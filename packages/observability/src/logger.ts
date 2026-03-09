import { getTraceContext } from "./traceContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Standard context fields that can be bound to a logger instance. */
export interface LogContext {
  tenant_id?: string;
  workspace_id?: string;
  user_id?: string;
  memory_id?: string;
  fact_id?: string;
  job_id?: string;
  [key: string]: string | undefined;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  component: string;
  event: string;
  trace_id?: string;
  tenant_id?: string;
  workspace_id?: string;
  user_id?: string;
  memory_id?: string;
  fact_id?: string;
  job_id?: string;
  duration_ms?: number;
  status?: string | number;
  [key: string]: unknown;
}

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  child(component: string): Logger;
  /** Return a new Logger with the given context fields bound to every entry. */
  withContext(ctx: LogContext): Logger;
}

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function createLogger(
  service: string,
  component = "main",
  boundContext: LogContext = {}
): Logger {
  function log(
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const ctx = getTraceContext();

    // Merge: trace attributes < bound context < call-site data
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      component,
      event,
      ...(ctx?.traceId ? { trace_id: ctx.traceId } : {}),
      ...stripUndefined(ctx?.attributes ?? {}),
      ...stripUndefined(boundContext),
      ...data,
    };

    const output = JSON.stringify(entry);
    if (level === "error") {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  }

  return {
    debug: (event, data) => log("debug", event, data),
    info: (event, data) => log("info", event, data),
    warn: (event, data) => log("warn", event, data),
    error: (event, data) => log("error", event, data),
    child: (childComponent) => createLogger(service, childComponent, boundContext),
    withContext: (ctx) => createLogger(service, component, { ...boundContext, ...ctx }),
  };
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}
