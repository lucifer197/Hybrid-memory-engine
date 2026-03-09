import { MemoryType } from "../enums/memoryType";
import { PrivacyScope } from "../enums/privacyScope";

// ── Sub-types ────────────────────────────────────────────────

export interface MessageDTO {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface ToolCallDTO {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

// ── Request ──────────────────────────────────────────────────

export interface WriteTurnRequest {
  /** Tenant / org owning this data */
  tenant_id: string;
  /** Workspace within the tenant */
  workspace_id: string;
  /** End-user who generated the turn */
  user_id: string;
  /** Conversation session */
  session_id: string;
  /** Unique turn identifier (idempotency key) */
  turn_id: string;
  /** At least one message */
  messages: MessageDTO[];

  // ── Optional ──
  agent_id?: string;
  tool_calls?: ToolCallDTO[];
  metadata?: Record<string, unknown>;
  /** Hints the client can pass to bias memory extraction */
  memory_hints?: string[];
  /** Visibility scope for the memory (default: private) */
  privacy_scope?: PrivacyScope;
}

// ── Response ─────────────────────────────────────────────────

export interface WriteTurnResponse {
  turn_id: string;
  /** IDs of memories created or updated from this turn */
  memory_ids: string[];
  created_at: string;
}
