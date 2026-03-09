import { getPool, withTransaction } from "../db";
import { getEnv } from "../config/env";
import { eventRepo } from "../repositories/eventRepo";
import { memoryRepo } from "../repositories/memoryRepo";
import { consolidationRepo, type ConsolidationCluster } from "../repositories/consolidationRepo";
import { edgeRepo } from "../repositories/edgeRepo";
import { createLogger } from "@hybrid-memory/observability";
import { consolidatedCount, consolidateSweepLatency } from "../observability/metrics";

const log = createLogger("lifecycle-worker", "consolidate");

/**
 * Scheduled consolidation sweep (Step 5.7):
 *
 * Finds **clusters** (>= CONSOLIDATION_MIN_CLUSTER_SIZE) of active
 * episodic memories connected by `similar_to` edges with weight
 * >= CONSOLIDATION_SIMILARITY_THRESHOLD, created within the last
 * CONSOLIDATION_MAX_AGE_DAYS days.
 *
 * For each cluster:
 *   1. Merge content into a new semantic memory
 *      (stability = CONSOLIDATION_INITIAL_STABILITY)
 *   2. Create `consolidated_into` edges from each source → target
 *   3. Record the consolidation link in memory_consolidations
 *   4. Archive source episodic memories
 *   5. Log lifecycle events
 *
 * Returns count of consolidations performed.
 */
export async function runConsolidationSweep(): Promise<number> {
  const start = Date.now();
  const env = getEnv();

  const clusters = await consolidationRepo.findClusters(
    env.CONSOLIDATION_SIMILARITY_THRESHOLD,
    env.CONSOLIDATION_MAX_AGE_DAYS,
    env.CONSOLIDATION_MIN_CLUSTER_SIZE,
    env.CONSOLIDATION_BATCH_SIZE
  );

  if (clusters.length === 0) {
    log.info("no_clusters");
    return 0;
  }

  log.info("clusters_found", { count: clusters.length });

  const pool = getPool();
  let consolidated = 0;

  for (const cluster of clusters) {
    try {
      await processCluster(cluster, env.CONSOLIDATION_INITIAL_STABILITY);
      consolidated++;
    } catch (err) {
      log.error("cluster_failed", {
        seed_memory_id: cluster.seed_memory_id,
        size: cluster.member_ids.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const elapsed = Date.now() - start;
  consolidatedCount.inc({}, consolidated);
  consolidateSweepLatency.observe(elapsed);
  log.info("sweep_complete", {
    consolidated,
    clusters: clusters.length,
    elapsed_ms: elapsed,
  });
  return consolidated;
}

/**
 * Process a single cluster: fetch source content, merge, create
 * consolidated memory, add edges, archive sources.
 */
async function processCluster(
  cluster: ConsolidationCluster,
  initialStability: number
): Promise<void> {
  const pool = getPool();

  // Fetch content of all cluster members
  const { rows: sources } = await pool.query<{
    memory_id: string;
    content_raw: string;
    tags: string[];
    stability_score: number;
    user_id: string;
  }>(
    `SELECT memory_id, content_raw, tags, stability_score, user_id
     FROM memories
     WHERE memory_id = ANY($1) AND status = 'active'`,
    [cluster.member_ids]
  );

  // If too many were already archived/deleted, skip
  if (sources.length < (getEnv().CONSOLIDATION_MIN_CLUSTER_SIZE)) {
    log.info("cluster_too_small", {
      seed_memory_id: cluster.seed_memory_id,
      active_members: sources.length,
    });
    return;
  }

  const mergedContent =
    `[Consolidated from ${sources.length} episodic memories]\n\n` +
    sources.map((s) => s.content_raw).join("\n\n---\n\n");

  const mergedTags = [...new Set(sources.flatMap((s) => s.tags ?? []))];

  await withTransaction(async (client) => {
    // 1. Insert the consolidated semantic memory
    const targetMemoryId = await consolidationRepo.insertConsolidatedMemory(
      client,
      {
        tenant_id: cluster.tenant_id,
        workspace_id: cluster.workspace_id,
        user_id: sources[0].user_id,
        content_raw: mergedContent,
        tags: mergedTags,
        stability_score: initialStability,
      }
    );

    // 2. Create consolidated_into edges (source → target)
    await edgeRepo.insertConsolidatedIntoEdges(client, {
      tenant_id: cluster.tenant_id,
      workspace_id: cluster.workspace_id,
      source_memory_ids: sources.map((s) => s.memory_id),
      target_memory_id: targetMemoryId,
      weight: cluster.avg_similarity,
    });

    // 3. Record consolidation link
    await consolidationRepo.insertConsolidationRecord(client, {
      tenant_id: cluster.tenant_id,
      workspace_id: cluster.workspace_id,
      target_memory_id: targetMemoryId,
      source_memory_ids: sources.map((s) => s.memory_id),
      metadata: {
        avg_similarity: cluster.avg_similarity,
        cluster_size: sources.length,
        seed_memory_id: cluster.seed_memory_id,
      },
    });

    // 4. Archive source memories + log events
    for (const src of sources) {
      await memoryRepo.archive(client, src.memory_id);

      await eventRepo.logEvent(client, {
        tenant_id: cluster.tenant_id,
        workspace_id: cluster.workspace_id,
        memory_id: src.memory_id,
        event_type: "consolidated",
        metadata: {
          consolidated_into: targetMemoryId,
          avg_similarity: cluster.avg_similarity,
          cluster_size: sources.length,
        },
      });
    }

    // 5. Log creation event for the new consolidated memory
    await eventRepo.logEvent(client, {
      tenant_id: cluster.tenant_id,
      workspace_id: cluster.workspace_id,
      memory_id: targetMemoryId,
      event_type: "consolidated",
      metadata: {
        source_memory_ids: sources.map((s) => s.memory_id),
        avg_similarity: cluster.avg_similarity,
        cluster_size: sources.length,
      },
    });

    log.info("consolidated", {
      target_memory_id: targetMemoryId,
      source_count: sources.length,
      avg_similarity: cluster.avg_similarity,
    });
  });
}
