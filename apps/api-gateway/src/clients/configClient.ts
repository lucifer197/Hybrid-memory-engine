import type { ErrorResponse } from "@hybrid-memory/shared-types";
import { getTraceId } from "@hybrid-memory/observability";

const RETRIEVAL_URL =
  process.env.RETRIEVAL_ORCHESTRATOR_URL ?? "http://localhost:3002";
const CONFIG_TIMEOUT_MS = parseInt(
  process.env.CONFIG_TIMEOUT_MS ?? "5000",
  10
);

export interface ConfigResult {
  status: number;
  body: Record<string, unknown> | ErrorResponse;
}

export async function getConfig(
  tenantId: string,
  workspaceId: string
): Promise<ConfigResult> {
  const res = await fetch(
    `${RETRIEVAL_URL}/internal/config/${encodeURIComponent(tenantId)}/${encodeURIComponent(workspaceId)}`,
    {
      headers: { "X-Trace-Id": getTraceId() },
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    }
  );

  const body = (await res.json()) as Record<string, unknown> | ErrorResponse;
  return { status: res.status, body };
}

export async function putConfig(
  tenantId: string,
  workspaceId: string,
  updates: Record<string, unknown>
): Promise<ConfigResult> {
  const res = await fetch(
    `${RETRIEVAL_URL}/internal/config/${encodeURIComponent(tenantId)}/${encodeURIComponent(workspaceId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Trace-Id": getTraceId(),
      },
      body: JSON.stringify(updates),
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    }
  );

  const body = (await res.json()) as Record<string, unknown> | ErrorResponse;
  return { status: res.status, body };
}
