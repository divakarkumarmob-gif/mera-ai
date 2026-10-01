import { Router } from "express";
import { appSecurityService } from "../services/appSecurityService";
import { serverFirewallService } from "../services/serverFirewallService";
import { humanBotFirewallService } from "../services/humanBotFirewallService";
import { networkDeviceScannerService } from "../services/networkDeviceScannerService";
import { voiceBiometricsService } from "../services/voiceBiometricsService";
import { sherlockService } from "../services/sherlockService";
import { theHarvesterService } from "../services/theHarvesterService";
import { sqlMapService } from "../services/sqlMapService";
import { niktoService } from "../services/niktoService";
import { socialEngineerToolkitService } from "../services/socialEngineerToolkitService";
import { johnTheRipperService } from "../services/johnTheRipperService";

export function createSecurityRouter(): Router {
  const router = Router();

  // ── Firewall & Protection Telemetry ────────────────────────────────────────
  router.get("/api/security/firewall-stats", async (_req, res) => {
    try {
      const stats = serverFirewallService.getStats();
      res.json({ ok: true, stats });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/firewall/social-status", (_req, res) => {
    res.json({ ok: true, ...humanBotFirewallService.getStats() });
  });

  // ── App Key Security Endpoints ────────────────────────────────────────────
  router.get("/api/app-key/status", async (_req, res) => {
    try {
      const activeKey = await appSecurityService.getAppKey();
      res.json({ ok: true, isConfigured: !!activeKey });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  router.post("/api/app-key/verify", async (req, res) => {
    try {
      const { key, username, password } = req.body || {};
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

      const verifyRes = await appSecurityService.verifyUserLogin(
        String(username || "").trim(),
        String(password || key || "").trim(),
        clientIp,
        userAgent
      );

      if (verifyRes.blocked) {
        return res.status(403).json(verifyRes);
      }
      if (verifyRes.rateLimited) {
        return res.status(429).json(verifyRes);
      }

      res.json(verifyRes);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Verification failed" });
    }
  });

  router.get("/api/app-key/session-check", (req, res) => {
    const token =
      (req.headers["x-app-key-token"] as string) ||
      (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null) ||
      (req.query["token"] as string);

    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
    const userAgent = (req.headers["user-agent"] as string) || "Unknown Device";

    if (!token || !appSecurityService.verifySessionToken(token, clientIp, userAgent)) {
      return res.status(401).json({ ok: false, valid: false, error: "SESSION_REVOKED", message: "Session expired or revoked by Boss." });
    }

    res.json({ ok: true, valid: true });
  });

  // ── Blocked Clients Management ─────────────────────────────────────────────
  router.get("/api/security/blocked-clients", async (_req, res) => {
    try {
      const list = await appSecurityService.listBlockedIps();
      res.json({ ok: true, blockedList: list });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to list blocked clients" });
    }
  });

  router.post("/api/security/unblock", async (req, res) => {
    try {
      const { ip, masterKey } = req.body || {};
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && (!masterKey || masterKey.trim() !== activeKey.trim())) {
        return res.status(403).json({ ok: false, error: "MASTER_KEY_REQUIRED", message: "Boss's Master App Key required to unblock clients." });
      }
      const unblocked = await appSecurityService.unblockIp(ip);
      res.json({ ok: unblocked, ip, message: unblocked ? `IP ${ip} successfully unblocked.` : `IP ${ip} was not in the blocked list.` });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to unblock client" });
    }
  });

  router.get("/api/security/active-devices", async (_req, res) => {
    try {
      const devices = await appSecurityService.getActiveSessions();
      res.json({ ok: true, devices, count: devices.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  router.post("/api/security/logout-all", async (req, res) => {
    try {
      const { senderName, masterKey } = req.body || {};
      const activeKey = await appSecurityService.getAppKey();
      if (activeKey && masterKey !== activeKey) {
        return res.status(403).json({ ok: false, error: "UNAUTHORIZED", message: "Master App Key required to trigger remote logout." });
      }
      const result = await appSecurityService.logoutAll("Remote logout initiated from Dashboard", senderName || "Dashboard User");
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || e });
    }
  });

  // ── Network Device Radar & Recon Endpoints ─────────────────────────────────
  router.get("/api/network/connected-devices", async (req, res) => {
    try {
      const quick = req.query.quick === "true";
      const devices = await networkDeviceScannerService.scanLocalSubnet(quick);
      res.json({ ok: true, count: devices.length, devices });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Network scan failed" });
    }
  });

  router.get("/api/network/wifi-radar", async (_req, res) => {
    try {
      const radar = await networkDeviceScannerService.getWifiRadar();
      res.json({ ok: true, ...radar });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "WiFi radar failed" });
    }
  });

  router.get("/api/network/wifi-recon", async (_req, res) => {
    try {
      const recon = await networkDeviceScannerService.performWifiRecon();
      res.json({ ok: true, ...recon });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "WiFi recon failed" });
    }
  });

  // ── Voice Biometrics & Security Identification ─────────────────────────────
  router.get("/api/voice-biometrics/profiles", async (_req, res) => {
    try {
      const profiles = await voiceBiometricsService.listProfiles();
      res.json({ ok: true, profiles });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to list profiles" });
    }
  });

  router.post("/api/voice-biometrics/start-enroll", async (req, res) => {
    try {
      const { name, relation, pin } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
      const prompt = await voiceBiometricsService.startEnrollment(String(name), relation, pin);
      res.json({ ok: true, ...prompt });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to start enrollment" });
    }
  });

  router.post("/api/voice-biometrics/record-sample", async (req, res) => {
    try {
      const { name, audioBase64 } = req.body || {};
      if (!name || !audioBase64) return res.status(400).json({ ok: false, error: "Name and audio sample are required" });
      const buffer = Buffer.from(audioBase64, "base64");
      const result = await voiceBiometricsService.recordEnrollmentSample(String(name), buffer);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to record sample" });
    }
  });

  router.post("/api/voice-biometrics/delete-profile", async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
      const result = await voiceBiometricsService.deleteProfile(String(name));
      res.json({ ok: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to delete profile" });
    }
  });

  router.post("/api/voice-biometrics/update-pin", async (req, res) => {
    try {
      const { name, pin } = req.body || {};
      if (!name || !pin) return res.status(400).json({ ok: false, error: "Name and pin are required" });
      const result = await voiceBiometricsService.updatePin(String(name), String(pin));
      res.json({ ok: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "Failed to update pin" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // OSINT & RECONNAISSANCE TOOLKIT (Sherlock, Harvester, SQLMap, Nikto, SET, John)
  // ══════════════════════════════════════════════════════════════════════════

  // Sherlock
  router.get("/api/osint/sherlock/status", (_req, res) => {
    res.json({ ok: true, ...sherlockService.getStatus() });
  });

  router.post("/api/osint/sherlock/search", async (req, res) => {
    try {
      const { username, siteCategories, timeout } = req.body || {};
      if (!username || typeof username !== "string") {
        return res.status(400).json({ ok: false, error: "username is required" });
      }
      const results = await sherlockService.searchUsername(username.trim(), {
        siteCategories: Array.isArray(siteCategories) ? siteCategories : undefined,
        timeout: timeout ? Number(timeout) : 30,
      });
      res.json({ ok: true, results });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sherlock_search_failed" });
    }
  });

  router.get("/api/osint/sherlock/sites", async (_req, res) => {
    try {
      const sites = await sherlockService.getSupportedSites();
      res.json({ ok: true, totalSites: sites.length, sites });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sherlock_sites_failed" });
    }
  });

  // TheHarvester
  router.get("/api/osint/harvester/status", (_req, res) => {
    res.json({ ok: true, ...theHarvesterService.getStatus() });
  });

  router.post("/api/osint/harvester/harvest", async (req, res) => {
    try {
      const { domain, resolveIps, shodanScan, virusTotalKey, hunterKey } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }
      const report = await theHarvesterService.harvest(domain.trim(), {
        resolveIps: resolveIps !== false,
        shodanScan: shodanScan !== false,
        virusTotalKey,
        hunterKey,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "harvester_failed" });
    }
  });

  router.post("/api/osint/harvester/subdomains", async (req, res) => {
    try {
      const { domain } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }
      const result = await theHarvesterService.findSubdomains(domain.trim());
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "subdomain_scan_failed" });
    }
  });

  router.post("/api/osint/harvester/dns", async (req, res) => {
    try {
      const { domain } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }
      const result = await theHarvesterService.getDnsRecords(domain.trim());
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "dns_lookup_failed" });
    }
  });

  router.post("/api/osint/harvester/ip-scan", async (req, res) => {
    try {
      const { ip } = req.body || {};
      if (!ip || typeof ip !== "string") {
        return res.status(400).json({ ok: false, error: "ip is required" });
      }
      const result = await theHarvesterService.scanIp(ip.trim());
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "ip_scan_failed" });
    }
  });

  // SQLMap
  router.get("/api/osint/sqlmap/status", (_req, res) => {
    res.json({ ok: true, ...sqlMapService.getStatus() });
  });

  router.post("/api/osint/sqlmap/scan", async (req, res) => {
    try {
      const { url, method, postData, params, cookies, techniques, timeThreshold } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const report = await sqlMapService.scan(url.trim(), {
        method: method || "GET",
        postData,
        params: Array.isArray(params) ? params : undefined,
        cookies,
        techniques: Array.isArray(techniques) ? techniques : undefined,
        timeThreshold: timeThreshold ? Number(timeThreshold) : undefined,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "sqlmap_scan_failed" });
    }
  });

  router.post("/api/osint/sqlmap/quick-test", async (req, res) => {
    try {
      const { url, param, payload } = req.body || {};
      if (!url || !param || !payload) {
        return res.status(400).json({ ok: false, error: "url, param, and payload are required" });
      }
      const result = await sqlMapService.quickTest(String(url), String(param), String(payload));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "quick_test_failed" });
    }
  });

  router.post("/api/osint/sqlmap/analyze-url", async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const analysis = sqlMapService.analyzeUrl(url.trim());
      res.json({ ok: true, ...analysis });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "analyze_url_failed" });
    }
  });

  router.get("/api/osint/sqlmap/payloads", (_req, res) => {
    try {
      const payloads = sqlMapService.getPayloads();
      res.json({ ok: true, ...payloads });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "payloads_fetch_failed" });
    }
  });

  // Nikto
  router.get("/api/osint/nikto/status", (_req, res) => {
    res.json({ ok: true, ...niktoService.getStatus() });
  });

  router.post("/api/osint/nikto/scan", async (req, res) => {
    try {
      const { url, checkPaths, checkHeaders, checkMethods, maxPaths, concurrency } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const report = await niktoService.scan(url.trim(), {
        checkPaths: checkPaths !== false,
        checkHeaders: checkHeaders !== false,
        checkMethods: checkMethods !== false,
        maxPaths: maxPaths ? Number(maxPaths) : undefined,
        concurrency: concurrency ? Number(concurrency) : 15,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "nikto_scan_failed" });
    }
  });

  router.post("/api/osint/nikto/headers-only", async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, error: "url is required" });
      }
      const report = await niktoService.scan(url.trim(), {
        checkPaths: false,
        checkHeaders: true,
        checkMethods: true,
        maxPaths: 0,
      });
      res.json({ ok: true, report });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "header_check_failed" });
    }
  });

  // Social Engineer Toolkit (SET)
  router.get("/api/osint/set/status", (_req, res) => {
    res.json({ ok: true, ...socialEngineerToolkitService.getStatus() });
  });

  router.get("/api/osint/set/phishing-templates", (req, res) => {
    try {
      const category = req.query.category as any;
      const templates = socialEngineerToolkitService.getPhishingTemplates(category);
      res.json({ ok: true, count: templates.length, templates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/osint/set/generate-phishing", (req, res) => {
    try {
      const { templateId, targetName, targetEmail, phishingLink, companyName, senderName } = req.body || {};
      if (!templateId) return res.status(400).json({ ok: false, error: "templateId is required" });
      const result = socialEngineerToolkitService.generatePhishingEmail(String(templateId), {
        targetName, targetEmail, phishingLink, companyName, senderName,
      });
      if (!result.template) return res.status(404).json({ ok: false, error: "Template not found" });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/osint/set/pretexting", (req, res) => {
    try {
      const scenario = req.query.scenario as string | undefined;
      const scripts = socialEngineerToolkitService.getPretextingScripts(scenario);
      res.json({ ok: true, count: scripts.length, scripts });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/osint/set/smishing", (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = socialEngineerToolkitService.getSmishingTemplates(category);
      res.json({ ok: true, count: templates.length, templates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/osint/set/vishing", (_req, res) => {
    try {
      const scripts = socialEngineerToolkitService.getVishingScripts();
      res.json({ ok: true, count: scripts.length, scripts });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/osint/set/analyze-url", (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ ok: false, error: "url is required" });
      const analysis = socialEngineerToolkitService.analyzePhishingUrl(String(url));
      res.json({ ok: true, analysis });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/osint/set/build-campaign", (req, res) => {
    try {
      const { name, type, targetDescription, duration } = req.body || {};
      if (!name || !type || !targetDescription) {
        return res.status(400).json({ ok: false, error: "name, type, and targetDescription are required" });
      }
      const campaign = socialEngineerToolkitService.buildCampaign({ name, type, targetDescription, duration });
      res.json({ ok: true, campaign });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/osint/set/awareness-quiz", (_req, res) => {
    try {
      const quiz = socialEngineerToolkitService.getAwarenessQuiz();
      res.json({ ok: true, count: quiz.length, quiz });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get("/api/osint/set/harvester-templates", (_req, res) => {
    try {
      const templates = socialEngineerToolkitService.getHarvesterTemplates();
      res.json({ ok: true, count: templates.length, templates });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // John the Ripper
  router.get("/api/osint/john/status", (_req, res) => {
    res.json({ ok: true, ...johnTheRipperService.getStatus() });
  });

  router.post("/api/osint/john/identify", (req, res) => {
    try {
      const { hash } = req.body || {};
      if (!hash) return res.status(400).json({ ok: false, error: "hash is required" });
      const result = johnTheRipperService.identifyHash(String(hash));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/osint/john/crack", async (req, res) => {
    try {
      const { hash, hashType, useOnlineLookup, customWordlist } = req.body || {};
      if (!hash) return res.status(400).json({ ok: false, error: "hash is required" });
      const result = await johnTheRipperService.crackHash(String(hash), {
        hashType,
        useOnlineLookup: useOnlineLookup !== false,
        customWordlist: Array.isArray(customWordlist) ? customWordlist : undefined,
      });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/osint/john/crack-multiple", async (req, res) => {
    try {
      const { hashes, hashType, useOnlineLookup } = req.body || {};
      if (!Array.isArray(hashes) || hashes.length === 0) {
        return res.status(400).json({ ok: false, error: "hashes array is required" });
      }
      if (hashes.length > 20) {
        return res.status(400).json({ ok: false, error: "Max 20 hashes per request" });
      }
      const results = await johnTheRipperService.crackMultiple(
        hashes.map(String),
        { hashType, useOnlineLookup: useOnlineLookup !== false }
      );
      res.json({ ok: true, results, crackedCount: results.filter(r => r.cracked).length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post("/api/osint/john/analyze-password", (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, error: "password is required" });
      const analysis = johnTheRipperService.analyzePasswordStrength(String(password));
      res.json({ ok: true, analysis });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
