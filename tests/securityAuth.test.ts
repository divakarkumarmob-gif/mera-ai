import { describe, it, expect, beforeEach } from "vitest";
import { appSecurityService } from "../src/services/appSecurityService";

describe("Zero-Trust Security Barrier (appSecurityService)", () => {
  const testIp = "192.168.1.100";
  const testAgent = "Mozilla/5.0 Test Suite";

  beforeEach(async () => {
    await appSecurityService.unblockIp(testIp);
  });

  it("should generate and verify HMAC-SHA256 session tokens correctly", () => {
    const { token, sessionId } = appSecurityService.generateSessionToken(Date.now(), undefined, "boss", "boss");
    expect(token).toBeDefined();
    expect(sessionId).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    const isValid = appSecurityService.verifySessionToken(token, testIp, testAgent);
    expect(isValid).toBe(true);

    // Tampered token must fail
    const tamperedToken = token.slice(0, -4) + "XXXX";
    const isTamperedValid = appSecurityService.verifySessionToken(tamperedToken, testIp, testAgent);
    expect(isTamperedValid).toBe(false);
  });

  it("should identify unblocked IP initially", () => {
    const isBlocked = appSecurityService.isIpBlocked(testIp);
    expect(isBlocked).toBe(false);
  });

  it("should properly block and unblock a client IP", async () => {
    await appSecurityService.blockClient(testIp, testAgent, "Automated Test Suite Ban");
    expect(appSecurityService.isIpBlocked(testIp)).toBe(true);

    const unblocked = await appSecurityService.unblockIp(testIp);
    expect(unblocked).toBe(true);
    expect(appSecurityService.isIpBlocked(testIp)).toBe(false);
  });
});
