// ── Enums ────────────────────────────────────────────────────
export { MemoryType } from "./enums/memoryType";
export { PrivacyScope } from "./enums/privacyScope";
export { EdgeType } from "./enums/edgeType";
export { EntityType } from "./enums/entityType";

// ── DTOs ─────────────────────────────────────────────────────
export type {
  WriteTurnRequest,
  WriteTurnResponse,
  MessageDTO,
  ToolCallDTO,
} from "./dto/writeTurn";

export type {
  RetrieveContextRequest,
  RetrieveContextResponse,
  RetrieveFilters,
  MemoryRefDTO,
  FactRefDTO,
  DebugInfo,
  PipelineDebug,
} from "./dto/retrieveContext";

export { ErrorCode } from "./dto/error";
export type { ErrorResponse } from "./dto/error";

export type { EmbedJob } from "./dto/embedJob";
export type { GraphJob } from "./dto/graphJob";
export type { LifecycleJob, AccessJob, ReinforceJob } from "./dto/lifecycleJob";
export type { ForgetRequest, ForgetResponse } from "./dto/forget";
export type { ConsolidationJob } from "./dto/consolidationJob";
export type {
  ConfirmFactRequest,
  ConfirmFactResponse,
  RejectFactRequest,
  RejectFactResponse,
  CorrectFactRequest,
  CorrectFactResponse,
} from "./dto/factsFeedback";

// ── Validation schemas ───────────────────────────────────────
export {
  WriteTurnRequestSchema,
  type ValidatedWriteTurnRequest,
} from "./validation/writeTurn.schema";

export {
  RetrieveContextRequestSchema,
  type ValidatedRetrieveContextRequest,
} from "./validation/retrieveContext.schema";

export {
  ForgetRequestSchema,
  type ValidatedForgetRequest,
} from "./validation/forget.schema";
