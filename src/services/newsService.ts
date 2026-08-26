export interface NewsArticle {
  title: string;
  link: string;
  source: string;
  sourceIcon?: string;
  pubDate: string;
  description?: string;
  content?: string;
  imageUrl?: string;
  category?: string[];
  country?: string[];
  language?: string;
  sentiment?: "positive" | "negative" | "neutral" | string;
  sentimentStats?: {
    positive?: number;
    neutral?: number;
    negative?: number;
  };
}

export interface NewsResult {
  success: boolean;
  totalResults: number;
  category?: string;
  topic?: string;
  articles: NewsArticle[];
  sourceEngine: "newsdata_io" | "google_news_live" | "newsapi_org";
  nextPage?: string;
  message: string;
}

export interface CryptoNewsResult {
  success: boolean;
  coin?: string;
  articles: NewsArticle[];
  message: string;
}

export interface NewsSourcesResult {
  success: boolean;
  totalSources: number;
  sources: {
    id: string;
    name: string;
    url: string;
    category?: string;
    country?: string;
    language?: string;
  }[];
  message: string;
}

export class NewsService {
  private baseUrl = "https://newsdata.io/api/1";

  private getApiKey(): string | undefined {
    return (
      process.env.NEWSDATA_API_KEY ||
      process.env.NEWS_DATA_API_KEY ||
      process.env.NEWSDATA_KEY ||
      process.env.NEWS_API_KEY
    );
  }

