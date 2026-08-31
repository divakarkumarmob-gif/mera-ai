/**
 * FRIDAY AI — TheHarvester OSINT Service (Pure JS — No Python Required)
 * Email addresses, subdomains, hosts, IPs, and employee names gathering
 * Inspired by: https://github.com/laramies/theHarvester
 *
 * Sources used (all free/public):
 *  - crt.sh          → Certificate Transparency (subdomains)
 *  - HackerTarget    → DNS, reverse IP, subdomains
 *  - ThreatCrowd     → Domain intelligence
 *  - VirusTotal API  → Subdomains (optional key)
 *  - Hunter.io API   → Emails (optional key)
 *  - DNS (Node)      → MX, NS, A, AAAA, TXT records
 *  - Shodan InternetDB → Open ports, CVEs (no key needed!)
 *  - AlienVault OTX  → Threat intelligence
 *  - WHOIS API       → Domain registration info
 */

import https from "https";
import http from "http";
import dns from "dns";
import { promisify } from "util";

const dnsResolve = promisify(dns.resolve);
const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);
const dnsResolveMx = promisify(dns.resolveMx);
const dnsResolveNs = promisify(dns.resolveNs);
const dnsResolveTxt = promisify(dns.resolveTxt);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
export interface HarvesterEmailResult {
  email: string;
  source: string;
  confidence: "high" | "medium" | "low";
}

export interface HarvesterSubdomainResult {
  subdomain: string;
  ip?: string;
  source: string;
}

export interface HarvesterHostResult {
  host: string;
  ip: string;
  openPorts?: number[];
  cves?: string[];
  source: string;
}

export interface HarvesterDnsResult {
  type: string;
  records: string[];
}

export interface HarvesterReport {
  domain: string;
  emails: HarvesterEmailResult[];
  subdomains: HarvesterSubdomainResult[];
  hosts: HarvesterHostResult[];
  dnsRecords: HarvesterDnsResult[];
  ipAddresses: string[];
  openPorts: { ip: string; ports: number[]; cves?: string[] }[];
  linkedInUrls: string[];
  summary: string;
  sources: string[];
  scanDurationMs: number;
  totalFindings: number;
}

// ---------------------------------------------------------------------------
// HTTP Helper
// ---------------------------------------------------------------------------
function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const defaultHeaders = {
      "User-Agent": "Mozilla/5.0 (compatible; FRIDAY-OSINT/1.0)",
      "Accept": "application/json",
      ...headers,
    };

    const req = lib.get(url, { headers: defaultHeaders, timeout: 15000 } as any, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const defaultHeaders = {
      "User-Agent": "Mozilla/5.0 (compatible; FRIDAY-OSINT/1.0)",
      "Accept": "text/html,text/plain,*/*",
      ...headers,
    };

    const req = lib.get(url, { headers: defaultHeaders, timeout: 15000 } as any, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
  });
}

// ---------------------------------------------------------------------------
// Source Scrapers
// ---------------------------------------------------------------------------

/** crt.sh — Certificate Transparency Logs → subdomains */
async function fetchCrtSh(domain: string): Promise<HarvesterSubdomainResult[]> {
  const results: HarvesterSubdomainResult[] = [];
  try {
    const data = await fetchJson(`https://crt.sh/?q=%.${domain}&output=json`);
    if (!Array.isArray(data)) return results;

    const seen = new Set<string>();
    for (const entry of data) {
      const names: string[] = (entry.name_value || "").split("\n");
      for (const name of names) {
        const sub = name.trim().replace(/^\*\./, "");
        if (sub && sub.endsWith(domain) && !seen.has(sub)) {
          seen.add(sub);
          results.push({ subdomain: sub, source: "crt.sh" });
        }
      }
    }
  } catch {}
  return results;
}

/** HackerTarget — Subdomain finder */
async function fetchHackerTargetSubdomains(domain: string): Promise<HarvesterSubdomainResult[]> {
  const results: HarvesterSubdomainResult[] = [];
  try {
    const text = await fetchText(`https://api.hackertarget.com/hostsearch/?q=${domain}`);
    if (!text || text.includes("error") || text.includes("API count")) return results;

    const lines = text.split("\n").filter(Boolean);
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length >= 2) {
        results.push({
          subdomain: parts[0].trim(),
          ip: parts[1].trim(),
          source: "HackerTarget",
        });
      }
    }
  } catch {}
  return results;
}

