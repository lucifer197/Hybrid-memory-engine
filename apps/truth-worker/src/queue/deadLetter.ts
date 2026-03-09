import type { DeadLetterEntry } from "@hybrid-memory/observability";
import { createLogger } from "@hybrid-memory/observability";
import { getPool } from "../db";

const log = createLogger("truth-worker", "deadLetter");

export async function persistDeadLetter(entry: DeadLetterEntry): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO dead_letter_jobs (job_type, queue_name, payload, error_message, stack_trace, attempt_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.job_type,
        entry.queue_name,
        JSON.stringify(entry.payload),
        entry.error_message,
        entry.stack_trace,
        entry.attempt_count,
        entry.created_at,
      ]
    );
  } catch (err) {
    log.error("persist_dead_letter_failed", {
      error: err instanceof Error ? err.message : String(err),
      job_type: entry.job_type,
    });
  }
}
