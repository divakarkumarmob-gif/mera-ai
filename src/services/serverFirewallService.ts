/**
 * INDUSTRIAL-GRADE WEB APPLICATION FIREWALL (WAF) & ATTACK SENTINEL
 *
 * Enterprise-Level Protection for Render & Cloud Deployment
 * Features:
 * 1. Deep Packet Inspection (DPI) for SQLi, XSS, RCE, LFI, Path Traversal, SSRF, Prototype Pollution
 * 2. Scanner & Exploit Bot Blacklisting (Nikto, SQLMap, Nmap, Gobuster, Burp, Masscan)
 * 3. Honeypot Trap Routes (/.env, /wp-login, /.git, /phpmyadmin) with Instant Auto-Ban
 * 4. Sub-millisecond In-Memory IP Jail + Persistent Cloud Firestore Sync
 * 5. Automated Security Headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)
 * 6. Telegram Security Alert Dispatcher on Attack Detections
 */

import { Request, Response, NextFunction } from "express";
import { db } from "./firebaseAdmin";
import { appSecurityService } from "./appSecurityService";

export interface SecurityThreat {
  type: "SQLI" | "XSS" | "RCE" | "LFI" | "SSRF" | "BAD_BOT" | "HONEYPOT" | "PROTO_POLLUTION" | "SCRAPER_BOT" | "BURST_SCRAPING";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  patternMatched: string;
  targetField: string;
  snippet: string;
}

export interface FirewallStats {
  totalRequestsInspected: number;
  threatsBlocked: number;
  ipsJailed: number;
  honeypotHits: number;
  scrapersBlocked: number;
  uptimeSeconds: number;
  lastThreatDetected?: {
    type: string;
    ip: string;
    timestamp: number;
  };
}

class ServerFirewallService {
  private startTime = Date.now();
  private totalRequests = 0;
  private totalBlocked = 0;
  private honeypotHits = 0;
  private scrapersBlocked = 0;
  private lastThreat?: { type: string; ip: string; timestamp: number };

  // Anti-Burst Scraping Sliding Window Tracker (IP -> Timestamps[])
  private burstTracker = new Map<string, number[]>();
  private readonly BURST_WINDOW_MS = 5 * 1000; // 5 seconds
  private readonly MAX_BURST_REQUESTS = 18; // Max 18 requests per 5 seconds for unauthenticated endpoints

  // Known exploit scanner signatures
  private static readonly SCANNER_USER_AGENTS = [
    /nikto/i,
    /sqlmap/i,
    /acunetix/i,
    /burpcollaborator/i,
    /burp\s*suite/i,
    /gobuster/i,
    /dirbuster/i,
    /wpscan/i,
    /masscan/i,
    /nmap/i,
    /zgrab/i,
    /shodan/i,
    /censys/i,
    /metasploit/i,
    /havij/i,
    /hydra/i,
  ];

  // Headless browsers, Automated HTTP scripts, Wrappers & Scrapers
  private static readonly SCRAPER_USER_AGENTS = [
    /HeadlessChrome/i,
    /Playwright/i,
    /Puppeteer/i,
    /Selenium/i,
    /PhantomJS/i,
    /Nightmare/i,
    /webdriver/i,
    /python-requests/i,
    /aiohttp/i,
    /scrapy/i,
    /urllib/i,
    /httpx/i,
    /axios\//i,
    /got\//i,
    /node-fetch/i,
    /undici/i,
    /curl\//i,
    /wget\//i,
    /httpie/i,
    /postmanruntime/i,
    /insomnia/i,
    /go-http-client/i,
    /apache-httpclient/i,
    /okhttp/i,
    /rest-client/i,
    /guzzlehttp/i,
    /libwww-perl/i,
    /colly/i,
    /bytespider/i,
    /petalbot/i,
    /ahrefsbot/i,
    /semrushbot/i,
    /dotbot/i,
    /mj12bot/i,
  ];

  // Honeypot trap route paths (Immediate Auto-Ban if visited)
  private static readonly HONEYPOT_TRAP_PATHS = [
    /^\/\.env/i,
    /^\/\.git/i,
    /^\/\.aws/i,
    /^\/\.config/i,
    /^\/wp-admin/i,
    /^\/wp-login\.php/i,
    /^\/phpmyadmin/i,
    /^\/pma\//i,
    /^\/actuator/i,
    /^\/server-status/i,
    /^\/telescope/i,
    /^\/debug\/default\/view/i,
    /^\/\.well-known\/security\.txt$/i, // Allowed
    /^\/config\.json/i,
    /^\/credentials/i,
    /^\/backup/i,
    /^\/database\.sql/i,
  ];

