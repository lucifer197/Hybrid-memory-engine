import express, { ErrorRequestHandler } from "express";
import { internalRouter } from "./routes";
import { healthRouter } from "../routes/health";
import { getEnv } from "../config/env";
import { ErrorCode, type ErrorResponse } from "@hybrid-memory/shared-types";
import { traceMiddleware } from "@hybrid-memory/observability";
import { logger } from "../observability/logger";
import { registry } from "../observability/metrics";

const app = express();

app.use(express.json());

// ── Trace middleware (before routes) ─────────────────────────
app.use(
  traceMiddleware({
    service: "memory-service",
    logger,
  })
);

app.use(internalRouter);
app.use(healthRouter);

app.get("/metrics", (_req, res) => {
  res.json(registry.toJSON());
});

// Global error handler
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error("unhandled_error", {
    error: err instanceof Error ? err.message : String(err),
  });
  const body: ErrorResponse = {
    error: {
      code: ErrorCode.Internal,
      message: "An unexpected error occurred",
    },
  };
  res.status(500).json(body);
};
app.use(errorHandler);

const PORT = getEnv().PORT;

app.listen(PORT, () => {
  logger.info("server_start", { port: PORT });
});

export { app };
