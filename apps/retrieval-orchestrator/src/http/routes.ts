import { Router } from "express";
import { retrieveController } from "./controllers/retrieveController";
import {
  getConfigController,
  putConfigController,
} from "./controllers/adminConfigController";

export const internalRouter = Router();

// Internal endpoint — called by api-gateway
internalRouter.post("/internal/memory/retrieve", retrieveController);

// Admin config endpoints — called by api-gateway
internalRouter.get("/internal/config/:tenant_id/:workspace_id", getConfigController);
internalRouter.put("/internal/config/:tenant_id/:workspace_id", putConfigController);