/** HackerTarget — Reverse IP lookup */
async function fetchHackerTargetReverseIp(ip: string): Promise<string[]> {
  try {
    const text = await fetchText(`https://api.hackertarget.com/reverseiplookup/?q=${ip}`);
    if (!text || text.includes("error")) return [];
    return text.split("\n").map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** HackerTarget — DNS lookup */
async function fetchHackerTargetDns(domain: string): Promise<string> {
  try {
    const text = await fetchText(`https://api.hackertarget.com/dnslookup/?q=${domain}`);
    return text || "";
  } catch {
    return "";
  }
}

/** AlienVault OTX — Subdomains + passive DNS */
async function fetchOtxSubdomains(domain: string): Promise<HarvesterSubdomainResult[]> {
  const results: HarvesterSubdomainResult[] = [];
  try {
    const data = await fetchJson(`https://otx.alienvault.com/api/v1/indicators/domain/${domain}/passive_dns`);
    if (!data?.passive_dns) return results;

    for (const record of data.passive_dns) {
      if (record.hostname && record.hostname.endsWith(domain)) {
        results.push({
          subdomain: record.hostname,
          ip: record.address,
          source: "AlienVault OTX",
        });
      }
    }
  } catch {}
  return results;
}

/** AlienVault OTX — URLs (can extract emails) */
async function fetchOtxUrls(domain: string): Promise<string[]> {
  try {
    const data = await fetchJson(`https://otx.alienvault.com/api/v1/indicators/domain/${domain}/url_list?limit=100`);
    return (data?.url_list || []).map((u: any) => u.url || "").filter(Boolean);
  } catch {
    return [];
  }
}

/** Shodan InternetDB — Open ports + CVEs (no API key!) */
async function fetchShodanInternetDb(ip: string): Promise<{ ports: number[]; cves: string[]; tags: string[] }> {
  try {
    const data = await fetchJson(`https://internetdb.shodan.io/${ip}`);
    if (!data) return { ports: [], cves: [], tags: [] };
    return {
      ports: data.ports || [],
      cves: data.cves || [],
      tags: data.tags || [],
    };
  } catch {
    return { ports: [], cves: [], tags: [] };
  }
}

/** VirusTotal — Subdomains (optional API key) */
async function fetchVirusTotalSubdomains(domain: string, apiKey?: string): Promise<HarvesterSubdomainResult[]> {
  if (!apiKey) return [];
  try {
    const data = await fetchJson(
      `https://www.virustotal.com/api/v3/domains/${domain}/subdomains?limit=40`,
      { "x-apikey": apiKey }
    );
    if (!data?.data) return [];
    return data.data.map((entry: any) => ({
      subdomain: entry.id,
      source: "VirusTotal",
    }));
  } catch {
    return [];
  }
}

/** Hunter.io — Email finder (optional API key) */
async function fetchHunterEmails(domain: string, apiKey?: string): Promise<HarvesterEmailResult[]> {
  if (!apiKey) return [];
  try {
    const data = await fetchJson(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${apiKey}&limit=50`
    );
    if (!data?.data?.emails) return [];
    return data.data.emails.map((e: any) => ({
      email: e.value,
      source: "Hunter.io",
      confidence: e.confidence > 80 ? "high" : e.confidence > 50 ? "medium" : "low",
    }));
  } catch {
    return [];
  }
}

/** Extract emails from raw text using regex */
function extractEmailsFromText(text: string, domain: string, source: string): HarvesterEmailResult[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  const results: HarvesterEmailResult[] = [];
  const seen = new Set<string>();

  for (const email of matches) {
    const lower = email.toLowerCase();
    if (!seen.has(lower) && (domain === "" || lower.includes(domain))) {
      seen.add(lower);
      results.push({ email: lower, source, confidence: "medium" });
    }
  }
  return results;
}

/** DNS Records via Node.js built-in */
async function fetchDnsRecords(domain: string): Promise<HarvesterDnsResult[]> {
  const records: HarvesterDnsResult[] = [];

  const safe = async (fn: () => Promise<any>, type: string) => {
    try {
      const result = await fn();
      if (result && result.length > 0) {
        let formatted: string[] = [];
        if (type === "MX") formatted = result.map((r: any) => `${r.priority} ${r.exchange}`);
        else if (type === "TXT") formatted = result.map((r: any) => Array.isArray(r) ? r.join("") : String(r));
        else formatted = result.map((r: any) => String(r));
        records.push({ type, records: formatted });
      }
    } catch {}
  };

  await Promise.all([
    safe(() => dnsResolve4(domain), "A"),
    safe(() => dnsResolve6(domain), "AAAA"),
    safe(() => dnsResolveMx(domain), "MX"),
    safe(() => dnsResolveNs(domain), "NS"),
    safe(() => dnsResolveTxt(domain), "TXT"),
    safe(() => dnsResolve(domain, "CNAME"), "CNAME"),
    safe(() => dnsResolve(domain, "SOA"), "SOA"),
  ]);

  return records;
}

/** Resolve IP for a subdomain */
async function resolveIp(hostname: string): Promise<string | undefined> {
  try {
    const ips = await dnsResolve4(hostname);
    return ips[0];
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main Service Class
// ---------------------------------------------------------------------------
class TheHarvesterService {

  async harvest(
    domain: string,
    options?: {
      sources?: string[];       // specific sources to use
      virusTotalKey?: string;
      hunterKey?: string;
      resolveIps?: boolean;     // resolve IPs for subdomains (slower)
      shodanScan?: boolean;     // scan IPs via Shodan InternetDB
    }
  ): Promise<HarvesterReport> {
    const startTime = Date.now();
    domain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();

    const allEmails: HarvesterEmailResult[] = [];
    const allSubdomains: HarvesterSubdomainResult[] = [];
    const allHosts: HarvesterHostResult[] = [];
    const usedSources: string[] = [];
    const ipAddresses: string[] = [];
    const openPortsData: { ip: string; ports: number[]; cves?: string[] }[] = [];
    const linkedInUrls: string[] = [];

    // ------ Run all sources in parallel ------
    const [
      crtSubdomains,
      hackerTargetSubdomains,
      otxSubdomains,
      otxUrls,
      dnsRecords,
      vtSubdomains,
      hunterEmails,
    ] = await Promise.all([
      fetchCrtSh(domain),
      fetchHackerTargetSubdomains(domain),
      fetchOtxSubdomains(domain),
      fetchOtxUrls(domain),
      fetchDnsRecords(domain),
      fetchVirusTotalSubdomains(domain, options?.virusTotalKey || process.env.VIRUSTOTAL_API_KEY),
      fetchHunterEmails(domain, options?.hunterKey || process.env.HUNTER_API_KEY),
    ]);

    // Track sources used
    if (crtSubdomains.length > 0) usedSources.push("crt.sh");
    if (hackerTargetSubdomains.length > 0) usedSources.push("HackerTarget");
    if (otxSubdomains.length > 0) usedSources.push("AlienVault OTX");
    if (vtSubdomains.length > 0) usedSources.push("VirusTotal");
    if (hunterEmails.length > 0) usedSources.push("Hunter.io");
    if (dnsRecords.length > 0) usedSources.push("DNS");

    // Merge subdomains (deduplicate)
    const subdomainMap = new Map<string, HarvesterSubdomainResult>();
    for (const s of [...crtSubdomains, ...hackerTargetSubdomains, ...otxSubdomains, ...vtSubdomains]) {
      if (!subdomainMap.has(s.subdomain)) {
        subdomainMap.set(s.subdomain, s);
      }
    }

    // Collect IPs from DNS A records
    const aRecord = dnsRecords.find(r => r.type === "A");
    if (aRecord) {
      ipAddresses.push(...aRecord.records);
    }

    // Extract emails from OTX URLs
    for (const url of otxUrls) {
      const emails = extractEmailsFromText(url, domain, "AlienVault OTX");
      allEmails.push(...emails);
    }

    // Merge all emails (deduplicate)
    hunterEmails.forEach(e => allEmails.push(e));
    const emailMap = new Map<string, HarvesterEmailResult>();
    for (const e of allEmails) {
      if (!emailMap.has(e.email)) emailMap.set(e.email, e);
    }

    // Optionally resolve IPs for subdomains
    const resolvedSubdomains = Array.from(subdomainMap.values());
    if (options?.resolveIps !== false && resolvedSubdomains.length > 0) {
      const toResolve = resolvedSubdomains.slice(0, 50); // limit to 50
      await Promise.all(
        toResolve.map(async (sub) => {
          if (!sub.ip) {
            sub.ip = await resolveIp(sub.subdomain);
            if (sub.ip && !ipAddresses.includes(sub.ip)) {
              ipAddresses.push(sub.ip);
            }
          }
        })
      );
    }

    // Shodan InternetDB scan for found IPs
    if (options?.shodanScan !== false && ipAddresses.length > 0) {
      usedSources.push("Shodan InternetDB");
      const shodanResults = await Promise.all(
        ipAddresses.slice(0, 10).map(async (ip) => {
          const shodan = await fetchShodanInternetDb(ip);
          return { ip, ...shodan };
        })
      );

      for (const sr of shodanResults) {
        if (sr.ports.length > 0 || sr.cves.length > 0) {
          openPortsData.push({ ip: sr.ip, ports: sr.ports, cves: sr.cves });
        }
      }
    }

    const totalFindings =
      emailMap.size +
      resolvedSubdomains.length +
      allHosts.length +
      ipAddresses.length;

    const summary =
      `🎯 "${domain}" OSINT scan complete!\n` +
      `📧 Emails found: ${emailMap.size}\n` +
      `🌐 Subdomains found: ${resolvedSubdomains.length}\n` +
      `🖥️ IPs discovered: ${ipAddresses.length}\n` +
      `🔓 Open ports: ${openPortsData.reduce((acc, h) => acc + h.ports.length, 0)}\n` +
      `📋 DNS records: ${dnsRecords.length} types\n` +
      `⚡ Sources: ${usedSources.join(", ")}\n` +
      `⏱️ Scan time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    return {
      domain,
      emails: Array.from(emailMap.values()),
      subdomains: resolvedSubdomains,
      hosts: allHosts,
      dnsRecords,
      ipAddresses: [...new Set(ipAddresses)],
      openPorts: openPortsData,
      linkedInUrls,
      summary,
      sources: usedSources,
      scanDurationMs: Date.now() - startTime,
      totalFindings,
    };
  }

  /** Quick subdomain-only scan */
  async findSubdomains(domain: string): Promise<{
    domain: string;
    subdomains: HarvesterSubdomainResult[];
    totalFound: number;
  }> {
    domain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const [crt, ht, otx] = await Promise.all([
      fetchCrtSh(domain),
      fetchHackerTargetSubdomains(domain),
      fetchOtxSubdomains(domain),
    ]);

    const map = new Map<string, HarvesterSubdomainResult>();
    for (const s of [...crt, ...ht, ...otx]) {
      if (!map.has(s.subdomain)) map.set(s.subdomain, s);
    }

    return {
      domain,
      subdomains: Array.from(map.values()),
      totalFound: map.size,
    };
  }

  /** DNS records only */
  async getDnsRecords(domain: string): Promise<{
    domain: string;
    records: HarvesterDnsResult[];
    ipAddresses: string[];
  }> {
    domain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const records = await fetchDnsRecords(domain);
    const aRecord = records.find(r => r.type === "A");
    return {
      domain,
      records,
      ipAddresses: aRecord?.records || [],
    };
  }

  /** IP intelligence via Shodan InternetDB */
  async scanIp(ip: string): Promise<{
    ip: string;
    ports: number[];
    cves: string[];
    tags: string[];
    reverseHosts: string[];
  }> {
    const [shodan, reverseHosts] = await Promise.all([
      fetchShodanInternetDb(ip),
      fetchHackerTargetReverseIp(ip),
    ]);

    return {
      ip,
      ports: shodan.ports,
      cves: shodan.cves,
      tags: shodan.tags,
      reverseHosts,
    };
  }

  getStatus() {
    return {
      installed: true,
      version: "2.0.0-purejs",
      description: "TheHarvester OSINT — Email, subdomain, host, IP intelligence (Pure JS)",
      sources: ["crt.sh", "HackerTarget", "AlienVault OTX", "Shodan InternetDB", "DNS", "VirusTotal*", "Hunter.io*"],
      note: "* = Optional API keys (VIRUSTOTAL_API_KEY, HUNTER_API_KEY in .env)",
      engine: "native-http + dns",
    };
  }
}

export const theHarvesterService = new TheHarvesterService();
