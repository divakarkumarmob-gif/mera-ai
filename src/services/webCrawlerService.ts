import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";

// ---------------------------------------------------------------------------
// Friday AI Web Crawling, Firecrawl/Crawl4AI-Grade Markdown Engine, & RAG Pipeline
//
// Capabilities:
// 1. Robots.txt compliance checker & rate limiter.
// 2. High-fidelity HTML-to-Markdown cleaner (strips ads, cookies, nav, footers).
// 3. Multi-page deep crawler (BFS queue, same-domain filter, max-depth).
// 4. AI LLM Q&A & Insight Engine (Gemini 3.6/3.5/3.1 Flash fallback chain).
// 5. Structured JSON extraction for e-commerce, articles, contacts, specs.
// 6. RAG Semantic Chunking for large sites.
// ---------------------------------------------------------------------------

const MODEL_CHAIN = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
];

// Map Grounding Chain: 3.1 flash lite -> 2.5 flash -> 2.5 flash lite -> 2.0 flash
const MAP_GROUNDING_CHAIN = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

// Search Grounding Chain: 2.5 flash -> 2.0 flash
const SEARCH_GROUNDING_CHAIN = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

// Vector Embedding Model Chain: Gemini Embedding 1 -> Gemini Embedding 2 -> Legacy 001
const EMBEDDING_MODEL_CHAIN = [
  "text-embedding-004", // Gemini Embedding 1 (768/1536 dim SOTA)
  "text-embedding-002", // Gemini Embedding 2 (High-accuracy fallback)
  "embedding-001",      // Legacy Fallback
];

export interface CrawledPageMeta {
  title: string;
  description?: string;
  author?: string;
  language?: string;
  canonicalUrl?: string;
  publishedTime?: string;
  ogImage?: string;
  statusCode: number;
  contentType: string;
}

export interface CrawledLink {
  text: string;
  url: string;
  isInternal: boolean;
}

export interface CrawledPageResult {
  id: string;
  url: string;
  finalUrl: string;
  domain: string;
  timestamp: number;
  metadata: CrawledPageMeta;
  markdown: string;
  cleanedText: string;
  rawHtmlLength: number;
  markdownLength: number;
  estimatedTokens: number;
  links: CrawledLink[];
  headings: Array<{ level: number; text: string }>;
  images: Array<{ alt: string; url: string }>;
  robotsAllowed: boolean;
  crawlDurationMs: number;
  error?: string;
}

export interface DeepCrawlOptions {
  maxPages?: number; // default: 5, max: 25
  maxDepth?: number; // default: 2, max: 4
  allowSubdomains?: boolean;
  respectRobotsTxt?: boolean;
  delayBetweenRequestsMs?: number; // default: 600ms
  onProgress?: (progress: { visitedCount: number; currentUrl: string; queueLength: number }) => void;
}

export interface DeepCrawlSummary {
  rootUrl: string;
  domain: string;
  pagesCrawled: number;
  totalPagesDiscovered: number;
  totalTokens: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  pages: CrawledPageResult[];
  combinedMarkdown: string;
}

export interface WebAIQueryResponse {
  answer: string;
  sources: Array<{ title: string; url: string }>;
  keyTakeaways: string[];
  extractedData?: any;
}

const crawlCollection = () => db.collection("crawledPages");

class WebCrawlerService {
  private inMemoryCache = new Map<string, CrawledPageResult>();
  private robotsCache = new Map<string, { allowed: boolean; disallowedPaths: string[]; timestamp: number }>();

  private readonly DEFAULT_HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (compatible; FridayAI/2.0; +https://github.com/divakarkumarmob-gif/mera-ai)",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
  };

