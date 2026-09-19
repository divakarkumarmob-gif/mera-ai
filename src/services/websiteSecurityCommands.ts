/**
 * websiteSecurityCommands.ts
 *
 * Shared helper so WhatsApp / Telegram / Voice can all trigger the SAME
 * website vulnerability scans with natural phrases like:
 *   - "find vulnerabilities in example.com"
 *   - "find error in url xyzzzihiohu"
 *   - "link scan karo https://..."
 *   - "website security check karo example.com"
 *
 * ⚠️ LEGAL: Only scan systems you own or have written permission to test.
 */

import { cyberSecurityService } from "./cyberSecurityService";
import { niktoService } from "./niktoService";

export type WebsiteScanMode = "link" | "audit" | "deep";

export interface ParsedWebsiteScanCommand {
  mode: WebsiteScanMode;
  target: string;
}

/** Extract a URL / domain from free-form text (handles quoted "xyzzzihiohu"). */
function extractTarget(text: string): string | null {
  // 1) Full URL first
  const urlMatch = text.match(/https?:\/\/[^\s"'<>\]\)]+/i) || text.match(/www\.[^\s"'<>\]\)]+/i);
  if (urlMatch) {
    return urlMatch[0].replace(/[.,;:!?'"\])]+$/g, "").trim();
  }
  // 2) Quoted token: "xyzzzihiohu" or 'example.com'
  const quoted = text.match(/["'“”]([^"'“”\s]{3,120})["'“”]/);
  if (quoted?.[1]) return quoted[1].replace(/[.,;:!?]+$/g, "").trim();
  // 3) Bare domain: something.tld (+ optional path)
  const domain = text.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>\]\)]*)?)/i);
  if (domain?.[1]) {
    return domain[1].replace(/[.,;:!?'"\])]+$/g, "").trim();
  }
  // 4) Single bare word after "url/domain/website/site" keyword
  const kw = text.match(/(?:url|link|domain|website|site)\s+([a-z0-9][a-z0-9.\-]{2,80})/i);
  if (kw?.[1]) return kw[1].replace(/[.,;:!?'"\])]+$/g, "").trim();
  return null;
}

/**
 * Returns scan mode + target when the text is a website-security command,
 * otherwise null (so normal chat falls through untouched).
 */
export function parseWebsiteScanCommand(rawText: string): ParsedWebsiteScanCommand | null {
  const text = String(rawText || "").trim();
  if (text.length < 3) return null;
  const lower = text.toLowerCase();

  const hasTarget = extractTarget(text);
  // Deep vulnerability scan triggers
  const isDeep =
    /find\s+(vulnerabilit|vuln|weak\s*point|weakness|data\s*leak|leak|bug|error|issue|problem)/i.test(text) ||
    /vulnerability\s*scan|deep\s*scan|nikto|full\s*(security\s*)?(scan|audit|check)/i.test(text) ||
    (/audit/i.test(text) && /deep|full|vuln|nikto/i.test(text));
  // Header/DNS/SSL audit triggers
  const isAudit =
    /website\s*security|domain\s*audit|security\s*audit|audit\s*(website|domain|url|site)|security\s*check|grade\s*(batao|check|nikalo)/i.test(text);
  // Phishing / link-safety triggers
  const isLink =
    /link\s*scan|scan.*link|ye\s*link|phishing|is\s*link\s*safe|url\s*scan|scan.*url|link\s*safe|malware\s*check|safe\s*hai\s*kya/i.test(text) ||
    (hasTarget && /^(scan|check|verify)\b/i.test(text));

  if (!isDeep && !isAudit && !isLink) return null;
  if (!hasTarget) return null;

  const mode: WebsiteScanMode = isDeep ? "deep" : isAudit ? "audit" : "link";
  return { mode, target: hasTarget };
}

function normalizeTarget(target: string): string {
  let t = String(target || "").trim().replace(/[.,;:!?'"\])]+$/g, "");
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return t;
}

const DISCLAIMER = `\n\n⚠️ _Note: Sirf apni ya authorized website par test karein._`;

/** Run the scan and return a chat-ready (WhatsApp/Telegram) reply. */
export async function runWebsiteSecurityScan(
  rawTarget: string,
  mode: WebsiteScanMode = "deep"
): Promise<string> {
  const target = normalizeTarget(rawTarget);

  try {
    if (mode === "link") {
      const r = await cyberSecurityService.scanUrlSafety(target);
      const threats = r.threatsDetected.length > 0 ? `\n☠️ *Khatre:* ${r.threatsDetected.join("; ")}` : "";
      return (
        `🛡️ *Link Safety Scan*\n🔗 ${r.url}\n` +
        `📊 Risk: *${r.riskLevel}* (${r.riskScore}/100) — ${r.isSafe ? "✅ Safe lag raha hai" : "⚠️ Suspicious/Dangerous"}${threats}\n` +
        `📝 ${r.explanation}` +
        DISCLAIMER
      );
    }

    if (mode === "audit") {
      const a = await cyberSecurityService.auditWebsiteSecurity(target);
      const gaps = a.vulnerabilities.slice(0, 8).map((v) => `• ${v}`).join("\n") || "• Koi major gap nahi mila ✅";
      return (
        `🔒 *Website Security Audit*\n🌐 ${a.domain}\n` +
        `🏆 Grade: *${a.grade}* (Score: ${a.score}/100)\n` +
        `🔑 HTTPS: ${a.httpsEnforced ? "✅ Enforced" : "❌ NOT enforced"}\n` +
        `🖥️ Server: ${a.serverTechnology || "Hidden"}\n` +
        `🚨 Gaps (${a.vulnerabilities.length}):\n${gaps}` +
        DISCLAIMER
      );
    }

    // ── DEEP mode: phishing check + header/DNS audit + Nikto path scan (capped for chat speed)
    const [link, audit] = await Promise.all([
      cyberSecurityService.scanUrlSafety(target).catch(() => null),
      cyberSecurityService.auditWebsiteSecurity(target).catch(() => null),
    ]);
    const nikto = await niktoService
      .scan(target, { checkPaths: true, checkHeaders: true, checkMethods: true, maxPaths: 40, concurrency: 10 })
      .catch(() => null);

    const crit = nikto?.findings.filter((f) => f.severity === "critical") || [];
    const high = nikto?.findings.filter((f) => f.severity === "high") || [];
    const top = [...crit, ...high].slice(0, 6);
    const topLines =
      top.map((f) => `• [${f.severity.toUpperCase()}] ${f.title}${f.url ? `\n  ${f.url}` : ""}`).join("\n") ||
      "• Critical/High findings nahi mile ✅";

    return (
      `🔍 *Deep Vulnerability Scan*\n🌐 ${target}\n` +
      (link ? `🛡️ Link risk: *${link.riskLevel}* (${link.riskScore}/100)\n` : "") +
      (audit ? `🏆 Audit grade: *${audit.grade}* (${audit.score}/100) | HTTPS: ${audit.httpsEnforced ? "✅" : "❌"}\n` : "") +
      (nikto ? `📊 Nikto score: *${nikto.securityScore}/100* (Grade ${nikto.grade}) | Requests: ${nikto.totalRequests}\n` : "") +
      `🚨 Critical: ${crit.length} | High: ${high.length}\n\n*Top findings:*\n${topLines}` +
      DISCLAIMER
    );
  } catch (e: any) {
    return `❌ Scan fail hua "${target}" ke liye: ${e?.message || e}${DISCLAIMER}`;
  }
}
