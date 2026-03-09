import { PoolClient } from "pg";
import { getPool } from "../db";

/**
 * A cluster of highly-similar episodic memories eligible for consolidation.
 *
 * Found by walking the `similar_to` edge graph: pick a seed memory,
 * then gather all active episodic neighbors with edge weight >= threshold
 * that were created within the age window.
 */
export interface ConsolidationCluster {
  /** The seed memory that anchors this cluster. */
  seed_memory_id: string;
  tenant_id: string;
  workspace_id: string;
  /** All memory IDs in the cluster (including seed). */
  member_ids: string[];
  /** Average similarity weight across all intra-cluster edges. */
  avg_similarity: number;
}

/**
 * A row returned by the cluster-finding query: each row is a connected
 * pair (seed → neighbor) where both are active episodic and within the
 * age/similarity window.
 */
interface ClusterEdgeRow {
  src_memory_id: string;
  dst_memory_id: string;
  weight: number;
  tenant_id: string;
  workspace_id: string;
}

export const consolidationRepo = {
  /**
   * Find clusters of active episodic memories connected by `similar_to`
   * edges with weight >= `similarityThreshold`, created within the last
   * `maxAgeDays` days.
   *
   * Strategy (greedy single-linkage):
   *  1. Fetch all qualifying edges (similarity >= threshold, both active episodic,
   *     within age window).
   *  2. Build an adjacency list and greedily form clusters via BFS/DFS.
   *  3. Only return clusters with size >= minClusterSize.
   *  4. Return at most `limit` clusters sorted by avg similarity descending.
   *
   * This runs in the lifecycle-worker on a schedule, so we can afford a
   * slightly heavier query.
   */
  async findClusters(
    similarityThreshold: number,
    maxAgeDays: number,
    minClusterSize: number,
    limit: number
  ): Promise<ConsolidationCluster[]> {
    const pool = getPool();

    // Step 1: Fetch all qualifying edges
    const { rows } = await pool.query<ClusterEdgeRow>(
      `SELECT
         e.src_memory_id,
         e.dst_memory_id,
         e.weight,
         e.tenant_id,
         e.workspace_id
       FROM memory_edges e
       JOIN memories ma ON ma.memory_id = e.src_memory_id
         AND ma.status = 'active'
         AND ma.memory_type = 'episodic'
         AND ma.pinned = false
         AND ma.created_at >= now() - ($2 || ' days')::interval
       JOIN memories mb ON mb.memory_id = e.dst_memory_id
         AND mb.status = 'active'
         AND mb.memory_type = 'episodic'
         AND mb.pinned = false
         AND mb.created_at >= now() - ($2 || ' days')::interval
       WHERE e.edge_type = 'similar_to'
         AND e.weight >= $1
       ORDER BY e.weight DESC`,
      [similarityThreshold, maxAgeDays]
    );

    if (rows.length === 0) return [];

    // Step 2: Build adjacency list (undirected)
    const adj = new Map<string, Set<string>>();
    const edgeWeights = new Map<string, number>(); // "a|b" → weight
    const tenantMap = new Map<string, { tenant_id: string; workspace_id: string }>();

    for (const row of rows) {
      const { src_memory_id: a, dst_memory_id: b } = row;

      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);

      const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeWeights.set(edgeKey, row.weight);

      tenantMap.set(a, { tenant_id: row.tenant_id, workspace_id: row.workspace_id });
      tenantMap.set(b, { tenant_id: row.tenant_id, workspace_id: row.workspace_id });
    }

    // Step 3: BFS to find connected components
    const visited = new Set<string>();
    const clusters: ConsolidationCluster[] = [];

    for (const seed of adj.keys()) {
      if (visited.has(seed)) continue;

      const component: string[] = [];
      const queue: string[] = [seed];
      visited.add(seed);

      while (queue.length > 0) {
        const node = queue.shift()!;
        component.push(node);

        for (const neighbor of adj.get(node) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      if (component.length < minClusterSize) continue;

      // Compute average similarity across intra-cluster edges
      let totalWeight = 0;
      let edgeCount = 0;
      for (let i = 0; i < component.length; i++) {
        for (let j = i + 1; j < component.length; j++) {
          const key =
            component[i] < component[j]
              ? `${component[i]}|${component[j]}`
              : `${component[j]}|${component[i]}`;
          const w = edgeWeights.get(key);
          if (w !== undefined) {
            totalWeight += w;
            edgeCount++;
          }
        }
      }

      const tw = tenantMap.get(seed)!;

      clusters.push({
        seed_memory_id: seed,
        tenant_id: tw.tenant_id,
        workspace_id: tw.workspace_id,
        member_ids: component,
        avg_similarity: edgeCount > 0 ? totalWeight / edgeCount : 0,
      });
    }

    // Step 4: Sort by avg_similarity descending, take top `limit`
    clusters.sort((a, b) => b.avg_similarity - a.avg_similarity);
    return clusters.slice(0, limit);
  },

  /**
   * Insert the new consolidated semantic memory and return its ID.
   */
  async insertConsolidatedMemory(
    client: PoolClient,
    params: {
      tenant_id: string;
      workspace_id: string;
      user_id: string;
      content_raw: string;
      tags: string[];
      stability_score: number;
    }
  ): Promise<string> {
    const { rows } = await client.query<{ memory_id: string }>(
      `INSERT INTO memories
         (tenant_id, workspace_id, user_id, memory_type, content_raw,
          tags, stability_score, importance, status)
       VALUES ($1, $2, $3, 'semantic', $4, $5::jsonb, $6, 0.5, 'active')
       RETURNING memory_id`,
      [
        params.tenant_id,
        params.workspace_id,
        params.user_id,
        params.content_raw,
        JSON.stringify(params.tags),
        params.stability_score,
      ]
    );
    return rows[0].memory_id;
  },

  /**
   * Record the consolidation link in the memory_consolidations table.
   */
  async insertConsolidationRecord(
    client: PoolClient,
    params: {
      tenant_id: string;
      workspace_id: string;
      target_memory_id: string;
      source_memory_ids: string[];
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO memory_consolidations
         (tenant_id, workspace_id, target_memory_id, source_memory_ids, metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        params.tenant_id,
        params.workspace_id,
        params.target_memory_id,
        JSON.stringify(params.source_memory_ids),
        JSON.stringify(params.metadata),
      ]
    );
  },
};
