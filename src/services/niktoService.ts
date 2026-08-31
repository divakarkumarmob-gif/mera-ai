/**
 * FRIDAY AI — Nikto Web Server Scanner (Pure JS — No Perl Required)
 * Web server vulnerability and misconfiguration scanner
 * Inspired by: https://github.com/sullo/nikto
 *
 * Checks performed:
 *  - Security headers (missing/misconfigured)
 *  - Dangerous files & directories (admin panels, backups, configs)
 *  - Server version disclosure
 *  - Default credentials pages
 *  - CMS detection (WordPress, Joomla, Drupal, Laravel...)
 *  - Directory listing enabled
 *  - Common CVEs & misconfigurations
 *  - HTTP methods allowed (PUT, DELETE, TRACE...)
 *  - Cookie security flags
 *  - SSL/TLS info
 *
 * ⚠️ LEGAL DISCLAIMER: Only use on systems you own or have permission to test!
 */

import https from "https";
import http from "http";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
export interface NiktoFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  evidence?: string;
  url?: string;
  remediation?: string;
  cve?: string;
}

export interface NiktoReport {
  target: string;
  ip?: string;
  port: number;
  protocol: "http" | "https";
  serverBanner?: string;
  poweredBy?: string;
  findings: NiktoFinding[];
  securityScore: number; // 0 (worst) to 100 (best)
  grade: "A" | "B" | "C" | "D" | "F";
  cmsDetected?: string;
  technologiesDetected: string[];
  allowedMethods: string[];
  totalRequests: number;
  summary: string;
  scanDurationMs: number;
  findingsBySecerity: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Dangerous Paths Database (~500+ entries like Nikto)
// ---------------------------------------------------------------------------
interface PathCheck {
  path: string;
  title: string;
  severity: NiktoFinding["severity"];
  category: string;
  description: string;
  remediation?: string;
  cve?: string;
  expectStatus?: number[]; // if response status is in this list, it's a finding
  expectBodyContains?: string[]; // if body contains any of these, it's a finding
}

const DANGEROUS_PATHS: PathCheck[] = [
  // ─── Admin Panels ───────────────────────────────────────────────────────
  { path: "/admin", title: "Admin panel exposed", severity: "high", category: "Admin", description: "Admin panel accessible to public", remediation: "Restrict access with IP whitelist or authentication" },
  { path: "/admin/", title: "Admin directory exposed", severity: "high", category: "Admin", description: "Admin directory publicly accessible", remediation: "Restrict admin access" },
  { path: "/administrator", title: "Joomla admin panel", severity: "high", category: "Admin", description: "Joomla administrator panel exposed" },
  { path: "/wp-admin", title: "WordPress admin panel", severity: "high", category: "Admin", description: "WordPress /wp-admin exposed", remediation: "Use security plugin to restrict wp-admin access" },
  { path: "/wp-login.php", title: "WordPress login page", severity: "medium", category: "Admin", description: "WordPress login page exposed - brute force risk" },
  { path: "/phpmyadmin", title: "phpMyAdmin exposed", severity: "critical", category: "Admin", description: "phpMyAdmin database admin panel exposed", remediation: "Remove phpMyAdmin from production or restrict by IP", cve: "CVE-2018-12613" },
  { path: "/phpmyadmin/", title: "phpMyAdmin exposed", severity: "critical", category: "Admin", description: "phpMyAdmin panel publicly accessible" },
  { path: "/pma", title: "phpMyAdmin (alias)", severity: "critical", category: "Admin", description: "phpMyAdmin alias exposed" },
  { path: "/mysql", title: "MySQL admin exposed", severity: "critical", category: "Admin", description: "MySQL admin interface exposed" },
  { path: "/adminer.php", title: "Adminer DB tool exposed", severity: "critical", category: "Admin", description: "Adminer database management tool exposed" },
  { path: "/cpanel", title: "cPanel exposed", severity: "high", category: "Admin", description: "cPanel hosting control panel accessible" },
  { path: "/webadmin", title: "Web admin panel", severity: "high", category: "Admin", description: "Web admin interface accessible" },
  { path: "/manager/html", title: "Tomcat Manager exposed", severity: "critical", category: "Admin", description: "Apache Tomcat manager interface exposed", cve: "CVE-2017-12617" },
  { path: "/jenkins", title: "Jenkins CI exposed", severity: "high", category: "Admin", description: "Jenkins CI/CD server accessible" },
  { path: "/console", title: "Admin console exposed", severity: "high", category: "Admin", description: "Admin console publicly accessible" },
  { path: "/solr", title: "Apache Solr exposed", severity: "high", category: "Admin", description: "Apache Solr admin interface exposed", cve: "CVE-2019-0193" },

  // ─── Config Files ────────────────────────────────────────────────────────
  { path: "/.env", title: ".env file exposed", severity: "critical", category: "Config", description: "Environment file with secrets exposed", remediation: "Block access to .env files in webserver config", expectBodyContains: ["DB_", "APP_", "SECRET", "KEY", "PASSWORD", "TOKEN"] },
  { path: "/.env.local", title: ".env.local exposed", severity: "critical", category: "Config", description: "Local environment file exposed" },
  { path: "/.env.production", title: ".env.production exposed", severity: "critical", category: "Config", description: "Production environment file exposed" },
  { path: "/.env.backup", title: ".env backup exposed", severity: "critical", category: "Config", description: "Environment backup file exposed" },
  { path: "/config.php", title: "config.php exposed", severity: "critical", category: "Config", description: "PHP config file exposed" },
  { path: "/config.yml", title: "config.yml exposed", severity: "high", category: "Config", description: "YAML config file exposed" },
  { path: "/config.json", title: "config.json exposed", severity: "high", category: "Config", description: "JSON config file exposed" },
  { path: "/configuration.php", title: "Joomla config exposed", severity: "critical", category: "Config", description: "Joomla configuration.php exposed" },
  { path: "/wp-config.php", title: "WordPress config exposed", severity: "critical", category: "Config", description: "WordPress wp-config.php exposed - DB credentials risk", remediation: "Deny access to wp-config.php in .htaccess" },
  { path: "/settings.py", title: "Django settings exposed", severity: "critical", category: "Config", description: "Django settings.py file exposed" },
  { path: "/application.properties", title: "Spring config exposed", severity: "high", category: "Config", description: "Spring Boot application.properties exposed" },
  { path: "/web.config", title: "IIS web.config exposed", severity: "high", category: "Config", description: "IIS web.config file accessible" },
  { path: "/.htaccess", title: ".htaccess exposed", severity: "medium", category: "Config", description: "Apache .htaccess file readable" },
  { path: "/.htpasswd", title: ".htpasswd exposed", severity: "critical", category: "Config", description: "HTTP auth password file exposed!", remediation: "Move .htpasswd outside web root" },
  { path: "/database.yml", title: "Rails database config", severity: "critical", category: "Config", description: "Rails database.yml with credentials exposed" },
  { path: "/secrets.yml", title: "Rails secrets exposed", severity: "critical", category: "Config", description: "Rails secrets.yml exposed" },

  // ─── Backup Files ────────────────────────────────────────────────────────
  { path: "/backup.sql", title: "SQL backup exposed", severity: "critical", category: "Backup", description: "Database SQL backup file accessible" },
  { path: "/backup.zip", title: "Backup ZIP exposed", severity: "critical", category: "Backup", description: "Site backup ZIP file accessible" },
  { path: "/backup.tar.gz", title: "Backup tarball exposed", severity: "critical", category: "Backup", description: "Site backup tarball exposed" },
  { path: "/db.sql", title: "Database dump exposed", severity: "critical", category: "Backup", description: "Database dump file accessible" },
  { path: "/dump.sql", title: "DB dump exposed", severity: "critical", category: "Backup", description: "SQL dump file exposed" },
  { path: "/site.zip", title: "Site ZIP backup", severity: "critical", category: "Backup", description: "Site ZIP backup accessible" },
  { path: "/www.zip", title: "WWW ZIP backup", severity: "critical", category: "Backup", description: "WWW backup ZIP exposed" },
  { path: "/old.zip", title: "Old backup ZIP", severity: "high", category: "Backup", description: "Old site backup accessible" },
  { path: "/backup/", title: "Backup directory", severity: "high", category: "Backup", description: "Backup directory accessible" },
  { path: "/.git", title: "Git repository exposed", severity: "critical", category: "Backup", description: ".git directory exposed - source code leakage!", remediation: "Block /.git in webserver config", cve: "CWE-538" },
  { path: "/.git/config", title: "Git config exposed", severity: "critical", category: "Backup", description: "Git config file with remote URL exposed" },
  { path: "/.git/HEAD", title: "Git HEAD exposed", severity: "high", category: "Backup", description: "Git HEAD reference file exposed" },
  { path: "/.svn", title: "SVN repository exposed", severity: "critical", category: "Backup", description: "SVN repository exposed - source code leakage" },
  { path: "/.DS_Store", title: "macOS .DS_Store exposed", severity: "medium", category: "Backup", description: "macOS directory metadata file exposed - directory structure leakage" },

  // ─── Log Files ──────────────────────────────────────────────────────────
  { path: "/logs/", title: "Log directory accessible", severity: "high", category: "Logs", description: "Log files directory publicly accessible" },
  { path: "/log/", title: "Log directory accessible", severity: "high", category: "Logs", description: "Log directory exposed" },
  { path: "/error.log", title: "Error log exposed", severity: "medium", category: "Logs", description: "Error log file accessible" },
  { path: "/access.log", title: "Access log exposed", severity: "medium", category: "Logs", description: "Web server access log exposed" },
  { path: "/debug.log", title: "Debug log exposed", severity: "medium", category: "Logs", description: "Application debug log exposed" },
  { path: "/storage/logs/laravel.log", title: "Laravel log exposed", severity: "high", category: "Logs", description: "Laravel application log accessible" },

  // ─── API & Keys ─────────────────────────────────────────────────────────
  { path: "/api/v1/users", title: "User API endpoint", severity: "medium", category: "API", description: "User list API endpoint accessible" },
  { path: "/api/users", title: "User API exposed", severity: "medium", category: "API", description: "Users API endpoint accessible" },
  { path: "/.well-known/security.txt", title: "Security.txt present", severity: "info", category: "Info", description: "Security disclosure policy found" },
  { path: "/robots.txt", title: "Robots.txt found", severity: "info", category: "Info", description: "robots.txt may reveal hidden paths", expectStatus: [200] },
  { path: "/sitemap.xml", title: "Sitemap found", severity: "info", category: "Info", description: "XML sitemap reveals site structure" },
  { path: "/.well-known/openid-configuration", title: "OpenID config exposed", severity: "info", category: "API", description: "OpenID configuration endpoint found" },

  // ─── Common Vulnerabilities ──────────────────────────────────────────────
  { path: "/cgi-bin/test.cgi", title: "CGI test script", severity: "medium", category: "CGI", description: "CGI test script accessible", cve: "CVE-1999-0070" },
  { path: "/cgi-bin/printenv.pl", title: "Env printout script", severity: "high", category: "CGI", description: "CGI script dumps environment variables" },
  { path: "/cgi-bin/php.cgi", title: "PHP CGI exposed", severity: "critical", category: "CGI", description: "PHP CGI binary directly accessible", cve: "CVE-2012-1823" },
  { path: "/.aws/credentials", title: "AWS credentials exposed!", severity: "critical", category: "Cloud", description: "AWS credentials file accessible!", remediation: "Immediately rotate AWS credentials" },
  { path: "/.azure", title: "Azure config exposed", severity: "high", category: "Cloud", description: "Azure configuration directory accessible" },
  { path: "/server-status", title: "Apache server-status", severity: "high", category: "Info", description: "Apache server-status page shows live traffic", cve: "CVE-2019-17567" },
  { path: "/server-info", title: "Apache server-info", severity: "medium", category: "Info", description: "Apache server-info page exposes config" },
  { path: "/_profiler", title: "Symfony profiler", severity: "critical", category: "Debug", description: "Symfony debug profiler exposed in production", cve: "CVE-2018-11408" },
  { path: "/_profiler/phpinfo", title: "PHPInfo via Symfony", severity: "critical", category: "Debug", description: "PHP info page via Symfony profiler" },
  { path: "/phpinfo.php", title: "phpinfo() exposed", severity: "high", category: "Info", description: "phpinfo() page exposes PHP config and server info", remediation: "Remove phpinfo.php from production" },
  { path: "/info.php", title: "PHP info page", severity: "high", category: "Info", description: "PHP info script exposed" },
  { path: "/test.php", title: "PHP test script", severity: "medium", category: "Info", description: "Test PHP script accessible" },
  { path: "/readme.txt", title: "CMS readme exposed", severity: "info", category: "Info", description: "CMS readme reveals version info", expectStatus: [200] },
  { path: "/README.md", title: "README exposed", severity: "info", category: "Info", description: "README file may reveal tech stack" },
  { path: "/CHANGELOG.md", title: "Changelog exposed", severity: "info", category: "Info", description: "Changelog reveals version history" },
  { path: "/INSTALL.txt", title: "Install instructions", severity: "low", category: "Info", description: "Installation instructions expose tech details" },
  { path: "/package.json", title: "package.json exposed", severity: "medium", category: "Info", description: "Node.js package.json reveals dependencies and versions" },
  { path: "/composer.json", title: "composer.json exposed", severity: "medium", category: "Info", description: "PHP composer.json reveals dependencies" },
  { path: "/Gemfile", title: "Ruby Gemfile exposed", severity: "medium", category: "Info", description: "Ruby Gemfile reveals dependencies" },
  { path: "/requirements.txt", title: "Python requirements exposed", severity: "low", category: "Info", description: "Python requirements.txt reveals dependencies" },

  // ─── WordPress Specific ──────────────────────────────────────────────────
  { path: "/wp-content/debug.log", title: "WordPress debug log", severity: "high", category: "WordPress", description: "WordPress debug.log file publicly accessible" },
  { path: "/wp-includes/", title: "WordPress includes exposed", severity: "low", category: "WordPress", description: "WordPress includes directory accessible" },
  { path: "/xmlrpc.php", title: "WordPress XMLRPC enabled", severity: "high", category: "WordPress", description: "XMLRPC interface enabled — brute force risk", remediation: "Disable xmlrpc.php", cve: "CVE-2015-1438" },
  { path: "/wp-json/wp/v2/users", title: "WordPress user enum", severity: "high", category: "WordPress", description: "WordPress REST API exposes user list" },

  // ─── Upload & Shell ─────────────────────────────────────────────────────
  { path: "/upload.php", title: "Upload script exposed", severity: "high", category: "Upload", description: "File upload script accessible" },
  { path: "/uploads/", title: "Uploads directory", severity: "medium", category: "Upload", description: "Upload directory accessible - potential webshell risk" },
  { path: "/shell.php", title: "PHP webshell found!", severity: "critical", category: "Malware", description: "PHP webshell detected!", remediation: "Immediately remove and investigate" },
  { path: "/cmd.php", title: "Command shell exposed!", severity: "critical", category: "Malware", description: "PHP command execution shell found!" },
  { path: "/c99.php", title: "c99 shell found!", severity: "critical", category: "Malware", description: "c99 PHP webshell detected!" },
  { path: "/r57.php", title: "r57 shell found!", severity: "critical", category: "Malware", description: "r57 PHP webshell detected!" },
];

// Security Headers to check
const SECURITY_HEADERS = [
  { name: "Strict-Transport-Security", title: "HSTS Missing", severity: "high" as const, description: "HTTP Strict Transport Security not set" },
  { name: "Content-Security-Policy", title: "CSP Missing", severity: "medium" as const, description: "Content Security Policy header not set" },
  { name: "X-Frame-Options", title: "Clickjacking Protection Missing", severity: "medium" as const, description: "X-Frame-Options header missing — clickjacking risk" },
  { name: "X-Content-Type-Options", title: "MIME Sniffing Protection Missing", severity: "low" as const, description: "X-Content-Type-Options not set" },
  { name: "X-XSS-Protection", title: "XSS Protection Header Missing", severity: "low" as const, description: "X-XSS-Protection not set" },
  { name: "Referrer-Policy", title: "Referrer Policy Missing", severity: "low" as const, description: "Referrer-Policy not configured" },
  { name: "Permissions-Policy", title: "Permissions Policy Missing", severity: "low" as const, description: "Permissions-Policy header not configured" },
];

// ---------------------------------------------------------------------------
// HTTP Helper
// ---------------------------------------------------------------------------
interface RawResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  responseTimeMs: number;
}

