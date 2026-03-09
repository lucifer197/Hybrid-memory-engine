import { z } from "zod";
import { MemoryType } from "../enums/memoryType";
import { PrivacyScope } from "../enums/privacyScope";

const RetrieveFiltersSchema = z.object({
  memory_types: z
    .array(z.nativeEnum(MemoryType))
    .optional(),
  privacy_scope: z.nativeEnum(PrivacyScope).optional(),
  session_id: z.string().optional(),
  agent_id: z.string().optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
});

export const RetrieveContextRequestSchema = z.object({
  tenant_id: z.string().min(1, "tenant_id is required"),
  workspace_id: z.string().min(1, "workspace_id is required"),
  user_id: z.string().min(1, "user_id is required"),
  query: z.string().min(1, "query is required"),

  session_id: z.string().optional(),
  k: z
    .number()
    .int()
    .min(1)
    .max(20, "k must be at most 20")
    .default(8),
  filters: RetrieveFiltersSchema.optional(),
  debug: z.boolean().default(false),
});

export type ValidatedRetrieveContextRequest = z.infer<
  typeof RetrieveContextRequestSchema
>;
