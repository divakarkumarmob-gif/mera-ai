/**
 * FRIDAY AI — Stealth Anti-Bot Request & Scraping Engine
 * 
 * Provides human-like browser fingerprint emulation, User-Agent & Client Hints rotation,
 * residential scraping API fallbacks (ScraperAPI / ZenRows / BrightData / ScrapingDog),
 * and automatic retry logic for e-commerce crawling (Amazon, Flipkart, Meesho, Croma, etc.).
 */

interface UserAgentProfile {
  userAgent: string;
  secChUa: string;
  secChUaPlatform: string;
  secChUaMobile: string;
}

const USER_AGENT_PROFILES: UserAgentProfile[] = [
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    secChUaPlatform: '"macOS"',
    secChUaMobile: "?0",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
    secChUa: '"Firefox";v="135", "Gecko";v="20100101"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
  },
  {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6943.121 Mobile Safari/537.36",
    secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    secChUaPlatform: '"Android"',
    secChUaMobile: "?1",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
    secChUa: '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
  }
];

export interface StealthFetchOptions {
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: any;
  timeoutMs?: number;
  maxRetries?: number;
  useScrapingApiIfAvailable?: boolean;
}

export interface StealthFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  html: string;
  url: string;
  usedProxyOrApi: boolean;
  provider: string;
}

class StealthScraperService {
  private cookieJar: Map<string, string> = new Map();

  private getRandomProfile(): UserAgentProfile {
    const idx = Math.floor(Math.random() * USER_AGENT_PROFILES.length);
    return USER_AGENT_PROFILES[idx];
  }

  private getRealisticHeaders(targetUrl: string, customHeaders?: Record<string, string>): Record<string, string> {
    const profile = this.getRandomProfile();
    const parsed = new URL(targetUrl);

    const headers: Record<string, string> = {
      "User-Agent": profile.userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Ch-Ua": profile.secChUa,
      "Sec-Ch-Ua-Mobile": profile.secChUaMobile,
      "Sec-Ch-Ua-Platform": profile.secChUaPlatform,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      "DNT": "1",
      "Connection": "keep-alive",
      "Host": parsed.host,
      ...(customHeaders || {})
    };

    // Attach stored cookies for domain if any
    const existingCookie = this.cookieJar.get(parsed.hostname);
    if (existingCookie) {
      headers["Cookie"] = existingCookie;
    }

    return headers;
  }

  public async fetchStealthHtml(targetUrl: string, options: StealthFetchOptions = {}): Promise<StealthFetchResponse> {
    const maxRetries = options.maxRetries ?? 3;
    const timeoutMs = options.timeoutMs ?? 15000;
    const useScrapingApi = options.useScrapingApiIfAvailable !== false;

    // 1. Check if Premium Scraping APIs are configured via environment variables
    if (useScrapingApi) {
      // ScraperAPI (https://www.scraperapi.com)
      if (process.env.SCRAPER_API_KEY) {
        try {
          const scraperUrl = `https://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&country_code=in&render=true`;
          const resp = await fetch(scraperUrl, { signal: AbortSignal.timeout(timeoutMs) });
          if (resp.ok) {
            const html = await resp.text();
            return {
              ok: true,
              status: resp.status,
              statusText: resp.statusText,
              html,
              url: targetUrl,
              usedProxyOrApi: true,
              provider: "ScraperAPI"
            };
          }
        } catch (err) {
          console.warn("[StealthScraper] ScraperAPI fallback note:", err);
        }
      }

      // ZenRows (https://www.zenrows.com)
      if (process.env.ZENROWS_API_KEY) {
        try {
          const zenUrl = `https://api.zenrows.com/v1/?apikey=${process.env.ZENROWS_API_KEY}&url=${encodeURIComponent(targetUrl)}&js_render=true&antibot=true&premium_proxy=true&proxy_country=in`;
          const resp = await fetch(zenUrl, { signal: AbortSignal.timeout(timeoutMs) });
          if (resp.ok) {
            const html = await resp.text();
            return {
              ok: true,
              status: resp.status,
              statusText: resp.statusText,
              html,
              url: targetUrl,
              usedProxyOrApi: true,
              provider: "ZenRows"
            };
          }
        } catch (err) {
          console.warn("[StealthScraper] ZenRows fallback note:", err);
        }
      }

      // ScrapingDog (https://www.scrapingdog.com)
      if (process.env.SCRAPINGDOG_API_KEY) {
        try {
          const dogUrl = `https://api.scrapingdog.com/scrape?api_key=${process.env.SCRAPINGDOG_API_KEY}&url=${encodeURIComponent(targetUrl)}&country=in&dynamic=true`;
          const resp = await fetch(dogUrl, { signal: AbortSignal.timeout(timeoutMs) });
          if (resp.ok) {
            const html = await resp.text();
            return {
              ok: true,
              status: resp.status,
              statusText: resp.statusText,
              html,
              url: targetUrl,
              usedProxyOrApi: true,
              provider: "ScrapingDog"
            };
          }
        } catch (err) {
          console.warn("[StealthScraper] ScrapingDog fallback note:", err);
        }
      }
    }

    // 2. Direct High-Stealth Native Request with Fingerprint Rotation & Jittered Delays
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Human-like jitter delay between retries
        if (attempt > 1) {
          const jitter = 1000 + Math.floor(Math.random() * 2000);
          await new Promise((res) => setTimeout(res, jitter));
        }

        const headers = this.getRealisticHeaders(targetUrl, options.headers);
        const resp = await fetch(targetUrl, {
          method: options.method || "GET",
          headers,
          body: options.body,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow"
        });

        // Store any set-cookie response headers
        const setCookie = resp.headers.get("set-cookie");
        if (setCookie) {
          try {
            const domain = new URL(targetUrl).hostname;
            this.cookieJar.set(domain, setCookie.split(";")[0]);
          } catch {}
        }

        const html = await resp.text();

        // Check if page contains anti-bot / captcha challenge
        const isBotBlocked = 
          resp.status === 403 || 
          resp.status === 429 || 
          html.includes("Robot Check") || 
          html.includes("Type the characters you see in this image") ||
          html.includes("Cloudflare Ray ID") ||
          html.includes("cf-browser-verification");

        if (isBotBlocked && attempt < maxRetries) {
          console.warn(`[StealthScraper] Bot detection encountered for ${targetUrl} (Attempt ${attempt}/${maxRetries}), rotating profile...`);
          continue;
        }

        return {
          ok: !isBotBlocked && resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          html,
          url: targetUrl,
          usedProxyOrApi: false,
          provider: "NativeStealthEngine"
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[StealthScraper] Request attempt ${attempt} failed:`, err?.message || err);
      }
    }

    return {
      ok: false,
      status: 500,
      statusText: "All stealth attempts failed: " + (lastError?.message || "Unknown error"),
      html: "",
      url: targetUrl,
      usedProxyOrApi: false,
      provider: "None"
    };
  }
}

export const stealthScraperService = new StealthScraperService();
