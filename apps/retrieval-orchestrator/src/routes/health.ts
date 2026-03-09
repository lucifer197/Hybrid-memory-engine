import { Router } from "express";
import { liveness, readiness } from "../services/healthService";

export const healthRouter = Router();

healthRouter.get("/livez", liveness);
healthRouter.get("/readyz", readiness);
healthRouter.get("/health", liveness);