  /**
   * 1. Real-Time Latest Breaking News (Category, Country, Search Query, Multi-Language)
   */
  public async getLatestNews(
    topicOrQuery?: string,
    category?: string,
    country: string = "in",
    language: string = "en",
    count: number = 10
  ): Promise<NewsResult> {
    const apiKey = this.getApiKey();
    const requestedCount = Math.min(Math.max(count || 10, 1), 15);
    const cat = category || this.detectCategory(topicOrQuery);

    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apikey: apiKey,
          country: country || "in",
          language: language || "en",
        });

        if (cat && cat !== "all" && cat !== "top") {
          params.set("category", cat);
        }

        if (topicOrQuery && !this.isGenericQuery(topicOrQuery)) {
          params.set("q", topicOrQuery);
        }

        const url = `${this.baseUrl}/latest?${params.toString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });

        if (res.ok) {
          const data = await res.json();
          if (data.status === "success" && Array.isArray(data.results) && data.results.length > 0) {
            const articles: NewsArticle[] = data.results.slice(0, requestedCount).map((r: any) => ({
              title: r.title,
              link: r.link,
              source: r.source_id || r.source_name || "NewsData",
              sourceIcon: r.source_icon,
              pubDate: r.pubDate,
              description: r.description,
              imageUrl: r.image_url,
              category: r.category,
              country: r.country,
              language: r.language,
              sentiment: r.sentiment || "neutral",
              sentimentStats: r.sentiment_stats,
            }));

            let msg = `📰 **Latest Breaking News${cat ? ` (${cat.toUpperCase()})` : ""}:**\n\n`;
            articles.slice(0, 5).forEach((a, idx) => {
              msg += `${idx + 1}. **${a.title}**\n   🏛️ _Source: ${a.source}_ | ⏱️ ${a.pubDate || "Just now"}\n`;
            });

            return {
              success: true,
              totalResults: data.totalResults || articles.length,
              category: cat,
              topic: topicOrQuery,
              articles,
              sourceEngine: "newsdata_io",
              nextPage: data.nextPage,
              message: msg.trim(),
            };
          }
        }
      } catch (e) {
        console.warn("[NewsService] NewsData.io error, falling back to Google News:", e);
      }
    }

    // High-precision Real-Time Google News Live RSS Fallback
    return this.getGoogleNewsFallback(topicOrQuery, cat, requestedCount);
  }

  /**
   * 2. Dedicated Crypto & Blockchain Real-Time News Stream
   */
  public async getCryptoNews(coinOrQuery: string = "Bitcoin", count: number = 8): Promise<CryptoNewsResult> {
    const apiKey = this.getApiKey();
    const q = coinOrQuery.trim() || "crypto";

    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apikey: apiKey,
          q: q,
          language: "en",
        });

        const url = `${this.baseUrl}/crypto?${params.toString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (res.ok) {
          const data = await res.json();
          if (data.status === "success" && Array.isArray(data.results)) {
            const articles: NewsArticle[] = data.results.slice(0, count).map((r: any) => ({
              title: r.title,
              link: r.link,
              source: r.source_id || "CryptoNews",
              sourceIcon: r.source_icon,
              pubDate: r.pubDate,
              description: r.description,
              imageUrl: r.image_url,
              sentiment: r.sentiment || "neutral",
            }));

            let msg = `🪙 **Live Crypto & Blockchain News (${q}):**\n\n`;
            articles.slice(0, 5).forEach((a, idx) => {
              msg += `${idx + 1}. **${a.title}** (${a.source})\n`;
            });

            return {
              success: true,
              coin: q,
              articles,
              message: msg.trim(),
            };
          }
        }
      } catch (e) {}
    }

    // Google News Crypto Fallback
    const fallback = await this.getGoogleNewsFallback(`${q} cryptocurrency crypto`, "business", count);
    return {
      success: fallback.success,
      coin: q,
      articles: fallback.articles,
      message: fallback.message,
    };
  }

  /**
   * 3. Historical & Archive News Search
   */
  public async getArchiveNews(
    query: string,
    fromDate?: string,
    toDate?: string,
    country: string = "in"
  ): Promise<NewsResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return this.getGoogleNewsFallback(query, undefined, 8);
    }

    try {
      const params = new URLSearchParams({
        apikey: apiKey,
        q: query,
        country: country || "in",
      });

      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);

      const url = `${this.baseUrl}/archive?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });

      if (res.ok) {
        const data = await res.json();
        const articles: NewsArticle[] = (data.results || []).slice(0, 10).map((r: any) => ({
          title: r.title,
          link: r.link,
          source: r.source_id || "Archive",
          pubDate: r.pubDate,
          description: r.description,
        }));

        return {
          success: true,
          totalResults: data.totalResults || articles.length,
          topic: query,
          articles,
          sourceEngine: "newsdata_io",
          message: `📜 Found ${articles.length} historical news records for "${query}".`,
        };
      }
    } catch (e) {}

    return this.getGoogleNewsFallback(query, undefined, 8);
  }

  /**
   * 4. Directory of Verified News Sources
   */
  public async getNewsSources(country: string = "in", category?: string): Promise<NewsSourcesResult> {
    const apiKey = this.getApiKey();
    if (apiKey) {
      try {
        const params = new URLSearchParams({ apikey: apiKey, country: country || "in" });
        if (category) params.set("category", category);

        const url = `${this.baseUrl}/sources?${params.toString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const sources = (data.results || []).slice(0, 15).map((s: any) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            category: s.category,
            country: s.country,
            language: s.language,
          }));

          let msg = `🏛️ **Verified Indian News Sources:**\n`;
          sources.slice(0, 8).forEach((s: any) => (msg += `• **${s.name}** (${s.url})\n`));

          return {
            success: true,
            totalSources: data.totalResults || sources.length,
            sources,
            message: msg,
          };
        }
      } catch (e) {}
    }

    return {
      success: true,
      totalSources: 6,
      sources: [
        { id: "ndtv", name: "NDTV News", url: "https://ndtv.com", country: "in" },
        { id: "toi", name: "Times of India", url: "https://timesofindia.indiatimes.com", country: "in" },
        { id: "thehindu", name: "The Hindu", url: "https://thehindu.com", country: "in" },
        { id: "indianexpress", name: "Indian Express", url: "https://indianexpress.com", country: "in" },
        { id: "aajtak", name: "Aaj Tak", url: "https://aajtak.in", country: "in" },
        { id: "hindustantimes", name: "Hindustan Times", url: "https://hindustantimes.com", country: "in" },
      ],
      message: `🏛️ Verified Sources: NDTV, Times of India, The Hindu, Indian Express, Aaj Tak, Hindustan Times.`,
    };
  }

  // ── Helper Detectors & Google News Live Fallback ───────────────────────────
  private detectCategory(query?: string): string | undefined {
    if (!query) return undefined;
    const q = query.toLowerCase();
    if (q.includes("politics") || q.includes("rajneeti") || q.includes("election") || q.includes("bjp") || q.includes("congress")) return "politics";
    if (q.includes("tech") || q.includes("technology") || q.includes("ai") || q.includes("apple") || q.includes("google")) return "technology";
    if (q.includes("business") || q.includes("finance") || q.includes("stock") || q.includes("market") || q.includes("economy") || q.includes("ipo")) return "business";
    if (q.includes("entertainment") || q.includes("bollywood") || q.includes("movie") || q.includes("cinema") || q.includes("actor")) return "entertainment";
    if (q.includes("sports") || q.includes("cricket") || q.includes("football") || q.includes("ipl") || q.includes("match")) return "sports";
    if (q.includes("science") || q.includes("isro") || q.includes("nasa") || q.includes("space")) return "science";
    if (q.includes("health") || q.includes("medical") || q.includes("doctor") || q.includes("corona")) return "health";
    if (q.includes("world") || q.includes("international") || q.includes("global") || q.includes("america") || q.includes("russia")) return "world";
    return undefined;
  }

  private isGenericQuery(q: string): boolean {
    const clean = q.toLowerCase().trim();
    return ["top", "top 10", "latest", "news", "aaj ki khabar", "breaking news", "india", "khabar"].includes(clean);
  }

  private async getGoogleNewsFallback(query?: string, category?: string, count = 10): Promise<NewsResult> {
    try {
      let rssUrl = "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en";
      const cat = category || this.detectCategory(query);

      if (cat === "politics") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/POLITICS?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "world") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "business") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "technology") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "entertainment") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "sports") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "science") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "health") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (query && !this.isGenericQuery(query)) {
        rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
      }

      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(5000),
      });

      const xml = await res.text();
      const articles: NewsArticle[] = [];
      const itemRegex = /<item>(.*?)<\/item>/gs;
      let match;

      while ((match = itemRegex.exec(xml)) !== null && articles.length < count) {
        const itemContent = match[1];
        const rawTitle = itemContent.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "";
        const source = itemContent.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "Google News";
        const link = itemContent.match(/<link>(.*?)<\/link>/)?.[1] || "";
        const pubDate = itemContent.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";

        if (rawTitle) {
          const cleanTitle = rawTitle
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");

          articles.push({
            title: cleanTitle,
            source,
            link,
            pubDate,
            sentiment: "neutral",
          });
        }
      }

      let msg = `📰 **Latest Breaking News${cat ? ` (${cat.toUpperCase()})` : ""}:**\n\n`;
      articles.slice(0, 5).forEach((a, idx) => {
        msg += `${idx + 1}. **${a.title}**\n   🏛️ _Source: ${a.source}_\n`;
      });

      return {
        success: true,
        totalResults: articles.length,
        category: cat,
        topic: query,
        articles,
        sourceEngine: "google_news_live",
        message: msg.trim(),
      };
    } catch (e: any) {
      return {
        success: false,
        totalResults: 0,
        articles: [],
        sourceEngine: "google_news_live",
        message: `News fetch error: ${e?.message || e}`,
      };
    }
  }
}

export const newsService = new NewsService();
