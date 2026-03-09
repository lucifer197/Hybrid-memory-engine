import { z } from "zod";

export const ForgetRequestSchema = z
  .object({
    tenant_id: z.string().min(1, "tenant_id is required"),
    workspace_id: z.string().min(1, "workspace_id is required"),
    memory_id: z.string().uuid().optional(),
    user_id: z.string().min(1).optional(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (data) => data.memory_id || data.user_id,
    { message: "Either memory_id or user_id must be provided" }
  );

export type ValidatedForgetRequest = z.infer<typeof ForgetRequestSchema>;
