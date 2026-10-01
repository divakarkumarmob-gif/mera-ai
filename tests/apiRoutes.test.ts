import { describe, it, expect } from "vitest";
import { createApiRouter } from "../src/routes/apiRoutes";
import { createTelephonyRouter } from "../src/routes/telephonyRoutes";
import { createSecurityRouter } from "../src/routes/securityRoutes";
import { createMemoryRouter } from "../src/routes/memoryRoutes";
import { createMultimediaRouter } from "../src/routes/multimediaRoutes";
import { createBotRouter } from "../src/routes/botRoutes";
import { createAgentToolsRouter } from "../src/routes/agentToolsRoutes";

describe("Modular API Subsystem Routing", () => {
  const dummyContext = {
    getBaileysEnabled: () => true,
    setBaileysEnabled: () => {},
    getActiveConnectionsCount: () => 1,
  };

  it("should initialize master router with all sub-routers attached", () => {
    const masterRouter = createApiRouter(dummyContext);
    expect(masterRouter).toBeDefined();
    expect(masterRouter.stack).toBeDefined();
    expect(masterRouter.stack.length).toBeGreaterThan(5);
  });

  it("should instantiate individual domain sub-routers cleanly", () => {
    const telephony = createTelephonyRouter();
    const security = createSecurityRouter();
    const memory = createMemoryRouter();
    const multimedia = createMultimediaRouter();
    const bot = createBotRouter(dummyContext);
    const agentTools = createAgentToolsRouter();

    expect(telephony).toBeDefined();
    expect(security).toBeDefined();
    expect(memory).toBeDefined();
    expect(multimedia).toBeDefined();
    expect(bot).toBeDefined();
    expect(agentTools).toBeDefined();
  });

  it("should register health and core route paths on master router stack", () => {
    const masterRouter = createApiRouter(dummyContext);

    // Extract directly mounted routes
    const directRoutes = masterRouter.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(directRoutes).toContain("/health");

    // Extract sub-router router layers
    const routerLayers = masterRouter.stack.filter(
      (layer: any) => layer.name === "router" && layer.handle?.stack
    );
    expect(routerLayers.length).toBeGreaterThanOrEqual(6);
  });
});
