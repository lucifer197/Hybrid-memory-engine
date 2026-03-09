import { PoolClient } from "pg";
import { EdgeType } from "@hybrid-memory/shared-types";
import { edgeRepo, type UpsertEdgeParams } from "../repositories/edgeRepo";
import { entityRepo, type InsertEntityParams } from "../repositories/entityRepo";
import {
  memoryReadRepo,
  type MemoryRow,
} from "../repositories/memoryReadRepo";
import { extractEntities } from "./entityExtractor";
import { getEnv } from "../config/env";

export interface BuildEdgesResult {
  same_session: number;
  follows: number;
  similar_to: number;
  shares_entity: number;
  entities_extracted: number;
}

/**
 * Build all graph edges for a newly created memory.
 * Runs inside a transaction. Idempotent — safe to re-run.
 */
export async function buildEdgesForMemory(
  client: PoolClient,
  memory: MemoryRow
): Promise<BuildEdgesResult> {
  const result: BuildEdgesResult = {
    same_session: 0,
    follows: 0,
    similar_to: 0,
    shares_entity: 0,
    entities_extracted: 0,
  };

  const { tenant_id, workspace_id, memory_id } = memory;

  // ── Rule 1: same_session edges ───────────────────────────
  if (memory.session_id) {
    const sessionMemories = await memoryReadRepo.findBySession(
      tenant_id,
      workspace_id,
      memory.session_id,
      memory_id
    );

    const sessionEdges: UpsertEdgeParams[] = sessionMemories.map((other) => ({
      tenant_id,
      workspace_id,
      src_memory_id: memory_id,
      dst_memory_id: other.memory_id,
      edge_type: EdgeType.SameSession,
      weight: 0.4,
    }));

    result.same_session = await edgeRepo.upsertEdges(client, sessionEdges);

    // ── Rule 2: follows edge (temporal adjacency) ────────────
    const previous = await memoryReadRepo.findPreviousInSession(
      tenant_id,
      workspace_id,
      memory.session_id,
      memory.created_at
    );

    if (previous) {
      await edgeRepo.upsertEdge(client, {
        tenant_id,
        workspace_id,
        src_memory_id: previous.memory_id,
        dst_memory_id: memory_id,
        edge_type: EdgeType.Follows,
        weight: 0.6,
      });
      result.follows = 1;
    }
  }

  // ── Rule 3: similar_to edges (semantic) ──────────────────
  const env = getEnv();
  const similarMemories = await memoryReadRepo.findSimilarByEmbedding(
    tenant_id,
    workspace_id,
    memory_id,
    env.SIMILAR_EDGE_LIMIT,
    env.SIMILAR_EDGE_THRESHOLD
  );

  const similarEdges: UpsertEdgeParams[] = similarMemories.map((s) => ({
    tenant_id,
    workspace_id,
    src_memory_id: memory_id,
    dst_memory_id: s.memory_id,
    edge_type: EdgeType.SimilarTo,
    weight: Math.min(1, Math.max(0, s.similarity)),
  }));

  result.similar_to = await edgeRepo.upsertEdges(client, similarEdges);

  // ── Rule 4: shares_entity edges ──────────────────────────
  // 4a. Extract entities from content
  const entities = extractEntities(memory.content_raw, memory.tags);
  result.entities_extracted = entities.length;

  // 4b. Store entities
  const entityParams: InsertEntityParams[] = entities.map((e) => ({
    tenant_id,
    workspace_id,
    memory_id,
    entity_type: e.entity_type,
    entity_value: e.entity_value,
    confidence: e.confidence,
  }));
  await entityRepo.upsertEntities(client, entityParams);

  // 4c. Find memories sharing entities and create edges
  const sharingMemories = await entityRepo.findMemoriesSharingEntities(
    client,
    tenant_id,
    workspace_id,
    memory_id
  );

  const entityEdges: UpsertEdgeParams[] = sharingMemories.map((s) => ({
    tenant_id,
    workspace_id,
    src_memory_id: memory_id,
    dst_memory_id: s.memory_id,
    edge_type: EdgeType.SharesEntity,
    weight: Math.min(0.7, Math.max(0.3, s.max_confidence * 0.7)),
    metadata: { shared_entities: s.shared_values },
  }));

  result.shares_entity = await edgeRepo.upsertEdges(client, entityEdges);

  return result;
}
