/**
 * FRIDAY AI — Multi-Store E-Commerce Price Comparison & Tracking Service
 * 
 * Scrapes, extracts, and compares live prices across Flipkart, Amazon India, and Meesho
 * using the Stealth Anti-Bot engine with fallback scrapers and public data APIs.
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

  /**
   * Scrapes Amazon India for a search query
   */
  public async searchAmazon(query: string): Promise<EcomProduct[]> {
    const products: EcomProduct[] = [];
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;

    try {
      const resp = await stealthScraperService.fetchStealthHtml(searchUrl);
      if (!resp.ok || !resp.html) {
        console.warn("[ProductPriceService] Amazon fetch returned non-200 or empty HTML.");
        return [];
      }

      const html = resp.html;

      // Extract products using regex pattern matching on Amazon search result cards
      // Amazon uses data-component-type="s-search-result"
      const resultBlocks = html.split('data-component-type="s-search-result"');

      for (let i = 1; i < Math.min(resultBlocks.length, 6); i++) {
        const block = resultBlocks[i];

        // Extract Title
        const titleMatch = block.match(/<span class="a-size-medium a-color-base a-text-normal"[^>]*>([^<]+)<\/span>/) ||
                           block.match(/<span class="a-size-base-plus a-color-base a-text-normal"[^>]*>([^<]+)<\/span>/) ||
                           block.match(/<h2[^>]*><span[^>]*>([^<]+)<\/span><\/h2>/);
        const title = titleMatch ? titleMatch[1].trim() : "";

        // Extract Price
        const priceMatch = block.match(/<span class="a-price-whole">([0-9,]+)<\/span>/);
        const price = priceMatch ? this.parsePrice(priceMatch[1]) : 0;

        // Extract MRP / Original Price
        const mrpMatch = block.match(/<span class="a-price a-text-price"[^>]*>.*?<span class="a-offscreen">₹?([0-9,.]+)<\/span>/s);
        const originalPrice = mrpMatch ? this.parsePrice(mrpMatch[1]) : undefined;

        // Extract Rating
        const ratingMatch = block.match(/<span class="a-icon-alt">([0-9.]+)\s*out of 5/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

        // Extract Product Link
        const linkMatch = block.match(/<a class="a-link-normal s-no-outline"[^>]*href="([^"]+)"/);
        const rawLink = linkMatch ? linkMatch[1] : "";
        const productUrl = rawLink.startsWith("http") ? rawLink : (rawLink ? `https://www.amazon.in${rawLink}` : searchUrl);

        // Extract Image
        const imgMatch = block.match(/<img class="s-image"[^>]*src="([^"]+)"/);
        const imageUrl = imgMatch ? imgMatch[1] : undefined;

        if (title && price > 0) {
          const discountPercentage = originalPrice && originalPrice > price
            ? Math.round(((originalPrice - price) / originalPrice) * 100)
            : undefined;

          products.push({
            store: "Amazon",
            title,
            price,
            originalPrice,
            discountPercentage,
            rating,
            productUrl,
            imageUrl,
            inStock: true,
            source: resp.provider
          });
        }
      }
    } catch (err) {
      console.warn("[ProductPriceService] Amazon search error:", err);
    }

    return products;
  }

  /**
   * Scrapes Flipkart for a search query
   */
  public async searchFlipkart(query: string): Promise<EcomProduct[]> {
    const products: EcomProduct[] = [];
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;

    try {
      const resp = await stealthScraperService.fetchStealthHtml(searchUrl);
      if (!resp.ok || !resp.html) {
        console.warn("[ProductPriceService] Flipkart fetch returned non-200 or empty HTML.");
        return [];
      }

      const html = resp.html;

      // Flipkart often embeds initial state or standard row classes like div._75nlfW, div.KzDlHZ, div.Nx9bqj
      // Check for JSON-LD structured data first
      const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      for (const m of jsonLdMatches) {
        try {
          const parsed = JSON.parse(m[1]);
          if (parsed["@type"] === "Product" || Array.isArray(parsed?.itemListElement)) {
            const items = Array.isArray(parsed.itemListElement) ? parsed.itemListElement : [parsed];
            for (const it of items) {
              const item = it.item || it;
              if (item?.name && item?.offers?.price) {
                products.push({
                  store: "Flipkart",
                  title: item.name,
                  price: this.parsePrice(item.offers.price),
                  rating: item.aggregateRating?.ratingValue ? parseFloat(item.aggregateRating.ratingValue) : undefined,
                  productUrl: item.url || searchUrl,
                  imageUrl: Array.isArray(item.image) ? item.image[0] : item.image,
                  inStock: true,
                  source: "FlipkartJSON-LD"
                });
              }
            }
          }
        } catch {}
      }

      // If JSON-LD didn't capture enough, fallback to HTML regex extraction
      if (products.length === 0) {
        // Flipkart Product Title Class: KzDlHZ / wjcEIp / _4rR01T
        // Price Class: Nx9bqj / _30jeq3
        const cardRegex = /<div class="(?:_75nlfW|_1sdMkc|slAVV4|CG275T)"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
        const matches = html.match(cardRegex) || [];

        for (const card of matches.slice(0, 5)) {
          const titleMatch = card.match(/class="(?:KzDlHZ|wjcEIp|_4rR01T|s1Q9rs)"[^>]*>([^<]+)<\/div>/);
          const priceMatch = card.match(/class="(?:Nx9bqj|_30jeq3)[^"]*"[^>]*>₹?([0-9,]+)<\/div>/);
          const originalPriceMatch = card.match(/class="(?:yRaY8j|_3I9_wc)[^"]*"[^>]*>₹?([0-9,]+)<\/div>/);
          const discountMatch = card.match(/class="(?:UkUFwK|_3Ay6Sb)[^"]*"[^>]*><span>([0-9]+)%\s*off<\/span>/);
          const ratingMatch = card.match(/class="(?:XqGby|_3LWZlK)"[^>]*>([0-9.]+)/);
          const linkMatch = card.match(/<a class="(?:CG275T|VJA3rP|_1fQZEK|s1Q9rs)"[^>]*href="([^"]+)"/);
          const imgMatch = card.match(/<img class="(?:DByuf4|_396cs4)"[^>]*src="([^"]+)"/);

          const title = titleMatch ? titleMatch[1].trim() : "";
          const price = priceMatch ? this.parsePrice(priceMatch[1]) : 0;
          const originalPrice = originalPriceMatch ? this.parsePrice(originalPriceMatch[1]) : undefined;
          const discountPercentage = discountMatch ? parseInt(discountMatch[1]) : undefined;
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;
          const rawLink = linkMatch ? linkMatch[1] : "";
          const productUrl = rawLink.startsWith("http") ? rawLink : (rawLink ? `https://www.flipkart.com${rawLink}` : searchUrl);
          const imageUrl = imgMatch ? imgMatch[1] : undefined;

          if (title && price > 0) {
            products.push({
              store: "Flipkart",
              title,
              price,
              originalPrice,
              discountPercentage,
              rating,
              productUrl,
              imageUrl,
              inStock: true,
              source: resp.provider
            });
          }
        }
      }
    } catch (err) {
      console.warn("[ProductPriceService] Flipkart search error:", err);
    }

    return products;
  }

  /**
   * Scrapes / Queries Meesho for a search query
   */
  public async searchMeesho(query: string): Promise<EcomProduct[]> {
    const products: EcomProduct[] = [];
    const searchUrl = `https://www.meesho.com/search?q=${encodeURIComponent(query)}`;

    try {
      // Meesho provides public search GraphQL/API endpoints or SSR Next.js __NEXT_DATA__
      const resp = await stealthScraperService.fetchStealthHtml(searchUrl);
      if (!resp.ok || !resp.html) {
        console.warn("[ProductPriceService] Meesho fetch returned non-200 or empty HTML.");
        return [];
      }

      const html = resp.html;

      // Check for Next.js __NEXT_DATA__ JSON payload
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const catalogList = nextData?.props?.pageProps?.initialState?.search?.products ||
                             nextData?.props?.pageProps?.products ||
                             [];

          for (const item of catalogList.slice(0, 5)) {
            if (item.name && (item.price || item.discounted_price)) {
              products.push({
                store: "Meesho",
                title: item.name,
                price: this.parsePrice(item.discounted_price || item.price),
                originalPrice: item.original_price ? this.parsePrice(item.original_price) : undefined,
                discountPercentage: item.discount_percentage,
                rating: item.rating ? parseFloat(item.rating) : undefined,
                productUrl: item.slug ? `https://www.meesho.com/${item.slug}/p/${item.id}` : searchUrl,
                imageUrl: item.images?.[0] || item.image,
                inStock: true,
                source: "MeeshoNextData"
              });
            }
          }
        } catch {}
      }

      // Regex fallback for Meesho HTML
      if (products.length === 0) {
        const titleMatches = html.matchAll(/<p[^>]*class="[^"]*sc-eDPEul[^"]*"[^>]*>([^<]+)<\/p>/g);
        const priceMatches = html.matchAll(/<h5[^>]*>₹?([0-9,]+)<\/h5>/g);

        const titles = Array.from(titleMatches).map(m => m[1].trim());
        const prices = Array.from(priceMatches).map(m => this.parsePrice(m[1]));

        for (let i = 0; i < Math.min(titles.length, prices.length, 5); i++) {
          if (titles[i] && prices[i] > 0) {
            products.push({
              store: "Meesho",
              title: titles[i],
              price: prices[i],
              productUrl: searchUrl,
              inStock: true,
              source: resp.provider
            });
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

    // Execute in parallel with stealth delays
    const [amazonRes, flipkartRes, meeshoRes] = await Promise.allSettled([
      this.searchAmazon(cleanQuery),
      this.searchFlipkart(cleanQuery),
      this.searchMeesho(cleanQuery)
    ]);

    const amazon = amazonRes.status === "fulfilled" ? amazonRes.value : [];
    const flipkart = flipkartRes.status === "fulfilled" ? flipkartRes.value : [];
    const meesho = meeshoRes.status === "fulfilled" ? meeshoRes.value : [];

    // Collect all valid found items to find the absolute best deal
    const allFound: EcomProduct[] = [...amazon, ...flipkart, ...meesho].filter(p => p.price > 0);

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
      comparisonMessage += `Boss, Amazon, Flipkart ya Meesho par filhal "${cleanQuery}" ka live price fetch nahi ho paya. Please URL provide karein ya query rephrase karein.`;
    } else {
      if (amazon.length > 0) {
        const top = amazon[0];
        comparisonMessage += `📦 *Amazon:* ₹${top.price.toLocaleString("en-IN")} ${top.discountPercentage ? `(${top.discountPercentage}% OFF)` : ""} ${top.rating ? `⭐ ${top.rating}` : ""}\n`;
      } else {
        comparisonMessage += `📦 *Amazon:* Not Found / Out of stock\n`;
      }

      if (flipkart.length > 0) {
        const top = flipkart[0];
        comparisonMessage += `🛍️ *Flipkart:* ₹${top.price.toLocaleString("en-IN")} ${top.discountPercentage ? `(${top.discountPercentage}% OFF)` : ""} ${top.rating ? `⭐ ${top.rating}` : ""}\n`;
      } else {
        comparisonMessage += `🛍️ *Flipkart:* Not Found / Out of stock\n`;
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
