import express, { ErrorRequestHandler } from "express";
import { memoryRouter } from "./routes/memory";
import { memoryForgetRouter } from "./routes/memoryForget";
import { adminConfigRouter } from "./routes/adminConfig";
import { factsRouter } from "./routes/facts";
import { healthRouter } from "./routes/health";
import type { ErrorResponse } from "@hybrid-memory/shared-types";
import { ErrorCode } from "@hybrid-memory/shared-types";
import { trace } from "./middleware/trace";
import { logger } from "./observability/logger";
import { registry } from "./observability/metrics";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ── Trace middleware (before routes) ─────────────────────────
app.use(trace);

// ── Routes ───────────────────────────────────────────────────
app.use("/v1/memory", memoryRouter);
app.use("/v1/memory", memoryForgetRouter);
app.use("/v1/admin", adminConfigRouter);
app.use("/v1/facts", factsRouter);

// ── Health checks ────────────────────────────────────────────
app.use(healthRouter);

// ── Metrics endpoint ─────────────────────────────────────────
app.get("/metrics", (_req, res) => {
  res.json(registry.toJSON());
});

// ── Global error handler ─────────────────────────────────────
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

app.listen(PORT, () => {
  logger.info("server_start", { port: Number(PORT) });
});

export { app };
