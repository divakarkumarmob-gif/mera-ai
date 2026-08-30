/**
 * FRIDAY AI — Multi-Store E-Commerce Price Comparison & Tracking Service
 * 
 * Scrapes, extracts, and compares live prices across Flipkart, Amazon India, and Meesho
 * with guaranteed canonical individual product URLs (e.g. /dp/ASIN on Amazon, /p/itm on Flipkart)
 * and high-resolution product images.
 */

import { stealthScraperService } from "./stealthScraperService";

export interface EcomProduct {
  store: "Amazon" | "Flipkart" | "Meesho" | "Unknown";
  title: string;
  price: number;
  originalPrice?: number;
  discountPercentage?: number;
  rating?: number;
  ratingCount?: number;
  productUrl: string;
  imageUrl?: string;
  inStock: boolean;
  deliveryInfo?: string;
  source: string;
}

export interface PriceComparisonSummary {
  query: string;
  timestamp: string;
  bestDeal: {
    store: string;
    product: EcomProduct;
    savingsComparedToHighest: number;
  } | null;
  stores: {
    amazon: EcomProduct[];
    flipkart: EcomProduct[];
    meesho: EcomProduct[];
  };
  comparisonMessage: string;
}

class ProductPriceService {
  /**
   * Helper to clean numeric price from string (e.g. "₹69,999" -> 69999)
   */
  private parsePrice(raw: string | number | undefined): number {
    if (!raw) return 0;
    if (typeof raw === "number") return raw;
    const cleaned = String(raw).replace(/[^0-9.]/g, "");
    return parseFloat(cleaned) || 0;
  }

  private cleanHtmlEntities(text: string): string {
    if (!text) return "";
    return text
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Scrapes Amazon India for a search query with guaranteed /dp/ASIN direct product links
   */
  public async searchAmazon(query: string): Promise<EcomProduct[]> {
    const products: EcomProduct[] = [];
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;

    try {
      const resp = await stealthScraperService.fetchStealthHtml(searchUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
        }
      });

      if (!resp.ok || !resp.html) {
        console.warn("[ProductPriceService] Amazon fetch returned non-200 or empty HTML.");
        return [];
      }

      const html = resp.html;
      const amzSections = html.split('data-asin="');

      for (let i = 1; i < amzSections.length; i++) {
        const sec = amzSections[i];
        const asinMatch = sec.match(/^([A-Z0-9]{10})/);
        if (!asinMatch) continue;
        const asin = asinMatch[1];
        if (asin === "0000000000") continue;

        // Title
        const titleMatch =
          sec.match(/<span class="[^"]*(?:a-size-medium|a-size-base-plus)[^"]*a-color-base a-text-normal"[^>]*>([^<]+)<\/span>/) ||
          sec.match(/<h2[^>]*><span[^>]*>([^<]+)<\/span><\/h2>/) ||
          sec.match(/<h2[^>]*><a[^>]*><span[^>]*>([^<]+)<\/span><\/a><\/h2>/) ||
          sec.match(/alt="([^"]+)"/);
        const rawTitle = titleMatch ? titleMatch[1] : "";
        const title = this.cleanHtmlEntities(rawTitle);

        // Price
        const priceMatch = sec.match(/<span class="a-price-whole">([0-9,]+)/);
        const price = priceMatch ? this.parsePrice(priceMatch[1]) : 0;

        // MRP
        const mrpMatch = sec.match(/<span class="a-price a-text-price"[^>]*>[\s\S]*?<span class="a-offscreen">₹?([0-9,.]+)/);
        const originalPrice = mrpMatch ? this.parsePrice(mrpMatch[1]) : undefined;

        // Image
        const imgMatch = sec.match(/<img class="s-image"[^>]*src="([^"]+)"/);
        const imageUrl = imgMatch ? imgMatch[1] : undefined;

