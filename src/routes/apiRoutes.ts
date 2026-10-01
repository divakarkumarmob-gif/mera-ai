/**
 * FRIDAY AI — Master Express REST API Router Hub
 * Modular domain routers for telephony, security, memory, multimedia, bots, and agent automation tools.
 */

import { Router } from "express";
import { createTelephonyRouter } from "./telephonyRoutes";
import { createSecurityRouter } from "./securityRoutes";
import { createMemoryRouter } from "./memoryRoutes";
import { createMultimediaRouter } from "./multimediaRoutes";
import { createBotRouter, BotRoutesContext } from "./botRoutes";
import { createAgentToolsRouter } from "./agentToolsRoutes";

export interface ApiRoutesContext extends BotRoutesContext {
  getBaileysEnabled: () => boolean;
  setBaileysEnabled: (v: boolean) => void;
  getActiveConnectionsCount: () => number;
}

/**
 * Creates and mounts all domain sub-routers onto the master express router.
 */
export function createApiRouter(context: ApiRoutesContext): Router {
  const masterRouter = Router();

  // Root health check endpoint
  masterRouter.get("/health", (_req, res) => res.json({ ok: true, status: "healthy", timestamp: Date.now() }));

  // Mount domain sub-routers
  masterRouter.use(createTelephonyRouter());
  masterRouter.use(createSecurityRouter());
  masterRouter.use(createMemoryRouter());
  masterRouter.use(createMultimediaRouter());
  masterRouter.use(createBotRouter(context));
  masterRouter.use(createAgentToolsRouter());

  return masterRouter;
}

// Export sub-router factories for targeted unit and integration testing
export {
  createTelephonyRouter,
  createSecurityRouter,
  createMemoryRouter,
  createMultimediaRouter,
  createBotRouter,
  createAgentToolsRouter,
};
