import { Router } from "express";
import { writeTurnController } from "./controllers/writeTurnController";
import { forgetController } from "./controllers/forgetController";
import {
  listFactsController,
  confirmFactController,
  rejectFactController,
  correctFactController,
} from "./controllers/factsController";

export const internalRouter = Router();

// Internal endpoints — called by api-gateway, not exposed publicly.
internalRouter.post("/internal/memory/turn", writeTurnController);
internalRouter.post("/internal/memory/forget", forgetController);

// Facts endpoints
internalRouter.get("/internal/facts", listFactsController);
internalRouter.post("/internal/facts/confirm", confirmFactController);
internalRouter.post("/internal/facts/reject", rejectFactController);
internalRouter.post("/internal/facts/correct", correctFactController);
