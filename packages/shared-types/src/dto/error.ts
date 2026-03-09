export enum ErrorCode {
  BadRequest = "BAD_REQUEST",
  Unauthorized = "UNAUTHORIZED",
  Forbidden = "FORBIDDEN",
  NotFound = "NOT_FOUND",
  Conflict = "CONFLICT",
  RateLimited = "RATE_LIMITED",
  Internal = "INTERNAL_ERROR",
  ServiceUnavailable = "SERVICE_UNAVAILABLE",
}

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
