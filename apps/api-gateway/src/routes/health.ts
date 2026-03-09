import { Router } from "express";
import { liveness, readiness } from "../services/healthService";

export const healthRouter = Router();

healthRouter.get("/livez", liveness);
healthRouter.get("/readyz", readiness);
// Keep backwards-compatible /health as liveness
healthRouter.get("/health", liveness);
