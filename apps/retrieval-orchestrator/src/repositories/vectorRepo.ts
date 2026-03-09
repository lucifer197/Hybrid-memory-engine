import { getPool } from "../db";
import { MemoryType } from "@hybrid-memory/shared-types";
import { withTimeout, withRetry, createLogger } from "@hybrid-memory/observability";
import { getEnv } from "../config/env";
import { timeoutTotal, retryAttemptTotal } from "../observability/metrics";
import { buildPrivacyScopeClause } from "../services/privacyFilter";

const log = createLogger("retrieval-orchestrator", "vectorRepo");

export interface VectorHit {
  chunk_id: string;
  memory_id: string;
  chunk_text: string;
  chunk_index: number;
  distance: number;
  // parent memory fields
  memory_type: MemoryType;
  status: string;
  created_at: Date;
  metadata: Record<string, unknown>;
  stability_score: number;
  importance: number;
  last_accessed_at: Date;
  pinned: boolean;
}

export interface VectorSearchParams {
  embedding: number[];
  tenantId: string;
  workspaceId: string;
  userId: string;
  limit: number;
  memoryTypes?: MemoryType[];
  sessionId?: string;
  after?: string;
  before?: string;
}

/**
 * Format a number[] as a pgvector literal: '[0.1,0.2,...]'
 */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Cosine-similarity search against chunk_embeddings + joined memory metadata.
 */
export async function vectorSearch(
  params: VectorSearchParams
): Promise<VectorHit[]> {
  const pool = getPool();

  const conditions: string[] = [
    "ce.tenant_id = $2",
    "ce.workspace_id = $3",
    "m.status IN ('active', 'archived')",
  ];
  const values: unknown[] = [
    toVectorLiteral(params.embedding),
    params.tenantId,
    params.workspaceId,
  ];

  let paramIdx = 4;

  if (params.memoryTypes?.length) {
    conditions.push(`m.memory_type = ANY($${paramIdx}::text[])`);
    values.push(params.memoryTypes);
    paramIdx++;
  }

  if (params.sessionId) {
    conditions.push(`m.session_id = $${paramIdx}`);
    values.push(params.sessionId);
    paramIdx++;
  }

  if (params.after) {
    conditions.push(`m.created_at >= $${paramIdx}::timestamptz`);
    values.push(params.after);
    paramIdx++;
  }

  if (params.before) {
    conditions.push(`m.created_at <= $${paramIdx}::timestamptz`);
    values.push(params.before);
    paramIdx++;
  }

  // Privacy scope enforcement
  const privacy = buildPrivacyScopeClause(
    { tenantId: params.tenantId, workspaceId: params.workspaceId, userId: params.userId },
    "m",
    paramIdx
  );
  conditions.push(privacy.clause);
  values.push(...privacy.params);
  paramIdx = privacy.nextParamIdx;

  values.push(params.limit);

  const sql = `
    SELECT
      ce.chunk_id,
      mc.memory_id,
      mc.chunk_text,
      mc.chunk_index,
      ce.embedding <=> $1::vector AS distance,
      m.memory_type,
      m.status,
      m.created_at,
      m.metadata,
      m.stability_score,
      COALESCE(m.importance, 0) AS importance,
      COALESCE(m.last_accessed_at, m.created_at) AS last_accessed_at,
      COALESCE(m.pinned, false) AS pinned
    FROM chunk_embeddings ce
    JOIN memory_chunks mc ON mc.chunk_id = ce.chunk_id
    JOIN memories m ON m.memory_id = mc.memory_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY distance
    LIMIT $${paramIdx}
  `;

  const env = getEnv();

  const { rows } = await withRetry(
    () =>
      withTimeout(
        pool.query<VectorHit>(sql, values),
        env.VECTOR_SEARCH_TIMEOUT_MS,
        "vectorSearch"
      ),
    {
      maxAttempts: 2,
      baseDelayMs: 300,
      onRetry: (err, attempt, delay) => {
        retryAttemptTotal.inc({ operation: "vectorSearch" });
        log.warn("vector_search_retry", {
          attempt,
          delay_ms: delay,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    }
  );
  return rows;
}