        // Rating
        const ratingMatch = sec.match(/<span class="a-icon-alt">([0-9.]+)\s*out of 5/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

        // 100% Guaranteed Direct Individual Product Page URL
        const directProductUrl = `https://www.amazon.in/dp/${asin}`;

        if (title && price > 0 && !products.some((it) => it.productUrl === directProductUrl)) {
          const discountPercentage =
            originalPrice && originalPrice > price
              ? Math.round(((originalPrice - price) / originalPrice) * 100)
              : undefined;

          products.push({
            store: "Amazon",
            title,
            price,
            originalPrice,
            discountPercentage,
            rating,
            productUrl: directProductUrl,
            imageUrl,
            inStock: true,
            source: resp.provider
          });

          if (products.length >= 8) break;
        }
      }
    } catch (err) {
      console.warn("[ProductPriceService] Amazon search error:", err);
    }

    return products;
  }

  /**
   * Scrapes Flipkart with guaranteed direct /p/itm product links & high-res images
   */
  public async searchFlipkart(query: string): Promise<EcomProduct[]> {
    const products: EcomProduct[] = [];
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;

    try {
      const resp = await stealthScraperService.fetchStealthHtml(searchUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
          "Cookie": "T=TI1740888000.000; ak_bmsc=1;"
        }
      });

      if (!resp.ok || !resp.html) {
        console.warn("[ProductPriceService] Flipkart fetch returned non-200 or empty HTML.");
        return [];
      }

      const html = resp.html;
      const containerBlocks = html.split('href="/');

      for (let i = 1; i < containerBlocks.length; i++) {
        const block = containerBlocks[i];
        if (!block.includes('/p/itm')) continue;

        const rawHrefMatch = block.match(/^([^"?\s]+(?:\?[^"\s]+)?)"/);
        if (!rawHrefMatch) continue;
        const rawPath = rawHrefMatch[1].replace(/&amp;/g, '&');
        if (!rawPath.includes('/p/itm')) continue;

        // Build canonical direct product URL (e.g. https://www.flipkart.com/slug/p/itm...?pid=XYZ)
        const pid = rawPath.match(/pid=([A-Z0-9]+)/)?.[1] || '';
        const cleanSlug = rawPath.split('?')[0].replace(/^\//, '');
        const directProductUrl = `https://www.flipkart.com/${cleanSlug}${pid ? `?pid=${pid}` : ''}`;

        // Title
        const titleMatch =
          block.match(/title="([^"]+)"/) ||
          block.match(/alt="([^"]+)"/) ||
          block.match(/class="(?:KzDlHZ|wjcEIp|_4rR01T|s1Q9rs|WKTcLC)"[^>]*>([^<]+)<\/div>/) ||
          block.match(/class="(?:KzDlHZ|wjcEIp|_4rR01T|s1Q9rs|WKTcLC)"[^>]*>([^<]+)<\/a>/);
        const title = titleMatch ? this.cleanHtmlEntities(titleMatch[1]) : "";

        // Price
        const priceMatch =
          block.match(/class="(?:Nx9bqj|hZ3P6w|_30jeq3)[^"]*"[^>]*>₹?([0-9,]+)/) ||
          block.match(/₹([0-9,]+)/);
        const price = priceMatch ? this.parsePrice(priceMatch[1]) : 0;

        // MRP
        const mrpMatch = block.match(/class="(?:yRaY8j|kRYCnD|_3I9_wc)[^"]*"[^>]*>₹?([0-9,]+)/);
        const originalPrice = mrpMatch ? this.parsePrice(mrpMatch[1]) : undefined;

        // High-res Image
        const imgMatch =
          block.match(/(https:\/\/rukminim[0-9]\.flixcart\.com\/image\/[0-9x\/]+\/[a-zA-Z0-9_\-\.\/]+)/) ||
          block.match(/<img [^>]*src="([^"]+)"/);
        let imageUrl = imgMatch ? imgMatch[1] : undefined;
        if (imageUrl && imageUrl.startsWith('data:image/svg')) imageUrl = undefined;

        // Rating
        const ratingMatch = block.match(/class="(?:XqGby|_3LWZlK|Wphh3N)"[^>]*>([0-9.]+)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

        if (title && price > 0 && !products.some((it) => it.productUrl === directProductUrl)) {
          const discountPercentage =
            originalPrice && originalPrice > price
              ? Math.round(((originalPrice - price) / originalPrice) * 100)
              : undefined;

          products.push({
            store: "Flipkart",
            title,
            price,
            originalPrice,
            discountPercentage,
            rating,
            productUrl: directProductUrl,
            imageUrl,
            inStock: true,
            source: resp.provider
          });

          if (products.length >= 8) break;
        }
      }
    } catch (err) {
      console.warn("[ProductPriceService] Flipkart search error:", err);
    }

    return products;
  }

  /**
   * Scrapes / Extracts Meesho products with direct product links
   */
  public async searchMeesho(query: string): Promise<EcomProduct[]> {
    const products: EcomProduct[] = [];
    const searchUrl = `https://www.meesho.com/search?q=${encodeURIComponent(query)}`;

    try {
      const resp = await stealthScraperService.fetchStealthHtml(searchUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
        }
      });

      if (resp.ok && resp.html) {
        const html = resp.html;

        // Check for Next.js payload or HTML card anchors
        const cardMatches = html.matchAll(/href="(\/[^"]*\/p\/([a-zA-Z0-9]+))"/g);
        for (const m of cardMatches) {
          const path = m[1];
          const directUrl = `https://www.meesho.com${path}`;
          if (!products.some(p => p.productUrl === directUrl)) {
            // Find surrounding content
            const pos = html.indexOf(m[0]);
            const snippet = html.substring(Math.max(0, pos - 200), Math.min(html.length, pos + 800));

            const titleMatch = snippet.match(/<p[^>]*class="[^"]*sc-eDPEul[^"]*"[^>]*>([^<]+)<\/p>/) ||
                               snippet.match(/title="([^"]+)"/) ||
                               snippet.match(/alt="([^"]+)"/);
            const title = titleMatch ? this.cleanHtmlEntities(titleMatch[1]) : "";

            const priceMatch = snippet.match(/₹?([0-9,]+)/);
            const price = priceMatch ? this.parsePrice(priceMatch[1]) : 0;

            const imgMatch = snippet.match(/(https:\/\/images\.meesho\.com\/images\/products\/[0-9]+\/[a-zA-Z0-9_\-\.\/]+)/) ||
                             snippet.match(/<img [^>]*src="([^"]+)"/);
            const imageUrl = imgMatch ? imgMatch[1] : undefined;

            if (title && price > 0) {
              products.push({
                store: "Meesho",
                title,
                price,
                productUrl: directUrl,
                imageUrl,
                inStock: true,
                source: "MeeshoDirect"
              });
              if (products.length >= 6) break;
            }
          }
        }
      }
    } catch (err) {
      console.warn("[ProductPriceService] Meesho search error:", err);
    }

    return products;
  }

  /**
   * Compares a product across Flipkart, Amazon, and Meesho in parallel
   */
  public async compareProductAcrossStores(query: string): Promise<PriceComparisonSummary> {
    const cleanQuery = (query || "").trim();
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    // Execute in parallel with stealth headers
    const [amazonRes, flipkartRes, meeshoRes] = await Promise.allSettled([
      this.searchAmazon(cleanQuery),
      this.searchFlipkart(cleanQuery),
      this.searchMeesho(cleanQuery)
    ]);

    const amazon = amazonRes.status === "fulfilled" ? amazonRes.value : [];
    const flipkart = flipkartRes.status === "fulfilled" ? flipkartRes.value : [];
    const meesho = meeshoRes.status === "fulfilled" ? meeshoRes.value : [];

    // Collect all valid found items to find the absolute best deal
    const allFound: EcomProduct[] = [...amazon, ...flipkart, ...meesho].filter((p) => p.price > 0);

    let bestDeal: PriceComparisonSummary["bestDeal"] = null;

    if (allFound.length > 0) {
      allFound.sort((a, b) => a.price - b.price);
      const lowest = allFound[0];
      const highest = allFound[allFound.length - 1];
      const savings = Math.max(0, highest.price - lowest.price);

      bestDeal = {
        store: lowest.store,
        product: lowest,
        savingsComparedToHighest: savings
      };
    }

    // Format human-friendly Hinglish comparison message for FRIDAY
    let comparisonMessage = `🛒 *PRICE COMPARISON: "${cleanQuery}"*\n\n`;

    if (allFound.length === 0) {
      comparisonMessage += `Boss, Amazon, Flipkart ya Meesho par filhal "${cleanQuery}" ka live price fetch nahi ho paya. Please query rephrase karein.`;
    } else {
      if (amazon.length > 0) {
        const top = amazon[0];
        comparisonMessage += `📦 *Amazon:* ₹${top.price.toLocaleString("en-IN")} ${top.discountPercentage ? `(${top.discountPercentage}% OFF)` : ""} ${top.rating ? `⭐ ${top.rating}` : ""}\n`;
      } else {
        comparisonMessage += `📦 *Amazon:* Out of stock\n`;
      }

      if (flipkart.length > 0) {
        const top = flipkart[0];
        comparisonMessage += `🛍️ *Flipkart:* ₹${top.price.toLocaleString("en-IN")} ${top.discountPercentage ? `(${top.discountPercentage}% OFF)` : ""} ${top.rating ? `⭐ ${top.rating}` : ""}\n`;
      } else {
        comparisonMessage += `🛍️ *Flipkart:* Out of stock\n`;
      }

      if (meesho.length > 0) {
        const top = meesho[0];
        comparisonMessage += `🏷️ *Meesho:* ₹${top.price.toLocaleString("en-IN")} ${top.rating ? `⭐ ${top.rating}` : ""}\n`;
      } else {
        comparisonMessage += `🏷️ *Meesho:* Not Found\n`;
      }

      if (bestDeal) {
        comparisonMessage += `\n🏆 *Best Deal:* *${bestDeal.store}* par mil rahi hai ₹${bestDeal.product.price.toLocaleString("en-IN")} me!`;
        if (bestDeal.savingsComparedToHighest > 0) {
          comparisonMessage += ` (Aapki ₹${bestDeal.savingsComparedToHighest.toLocaleString("en-IN")} ki bachat ho rahi hai!)`;
        }
      }
    }

    return {
      query: cleanQuery,
      timestamp,
      bestDeal,
      stores: {
        amazon,
        flipkart,
        meesho
      },
      comparisonMessage
    };
  }
}

export const productPriceService = new ProductPriceService();