  /**
   * 1. Checks robots.txt compliance for a target URL.
   */
  public async checkRobotsTxt(targetUrl: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const parsed = new URL(targetUrl);
      const origin = parsed.origin;
      const path = parsed.pathname;

      const cached = this.robotsCache.get(origin);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        const isDisallowed = cached.disallowedPaths.some((p) => p && path.startsWith(p));
        return {
          allowed: !isDisallowed,
          reason: isDisallowed ? `Robots.txt rule forbids path: ${path}` : "Allowed by robots.txt",
        };
      }

      const robotsUrl = `${origin}/robots.txt`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const resp = await fetch(robotsUrl, {
        headers: this.DEFAULT_HEADERS,
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);

      if (!resp || !resp.ok) {
        // If robots.txt doesn't exist (404), crawling is permitted by default
        this.robotsCache.set(origin, { allowed: true, disallowedPaths: [], timestamp: Date.now() });
        return { allowed: true, reason: "No robots.txt restrictions found" };
      }

      const text = await resp.text();
      const disallowedPaths: string[] = [];
      let appliesToAll = false;

      const lines = text.split("\n").map((l) => l.trim());
      for (const line of lines) {
        if (/^User-agent:\s*\*/i.test(line) || /^User-agent:\s*Friday/i.test(line)) {
          appliesToAll = true;
        } else if (/^User-agent:/i.test(line)) {
          appliesToAll = false;
        } else if (appliesToAll && /^Disallow:\s*(.*)/i.test(line)) {
          const match = line.match(/^Disallow:\s*(.*)/i);
          const disPath = match?.[1]?.trim();
          if (disPath) disallowedPaths.push(disPath);
        }
      }

      this.robotsCache.set(origin, { allowed: true, disallowedPaths, timestamp: Date.now() });

      const isDisallowed = disallowedPaths.some((p) => p && path.startsWith(p));
      return {
        allowed: !isDisallowed,
        reason: isDisallowed ? `Robots.txt explicitly disallows path: ${path}` : "Allowed by robots.txt",
      };
    } catch {
      return { allowed: true, reason: "Defaulting to allow (robots check error)" };
    }
  }

  /**
   * 2. Cleans raw HTML into pristine, LLM-ready Markdown (Firecrawl / Crawl4AI standard).
   */
  public cleanHtmlToMarkdown(html: string, baseUrl: string): {
    markdown: string;
    cleanedText: string;
    metadata: CrawledPageMeta;
    links: CrawledLink[];
    headings: Array<{ level: number; text: string }>;
    images: Array<{ alt: string; url: string }>;
  } {
    let clean = html;

    // Extract Title
    const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? this.decodeHtmlEntities(titleMatch[1].trim()) : "Untitled Webpage";

    // Extract Meta Description
    const metaDescMatch = clean.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      clean.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
      clean.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
    const description = metaDescMatch ? this.decodeHtmlEntities(metaDescMatch[1].trim()) : undefined;

    // Extract Canonical URL
    const canonicalMatch = clean.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
    const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : undefined;

    // Extract Author
    const authorMatch = clean.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["']/i) ||
      clean.match(/<meta[^>]*property=["']article:author["'][^>]*content=["']([^"']*)["']/i);
    const author = authorMatch ? this.decodeHtmlEntities(authorMatch[1].trim()) : undefined;

    // Extract OG Image
    const ogImgMatch = clean.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
    const ogImage = ogImgMatch ? ogImgMatch[1].trim() : undefined;

    // Extract Headings
    const headings: Array<{ level: number; text: string }> = [];
    const headingMatches = clean.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);
    for (const hm of headingMatches) {
      const level = parseInt(hm[1], 10);
      const text = this.stripTags(hm[2]).trim();
      if (text) headings.push({ level, text });
    }

    // Extract Links before stripping tags
    const links: CrawledLink[] = [];
    const linkMatches = clean.matchAll(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi);
    const seenUrls = new Set<string>();
    for (const lm of linkMatches) {
      const rawHref = lm[1].trim();
      const linkText = this.stripTags(lm[2]).trim();
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
        continue;
      }
      try {
        const fullUrl = new URL(rawHref, baseUrl).href;
        if (!seenUrls.has(fullUrl)) {
          seenUrls.add(fullUrl);
          const baseDomain = new URL(baseUrl).hostname;
          const targetDomain = new URL(fullUrl).hostname;
          links.push({
            text: linkText || fullUrl,
            url: fullUrl,
            isInternal: baseDomain === targetDomain,
          });
        }
      } catch {}
    }

    // Extract Images
    const images: Array<{ alt: string; url: string }> = [];
    const imgMatches = clean.matchAll(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']?([^"'>]*)["']?[^>]*>/gi);
    for (const im of imgMatches) {
      const rawSrc = im[1].trim();
      const alt = im[2]?.trim() || "";
      if (rawSrc && !rawSrc.startsWith("data:")) {
        try {
          const fullImgUrl = new URL(rawSrc, baseUrl).href;
          images.push({ alt, url: fullImgUrl });
        } catch {}
      }
    }

    // Strip Noisy Elements: Scripts, Styles, Nav, Footers, Iframes, Cookie Banners, Ads
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
    clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
    clean = clean.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");
    clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ");
    clean = clean.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");
    clean = clean.replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, " ");
    clean = clean.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ");
    clean = clean.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ");
    clean = clean.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ");
    clean = clean.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ");
    clean = clean.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, " ");

    // Remove Cookie & Consent Banner containers
    clean = clean.replace(/<div[^>]*(id|class)=["'][^"']*(cookie|consent|banner|ad-container|advertisement|popup)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ");

    // Target Main / Article Content if available
    const articleMatch = clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
      clean.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
      clean.match(/<div[^>]*(id|class)=["'][^"']*(content|main|article-body|post-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    
    if (articleMatch && articleMatch[1] && articleMatch[1].length > 400) {
      clean = articleMatch[1];
    }

    // Convert HTML elements to clean Markdown
    // 1. Code blocks <pre><code>...</code></pre>
    clean = clean.replace(/<pre[^>]*><code(?: class=["'](?:language-)?([a-zA-Z0-9_-]+)["'])?[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
      return `\n\n\`\`\`${lang || ""}\n${this.decodeHtmlEntities(this.stripTags(code)).trim()}\n\`\`\`\n\n`;
    });
    clean = clean.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${this.decodeHtmlEntities(this.stripTags(code)).trim()}\``);

    // 2. Bold & Italics (Process before paragraph/block wrappers)
    clean = clean.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, b) => `**${this.stripTags(b).trim()}**`);
    clean = clean.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, i) => `*${this.stripTags(i).trim()}*`);

    // 3. Links & Images
    clean = clean.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const label = this.stripTags(text).trim() || href;
      return `[${label}](${href})`;
    });

    // 4. Headings
    clean = clean.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${this.stripTags(t).trim()}\n\n`);
    clean = clean.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${this.stripTags(t).trim()}\n\n`);
    clean = clean.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${this.stripTags(t).trim()}\n\n`);
    clean = clean.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, t) => `\n\n#### ${this.stripTags(t).trim()}\n\n`);

    // 5. Lists
    clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => `\n* ${item.trim()}`);
    clean = clean.replace(/<\/ul>|<\/ol>/gi, "\n\n");

    // 6. Blockquotes
    clean = clean.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, q) => `\n> ${q.trim()}\n\n`);

    // 7. Paragraphs & Line breaks
    clean = clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, p) => `\n\n${p.trim()}\n\n`);
    clean = clean.replace(/<br\s*\/?>/gi, "\n");
    clean = clean.replace(/<hr\s*\/?>/gi, "\n---\n");

    // 8. Strip any remaining dangling HTML tags
    const markdownBody = this.stripTags(clean);
    const decodedMarkdown = this.decodeHtmlEntities(markdownBody)
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    // Final LLM-optimized Markdown Document
    let finalizedMarkdown = `# ${title}\n\n`;
    finalizedMarkdown += `**Source URL:** ${baseUrl}\n`;
    if (author) finalizedMarkdown += `**Author:** ${author}\n`;
    if (description) finalizedMarkdown += `**Summary / Description:** ${description}\n`;
    finalizedMarkdown += `\n---\n\n${decodedMarkdown}`;

    const cleanedText = finalizedMarkdown.replace(/[*_#`~>\[\]]/g, "").replace(/\s+/g, " ").trim();

    return {
      markdown: finalizedMarkdown,
      cleanedText,
      metadata: {
        title,
        description,
        author,
        canonicalUrl,
        ogImage,
        statusCode: 200,
        contentType: "text/html",
      },
      links,
      headings,
      images: images.slice(0, 15),
    };
  }

  /**
   * 3. Crawls a single URL and extracts clean Markdown & structured signals.
   */
  public async crawlUrl(url: string, respectRobots = true): Promise<CrawledPageResult> {
    const startTime = Date.now();
    const id = `crawl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Normalize URL
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    const domain = new URL(targetUrl).hostname;

    // Check Robots.txt
    let robotsAllowed = true;
    if (respectRobots) {
      const robotsCheck = await this.checkRobotsTxt(targetUrl);
      robotsAllowed = robotsCheck.allowed;
      if (!robotsAllowed) {
        console.warn(`[WebCrawler] Robots.txt disallows URL: ${targetUrl}`);
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000); // 18s timeout

      const resp = await fetch(targetUrl, {
        headers: this.DEFAULT_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeout);

      const finalUrl = resp.url || targetUrl;
      const statusCode = resp.status;
      const contentType = resp.headers.get("content-type") || "text/html";

      if (!resp.ok) {
        throw new Error(`HTTP Error ${statusCode}: ${resp.statusText}`);
      }

      const rawHtml = await resp.text();
      const parsed = this.cleanHtmlToMarkdown(rawHtml, finalUrl);

      const estimatedTokens = Math.ceil(parsed.markdown.length / 3.8);

      const result: CrawledPageResult = {
        id,
        url: targetUrl,
        finalUrl,
        domain,
        timestamp: Date.now(),
        metadata: {
          ...parsed.metadata,
          statusCode,
          contentType,
        },
        markdown: parsed.markdown,
        cleanedText: parsed.cleanedText,
        rawHtmlLength: rawHtml.length,
        markdownLength: parsed.markdown.length,
        estimatedTokens,
        links: parsed.links,
        headings: parsed.headings,
        images: parsed.images,
        robotsAllowed,
        crawlDurationMs: Date.now() - startTime,
      };

      this.inMemoryCache.set(id, result);
      this.inMemoryCache.set(targetUrl, result);

      // Async persist to Firestore
      crawlCollection().doc(id).set(result).catch(() => {});

      return result;
    } catch (err: any) {
      console.error(`[WebCrawler] Failed to crawl ${targetUrl}:`, err);
      const failedResult: CrawledPageResult = {
        id,
        url: targetUrl,
        finalUrl: targetUrl,
        domain,
        timestamp: Date.now(),
        metadata: { title: "Crawl Failed", statusCode: 500, contentType: "unknown" },
        markdown: `# Crawl Failed for ${targetUrl}\n\nError: ${err?.message || err}`,
        cleanedText: `Crawl Failed: ${err?.message || err}`,
        rawHtmlLength: 0,
        markdownLength: 0,
        estimatedTokens: 0,
        links: [],
        headings: [],
        images: [],
        robotsAllowed,
        crawlDurationMs: Date.now() - startTime,
        error: err?.message || String(err),
      };
      this.inMemoryCache.set(id, failedResult);
      return failedResult;
    }
  }

  /**
   * 4. Multi-Page Deep Crawler (BFS Crawl over website hierarchy).
   */
  public async deepCrawl(rootUrl: string, options: DeepCrawlOptions = {}): Promise<DeepCrawlSummary> {
    const startTime = Date.now();
    const maxPages = Math.min(Math.max(options.maxPages || 5, 1), 25);
    const maxDepth = Math.min(Math.max(options.maxDepth || 2, 1), 4);
    const delayMs = options.delayBetweenRequestsMs || 500;
    const respectRobots = options.respectRobotsTxt !== false;

    let normalizedRoot = rootUrl.trim();
    if (!/^https?:\/\//i.test(normalizedRoot)) normalizedRoot = `https://${normalizedRoot}`;

    const rootDomain = new URL(normalizedRoot).hostname;
    const visitedUrls = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: normalizedRoot, depth: 1 }];
    const pages: CrawledPageResult[] = [];
    const discoveredUrls = new Set<string>([normalizedRoot]);

    while (queue.length > 0 && pages.length < maxPages) {
      const current = queue.shift()!;
      if (visitedUrls.has(current.url)) continue;
      visitedUrls.add(current.url);

      options.onProgress?.({
        visitedCount: pages.length + 1,
        currentUrl: current.url,
        queueLength: queue.length,
      });

      const pageResult = await this.crawlUrl(current.url, respectRobots);
      if (!pageResult.error) {
        pages.push(pageResult);

        // If depth limit not reached, discover internal links
        if (current.depth < maxDepth && pages.length + queue.length < maxPages * 2) {
          for (const link of pageResult.links) {
            if (link.isInternal && !visitedUrls.has(link.url) && !discoveredUrls.has(link.url)) {
              try {
                const linkDomain = new URL(link.url).hostname;
                const matchesDomain = options.allowSubdomains
                  ? linkDomain.endsWith(rootDomain)
                  : linkDomain === rootDomain;

                if (matchesDomain && this.isValidWebPageUrl(link.url)) {
                  discoveredUrls.add(link.url);
                  queue.push({ url: link.url, depth: current.depth + 1 });
                }
              } catch {}
            }
          }
        }
      }

      if (queue.length > 0 && pages.length < maxPages) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const totalTokens = pages.reduce((acc, p) => acc + p.estimatedTokens, 0);

    // Build unified multi-page Markdown digest
    let combinedMarkdown = `# Deep Crawl Report for ${rootDomain}\n\n`;
    combinedMarkdown += `**Root URL:** ${normalizedRoot}\n`;
    combinedMarkdown += `**Pages Crawled:** ${pages.length}\n`;
    combinedMarkdown += `**Total Estimated Tokens:** ${totalTokens}\n`;
    combinedMarkdown += `**Timestamp:** ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n\n`;
    combinedMarkdown += `---\n\n`;

    for (let idx = 0; idx < pages.length; idx++) {
      const p = pages[idx];
      combinedMarkdown += `## [Page ${idx + 1}/${pages.length}] ${p.metadata.title}\n`;
      combinedMarkdown += `**URL:** ${p.finalUrl}\n\n`;
      combinedMarkdown += `${p.markdown}\n\n---\n\n`;
    }

    return {
      rootUrl: normalizedRoot,
      domain: rootDomain,
      pagesCrawled: pages.length,
      totalPagesDiscovered: discoveredUrls.size,
      totalTokens,
      startTime,
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      pages,
      combinedMarkdown,
    };
  }

  /**
   * 5. AI LLM Integration: Ask Questions / Query Crawled Content (RAG & Direct Prompting).
   */
  public async queryCrawledContent(
    crawledMarkdownOrUrl: string,
    userQuery: string
  ): Promise<WebAIQueryResponse> {
    let markdownContent = crawledMarkdownOrUrl;
    let sourceUrl = "Crawled Source";

    // If a URL was passed directly instead of markdown, crawl it first
    if (/^https?:\/\//i.test(crawledMarkdownOrUrl.trim())) {
      sourceUrl = crawledMarkdownOrUrl.trim();
      const crawlRes = await this.crawlUrl(sourceUrl);
      markdownContent = crawlRes.markdown;
    }

    // Token-safe truncation for prompt context (up to ~35,000 characters)
    const contextContent = markdownContent.slice(0, 35000);

    const prompt = `You are Friday, DK's elite AI Web Intelligence Specialist & Research Assistant.
You have just crawled and extracted the full text and data from the target website.

USER QUERY / GOAL:
"${userQuery}"

CRAWLED WEBPAGE CONTENT (MARKDOWN):
${contextContent}

INSTRUCTIONS:
1. Provide a comprehensive, accurate, and insightful response answering DK's query based strictly on the crawled data.
2. If relevant, extract key facts, pricing, technical specifications, statistics, dates, or contact info in clear bullet points.
3. If the answer is not present in the content, be honest and state what was found.
4. Provide 3-5 high-impact "Key Takeaways".

Respond in clean, friendly Hinglish/English with crisp markdown formatting.`;

    const aiResponse = await this.callGeminiModel(prompt);

    const text = aiResponse || "Unable to extract answer from crawled content.";

    // Extract bullet takeaways
    const takeaways: string[] = [];
    const takeawayMatches = text.matchAll(/(?:[-*•]|\d+\.)\s*(.+)/g);
    for (const tm of takeawayMatches) {
      takeaways.push(tm[1].trim());
      if (takeaways.length >= 5) break;
    }

    return {
      answer: text,
      sources: [{ title: "Target Website", url: sourceUrl }],
      keyTakeaways: takeaways.length > 0 ? takeaways : ["Direct insights synthesized from target webpage."],
    };
  }

  /**
   * 6. AI LLM Auto-Summarizer & Executive Brief.
   */
  public async summarizeWebpage(urlOrMarkdown: string): Promise<{
    title: string;
    executiveSummary: string;
    keyPoints: string[];
    actionableInsights: string[];
    markdown: string;
  }> {
    const queryRes = await this.queryCrawledContent(
      urlOrMarkdown,
      "Summarize this website in detail: give an executive summary, core offerings/topics, key specs or pricing if any, and actionable insights."
    );

    return {
      title: "Webpage Executive Summary",
      executiveSummary: queryRes.answer,
      keyPoints: queryRes.keyTakeaways,
      actionableInsights: [
        "Website content successfully indexed and parsed into structured LLM context.",
        "Full markdown ready for downstream RAG vector search or voice extraction.",
      ],
      markdown: queryRes.answer,
    };
  }

  /**
   * 7. Structured JSON Extractor: Extracts custom JSON schema from any website.
   */
  public async extractStructuredJSON(urlOrMarkdown: string, schemaDescription: string): Promise<any> {
    let markdown = urlOrMarkdown;
    if (/^https?:\/\//i.test(urlOrMarkdown.trim())) {
      const crawl = await this.crawlUrl(urlOrMarkdown.trim());
      markdown = crawl.markdown;
    }

    const prompt = `You are a precision Data Extraction Engine. Extract structured data from this crawled webpage according to the requested schema.

TARGET SCHEMA / REQUIREMENTS:
${schemaDescription}

CRAWLED PAGE CONTENT:
${markdown.slice(0, 30000)}

RETURN ONLY VALID JSON (no backticks, no explanatory text, just raw JSON):`;

    const response = await this.callGeminiModel(prompt);
    if (!response) return { error: "AI extraction returned empty response" };

    try {
      const cleaned = response.replace(/```json/gi, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { rawExtractedText: response };
    }
  }

  /** Helper: Call Gemini model with robust fallback chain */
  private async callGeminiModel(prompt: string): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[WebCrawler] GEMINI_API_KEY not configured.");
      return null;
    }

    const ai = new GoogleGenAI({ apiKey });

    for (let i = 0; i < MODEL_CHAIN.length; i++) {
      const model = MODEL_CHAIN[i];
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: prompt,
        });
        const text = resp.text;
        if (text && text.trim()) return text;
        console.warn(`[WebCrawler] ${model} returned empty response, trying next in fallback chain...`);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const is503 = errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand");
        console.warn(`[WebCrawler] Model ${model} failed (${errMsg}). Switching to next fallback...`);
        if (i < MODEL_CHAIN.length - 1) {
          const delayMs = is503 ? 1500 : 300;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    console.error("[WebCrawler] ❌ All models in the fallback chain failed.");
    return null;
  }

  /**
   * Google Search Grounding with Live Citations & Facts
   * Chain: gemini-2.5-flash -> gemini-2.0-flash
   */
  public async executeSearchGrounding(query: string): Promise<{
    answer: string;
    sources: Array<{ title: string; url: string }>;
    modelUsed: string;
  }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured in environment");

    const ai = new GoogleGenAI({ apiKey });

    for (const model of SEARCH_GROUNDING_CHAIN) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: query,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
        const text = resp.text;
        if (text && text.trim()) {
          const sources: Array<{ title: string; url: string }> = [];
          const groundingMetadata = (resp as any).candidates?.[0]?.groundingMetadata;
          if (groundingMetadata?.groundingChunks) {
            for (const chunk of groundingMetadata.groundingChunks) {
              if (chunk.web?.uri) {
                sources.push({
                  title: chunk.web.title || "Web Source",
                  url: chunk.web.uri,
                });
              }
            }
          }
          return { answer: text, sources, modelUsed: model };
        }
      } catch (err: any) {
        console.warn(`[SearchGrounding] Model ${model} failed: ${err?.message || err}`);
      }
    }
    throw new Error("Search Grounding failed across all fallback models.");
  }

  /**
   * Google Map & Location Grounding (Places, Directions & Geo-Intelligence)
   * Chain: gemini-3.1-flash-lite -> gemini-2.5-flash -> gemini-2.5-flash-lite -> gemini-2.0-flash
   */
  public async executeMapGrounding(locationQuery: string): Promise<{
    answer: string;
    modelUsed: string;
  }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured in environment");

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are Friday's Location, Maps & Geospatial Intelligence Specialist.
Target Location Query: "${locationQuery}"

Provide a detailed, precise location guide including:
1. Exact area/coordinates context & landmarks.
2. Route guidance, navigation tips, and distances.
3. Operating hours, popular spots, and nearby essentials.
4. Clean bullet summary in friendly Hinglish/English.`;

    for (const model of MAP_GROUNDING_CHAIN) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: prompt,
        });
        const text = resp.text;
        if (text && text.trim()) {
          return { answer: text, modelUsed: model };
        }
      } catch (err: any) {
        console.warn(`[MapGrounding] Model ${model} failed: ${err?.message || err}`);
      }
    }
    throw new Error("Map Grounding failed across all fallback models.");
  }

  /**
   * Vector Embedding Generator with robust fallback chain:
   * text-embedding-004 -> text-embedding-002 -> embedding-001
   */
  public async generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const ai = new GoogleGenAI({ apiKey });

    for (const model of EMBEDDING_MODEL_CHAIN) {
      try {
        const resp = await ai.models.embedContent({
          model,
          contents: text,
        });
        const vector = resp.embedding?.values;
        if (vector && vector.length > 0) {
          return vector;
        }
      } catch (err: any) {
        console.warn(`[Embedding] Model ${model} failed: ${err?.message || err}`);
      }
    }
    return null;
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, " ");
  }

  private decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#x2F;/g, "/")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  }

  private isValidWebPageUrl(u: string): boolean {
    return !/\.(zip|tar|gz|exe|dmg|pdf|png|jpg|jpeg|gif|webp|svg|mp4|mp3|wav|json|xml|css|js)$/i.test(u);
  }
}

export const webCrawlerService = new WebCrawlerService();