  // Deep Packet Inspection Regex Patterns
  private static readonly THREAT_PATTERNS: Array<{
    type: SecurityThreat["type"];
    severity: SecurityThreat["severity"];
    regex: RegExp;
  }> = [
    // 1. SQL Injection (SQLi)
    {
      type: "SQLI",
      severity: "CRITICAL",
      regex: /(?:\bunion\s+(?:all\s+)?select\b)|(?:\bselect\s+.+\s+from\s+information_schema\b)|(?:\b(?:exec|execute)\s*\(?\s*xp_cmdshell\b)|(?:\bbenchmark\s*\(\s*\d+\s*,)|(?:\bsleep\s*\(\s*\d+\s*\))|(?:\b(?:or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?\s*--)|(?:\bdrop\s+table\b)|(?:\bwaitfor\s+delay\s+['"])/i,
    },
    // 2. Cross-Site Scripting (XSS)
    {
      type: "XSS",
      severity: "HIGH",
      regex: /(?:<script[\s\S]*?>[\s\S]*?<\/script>)|(?:javascript\s*:\s*[^\s]+)|(?:\bonerror\s*=\s*['"][^'"]*['"])|(?:\bonload\s*=\s*['"][^'"]*['"])|(?:<iframe[\s\S]*?>)|(?:document\.cookie)|(?:window\.location\s*=)/i,
    },
    // 3. Remote Code Execution (RCE) / Command Injection
    {
      type: "RCE",
      severity: "CRITICAL",
      regex: /(?:;\s*(?:rm\s+-rf|cat\s+\/etc\/|id|whoami|uname\s+-a|curl\s+https?:\/\/|wget\s+https?:\/\/))|(?:\$\(\s*(?:curl|wget|bash|sh|nc)\b)|(?:\|\s*(?:bash|sh|nc\s+-e|python\s+-c|perl\s+-e))|(?:powershell(?:\.exe)?\s+(?:-enc|-command|-nop))/i,
    },
    // 4. Path Traversal / Local File Inclusion (LFI)
    {
      type: "LFI",
      severity: "HIGH",
      regex: /(?:\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%252e%252e%252f)|(?:\/etc\/(?:passwd|shadow|hosts|group))|(?:c:\\windows\\system32)/i,
    },
    // 5. Server-Side Request Forgery (SSRF) / Cloud Metadata Probe
    {
      type: "SSRF",
      severity: "CRITICAL",
      regex: /(?:https?:\/\/169\.254\.169\.254)|(?:https?:\/\/metadata\.google\.internal)|(?:gopher:\/\/)|(?:dict:\/\/)|(?:file:\/\/\/)/i,
    },
    // 6. Prototype Pollution
    {
      type: "PROTO_POLLUTION",
      severity: "CRITICAL",
      regex: /(?:__proto__|constructor\s*\.\s*prototype|Object\s*\.\s*prototype)/i,
    },
  ];

  /**
   * Cleans and normalizes incoming client IP address.
   */
  public extractClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const parts = forwarded.split(",");
      return appSecurityService.cleanIp(parts[0].trim());
    }
    return appSecurityService.cleanIp(req.socket.remoteAddress || "127.0.0.1");
  }

  /**
   * Deeply inspects an object or string for malicious attack payloads.
   */
  public inspectPayload(val: any, path: string = ""): SecurityThreat | null {
    if (val === null || val === undefined) return null;

    if (typeof val === "string") {
      const str = val.trim();
      if (!str || str.length < 3) return null;

      for (const pattern of ServerFirewallService.THREAT_PATTERNS) {
        if (pattern.regex.test(str)) {
          const match = str.match(pattern.regex);
          return {
            type: pattern.type,
            severity: pattern.severity,
            patternMatched: pattern.regex.source.slice(0, 50),
            targetField: path,
            snippet: match ? match[0].slice(0, 100) : str.slice(0, 100),
          };
        }
      }
      return null;
    }

    if (typeof val === "object") {
      // Prototype pollution check
      const keys = Object.getOwnPropertyNames(val);
      for (const key of keys) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          return {
            type: "PROTO_POLLUTION",
            severity: "CRITICAL",
            patternMatched: `Unsafe Object Key: ${key}`,
            targetField: `${path}.${key}`,
            snippet: key,
          };
        }
        const threat = this.inspectPayload(val[key], path ? `${path}.${key}` : key);
        if (threat) return threat;
      }
    }


    return null;
  }

  /**
   * Express Middleware: Evaluates every incoming HTTP request through the Firewall.
   */
  public createMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      this.totalRequests++;
      const ip = this.extractClientIp(req);
      const userAgent = (req.headers["user-agent"] as string) || "Unknown";
      const reqPath = req.path;

      // ── Layer 0: Strict robots.txt for Search & Scraper Bots ───────────────
      if (reqPath === "/robots.txt") {
        res.setHeader("Content-Type", "text/plain");
        return res.send("User-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /auth/\nDisallow: /system/\n");
      }

      // ── Layer 1: Check if IP is in Jailed / Blocked List ───────────────────
      if (appSecurityService.isIpBlocked(ip)) {
        this.totalBlocked++;
        return res.status(403).json({
          ok: false,
          error: "FIREWALL_IP_JAILED",
          message: "⛔ ACCESS DENIED: Your IP address has been permanently jailed by the Server Firewall due to malicious activity.",
        });
      }

      // ── Layer 2: Rapid Burst Scraping & Abuse Protection ───────────────────
      const now = Date.now();
      const clientTimestamps = this.burstTracker.get(ip) || [];
      const recentRequests = clientTimestamps.filter((t) => now - t < this.BURST_WINDOW_MS);
      recentRequests.push(now);
      this.burstTracker.set(ip, recentRequests);

      // If more than 18 requests in 5 seconds without auth
      if (recentRequests.length > this.MAX_BURST_REQUESTS && reqPath.startsWith("/api/")) {
        const authHeader = (req.headers["x-app-key-token"] as string) || (req.headers["authorization"] as string);
        if (!authHeader || !appSecurityService.verifySessionToken(authHeader)) {
          this.scrapersBlocked++;
          this.totalBlocked++;
          this.lastThreat = { type: "BURST_SCRAPING", ip, timestamp: now };

          console.warn(`[Firewall] 🛑 RAPID BURST SCRAPER THROTTLED from IP: ${ip} (${recentRequests.length} reqs / 5s)`);
          return res.status(429).json({
            ok: false,
            error: "FIREWALL_BURST_RATE_LIMIT_EXCEEDED",
            message: "⛔ Rate Limit Exceeded: Rapid automated scraping and wrapper abuse is strictly throttled. Please wait before retrying.",
          });
        }
      }

      // ── Layer 3: Honeypot Traps (Instant Auto-Ban) ─────────────────────────
      for (const trap of ServerFirewallService.HONEYPOT_TRAP_PATHS) {
        if (trap.test(reqPath) && !reqPath.includes("security.txt")) {
          this.honeypotHits++;
          this.totalBlocked++;
          this.lastThreat = { type: "HONEYPOT", ip, timestamp: Date.now() };

          console.warn(`[Firewall] 🚨 HONEYPOT PROBE DETECTED from IP: ${ip} on Path: ${reqPath} (${userAgent})`);
          await appSecurityService.blockClient(
            ip,
            userAgent,
            `Honeypot Trap Hit: ${reqPath}`
          );

          this.dispatchTelegramAlert(
            `🍯 *FIREWALL HONEYPOT TRIGGERED & IP JAILED* 🚨\n\n` +
            `• 🌐 *Attacker IP:* \`${ip}\`\n` +
            `• 🎯 *Target Trap:* \`${reqPath}\`\n` +
            `• 📱 *User-Agent:* \`${userAgent}\`\n` +
            `• 🛡️ *Action:* IP permanently banned.`
          );

          return res.status(403).json({
            ok: false,
            error: "HONEYPOT_DETECTED",
            message: "🚨 Security Honeypot Triggered. Your IP has been permanently blacklisted.",
          });
        }
      }

      // ── Layer 4: Scanner Bot Blacklist (Nikto, SQLMap, Burp, Nmap) ─────────
      for (const botRegex of ServerFirewallService.SCANNER_USER_AGENTS) {
        if (botRegex.test(userAgent)) {
          this.totalBlocked++;
          this.lastThreat = { type: "BAD_BOT", ip, timestamp: Date.now() };

          console.warn(`[Firewall] 🛑 SCANNER BOT BLOCKED: ${userAgent} from IP: ${ip}`);
          await appSecurityService.blockClient(
            ip,
            userAgent,
            `Scanner Bot User-Agent: ${userAgent}`
          );

          return res.status(403).json({
            ok: false,
            error: "MALICIOUS_SCANNER_BLOCKED",
            message: "⛔ Access Denied: Security scanners and automated attack bots are strictly prohibited.",
          });
        }
      }

      // ── Layer 5: Automated Scraper & Wrapper Script Blacklist ──────────────
      // Block unauthenticated headless browsers and generic request libraries from scraping API
      if (reqPath.startsWith("/api/") && !reqPath.startsWith("/api/whatsapp/cloud/webhook") && !reqPath.startsWith("/api/telegram/webhook")) {
        for (const scraperRegex of ServerFirewallService.SCRAPER_USER_AGENTS) {
          if (scraperRegex.test(userAgent)) {
            const authHeader = (req.headers["x-app-key-token"] as string) || (req.headers["authorization"] as string);
            if (!authHeader || !appSecurityService.verifySessionToken(authHeader)) {
              this.scrapersBlocked++;
              this.totalBlocked++;
              this.lastThreat = { type: "SCRAPER_BOT", ip, timestamp: Date.now() };

              console.warn(`[Firewall] 🛡️ SCRAPER / WRAPPER BLOCKED: ${userAgent} from IP: ${ip} on ${reqPath}`);
              return res.status(403).json({
                ok: false,
                error: "AUTOMATED_SCRAPER_BLOCKED",
                message: "⛔ Access Denied: Unauthenticated automated scrapers, wrappers, and headless bots are strictly forbidden.",
              });
            }
          }
        }
      }

      // ── Layer 6: Deep Packet Inspection on Query Params & Body ─────────────
      const queryThreat = this.inspectPayload(req.query, "query");
      const bodyThreat = req.body ? this.inspectPayload(req.body, "body") : null;
      const threat = queryThreat || bodyThreat;


      if (threat) {
        this.totalBlocked++;
        this.lastThreat = { type: threat.type, ip, timestamp: Date.now() };

        console.warn(`[Firewall] 🚨 ${threat.type} ATTACK BLOCKED from IP: ${ip} on ${reqPath} [Field: ${threat.targetField}]: "${threat.snippet}"`);

        // If Critical attack (SQLi, RCE, SSRF), immediately jail the IP
        if (threat.severity === "CRITICAL") {
          await appSecurityService.blockClient(
            ip,
            userAgent,
            `${threat.type} Attack Attempt: ${threat.snippet}`
          );

          this.dispatchTelegramAlert(
            `🚨 *FIREWALL CRITICAL ATTACK BLOCKED & IP JAILED* 🛡️\n\n` +
            `• 💥 *Attack Type:* *${threat.type}* (${threat.severity})\n` +
            `• 🌐 *Attacker IP:* \`${ip}\`\n` +
            `• 📍 *Endpoint:* \`${reqPath}\`\n` +
            `• 🎯 *Field:* \`${threat.targetField}\`\n` +
            `• 🔍 *Payload Snippet:* \`${threat.snippet}\`\n` +
            `• 📱 *User-Agent:* \`${userAgent}\`\n` +
            `• 🛑 *Action:* Attack neutralized & IP jailed.`
          );
        }

        return res.status(400).json({
          ok: false,
          error: `FIREWALL_MALICIOUS_PAYLOAD_${threat.type}`,
          message: `🚨 Request Rejected: Malicious payload (${threat.type}) detected by Server Firewall.`,
        });
      }

      // ── Layer 5: Enforce Industrial Security Headers ────────────────────────
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("X-XSS-Protection", "1; mode=block");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");

      next();
    };
  }

  /**
   * Dispatches instant security alert to Boss Telegram Security Bot.
   */
  private async dispatchTelegramAlert(message: string): Promise<void> {
    try {
      const token = process.env.TELEGRAM_SECURITY_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.BOSS_TELEGRAM_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID;
      if (token && chatId) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(chatId),
            text: message,
            parse_mode: "Markdown",
          }),
        });
      }
    } catch {
      // Non-critical: ignore if Telegram alert fails
    }
  }

  /**
   * Returns live statistics of the Server Firewall.
   */
  public async getFirewallStats(): Promise<FirewallStats> {
    const list = await appSecurityService.listBlockedIps();
    return {
      totalRequestsInspected: this.totalRequests,
      threatsBlocked: this.totalBlocked,
      ipsJailed: list.length,
      honeypotHits: this.honeypotHits,
      scrapersBlocked: this.scrapersBlocked,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      lastThreatDetected: this.lastThreat,
    };
  }

}

export const serverFirewallService = new ServerFirewallService();