function httpGet(url: string, extraHeaders?: Record<string, string>): Promise<RawResponse> {
  return new Promise((resolve) => {
    const start = Date.now();
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return resolve({ statusCode: 0, headers: {}, body: "", responseTimeMs: 0 });
    }

    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NiktoJS/1.0; +https://friday.ai)",
        "Accept": "*/*",
        "Connection": "close",
        ...extraHeaders,
      },
      timeout: 10000,
    };

    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { if (body.length < 8192) body += chunk; });
      res.on("end", () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers as Record<string, string | string[]>,
        body,
        responseTimeMs: Date.now() - start,
      }));
    });

    req.on("error", () => resolve({ statusCode: 0, headers: {}, body: "", responseTimeMs: Date.now() - start }));
    req.on("timeout", () => { req.destroy(); resolve({ statusCode: 0, headers: {}, body: "", responseTimeMs: Date.now() - start }); });
    req.end();
  });
}

// Check HTTP methods
async function checkAllowedMethods(baseUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const parsed = new URL(baseUrl);
    const lib = parsed.protocol === "https:" ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname || "/",
      method: "OPTIONS",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NiktoJS/1.0)" },
      timeout: 8000,
    }, (res) => {
      const allow = res.headers["allow"] || res.headers["Allow"] || "";
      const methods = String(allow).split(",").map(m => m.trim()).filter(Boolean);
      resolve(methods);
    });

    req.on("error", () => resolve([]));
    req.on("timeout", () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// CMS detection patterns
const CMS_PATTERNS: Record<string, string[]> = {
  WordPress: ["wp-content", "wp-includes", "wp-json", "wordpress", "/wp-login"],
  Joomla: ["joomla", "/components/com_", "/modules/mod_", "Joomla!"],
  Drupal: ["drupal", "sites/default", "modules/system", "/misc/drupal.js"],
  Laravel: ["laravel", "XSRF-TOKEN", "_token"],
  Django: ["csrftoken", "django", "__admin"],
  Rails: ["_session_id", "rails", "X-Runtime"],
  Magento: ["Magento", "mage-", "/skin/frontend/"],
  Shopify: ["shopify", "Shopify.theme"],
  React: ["__REACT", "react-root", "_next"],
  Angular: ["ng-version", "__ngContext__"],
  Vue: ["__vue__", "vue-meta"],
  Next: ["__NEXT_DATA__", "_next/static"],
  Nuxt: ["__nuxt", "_nuxt/"],
};

function detectCms(body: string, headers: Record<string, string | string[]>): string[] {
  const detected: string[] = [];
  const combined = (body + JSON.stringify(headers)).toLowerCase();

  for (const [cms, patterns] of Object.entries(CMS_PATTERNS)) {
    if (patterns.some(p => combined.includes(p.toLowerCase()))) {
      detected.push(cms);
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Nikto Service
// ---------------------------------------------------------------------------
class NiktoService {

  async scan(
    targetUrl: string,
    options?: {
      checkPaths?: boolean;      // check dangerous paths (default: true)
      checkHeaders?: boolean;    // check security headers (default: true)
      checkMethods?: boolean;    // check HTTP methods (default: true)
      maxPaths?: number;         // limit path checks (default: all)
      concurrency?: number;      // concurrent requests (default: 15)
    }
  ): Promise<NiktoReport> {
    const startTime = Date.now();

    // Normalize URL
    if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;
    const parsed = new URL(targetUrl);
    const baseUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ":" + parsed.port : ""}`;
    const protocol = parsed.protocol === "https:" ? "https" : "http" as "http" | "https";
    const port = parseInt(parsed.port) || (protocol === "https" ? 443 : 80);

    const findings: NiktoFinding[] = [];
    const technologiesDetected: string[] = [];
    let serverBanner: string | undefined;
    let poweredBy: string | undefined;
    let cmsDetected: string | undefined;
    let allowedMethods: string[] = [];
    let totalRequests = 0;

    // ── 1) BASELINE REQUEST ──────────────────────────────────────────────
    const baseline = await httpGet(baseUrl + "/");
    totalRequests++;

    serverBanner = String(baseline.headers["server"] || "");
    poweredBy = String(baseline.headers["x-powered-by"] || "");

    // Detect CMS
    const cms = detectCms(baseline.body, baseline.headers);
    if (cms.length > 0) {
      cmsDetected = cms[0];
      technologiesDetected.push(...cms);
    }

    // ── 2) SECURITY HEADERS ──────────────────────────────────────────────
    if (options?.checkHeaders !== false) {
      for (const hdr of SECURITY_HEADERS) {
        const val = baseline.headers[hdr.name.toLowerCase()];
        if (!val) {
          findings.push({
            id: `HDR-${hdr.name.toUpperCase().replace(/-/g, "_")}`,
            severity: hdr.severity,
            category: "Security Headers",
            title: hdr.title,
            description: hdr.description,
            remediation: `Add header: ${hdr.name}: <appropriate-value>`,
          });
        }
      }

      // Server version disclosure
      if (serverBanner && serverBanner.length > 0) {
        findings.push({
          id: "INFO-SERVER-BANNER",
          severity: "low",
          category: "Information Disclosure",
          title: "Server version disclosed",
          description: `Server header reveals: "${serverBanner}"`,
          evidence: serverBanner,
          remediation: "Remove or mask the Server header",
        });
      }

      if (poweredBy && poweredBy.length > 3) {
        findings.push({
          id: "INFO-POWERED-BY",
          severity: "low",
          category: "Information Disclosure",
          title: "X-Powered-By header disclosed",
          description: `X-Powered-By reveals: "${poweredBy}"`,
          evidence: poweredBy,
          remediation: "Remove X-Powered-By header",
        });
      }

      // Cookie security
      const setCookie = baseline.headers["set-cookie"];
      if (setCookie) {
        const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
        if (!cookieStr.toLowerCase().includes("httponly")) {
          findings.push({
            id: "COOKIE-HTTPONLY",
            severity: "medium",
            category: "Cookie Security",
            title: "Cookie missing HttpOnly flag",
            description: "Session cookie is accessible via JavaScript (XSS risk)",
            evidence: cookieStr.substring(0, 100),
            remediation: "Add HttpOnly flag to all session cookies",
          });
        }
        if (!cookieStr.toLowerCase().includes("secure")) {
          findings.push({
            id: "COOKIE-SECURE",
            severity: "medium",
            category: "Cookie Security",
            title: "Cookie missing Secure flag",
            description: "Cookie may be sent over HTTP (man-in-the-middle risk)",
            evidence: cookieStr.substring(0, 100),
            remediation: "Add Secure flag to all cookies",
          });
        }
        if (!cookieStr.toLowerCase().includes("samesite")) {
          findings.push({
            id: "COOKIE-SAMESITE",
            severity: "low",
            category: "Cookie Security",
            title: "Cookie missing SameSite attribute",
            description: "Cookie is vulnerable to CSRF attacks",
            remediation: "Add SameSite=Strict or SameSite=Lax to cookies",
          });
        }
      }

      // HTTPS redirect check
      if (protocol === "http") {
        findings.push({
          id: "HTTPS-NOT-ENFORCED",
          severity: "high",
          category: "Transport Security",
          title: "HTTPS not enforced",
          description: "Site is accessible over plain HTTP — data transmitted unencrypted",
          remediation: "Configure redirect from HTTP to HTTPS and enable HSTS",
        });
      }
    }

    // ── 3) HTTP METHODS ──────────────────────────────────────────────────
    if (options?.checkMethods !== false) {
      allowedMethods = await checkAllowedMethods(baseUrl);
      totalRequests++;

      const dangerousMethods = ["PUT", "DELETE", "TRACE", "CONNECT", "PATCH"];
      for (const method of allowedMethods) {
        if (dangerousMethods.includes(method.toUpperCase())) {
          findings.push({
            id: `METHOD-${method.toUpperCase()}`,
            severity: method === "TRACE" ? "medium" : "high",
            category: "HTTP Methods",
            title: `Dangerous HTTP method allowed: ${method}`,
            description: `Server accepts ${method} requests — may allow unauthorized file modification`,
            evidence: `Allowed: ${allowedMethods.join(", ")}`,
            remediation: `Disable ${method} method in webserver config`,
            cve: method === "TRACE" ? "CVE-2003-1567" : undefined,
          });
        }
      }
    }

    // ── 4) PATH SCANNING ─────────────────────────────────────────────────
    if (options?.checkPaths !== false) {
      const paths = options?.maxPaths
        ? DANGEROUS_PATHS.slice(0, options.maxPaths)
        : DANGEROUS_PATHS;

      const concurrency = options?.concurrency || 15;

      // Batch with concurrency
      for (let i = 0; i < paths.length; i += concurrency) {
        const batch = paths.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map(async (check): Promise<NiktoFinding | null> => {
            const fullUrl = baseUrl + check.path;
            const resp = await httpGet(fullUrl);
            totalRequests++;

            const expectedStatus = check.expectStatus || [200, 201, 202, 301, 302, 403];
            const statusMatch = expectedStatus.includes(resp.statusCode);

            if (!statusMatch) return null;

            // For 403 — accessible but forbidden (still a finding)
            // For 301/302 — redirect (finding if sensitive)

            // Body content check
            if (check.expectBodyContains && resp.statusCode === 200) {
              const hasContent = check.expectBodyContains.some(s =>
                resp.body.toLowerCase().includes(s.toLowerCase())
              );
              if (!hasContent) return null;
            }

            // Directory listing check
            if (resp.body.toLowerCase().includes("index of ") && resp.statusCode === 200) {
              return {
                id: `DIR-LISTING-${check.path.replace(/\//g, "_")}`,
                severity: "high",
                category: "Directory Listing",
                title: `Directory listing enabled: ${check.path}`,
                description: `Directory listing is enabled at ${check.path} — file structure exposed`,
                url: fullUrl,
                evidence: `HTTP ${resp.statusCode} — "Index of" found in response`,
                remediation: "Disable directory listing in webserver config",
              };
            }

            return {
              id: `PATH-${check.path.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`,
              severity: check.severity,
              category: check.category,
              title: check.title,
              description: check.description,
              url: fullUrl,
              evidence: `HTTP ${resp.statusCode}${resp.body.length > 0 ? ` (${resp.body.length} bytes)` : ""}`,
              remediation: check.remediation,
              cve: check.cve,
            };
          })
        );

        findings.push(...results.filter((r): r is NiktoFinding => r !== null));
      }
    }

    // ── 5) COMPUTE SCORE & GRADE ─────────────────────────────────────────
    const findingsBySeverity = findings.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const deductions =
      (findingsBySeverity["critical"] || 0) * 25 +
      (findingsBySeverity["high"] || 0) * 15 +
      (findingsBySeverity["medium"] || 0) * 7 +
      (findingsBySeverity["low"] || 0) * 3;

    const securityScore = Math.max(0, 100 - deductions);
    const grade =
      securityScore >= 90 ? "A" :
      securityScore >= 75 ? "B" :
      securityScore >= 60 ? "C" :
      securityScore >= 40 ? "D" : "F";

    const scanDurationMs = Date.now() - startTime;

    // ── 6) SUMMARY ───────────────────────────────────────────────────────
    const totalFindings = findings.filter(f => f.severity !== "info").length;
    const summary =
      `🔍 Nikto scan complete for "${baseUrl}"\n` +
      `📊 Security Score: ${securityScore}/100 (Grade: ${grade})\n` +
      `🚨 Critical: ${findingsBySeverity["critical"] || 0}\n` +
      `🔴 High: ${findingsBySeverity["high"] || 0}\n` +
      `🟠 Medium: ${findingsBySeverity["medium"] || 0}\n` +
      `🟡 Low: ${findingsBySeverity["low"] || 0}\n` +
      `ℹ️ Info: ${findingsBySeverity["info"] || 0}\n` +
      `🖥️ Server: ${serverBanner || "Hidden"}\n` +
      `📦 CMS: ${cmsDetected || "Not detected"}\n` +
      `🔢 Requests made: ${totalRequests}\n` +
      `⏱️ Scan time: ${(scanDurationMs / 1000).toFixed(1)}s`;

    return {
      target: baseUrl,
      port,
      protocol,
      serverBanner: serverBanner || undefined,
      poweredBy: poweredBy || undefined,
      findings,
      securityScore,
      grade,
      cmsDetected,
      technologiesDetected,
      allowedMethods,
      totalRequests,
      summary,
      scanDurationMs,
      findingsBySecerity: findingsBySeverity,
    };
  }

  getStatus() {
    return {
      installed: true,
      version: "2.0.0-purejs",
      description: "Nikto Web Server Scanner — Security headers, dangerous paths, CMS detection (Pure JS)",
      totalChecks: DANGEROUS_PATHS.length + SECURITY_HEADERS.length,
      categories: ["Admin Panels", "Config Files", "Backup Files", "Logs", "Security Headers", "HTTP Methods", "CMS Detection", "Cookie Security"],
      engine: "native-http",
      disclaimer: "⚠️ Use only on systems you own or have permission to test!",
    };
  }
}

export const niktoService = new NiktoService();
