import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import {
  WriteTurnRequest,
  WriteTurnResponse,
  MemoryType,
  PrivacyScope,
  ErrorCode,
  type EmbedJob,
} from "@hybrid-memory/shared-types";
import { getTraceId } from "@hybrid-memory/observability";
import { withTransaction } from "../db";
import { turnWriteRepo } from "../repositories/turnWriteRepo";
import { memoryRepo } from "../repositories/memoryRepo";
import { chunkRepo } from "../repositories/chunkRepo";
import { chunkText } from "./chunking/deterministicChunker";
import { enqueueEmbedJob } from "../queue/embedProducer";
import { logger } from "../observability/logger";
import {
  writeTurnRequests,
  writeTurnLatency,
  memoryRowsCreated,
  chunksCreated,
  chunkCountDist,
  embedJobEnqueueCount,
} from "../observability/metrics";

const log = logger.child("writeTurn");

export interface WriteTurnResult extends WriteTurnResponse {
  trace_id: string;
}

/** Internal result that carries the embed job payload out of the transaction. */
interface TxResult {
  response: WriteTurnResult;
  embedJob: EmbedJob | null;
}

/**
 * Core write path.
 *
 * Inside one transaction:
 *  1. Check idempotency key
 *  2. Insert turn_writes (processing)
 *  3. Build transcript, insert memory
 *  4. Chunk transcript, insert chunks
 *  5. Mark turn_writes complete
 *
 * After commit:
 *  6. Enqueue embedding job (fire-and-forget)
 *     Embedding worker will enqueue graph job after embeddings exist.
 */
export async function createTurn(
  req: WriteTurnRequest
): Promise<WriteTurnResult> {
  const start = performance.now();
  writeTurnRequests.inc();
  const traceId = getTraceId();
  const requestHash = hashRequest(req);

  const { response, embedJob } = await withTransaction<TxResult>(
    async (client: PoolClient) => {
      // ── 1. Idempotency check ───────────────────────────────
      const existing = await turnWriteRepo.findByKey(
        client,
        req.tenant_id,
        req.workspace_id,
        req.session_id,
        req.turn_id
      );

      if (existing) {
        if (existing.status === "complete") {
          log.info("idempotent_replay", {
            turn_id: req.turn_id,
            memory_ids: existing.memory_ids,
          });
          return {
            response: {
              turn_id: req.turn_id,
              memory_ids: existing.memory_ids,
              created_at: existing.created_at.toISOString(),
              trace_id: traceId,
            },
            embedJob: null,
          };
        }

        if (existing.status === "processing") {
          const err = new Error("Turn is already being processed");
          (err as any).statusCode = 409;
          (err as any).errorCode = ErrorCode.Conflict;
          throw err;
        }

        // status === 'failed' → allow retry by falling through
      }

      // ── 2. Insert processing row ───────────────────────────
      const turnWrite = existing
        ? await retryFailed(client, existing.id)
        : await turnWriteRepo.insertProcessing(
            client,
            req.tenant_id,
            req.workspace_id,
            req.session_id,
            req.turn_id,
            requestHash
          );

      // ── 3. Build transcript + determine memory type ────────
      const transcript = req.messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join("\n\n");

      const memoryType = resolveMemoryType(req.memory_hints);

      // ── 4. Insert memory row ───────────────────────────────
      const memory = await memoryRepo.insertMemory(client, {
        tenant_id: req.tenant_id,
        workspace_id: req.workspace_id,
        user_id: req.user_id,
        agent_id: req.agent_id,
        session_id: req.session_id,
        turn_id: req.turn_id,
        memory_type: memoryType,
        content_raw: transcript,
        privacy_scope: req.privacy_scope ?? PrivacyScope.Private,
        tags: req.memory_hints ?? [],
        metadata: req.metadata ?? {},
      });

      const memoryIds = [memory.memory_id];
      memoryRowsCreated.inc();

      // ── 5. Chunk transcript + insert chunks ────────────────
      const chunks = chunkText(transcript);
      const chunkRows = await chunkRepo.insertChunks(
        client,
        memory.memory_id,
        chunks
      );
      chunksCreated.inc(undefined, chunkRows.length);

      // ── 6. Mark complete ───────────────────────────────────
      await turnWriteRepo.markComplete(client, turnWrite.id, memoryIds);

      const chunkIds = chunkRows.map((c) => c.chunk_id);
      const embeddingModel =
        process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

      log.info("committed", {
        turn_id: req.turn_id,
        memory_id: memory.memory_id,
        chunk_count: chunkIds.length,
      });

      chunkCountDist.observe(chunkIds.length);

      return {
        response: {
          turn_id: req.turn_id,
          memory_ids: memoryIds,
          created_at: memory.created_at.toISOString(),
          trace_id: traceId,
        },
        embedJob: {
          tenant_id: req.tenant_id,
          workspace_id: req.workspace_id,
          memory_id: memory.memory_id,
          chunk_ids: chunkIds,
          embedding_model: embeddingModel,
          // Forwarded to graph job after embeddings are inserted
          session_id: req.session_id,
          user_id: req.user_id,
          tags: req.memory_hints,
          trace_id: traceId,
        },
      };
    }
  );

  // ── 7. Enqueue AFTER commit (fire-and-forget) ──────────────
  // Embed job carries session_id/user_id/tags so the embedding worker
  // can forward them to the graph:jobs queue after embeddings exist.
  if (embedJob) {
    log.info("enqueue_embed_job", {
      turn_id: response.turn_id,
      memory_id: embedJob.memory_id,
      chunk_count: embedJob.chunk_ids.length,
    });
    embedJobEnqueueCount.inc();
    await enqueueEmbedJob(embedJob);
  }

  writeTurnLatency.observe(performance.now() - start);
  return response;
}

// ── Helpers ──────────────────────────────────────────────────

function hashRequest(req: WriteTurnRequest): string {
  return createHash("sha256").update(JSON.stringify(req)).digest("hex");
}

/** If the first memory hint matches a known MemoryType, use it. */
function resolveMemoryType(hints?: string[]): MemoryType {
  if (!hints?.length) return MemoryType.Episodic;
  const validTypes = new Set(Object.values(MemoryType) as string[]);
  const match = hints.find((h) => validTypes.has(h));
  return (match as MemoryType) ?? MemoryType.Episodic;
}

/** Reset a failed turn_writes row back to processing for retry. */
async function retryFailed(client: PoolClient, id: number) {
  const { rows } = await client.query(
    `UPDATE turn_writes
     SET status = 'processing', updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return rows[0];
}
