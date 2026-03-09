import { z } from "zod";
import { PrivacyScope } from "../enums/privacyScope";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().min(1, "Message content must not be empty"),
});

const ToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.unknown()),
  result: z.string().optional(),
});

export const WriteTurnRequestSchema = z.object({
  tenant_id: z.string().min(1, "tenant_id is required"),
  workspace_id: z.string().min(1, "workspace_id is required"),
  user_id: z.string().min(1, "user_id is required"),
  session_id: z.string().min(1, "session_id is required"),
  turn_id: z.string().min(1, "turn_id is required"),
  messages: z
    .array(MessageSchema)
    .min(1, "At least one message is required"),

  agent_id: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
  memory_hints: z.array(z.string()).optional(),
  privacy_scope: z.nativeEnum(PrivacyScope).optional(),
});

export type ValidatedWriteTurnRequest = z.infer<typeof WriteTurnRequestSchema>;
