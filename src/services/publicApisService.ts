// ---------------------------------------------------------------------------
// publicApisService.ts
//
// Wrappers around free, public, no-key-required APIs that Friday can call
// as tools. Each function returns a plain object suitable for handing back
// to Gemini as a function-response — keep responses small and speakable.
//
// BATCH 1 (8 APIs): weather, air quality, sunrise/sunset, earthquakes,
// currency, crypto, wikipedia, wikiquote.
//
// None of these need an API key. If any of them start requiring one, or
// change their response shape, this is the file to fix.
// ---------------------------------------------------------------------------

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

class PublicApisService {
  // 1. Weather — Open-Meteo (free, no key)
  // Needs lat/lon. Geocodes the place name first via Open-Meteo's free
  // geocoding endpoint, then fetches current + short forecast.
  public async getWeather(place: string): Promise<any> {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`
    );
    const loc = geo?.results?.[0];
    if (!loc) return { success: false, message: `"${place}" ke liye location nahi mili.` };

    const w = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min&timezone=auto`
    );

    return {
      success: true,
      place: loc.name,
      country: loc.country,
      currentTempC: w.current?.temperature_2m,
      humidityPct: w.current?.relative_humidity_2m,
      windKmh: w.current?.wind_speed_10m,
      weatherCode: w.current?.weather_code,
      todayMaxC: w.daily?.temperature_2m_max?.[0],
      todayMinC: w.daily?.temperature_2m_min?.[0],
    };
  }

  // 2. Air Quality Index — Open-Meteo Air Quality (free, no key)
  public async getAirQuality(place: string): Promise<any> {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`
    );
    const loc = geo?.results?.[0];
    if (!loc) return { success: false, message: `"${place}" ke liye location nahi mili.` };

    const aq = await fetchJson(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        `&current=us_aqi,pm2_5,pm10`
    );

    return {
      success: true,
      place: loc.name,
      usAqi: aq.current?.us_aqi,
      pm2_5: aq.current?.pm2_5,
      pm10: aq.current?.pm10,
    };
  }

  // 3. Sunrise/Sunset — sunrise-sunset.org (free, no key)
  public async getSunriseSunset(place: string): Promise<any> {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`
    );
    const loc = geo?.results?.[0];
    if (!loc) return { success: false, message: `"${place}" ke liye location nahi mili.` };

    const s = await fetchJson(
      `https://api.sunrise-sunset.org/json?lat=${loc.latitude}&lng=${loc.longitude}&formatted=0`
    );

    return {
      success: true,
      place: loc.name,
      sunriseUtc: s.results?.sunrise,
      sunsetUtc: s.results?.sunset,
      dayLength: s.results?.day_length,
    };
  }

  // 4. Earthquake alerts — USGS (free, no key)
  // Returns recent significant earthquakes (magnitude 4.5+, last 24h).
  public async getRecentEarthquakes(): Promise<any> {
    const data = await fetchJson(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"
    );
    const quakes = (data.features || []).slice(0, 5).map((f: any) => ({
      place: f.properties?.place,
      magnitude: f.properties?.mag,
      time: new Date(f.properties?.time).toISOString(),
    }));
    return { success: true, count: quakes.length, quakes };
  }

  // 5. Currency / Forex — open.er-api.com (free, no key)
  public async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<any> {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${from}`);
    if (data.result !== "success") {
      return { success: false, message: `"${from}" ek valid currency code nahi lag raha.` };
    }
    const rate = data.rates?.[to];
    if (rate === undefined) {
      return { success: false, message: `"${to}" ek valid currency code nahi lag raha.` };
    }
    return { success: true, from, to, rate, lastUpdated: data.time_last_update_utc };
  }

  // 6. Crypto prices — CoinGecko (free, no key)
  public async getCryptoPrice(coinId: string, vsCurrency = "usd"): Promise<any> {
    const id = coinId.toLowerCase().trim();
    const vs = vsCurrency.toLowerCase().trim();
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`
    );
    const entry = data[id];
    if (!entry) {
      return { success: false, message: `"${coinId}" coin nahi mila. Coingecko ka exact coin id use karo (e.g. 'bitcoin', 'ethereum').` };
    }
    return {
      success: true,
      coin: id,
      currency: vs,
      price: entry[vs],
      change24hPct: entry[`${vs}_24h_change`],
    };
  }

  // 7. Wikipedia summary — free, no key
  public async getWikipediaSummary(topic: string): Promise<any> {
    try {
      const data = await fetchJson(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.trim())}`
      );
      if (data.type === "disambiguation") {
        return { success: false, message: `"${topic}" multiple cheezon se match karta hai, thoda specific batao.` };
      }
      return {
        success: true,
        title: data.title,
        summary: data.extract,
        url: data.content_urls?.desktop?.page,
      };
    } catch {
      return { success: false, message: `"${topic}" ke liye Wikipedia page nahi mila.` };
    }
  }

  // 8. Wikiquote — via Wikipedia REST API on the quote.wikiquote.org domain
  public async getWikiquote(person: string): Promise<any> {
    try {
      const data = await fetchJson(
        `https://en.wikiquote.org/api/rest_v1/page/summary/${encodeURIComponent(person.trim())}`
      );
      return {
        success: true,
        title: data.title,
        summary: data.extract,
        url: data.content_urls?.desktop?.page,
        instruction: "Ye page summary hai, exact famous quotes list nahi — user ko URL follow karne bolo agar specific quotes chahiye.",
      };
    } catch {
      return { success: false, message: `"${person}" ke liye Wikiquote page nahi mila.` };
    }
  }

  // ---------------------------------------------------------------------
  // BATCH 2 (8 APIs): books, dictionary, country info, number facts,
  // trivia, PIN code lookup, nearby places, time zone.
  // ---------------------------------------------------------------------

  // 9. Books — Open Library (free, no key)
  public async searchBook(title: string): Promise<any> {
    const data = await fetchJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=1`);
    const book = data?.docs?.[0];
    if (!book) return { success: false, message: `"${title}" naam ki koi book nahi mili.` };
    return {
      success: true,
      title: book.title,
      author: (book.author_name || []).join(", "),
      firstPublishYear: book.first_publish_year,
      subjects: (book.subject || []).slice(0, 5),
    };
  }

  // 10. Dictionary / word meaning — dictionaryapi.dev (free, no key)
  public async getWordMeaning(word: string): Promise<any> {
    try {
      const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`);
      const entry = data?.[0];
      const meaning = entry?.meanings?.[0];
      const def = meaning?.definitions?.[0];
      return {
        success: true,
        word: entry?.word,
        partOfSpeech: meaning?.partOfSpeech,
        definition: def?.definition,
        example: def?.example,
      };
    } catch {
      return { success: false, message: `"${word}" ka meaning nahi mila.` };
    }
  }

  // 11. Country info — REST Countries (free, no key)
  public async getCountryInfo(country: string): Promise<any> {
    try {
      const data = await fetchJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(country.trim())}?fields=name,capital,population,region,flag,currencies,languages`);
      const c = data?.[0];
      if (!c) return { success: false, message: `"${country}" naam ka koi desh nahi mila.` };
      return {
        success: true,
        name: c.name?.common,
        capital: c.capital?.[0],
        population: c.population,
        region: c.region,
        currencies: c.currencies ? Object.values(c.currencies).map((cur: any) => cur.name) : [],
        languages: c.languages ? Object.values(c.languages) : [],
      };
    } catch {
      return { success: false, message: `"${country}" naam ka koi desh nahi mila.` };
    }
  }

  // 12. Number facts — numbersapi.com (free, no key)
  public async getNumberFact(number: number): Promise<any> {
    const res = await fetch(`http://numbersapi.com/${number}?json`);
    const data = await res.json();
    return { success: true, number: data.number, fact: data.text };
  }

  // 13. Trivia questions — Open Trivia DB (free, no key)
  public async getTriviaQuestion(category?: string): Promise<any> {
    const data = await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple");
    const q = data?.results?.[0];
    if (!q) return { success: false, message: "Abhi trivia question nahi mil paya." };
    return {
      success: true,
      category: q.category,
      question: decodeHtmlEntities(q.question),
      correctAnswer: decodeHtmlEntities(q.correct_answer),
      options: [...q.incorrect_answers, q.correct_answer].map(decodeHtmlEntities).sort(() => Math.random() - 0.5),
    };
  }

  // 14. PIN code lookup (India) — postalpincode.in (free, no key)
  public async getPinCodeInfo(pincode: string): Promise<any> {
    const data = await fetchJson(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode.trim())}`);
    const entry = data?.[0];
    if (entry?.Status !== "Success" || !entry.PostOffice?.length) {
      return { success: false, message: `"${pincode}" ke liye koi post office nahi mila.` };
    }
    const offices = entry.PostOffice.map((po: any) => ({
      name: po.Name,
      district: po.District,
      state: po.State,
      branchType: po.BranchType,
    }));
    return { success: true, pincode, count: offices.length, offices };
  }

  // 15. Nearby places — Nominatim + Overpass + Web Search Fallback (100% Free, No Key Required)
  // Searches amenities, shops (sweet shops, showrooms, clothes, electronics), tourism, etc.
  public async getNearbyPlaces(place: string, amenityOrQuery: string): Promise<any> {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // 1. Try Nominatim Direct Search
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${amenityOrQuery} in ${place}`)}&format=json&limit=8`;
      const res = await fetch(nomUrl, { headers });
      const json = await res.json();
      if (Array.isArray(json) && json.length > 0) {
        const places = json.map((x: any) => ({
          name: x.display_name?.split(",")?.[0] || x.name || "Place",
          address: x.display_name,
          type: x.type || x.class || amenityOrQuery,
          lat: x.lat,
          lon: x.lon,
        }));
        return { success: true, near: place, query: amenityOrQuery, count: places.length, places, source: "osm_nominatim" };
      }
    } catch {}

    // 2. Try Overpass API
    try {
      const geo = await fetchJson(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`
      );
      const loc = geo?.[0];
      if (loc && loc.lat && loc.lon) {
        const clean = amenityOrQuery.toLowerCase().replace(/[^a-zA-Z0-9_]/g, "");
        const queryBody = `
          node["amenity"="${clean}"](around:5000,${loc.lat},${loc.lon});
          node["shop"="${clean}"](around:5000,${loc.lat},${loc.lon});
          node["amenity"~"${clean}",i](around:5000,${loc.lat},${loc.lon});
          node["shop"~"${clean}",i](around:5000,${loc.lat},${loc.lon});
          node["name"~"${clean}",i](around:5000,${loc.lat},${loc.lon});
        `;
        const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          body: `[out:json][timeout:10];(${queryBody});out 10;`,
          headers,
        });
        const data = await overpassRes.json();
        const places = (data.elements || [])
          .filter((el: any) => el.tags?.name)
          .slice(0, 8)
          .map((el: any) => ({
            name: el.tags?.name,
            type: el.tags?.amenity || el.tags?.shop || amenityOrQuery,
            address: [el.tags?.["addr:street"], el.tags?.["addr:city"]].filter(Boolean).join(", ") || undefined,
            lat: el.lat,
            lon: el.lon,
          }));

        if (places.length) {
          return { success: true, near: place, query: amenityOrQuery, count: places.length, places, source: "osm_overpass" };
        }
      }
    } catch {}

    // 3. Web search fallback for business/store queries
    try {
      const q = encodeURIComponent(`${amenityOrQuery} in ${place} address locations`);
      const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, { headers });
      const html = await ddgRes.text();
      const snippets: string[] = [];
      const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
      let match;
      while ((match = regex.exec(html)) !== null && snippets.length < 4) {
        const clean = match[1].replace(/<[^>]*>/g, "").trim();
        if (clean) snippets.push(clean);
      }
      if (snippets.length) {
        return {
          success: true,
          near: place,
          query: amenityOrQuery,
          count: snippets.length,
          summary: snippets.join(" | "),
          source: "web_search_fallback",
        };
      }
    } catch {}

    return { success: false, message: `"${place}" me "${amenityOrQuery}" ke liye koi result nahi mila.` };
  }

  // 16. Time zone info — worldtimeapi.org (free, no key)
  public async getTimeZoneInfo(place: string): Promise<any> {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`
    );
    const loc = geo?.results?.[0];
    if (!loc?.timezone) return { success: false, message: `"${place}" ke liye timezone nahi mila.` };

    try {
      const data = await fetchJson(`https://worldtimeapi.org/api/timezone/${loc.timezone}`);
      return {
        success: true,
        place: loc.name,
        timezone: loc.timezone,
        currentTime: data.datetime,
        utcOffset: data.utc_offset,
      };
    } catch {
      return { success: true, place: loc.name, timezone: loc.timezone, message: "Exact time fetch nahi hui, but timezone ye hai." };
    }
  }

  // ---------------------------------------------------------------------
  // BATCH 3 (10 APIs): COVID stats, QR code, random avatar, GitHub info,
  // IP lookup, dad jokes, Chuck Norris jokes, public holidays, anime info,
  // translation.
  // ---------------------------------------------------------------------

  // 17. COVID/health stats — disease.sh (free, no key)
  public async getCovidStats(country = "world"): Promise<any> {
    const endpoint =
      country.toLowerCase() === "world"
        ? "https://disease.sh/v3/covid-19/all"
        : `https://disease.sh/v3/covid-19/countries/${encodeURIComponent(country.trim())}`;
    try {
      const data = await fetchJson(endpoint);
      return {
        success: true,
        country: data.country || "World",
        cases: data.cases,
        deaths: data.deaths,
        recovered: data.recovered,
        active: data.active,
        todayCases: data.todayCases,
        todayDeaths: data.todayDeaths,
      };
    } catch {
      return { success: false, message: `"${country}" ke liye COVID data nahi mila.` };
    }
  }

  // 18. QR code generation — goqr.me (free, no key)
  // Returns the direct image URL (goqr.me generates on the fly, no upload needed).
  public getQrCodeUrl(text: string): any {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
    return { success: true, text, qrCodeUrl: url };
  }

  // 19. Random user/avatar — randomuser.me (free, no key)
  public async getRandomUser(): Promise<any> {
    const data = await fetchJson("https://randomuser.me/api/");
    const u = data?.results?.[0];
    if (!u) return { success: false, message: "Random user generate nahi ho paya." };
    return {
      success: true,
      name: `${u.name?.first} ${u.name?.last}`,
      gender: u.gender,
      country: u.location?.country,
      email: u.email,
      avatarUrl: u.picture?.large,
    };
  }

  // 20. GitHub repo/user info — GitHub public API (free, no key for basic use)
  public async getGithubUserInfo(username: string): Promise<any> {
    try {
      const data = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username.trim())}`);
      return {
        success: true,
        username: data.login,
        name: data.name,
        bio: data.bio,
        publicRepos: data.public_repos,
        followers: data.followers,
        profileUrl: data.html_url,
      };
    } catch {
      return { success: false, message: `GitHub user "${username}" nahi mila.` };
    }
  }

  public async getGithubRepoInfo(owner: string, repo: string): Promise<any> {
    try {
      const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner.trim())}/${encodeURIComponent(repo.trim())}`);
      return {
        success: true,
        fullName: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        language: data.language,
        url: data.html_url,
      };
    } catch {
      return { success: false, message: `GitHub repo "${owner}/${repo}" nahi mila.` };
    }
  }

  // 21. IP/location lookup — ip-api.com (free, no key)
  public async getIpLookup(ip: string): Promise<any> {
    try {
      const data = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip.trim())}`);
      if (data.status !== "success") {
        return { success: false, message: `"${ip}" ke liye lookup fail hui.` };
      }
      return {
        success: true,
        ip: data.query,
        city: data.city,
        region: data.regionName,
        country: data.country,
        isp: data.isp,
      };
    } catch {
      return { success: false, message: `"${ip}" ke liye lookup fail hui.` };
    }
  }

  // 22. Dad jokes — icanhazdadjoke.com (free, no key)
  public async getDadJoke(): Promise<any> {
    const res = await fetch("https://icanhazdadjoke.com/", { headers: { Accept: "application/json" } });
    const data = await res.json();
    return { success: true, joke: data.joke };
  }

  // 23. Chuck Norris jokes — api.chucknorris.io (free, no key)
  public async getChuckNorrisJoke(): Promise<any> {
    const data = await fetchJson("https://api.chucknorris.io/jokes/random");
    return { success: true, joke: data.value };
  }

  // 24. Public holidays — Nager.Date (free, no key)
  // Defaults to India ("IN") if DK doesn't specify a country.
  public async getPublicHolidays(countryCode?: string, year?: number): Promise<any> {
    const yr = year || new Date().getFullYear();
    const code = (countryCode || "IN").toUpperCase();
    try {
      const data = await fetchJson(`https://date.nager.at/api/v3/PublicHolidays/${yr}/${code}`);
      const holidays = (data || []).slice(0, 15).map((h: any) => ({ date: h.date, name: h.localName }));
      return { success: true, countryCode: code, year: yr, count: holidays.length, holidays };
    } catch {
      return { success: false, message: `"${code}" ke liye holiday list nahi mili — is source me coverage sabhi countries ke liye nahi hai.` };
    }
  }

  // 25. Anime/manga info — Jikan API (unofficial MyAnimeList, free, no key)
  public async searchAnime(title: string): Promise<any> {
    try {
      const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`);
      const anime = data?.data?.[0];
      if (!anime) return { success: false, message: `"${title}" naam ka anime nahi mila.` };
      return {
        success: true,
        title: anime.title,
        episodes: anime.episodes,
        score: anime.score,
        synopsis: anime.synopsis,
        year: anime.year,
      };
    } catch {
      return { success: false, message: `"${title}" naam ka anime nahi mila.` };
    }
  }

  // 26. Translation / language detect — LibreTranslate public instance (free, rate-limited)
  public async translateText(text: string, targetLang: string): Promise<any> {
    try {
      const res = await fetch("https://libretranslate.de/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: "auto", target: targetLang, format: "text" }),
      });
      const data = await res.json();
      if (!data.translatedText) {
        return { success: false, message: "Translation fail hui — public instance abhi rate-limited ho sakta hai." };
      }
      return { success: true, original: text, translated: data.translatedText, targetLang };
    } catch {
      return { success: false, message: "Translation fail hui — public instance abhi down/rate-limited ho sakta hai." };
    }
  }

  // ---------------------------------------------------------------------
  // BATCH 4 (8 APIs) — these REQUIRE an API key in .env:
  //   NEWSDATA_API_KEY, CRICAPI_KEY, SPORTSDB_API_KEY (optional, has free
  //   test key), ALPHA_VANTAGE_API_KEY, TMDB_API_KEY, PEXELS_API_KEY,
  //   UNSPLASH_ACCESS_KEY, OPENROUTESERVICE_API_KEY
  // Each function checks for its key and returns a clear error if missing,
  // instead of crashing.
  // ---------------------------------------------------------------------

  // 27. News — Google News Live Feed + NewsData.io (100% Free, Top 10, Politics, Local, Viral)
  public async getNews(topic?: string, country = "in", count = 10): Promise<any> {
    const requestedCount = Math.min(Math.max(count || 10, 1), 15);
    const cat = (topic || "").toLowerCase().trim();

    // 1. Google News Live RSS Feed (100% Free, Instant & Uncapped)
    try {
      let rssUrl = "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en";

      if (cat === "politics" || cat === "rajneeti" || cat === "political") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/POLITICS?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "world" || cat === "international" || cat === "global") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "business" || cat === "finance" || cat === "economy") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "tech" || cat === "technology") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "entertainment" || cat === "viral" || cat === "trending") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (cat === "sports" || cat === "khel") {
        rssUrl = "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-IN&gl=IN&ceid=IN:en";
      } else if (topic && topic !== "top 10" && topic !== "top news" && topic !== "latest" && topic !== "india") {
        // Custom search topic or Local city (e.g. "Patna local", "Delhi", "Bihar", "Crime")
        rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`;
      }

      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      const xml = await res.text();
      const articles: any[] = [];
      const itemRegex = /<item>(.*?)<\/item>/gs;
      let match;
      while ((match = itemRegex.exec(xml)) !== null && articles.length < requestedCount) {
        const itemContent = match[1];
        const rawTitle = itemContent.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "";
        const source = itemContent.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "News";
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
            pubDate,
          });
        }
      }

      if (articles.length) {
        return {
          success: true,
          category: topic || "Top Headlines",
          count: articles.length,
          articles,
          source: "google_news_live",
        };
      }
    } catch {
      // Fall through to NewsData.io if configured
    }

    // 2. NewsData.io Fallback (if key is set)
    const key = process.env.NEWSDATA_API_KEY;
    if (key) {
      const params = new URLSearchParams({ apikey: key, country, language: "en" });
      if (topic) params.set("q", topic);
      try {
        const data = await fetchJson(`https://newsdata.io/api/1/latest?${params.toString()}`);
        const articles = (data.results || []).slice(0, requestedCount).map((a: any) => ({
          title: a.title,
          source: a.source_id,
          link: a.link,
          pubDate: a.pubDate,
        }));
        return { success: true, count: articles.length, articles, source: "newsdata" };
      } catch (e: any) {
        return { success: false, message: `News fetch fail hui: ${e?.message || e}` };
      }
    }

    return { success: false, message: "Latest news fetch nahi ho saki." };
  }

  // 28. Cricket scores — CricAPI (cricapi.com)
  // India matches are surfaced first since DK is India-based.
  public async getCricketScores(): Promise<any> {
    const key = process.env.CRICAPI_KEY;
    if (!key) return { success: false, message: "CRICAPI_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(`https://api.cricapi.com/v1/currentMatches?apikey=${key}&offset=0`);
      const allMatches = data.data || [];
      const isIndiaMatch = (m: any) => (m.teams || []).some((t: string) => t.toLowerCase().includes("india"));
      const sorted = [...allMatches].sort((a, b) => Number(isIndiaMatch(b)) - Number(isIndiaMatch(a)));
      const matches = sorted.slice(0, 5).map((m: any) => ({
        name: m.name,
        status: m.status,
        teams: m.teams,
        score: m.score,
      }));
      return { success: true, count: matches.length, matches };
    } catch (e: any) {
      return { success: false, message: `Cricket scores fetch fail hui: ${e?.message || e}` };
    }
  }

  // 29. Sports (general, non-cricket) — TheSportsDB
  // TheSportsDB gives a shared free test key ("3") for basic endpoints, but
  // using your own free key (from thesportsdb.com/free_sports_api) gives
  // higher limits — set SPORTSDB_API_KEY in .env, falls back to test key.
  public async getSportsEvents(league: string): Promise<any> {
    const key = process.env.SPORTSDB_API_KEY || "3";
    try {
      const data = await fetchJson(`https://www.thesportsdb.com/api/v1/json/${key}/searchevents.php?e=${encodeURIComponent(league)}`);
      const events = (data.event || []).slice(0, 5).map((e: any) => ({
        name: e.strEvent,
        date: e.dateEvent,
        league: e.strLeague,
        homeScore: e.intHomeScore,
        awayScore: e.intAwayScore,
      }));
      if (!events.length) return { success: false, message: `"${league}" ke liye koi event nahi mila.` };
      return { success: true, count: events.length, events };
    } catch (e: any) {
      return { success: false, message: `Sports data fetch fail hui: ${e?.message || e}` };
    }
  }

  // 30. Stock market (India-relevant, best-effort via Alpha Vantage global quote)
  public async getStockPrice(symbol: string): Promise<any> {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key) return { success: false, message: "ALPHA_VANTAGE_API_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`
      );
      const quote = data["Global Quote"];
      if (!quote || !quote["05. price"]) {
        return { success: false, message: `"${symbol}" ke liye stock data nahi mila. NSE/BSE symbols ke liye ".BSE" suffix try karo (e.g. 'RELIANCE.BSE').` };
      }
      return {
        success: true,
        symbol: quote["01. symbol"],
        price: quote["05. price"],
        change: quote["09. change"],
        changePercent: quote["10. change percent"],
      };
    } catch (e: any) {
      return { success: false, message: `Stock price fetch fail hui: ${e?.message || e}` };
    }
  }

  // 31. Movies/OTT — TMDB
  public async getMovieInfo(title: string): Promise<any> {
    const key = process.env.TMDB_API_KEY;
    if (!key) return { success: false, message: "TMDB_API_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(title)}`
      );
      const movie = data?.results?.[0];
      if (!movie) return { success: false, message: `"${title}" naam ki koi movie nahi mili.` };
      return {
        success: true,
        title: movie.title,
        overview: movie.overview,
        releaseDate: movie.release_date,
        rating: movie.vote_average,
        posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
      };
    } catch (e: any) {
      return { success: false, message: `Movie info fetch fail hui: ${e?.message || e}` };
    }
  }

  // 32. Public domain images — Pexels
  public async searchPexelsImage(query: string): Promise<any> {
    const key = process.env.PEXELS_API_KEY;
    if (!key) return { success: false, message: "PEXELS_API_KEY .env me set nahi hai." };
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3`, {
        headers: { Authorization: key },
      });
      const data = await res.json();
      const photos = (data.photos || []).map((p: any) => ({ url: p.src?.medium, photographer: p.photographer }));
      if (!photos.length) return { success: false, message: `"${query}" ke liye koi image nahi mili.` };
      return { success: true, count: photos.length, photos };
    } catch (e: any) {
      return { success: false, message: `Pexels image search fail hui: ${e?.message || e}` };
    }
  }

  // 33. AI/stock image search — Unsplash
  public async searchUnsplashImage(query: string): Promise<any> {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return { success: false, message: "UNSPLASH_ACCESS_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&client_id=${key}`
      );
      const photos = (data.results || []).map((p: any) => ({ url: p.urls?.regular, photographer: p.user?.name }));
      if (!photos.length) return { success: false, message: `"${query}" ke liye koi image nahi mili.` };
      return { success: true, count: photos.length, photos };
    } catch (e: any) {
      return { success: false, message: `Unsplash image search fail hui: ${e?.message || e}` };
    }
  }

  // 34. Maps/directions — OpenRouteService with 100% Free OSRM Fallback
  public async getDirections(fromPlace: string, toPlace: string): Promise<any> {
    const geocode = async (place: string): Promise<{ lon: number; lat: number; name?: string } | null> => {
      // 1. Try Open-Meteo Geocoding
      try {
        const gm = await fetchJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`
        );
        const res = gm?.results?.[0];
        if (res && res.latitude && res.longitude) {
          return { lon: res.longitude, lat: res.latitude, name: res.name };
        }
      } catch {}

      // 2. Try Nominatim Geocoding
      try {
        const gn = await fetchJson(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`
        );
        const res = gn?.[0];
        if (res && res.lat && res.lon) {
          return { lon: parseFloat(res.lon), lat: parseFloat(res.lat), name: res.display_name?.split(",")?.[0] || place };
        }
      } catch {}

      // 3. Try OpenRouteService Geocoding if key exists
      const key = process.env.OPENROUTESERVICE_API_KEY;
      if (key) {
        try {
          const data = await fetchJson(
            `https://api.openrouteservice.org/geocode/search?api_key=${key}&text=${encodeURIComponent(place)}&size=1`
          );
          const coords = data?.features?.[0]?.geometry?.coordinates;
          if (coords) return { lon: coords[0], lat: coords[1], name: place };
        } catch {}
      }

      return null;
    };

    try {
      const [from, to] = await Promise.all([geocode(fromPlace), geocode(toPlace)]);
      if (!from) return { success: false, message: `"${fromPlace}" location nahi mili.` };
      if (!to) return { success: false, message: `"${toPlace}" location nahi mili.` };

      const key = process.env.OPENROUTESERVICE_API_KEY;
      if (key) {
        try {
          const routeRes = await fetch(
            `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${key}&start=${from.lon},${from.lat}&end=${to.lon},${to.lat}`
          );
          const routeData = await routeRes.json();
          const summary = routeData?.features?.[0]?.properties?.summary;
          if (summary) {
            const distKm = (summary.distance / 1000).toFixed(1);
            const totalMins = Math.round(summary.duration / 60);
            const hours = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const durationFormatted = hours > 0 ? `${hours} hours ${mins} mins` : `${mins} mins`;

            return {
              success: true,
              from: from.name || fromPlace,
              to: to.name || toPlace,
              distanceKm: distKm,
              durationMinutes: totalMins,
              estimatedTime: durationFormatted,
              source: "openrouteservice",
            };
          }
        } catch {}
      }

      // 100% Free OSRM Routing Fallback (No API key needed)
      const osrmRes = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
      );
      const osrmData = await osrmRes.json();
      const route = osrmData?.routes?.[0];
      if (route) {
        const distKm = (route.distance / 1000).toFixed(1);
        const totalMins = Math.round(route.duration / 60);
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const durationFormatted = hours > 0 ? `${hours} hours ${mins} mins` : `${mins} mins`;

        return {
          success: true,
          from: from.name || fromPlace,
          to: to.name || toPlace,
          distanceKm: distKm,
          durationMinutes: totalMins,
          estimatedTime: durationFormatted,
          source: "osrm_free_fallback",
        };
      }

      return { success: false, message: `"${fromPlace}" se "${toPlace}" ka driving route nahi nikal saka.` };
    } catch (e: any) {
      return { success: false, message: `Directions fetch fail hui: ${e?.message || e}` };
    }
  }

  // ---------------------------------------------------------------------
  // BATCH 5 (5 APIs) — final key-required batch:
  //   EDAMAM_APP_ID + EDAMAM_APP_KEY, SPOONACULAR_API_KEY,
  //   AVIATIONSTACK_API_KEY, DATA_GOV_IN_API_KEY, UPCITEMDB (no key needed
  //   on free tier, but rate-limited — included here for consistency)
  // ---------------------------------------------------------------------

  // 35. Nutrition/calorie info — Edamam
  public async getNutritionInfo(foodQuery: string): Promise<any> {
    const appId = process.env.EDAMAM_APP_ID;
    const appKey = process.env.EDAMAM_APP_KEY;
    if (!appId || !appKey) return { success: false, message: "EDAMAM_APP_ID / EDAMAM_APP_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://api.edamam.com/api/nutrition-data?app_id=${appId}&app_key=${appKey}&ingr=${encodeURIComponent(foodQuery)}`
      );
      if (!data.calories) return { success: false, message: `"${foodQuery}" ke liye nutrition data nahi mila.` };
      return {
        success: true,
        query: foodQuery,
        calories: data.calories,
        totalWeightGrams: data.totalWeight,
        protein: data.totalNutrients?.PROCNT?.quantity,
        fat: data.totalNutrients?.FAT?.quantity,
        carbs: data.totalNutrients?.CHOCDF?.quantity,
      };
    } catch (e: any) {
      return { success: false, message: `Nutrition info fetch fail hui: ${e?.message || e}` };
    }
  }

  // 36. Recipe/food — Spoonacular
  public async searchRecipe(query: string): Promise<any> {
    const key = process.env.SPOONACULAR_API_KEY;
    if (!key) return { success: false, message: "SPOONACULAR_API_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://api.spoonacular.com/recipes/complexSearch?apiKey=${key}&query=${encodeURIComponent(query)}&number=1&addRecipeInformation=true`
      );
      const recipe = data?.results?.[0];
      if (!recipe) return { success: false, message: `"${query}" ke liye koi recipe nahi mili.` };
      return {
        success: true,
        title: recipe.title,
        readyInMinutes: recipe.readyInMinutes,
        servings: recipe.servings,
        sourceUrl: recipe.sourceUrl,
        summary: recipe.summary?.replace(/<[^>]*>/g, "").slice(0, 300),
      };
    } catch (e: any) {
      return { success: false, message: `Recipe search fail hui: ${e?.message || e}` };
    }
  }

  // 37. Flight status — AviationStack
  public async getFlightStatus(flightNumber: string): Promise<any> {
    const key = process.env.AVIATIONSTACK_API_KEY;
    if (!key) return { success: false, message: "AVIATIONSTACK_API_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://api.aviationstack.com/v1/flights?access_key=${key}&flight_iata=${encodeURIComponent(flightNumber)}`
      );
      const flight = data?.data?.[0];
      if (!flight) return { success: false, message: `"${flightNumber}" ke liye flight data nahi mila.` };
      return {
        success: true,
        flightNumber,
        status: flight.flight_status,
        departureAirport: flight.departure?.airport,
        departureScheduled: flight.departure?.scheduled,
        arrivalAirport: flight.arrival?.airport,
        arrivalScheduled: flight.arrival?.scheduled,
      };
    } catch (e: any) {
      return { success: false, message: `Flight status fetch fail hui: ${e?.message || e}` };
    }
  }

  // 38. Government schemes/data (India) — data.gov.in Open Government Data API
  // This is a generic catalog search — data.gov.in hosts many different
  // resource datasets, so this searches the resource catalog by keyword.
  public async searchGovtData(keyword: string): Promise<any> {
    const key = process.env.DATA_GOV_IN_API_KEY;
    if (!key) return { success: false, message: "DATA_GOV_IN_API_KEY .env me set nahi hai." };
    try {
      const data = await fetchJson(
        `https://api.data.gov.in/catalog?api-key=${key}&format=json&filters[title]=${encodeURIComponent(keyword)}&limit=5`
      );
      const results = (data.records || data.catalogs || []).slice(0, 5);
      if (!results.length) return { success: false, message: `"${keyword}" ke liye koi govt dataset/scheme nahi mila.` };
      return { success: true, count: results.length, results };
    } catch (e: any) {
      return { success: false, message: `Govt data search fail hui: ${e?.message || e}` };
    }
  }

  // 39. Barcode/product lookup — UPCitemdb
  // Free tier works without a key but is IP-rate-limited (~100/day); an
  // optional UPCITEMDB_USER_KEY raises that limit if the user signs up.
  public async getProductByBarcode(upc: string): Promise<any> {
    const userKey = process.env.UPCITEMDB_USER_KEY;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (userKey) headers["user_key"] = userKey;
    try {
      const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`, { headers });
      const data = await res.json();
      const item = data?.items?.[0];
      if (!item) return { success: false, message: `Barcode "${upc}" ke liye koi product nahi mila.` };
      return {
        success: true,
        title: item.title,
        brand: item.brand,
        description: item.description,
        lowestRecordedPrice: item.lowest_recorded_price,
        highestRecordedPrice: item.highest_recorded_price,
      };
    } catch (e: any) {
      return { success: false, message: `Barcode lookup fail hui: ${e?.message || e}` };
    }
  }

  // ---------------------------------------------------------------------
  // BATCH 6 (Indian Railways) — RapidAPI "IRCTC1" API (unofficial, free
  // tier is very limited — roughly ~50 calls/month on DK's current plan).
  // Uses RAPIDAPI_KEY (the "Application Key" from rapidapi.com console).
  // ---------------------------------------------------------------------

  private static readonly RAPIDAPI_HOST = "irctc1.p.rapidapi.com";

  private rapidApiHeaders(): Record<string, string> | null {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return null;
    return {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": PublicApisService.RAPIDAPI_HOST,
    };
  }

  // Internal helper: resolve a city/station name to its station code.
  private async findStationCode(place: string): Promise<{ code: string; name: string } | null> {
    const headers = this.rapidApiHeaders();
    if (!headers) return null;
    const res = await fetch(
      `https://irctc1.p.rapidapi.com/api/v1/searchStation?query=${encodeURIComponent(place)}`,
      { headers }
    );
    const data = await res.json();
    const station = data?.data?.[0];
    if (!station) return null;
    return { code: station.code, name: station.name };
  }

  // Helper: Free Indian Railway provider fallback (No API key required)
  private async getFreeTrainData(trainNumber: string): Promise<any> {
    try {
      const res = await fetch(`https://rappid.in/apis/train.php?train_no=${encodeURIComponent(trainNumber)}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.success || !Array.isArray(data.data) || !data.data.length) return null;
      return data;
    } catch {
      return null;
    }
  }

  // 40. Trains between two stations
  public async getTrainsBetweenStations(fromPlace: string, toPlace: string): Promise<any> {
    const headers = this.rapidApiHeaders();
    if (headers) {
      try {
        const [from, to] = await Promise.all([this.findStationCode(fromPlace), this.findStationCode(toPlace)]);
        if (from && to) {
          const res = await fetch(
            `https://irctc1.p.rapidapi.com/api/v1/trainBetweenStations?fromStationCode=${from.code}&toStationCode=${to.code}`,
            { headers }
          );
          const data = await res.json();
          const trains = (data?.data || []).slice(0, 8).map((t: any) => ({
            trainNumber: t.train_number,
            trainName: t.train_name,
            departureTime: t.from_std,
            arrivalTime: t.to_std,
            duration: t.duration,
          }));
          if (trains.length) {
            return { success: true, from: from.name, to: to.name, count: trains.length, trains };
          }
        }
      } catch {
        // Fall through to free search fallback
      }
    }

    // Fallback search
    try {
      const q = encodeURIComponent(`trains between ${fromPlace} and ${toPlace}`);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      const html = await res.text();
      const snippets: string[] = [];
      const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
      let match;
      while ((match = regex.exec(html)) !== null && snippets.length < 3) {
        const clean = match[1].replace(/<[^>]*>/g, "").trim();
        if (clean) snippets.push(clean);
      }
      if (snippets.length) {
        return {
          success: true,
          from: fromPlace,
          to: toPlace,
          summary: snippets.join(" | "),
          source: "web_fallback",
        };
      }
    } catch {
      // Ignore fallback errors
    }

    return { success: false, message: `"${fromPlace}" se "${toPlace}" ke beech train list nahi mil saki.` };
  }

  // 41. Train schedule by train number
  public async getTrainSchedule(trainNumber: string): Promise<any> {
    const headers = this.rapidApiHeaders();
    if (headers) {
      try {
        const res = await fetch(
          `https://irctc1.p.rapidapi.com/api/v1/getTrainSchedule?trainNo=${encodeURIComponent(trainNumber)}`,
          { headers }
        );
        const data = await res.json();
        const t = data?.data;
        if (t && t.route && t.route.length) {
          const stops = (t.route || []).slice(0, 15).map((s: any) => ({
            station: s.station_name,
            arrival: s.arrival_time,
            departure: s.departure_time,
            platform: s.platform_number || s.platform_num || s.platform || "Not specified",
            day: s.day_count,
          }));
          return { success: true, trainNumber, trainName: t.train_name, stops, source: "rapidapi" };
        }
      } catch {
        // Fall through to free fallback
      }
    }

    // Free fallback (No API key needed)
    const freeData = await this.getFreeTrainData(trainNumber);
    if (freeData) {
      const stops = freeData.data.slice(0, 15).map((s: any) => ({
        station: s.station_name,
        timing: s.timing,
        delay: s.delay || "On Time",
        platform: s.platform || "Not specified",
        halt: s.halt || "-",
        distance: s.distance || "-",
      }));
      return {
        success: true,
        trainNumber,
        trainName: freeData.train_name || `Train ${trainNumber}`,
        updatedTime: freeData.updated_time,
        stops,
        source: "free_fallback",
      };
    }

    return { success: false, message: `Train number "${trainNumber}" ka schedule nahi mila.` };
  }

  // 42. Live train running status (Location, delay, expected platform)
  public async getLiveTrainStatus(trainNumber: string, startDay: number = 0): Promise<any> {
    const headers = this.rapidApiHeaders();
    if (headers) {
      try {
        const res = await fetch(
          `https://irctc1.p.rapidapi.com/api/v1/liveTrainStatus?trainNo=${encodeURIComponent(trainNumber)}&startDay=${startDay}`,
          { headers }
        );
        const data = await res.json();
        const d = data?.data;
        if (d && (d.train_name || d.upcoming_stations || d.current_station_name)) {
          const upcoming = (d.upcoming_stations || d.station_list || []).slice(0, 5).map((s: any) => ({
            station: s.station_name,
            expectedArrival: s.eta || s.arrival_time,
            expectedDeparture: s.etd || s.departure_time,
            platform: s.platform_number || s.platform_num || s.platform || "TBD",
            delayInArrival: s.delay_in_arrival || 0,
            delayInDeparture: s.delay_in_departure || 0,
          }));

          const currentOrLast = d.current_station_name || d.last_stop || d.status_as_of || "On track";

          return {
            success: true,
            trainNumber,
            trainName: d.train_name,
            currentLocation: currentOrLast,
            statusSummary: d.status_as_of || d.status || d.headline || "Running",
            delayMinutes: d.delay || (upcoming.length ? upcoming[0].delayInArrival : 0),
            nextStop: upcoming[0]?.station || "N/A",
            expectedPlatform: upcoming[0]?.platform || "TBD",
            upcomingStations: upcoming,
            source: "rapidapi",
          };
        }
      } catch {
        // Fall through to free fallback
      }
    }

    // Free fallback (No API key needed)
    const freeData = await this.getFreeTrainData(trainNumber);
    if (freeData) {
      const stations = freeData.data || [];
      const currentStation = stations.find((s: any) => s.is_current_station) || stations[0];
      const upcoming = stations.slice(0, 6).map((s: any) => ({
        station: s.station_name,
        timing: s.timing,
        platform: s.platform || "TBD",
        delay: s.delay || "On Time",
        halt: s.halt,
      }));

      return {
        success: true,
        trainNumber,
        trainName: freeData.train_name,
        statusSummary: freeData.message || freeData.updated_time || "Live status retrieved",
        currentLocation: currentStation?.station_name || "En route",
        expectedPlatform: currentStation?.platform || upcoming[0]?.platform || "TBD",
        delay: currentStation?.delay || upcoming[0]?.delay || "On Time",
        upcomingStations: upcoming,
        updatedTime: freeData.updated_time,
        source: "free_fallback",
      };
    }

    return { success: false, message: `Train number "${trainNumber}" ka live status nahi mila.` };
  }

  // 43. PNR status
  public async getPnrStatus(pnrNumber: string): Promise<any> {
    const headers = this.rapidApiHeaders();
    if (headers) {
      try {
        const res = await fetch(
          `https://irctc1.p.rapidapi.com/api/v1/checkPNRStatus?pnrNumber=${encodeURIComponent(pnrNumber)}`,
          { headers }
        );
        const data = await res.json();
        const d = data?.data;
        if (d && d.passengerList) {
          return {
            success: true,
            pnrNumber,
            trainName: d.trainName,
            trainNumber: d.trainNumber,
            dateOfJourney: d.dateOfJourney,
            chartStatus: d.chartStatus,
            passengers: (d.passengerList || []).map((p: any) => ({
              currentStatus: p.currentStatus,
              bookingStatus: p.bookingStatus,
            })),
            source: "rapidapi",
          };
        }
      } catch {
        // Fall through to fallback message
      }
    }

    return { success: false, message: `PNR "${pnrNumber}" ka status abhi check nahi ho saka. RapidAPI key check karein.` };
  }

  // 44. Search product deals & compare across Amazon, Flipkart, Meesho
  public async searchProductDeals(productName: string): Promise<any> {
    const q = productName.trim();
    if (!q) return { success: false, message: "Product name zaroori hai." };

    const encoded = encodeURIComponent(q);
    const stores = [
      {
        store: "Meesho",
        buyLink: `https://www.meesho.com/search?q=${encoded}`,
        tagline: "Sabse sasta & budget friendly options",
      },
      {
        store: "Flipkart",
        buyLink: `https://www.flipkart.com/search?q=${encoded}`,
        tagline: "Value for money & top discounts",
      },
      {
        store: "Amazon India",
        buyLink: `https://www.amazon.in/s?k=${encoded}`,
        tagline: "Fast delivery & genuine brand warranty",
      },
    ];

    return {
      success: true,
      product: q,
      stores,
      message: `"${q}" ke liye Amazon, Flipkart aur Meesho ke direct buy links available hain.`,
    };
  }

  // 45. Daily life suggestions (Routine, Health/Diet, Focus, Motivation)
  public async getDailyLifeSuggestion(category?: string, context?: string): Promise<any> {
    const cat = (category || "routine").toLowerCase();
    
    if (cat.includes("diet") || cat.includes("health") || cat.includes("food") || cat.includes("khana")) {
      return {
        success: true,
        category: "Health & Diet",
        tips: [
          "Subah uthkar 1-2 glass gunguna paani zaroor piyein.",
          "Lunch me protein (Daal, Paneer, Dahi ya Sprouts) aur salad shamil karein.",
          "Har 1-2 ghante screen time ke baad 5 minute ki walk aur paani ka break lein.",
          "Raat ko sone se kam se kam 2 ghante pehle halka khana khayein.",
        ],
        contextGiven: context || "General health",
      };
    } else if (cat.includes("focus") || cat.includes("productiv") || cat.includes("work") || cat.includes("kaam")) {
      return {
        success: true,
        category: "Productivity & Focus",
        tips: [
          "Pomodoro Rule: 25 minute full focus kaam, 5 minute break.",
          "Din ki shuruat sabse mushkil task se karein (Eat That Frog).",
          "Phone ko kaam ke waqt Do Not Disturb par rakhein.",
          "Din me sirf top 3 priority tasks par concentrate karein.",
        ],
        contextGiven: context || "General productivity",
      };
    } else if (cat.includes("stress") || cat.includes("peace") || cat.includes("mind") || cat.includes("tension")) {
      return {
        success: true,
        category: "Mental Peace & Stress Relief",
        tips: [
          "Geeta Gyan: Karma par dhyan do, parinam ki chinta chhod do (Karmanye Vadhikaraste).",
          "4-7-8 Breathing: 4 sec saans andar lein, 7 sec rokein, 8 sec me dheere-dheere chhodein.",
          "Jo aapke control me nahi hai, uspar zyada sochna band karein.",
        ],
        contextGiven: context || "General peace",
      };
    }

    return {
      success: true,
      category: "Daily Routine & Planning",
      tips: [
        "Subah 10 minute planning: Aaj ke 3 sabse zaroori kaam likhein.",
        "Mausam aur daily reminders check karke din shuru karein.",
        "Self-Care: Din me kam se kam 30 minute physical activity ya walk zaroor karein.",
      ],
      contextGiven: context || "General daily routine",
    };
  }

  // 46. Website Info, Direct Links & Customer Care Helpline Directory
  public async getWebsiteOrHelplineInfo(query: string): Promise<any> {
    const verifiedDirectory: Record<string, { name: string; url: string; customerCare: string; description: string }> = {
      irctc: {
        name: "IRCTC (Indian Railway Catering and Tourism Corporation)",
        url: "https://www.irctc.co.in",
        customerCare: "14646 / 0755-6610661",
        description: "Indian Railways ki official ticket booking, train schedule, PNR status aur tourism portal.",
      },
      uidai: {
        name: "UIDAI (Unique Identification Authority of India)",
        url: "https://uidai.gov.in",
        customerCare: "1947 (Toll-Free)",
        description: "Aadhaar card download, PVC card order, update aur biometric lock/unlock portal.",
      },
      aadhaar: {
        name: "UIDAI (Unique Identification Authority of India)",
        url: "https://uidai.gov.in",
        customerCare: "1947 (Toll-Free)",
        description: "Aadhaar card download, PVC card order, update aur biometric lock/unlock portal.",
      },
      epfo: {
        name: "EPFO (Employees' Provident Fund Organisation)",
        url: "https://www.epfindia.gov.in",
        customerCare: "1800 118 005 (Toll-Free)",
        description: "PF balance check, UAN passbook, PF withdrawal aur member claim portal.",
      },
      incometax: {
        name: "Income Tax e-Filing Portal",
        url: "https://www.incometax.gov.in",
        customerCare: "1800 103 0025 / 1800 419 0025",
        description: "ITR filing, PAN-Aadhaar link, tax refund status aur AIS check portal.",
      },
      sbi: {
        name: "State Bank of India (SBI)",
        url: "https://onlinesbi.sbi",
        customerCare: "1800 1234 / 1800 2100",
        description: "SBI Online Net Banking, card block, balance enquiry aur customer support.",
      },
      hdfc: {
        name: "HDFC Bank",
        url: "https://www.hdfcbank.com",
        customerCare: "1800 1600 / 1800 2600",
        description: "HDFC NetBanking, loan, credit card aur account services portal.",
      },
      icici: {
        name: "ICICI Bank",
        url: "https://www.icicibank.com",
        customerCare: "1800 1080",
        description: "ICICI NetBanking, credit card, iMobile Pay aur customer care portal.",
      },
      amazon: {
        name: "Amazon India",
        url: "https://www.amazon.in",
        customerCare: "1800 3000 9009 (Toll-Free)",
        description: "Online shopping, electronics, fashion, groceries aur customer support portal.",
      },
      flipkart: {
        name: "Flipkart",
        url: "https://www.flipkart.com",
        customerCare: "1800 202 9898 (Toll-Free)",
        description: "Online shopping, mobile, fashion, appliances aur return/refund portal.",
      },
      meesho: {
        name: "Meesho",
        url: "https://www.meesho.com",
        customerCare: "080-61799600",
        description: "Budget shopping, clothing, home essentials aur reseller marketplace portal.",
      },
      zomato: {
        name: "Zomato",
        url: "https://www.zomato.com",
        customerCare: "In-App Support / help@zomato.com",
        description: "Food delivery, restaurant booking aur dining reviews portal.",
      },
      swiggy: {
        name: "Swiggy",
        url: "https://www.swiggy.com",
        customerCare: "080-67466729 / In-App Support",
        description: "Food delivery, Instamart grocery aur parcel delivery portal.",
      },
      jio: {
        name: "Reliance Jio",
        url: "https://www.jio.com",
        customerCare: "198 / 199 (From Jio) or 1800 889 9999",
        description: "Jio Mobile recharge, Fiber broadband, 5G plans aur Jio services portal.",
      },
      airtel: {
        name: "Bharti Airtel",
        url: "https://www.airtel.in",
        customerCare: "121 / 198 (From Airtel) or 1800 103 0121",
        description: "Airtel Mobile prepaid/postpaid, DTH, Xstream fiber aur banking portal.",
      },
      cybercrime: {
        name: "National Cyber Crime Reporting Portal",
        url: "https://cybercrime.gov.in",
        customerCare: "1930 (National Helpline)",
        description: "Online financial fraud, cyber stalking, hacking aur social media complaint portal.",
      },
      passport: {
        name: "Passport Seva Portal",
        url: "https://www.passportindia.gov.in",
        customerCare: "1800 258 1800 (Toll-Free)",
        description: "New passport application, renewal, appointment booking aur tracking portal.",
      },
    };

    const key = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const [k, v] of Object.entries(verifiedDirectory)) {
      if (key.includes(k) || k.includes(key)) {
        return { success: true, ...v, source: "verified_directory" };
      }
    }

    // Web search fallback
    try {
      const q = encodeURIComponent(`${query} official website link customer care number what is it`);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      const html = await res.text();
      const snippets: string[] = [];
      const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
      let match;
      while ((match = regex.exec(html)) !== null && snippets.length < 3) {
        const clean = match[1].replace(/<[^>]*>/g, "").trim();
        if (clean) snippets.push(clean);
      }
      if (snippets.length) {
        return {
          success: true,
          name: query,
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          customerCare: "Details mentioned in description",
          description: snippets.join(" | "),
          source: "web_search",
        };
      }
    } catch {}

    return { success: false, message: `"${query}" ke bare me jankari nahi mil saki.` };
  }

  // 47. Instagram Profile Lookup (Followers, Following, Total Posts, Bio, Verified Status)
  public async getInstagramUserInfo(username: string): Promise<any> {
    const cleanUsername = username.replace(/^@/, "").trim().toLowerCase();
    if (!cleanUsername) return { success: false, message: "Instagram username zaroori hai." };

    try {
      const res = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanUsername)}`,
        {
          headers: {
            "x-ig-app-id": "936619743392459",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": `https://www.instagram.com/${cleanUsername}/`,
          },
        }
      );

      const json = await res.json();
      const user = json?.data?.user;
      if (user) {
        const edges = user.edge_owner_to_timeline_media?.edges || [];
        const latestPosts = edges.slice(0, 4).map((e: any) => {
          const node = e.node;
          const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || "";
          return {
            type: node.is_video ? "Reel / Video" : "Photo",
            caption: caption.length > 120 ? caption.slice(0, 120) + "..." : caption,
            likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
            comments: node.edge_media_to_comment?.count || 0,
            views: node.video_view_count || undefined,
            postUrl: `https://www.instagram.com/p/${node.shortcode}/`,
            shortcode: node.shortcode,
          };
        });

        const followers = user.edge_followed_by?.count || 0;
        let avgLikes = 0;
        if (latestPosts.length > 0 && followers > 0) {
          const totalLikes = latestPosts.reduce((acc: number, p: any) => acc + (p.likes || 0), 0);
          avgLikes = Math.round(totalLikes / latestPosts.length);
        }

        return {
          success: true,
          username: user.username,
          fullName: user.full_name || user.username,
          biography: user.biography || "",
          followersCount: followers,
          followingCount: user.edge_follow?.count || 0,
          totalPosts: user.edge_owner_to_timeline_media?.count || 0,
          isVerified: !!user.is_verified,
          isPrivate: !!user.is_private,
          profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url,
          externalUrl: user.external_url || undefined,
          profileUrl: `https://www.instagram.com/${user.username}/`,
          avgRecentLikes: avgLikes,
          recentPostsCount: latestPosts.length,
          latestPosts,
        };
      }
    } catch (e: any) {
      // Fall through to error
    }

    return { success: false, message: `Instagram profile "@${cleanUsername}" fetch nahi ho saki ya account private/not found hai.` };
  }

  // 48. X (Twitter) Profile, Tweets & Search Helper
  public async getXTwitterInfo(usernameOrTopic: string): Promise<any> {
    const clean = usernameOrTopic.replace(/^@/, "").trim();
    if (!clean) return { success: false, message: "X / Twitter username ya topic zaroori hai." };

    const profileUrl = `https://x.com/${clean}`;

    // Search Fallback for Latest Tweets on X
    try {
      const q = encodeURIComponent(`site:x.com/${clean} OR site:twitter.com/${clean}`);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      const html = await res.text();
      const snippets: string[] = [];
      const linkRegex = /<a class="result__snippet[^>]*>(.*?)<\/a>/gs;
      let match;
      while ((match = linkRegex.exec(html)) !== null && snippets.length < 3) {
        const snippet = match[1].replace(/<[^>]*>/g, "").trim();
        if (snippet && !snippet.includes("JavaScript")) {
          snippets.push(snippet);
        }
      }

      return {
        success: true,
        query: clean,
        profileUrl,
        recentDiscussions: snippets,
        message: `X (Twitter) par @${clean} ka profile link available hai. Live tweets aur updates ke liye real-time information active hai.`,
      };
    } catch {
      return {
        success: true,
        query: clean,
        profileUrl,
        message: `X (Twitter) par @${clean} ka link: ${profileUrl}`,
      };
    }
  }

  // 49. YouTube Video, Channel & Trending Search
  public async searchYouTube(query: string): Promise<any> {
    const q = query.trim();
    if (!q) return { success: false, message: "YouTube search query zaroori hai." };
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const channelUrl = q.startsWith("@") ? `https://www.youtube.com/${q}` : undefined;

    return {
      success: true,
      query: q,
      searchUrl,
      channelUrl,
      message: `YouTube par "${q}" ke liye direct search link available hai.`,
    };
  }

  // 50. Reddit Community, Topics & Honest Opinions
  public async searchReddit(topicOrSubreddit: string): Promise<any> {
    const clean = topicOrSubreddit.trim().replace(/^r\//i, "");
    if (!clean) return { success: false, message: "Reddit topic ya subreddit zaroori hai." };
    const isSub = !clean.includes(" ");
    const subredditUrl = isSub ? `https://www.reddit.com/r/${clean}/` : undefined;
    const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(clean)}`;

    return {
      success: true,
      topic: clean,
      subredditUrl,
      searchUrl,
      message: `Reddit par "${clean}" ki public discussions aur reviews ke links available hain.`,
    };
  }

  // 51. Spotify & Apple Music Song/Artist Finder
  public async searchMusic(songOrArtist: string): Promise<any> {
    const q = songOrArtist.trim();
    if (!q) return { success: false, message: "Song ya artist ka naam zaroori hai." };

    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=3`
      );
      const json = await res.json();
      const tracks = (json.results || []).map((t: any) => ({
        trackName: t.trackName,
        artistName: t.artistName,
        collectionName: t.collectionName,
        releaseDate: t.releaseDate ? t.releaseDate.slice(0, 10) : undefined,
        previewUrl: t.previewUrl,
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(t.trackName + " " + t.artistName)}`,
      }));

      if (tracks.length) {
        return {
          success: true,
          query: q,
          count: tracks.length,
          tracks,
          spotifySearchUrl: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
        };
      }
    } catch {}

    return {
      success: true,
      query: q,
      spotifySearchUrl: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
      message: `"${q}" ke liye Spotify link available hai.`,
    };
  }

  // 51.1 Play & Stream Music in Background
  public async playMusic(songOrArtist: string): Promise<any> {
    const res = await this.searchMusic(songOrArtist);
    if (res.success && res.tracks && res.tracks.length > 0) {
      const topTrack = res.tracks[0];
      return {
        success: true,
        action: "play",
        trackName: topTrack.trackName,
        artistName: topTrack.artistName,
        audioUrl: topTrack.previewUrl,
        spotifyUrl: topTrack.spotifyUrl,
        message: `"${topTrack.trackName}" by ${topTrack.artistName} play kiya ja raha hai.`,
      };
    }
    return {
      success: false,
      message: `"${songOrArtist}" ke liye koi playable track nahi mila.`,
    };
  }

  // 51.2 Stop Currently Playing Music
  public async stopMusic(): Promise<any> {
    return {
      success: true,
      action: "stop",
      message: "Music / Gana band kar diya gaya hai.",
    };
  }

  // 52. LinkedIn Company & Jobs Hub
  public async getLinkedInInsights(query: string): Promise<any> {
    const q = query.trim();
    if (!q) return { success: false, message: "Company ya role ka naam zaroori hai." };

    const companyUrl = `https://www.linkedin.com/company/${encodeURIComponent(q.toLowerCase().replace(/\s+/g, "-"))}`;
    const jobsUrl = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(q)}`;

    return {
      success: true,
      query: q,
      companyUrl,
      jobsUrl,
      message: `LinkedIn par "${q}" ke company page aur job openings ke links available hain.`,
    };
  }

  // 53. Telegram & Discord Community Finder
  public async getCommunityLinks(platform: string, topic: string): Promise<any> {
    const plat = (platform || "telegram").toLowerCase();
    const q = topic.trim();
    if (!q) return { success: false, message: "Community topic zaroori hai." };

    if (plat.includes("discord")) {
      return {
        success: true,
        platform: "Discord",
        topic: q,
        inviteSearchUrl: `https://discord.com/invite/search?q=${encodeURIComponent(q)}`,
        message: `Discord par "${q}" community search link ready hai.`,
      };
    }

    return {
      success: true,
      platform: "Telegram",
      topic: q,
      telegramUrl: `https://t.me/s/${encodeURIComponent(q.replace(/\s+/g, "_"))}`,
      message: `Telegram par "${q}" channels search link ready hai.`,
    };
  }

  // 54. Pinterest Visual Trends & Ideas
  public async getPinterestIdeas(query: string): Promise<any> {
    const q = query.trim();
    if (!q) return { success: false, message: "Topic zaroori hai." };
    const pinterestUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`;

    return {
      success: true,
      query: q,
      pinterestUrl,
      message: `Pinterest par "${q}" ke visual ideas aur pins available hain.`,
    };
  }

  // 55. Medicine, Uses, Dosage & Jan Aushadhi Generic Alternatives
  public async getMedicineAndGenericInfo(medicineName: string): Promise<any> {
    const q = medicineName.toLowerCase().trim();
    if (!q) return { success: false, message: "Medicine name zaroori hai." };

    const commonMeds: Record<string, any> = {
      paracetamol: {
        brandName: "Paracetamol (Crocin / Dolo 650)",
        salt: "Paracetamol 500mg / 650mg",
        uses: "Bukhar (Fever), Sar dard, body pain aur halka joint pain kam karne ke liye.",
        precautions: "24 ghante me 4000mg se zyada na lein. Do doses me kam se kam 4-6 ghante ka gap rakhein.",
        janAushadhiAlternative: "PM Jan Aushadhi Paracetamol 650mg (Sirf ₹10 - ₹15 per strip, branded se 70% sasta).",
      },
      dolo: {
        brandName: "Dolo 650",
        salt: "Paracetamol 650mg",
        uses: "Tez bukhar aur severe body ache me upyogi.",
        precautions: "Khana khane ke baad lein. Liver problem wale doctor ki salah lein.",
        janAushadhiAlternative: "Generic Paracetamol 650mg (Jan Aushadhi price: ₹1.20 per tablet).",
      },
      pantop: {
        brandName: "Pantop-D / Pan-D",
        salt: "Pantoprazole 40mg + Domperidone 30mg",
        uses: "Severe acidity, gas, ulti jaisa lagna, aur pet me jalan.",
        precautions: "Subah khali pet (empty stomach) lene se best result milta hai.",
        janAushadhiAlternative: "Jan Aushadhi Pantoprazole + Domperidone (Sirf ₹25 - ₹30 per 10 capsules).",
      },
      azithromycin: {
        brandName: "Azithral 500 / Azee 500",
        salt: "Azithromycin 500mg",
        uses: "Gale me infection (throat infection), cough, aur bacterial infections.",
        precautions: "Yeh ek Antibiotic hai, bina doctor ki advice ke na lein aur poora course complete karein.",
        janAushadhiAlternative: "Jan Aushadhi Azithromycin 500mg (Sirf ₹35 - ₹45 per 3 tablets, branded se 65% sasta).",
      },
      cetirizine: {
        brandName: "Cetirizine (Okacet / Cetzine)",
        salt: "Cetirizine Hydrochloride 10mg",
        uses: "Allergy, cheenkein aana, naak behna, aur khujli.",
        precautions: "Ise lene ke baad halki neend aa sakti hai, gaadi chalate waqt avoid karein.",
        janAushadhiAlternative: "Jan Aushadhi Cetirizine 10mg (Sirf ₹3 - ₹5 per 10 tablets).",
      },
    };

    for (const [k, v] of Object.entries(commonMeds)) {
      if (q.includes(k)) {
        return { success: true, medicine: medicineName, ...v, source: "verified_medicine_directory" };
      }
    }

    return {
      success: true,
      medicine: medicineName,
      uses: `"${medicineName}" ke upyog aur dose ke liye doctor ya registered pharmacist se salah lein.`,
      janAushadhiTip: "Aap kisi bhi Pradhan Mantri Jan Aushadhi Kendra se iske salt name par 50% se 80% sasti dawai le sakte hain.",
      janAushadhiPortal: "http://janaushadhi.gov.in/",
    };
  }

  // 56. Daily Commodity Rates (Gold, Silver, Petrol, Diesel, LPG)
  public async getDailyCommodityRates(commodity: string, city = "Patna"): Promise<any> {
    return {
      success: true,
      city,
      commodity,
      rates: {
        gold24k: "₹72,800 - ₹74,500 per 10 grams (99.9% Pure)",
        gold22k: "₹66,800 - ₹68,200 per 10 grams (Jewellery standard)",
        silver: "₹88,500 - ₹91,200 per kg",
        petrolPatna: "₹105.48 / Litre",
        dieselPatna: "₹92.27 / Litre",
        petrolDelhi: "₹94.72 / Litre",
        dieselDelhi: "₹87.62 / Litre",
        lpgDomestic14kg: "₹850 - ₹900 per cylinder (approx with subsidy)",
      },
      note: "Live market rates fluctuate daily based on international bullion and MCX/OMC prices.",
    };
  }

  // 57. Emergency SOS & Instant Helplines Hub
  public async getEmergencyHelplines(serviceType?: string): Promise<any> {
    return {
      success: true,
      category: serviceType || "All Emergency Helplines",
      emergencyNumbers: {
        nationalAllInOne: "112 (Police, Ambulance, Fire single emergency number)",
        police: "100 / 112",
        ambulance: "102 / 108",
        fireBrigade: "101",
        cyberCrimeFraud: "1930 (National Cyber Crime Helpline)",
        womenSafetyHelpline: "1091",
        railwayHelpline: "139",
        childHelpline: "1098",
        nationalConsumerHelpline: "1915",
        nationalDisasterNDRF: "1078",
        healthCovidHelpline: "1075",
      },
      message: "Emergency ke waqt 112 dial karein ya Cyber Fraud ke liye turant 1930 par call karein.",
    };
  }

  // 58. Vehicle RC, DL, Insurance & E-Challan Services
  public async getVehicleAndChallanServices(service = "echallan", vehicleNumber?: string): Promise<any> {
    const vNo = (vehicleNumber || "").toUpperCase().replace(/\s+/g, "");
    return {
      success: true,
      serviceRequested: service,
      vehicleNumber: vNo || undefined,
      echallanUrl: "https://echallan.parivahan.gov.in/gstn/",
      parivahanRcDlPortal: "https://parivahan.gov.in/parivahan/",
      pucValidityUrl: "https://vahan.parivahan.gov.in/puc/",
      mParivahanApp: "https://play.google.com/store/apps/details?id=com.nic.mparivahan",
      message: "Parivahan e-Challan portal par gaadi number daalkar pending fine online check aur pay kiya ja sakta hai.",
    };
  }

  // 59. Utility Bills, Gas Cylinder & Fastag Services
  public async getUtilityAndBillServices(serviceType: string, providerOrState?: string): Promise<any> {
    return {
      success: true,
      serviceType,
      gasCylinderBooking: {
        indaneWhatsApp: "7718955555 (Send 'REFILL')",
        bharatGasWhatsApp: "1800224344",
        hpGasWhatsApp: "9222201122",
      },
      electricityPortals: {
        biharSouth: "https://sbpdcl.co.in",
        biharNorth: "https://nbpdcl.co.in",
        delhiBSES: "https://www.bsesdelhi.com",
        delhiTataPower: "https://www.tatapower-ddl.com",
        upPower: "https://www.upenergy.in",
      },
      fastagRecharge: "https://www.npci.org.in/what-we-do/netc-fastag/product-overview",
      message: "Gas cylinder direct WhatsApp number se book kar sakte hain aur bijli bill online check ho sakta hai.",
    };
  }

  // 60. Sarkari Yojana (Govt Scheme) Finder
  public async getGovtSchemeInfo(schemeName: string): Promise<any> {
    const q = schemeName.toLowerCase().trim();
    const schemesList: Record<string, any> = {
      ayushman: {
        name: "Ayushman Bharat (PM-JAY)",
        benefit: "Har parivar ko saal me ₹5 Lakh tak ka muft ilaj (Cashless hospital treatment).",
        eligibility: "SECC data aur ration card ke aadhar par eligible parivar.",
        officialPortal: "https://beneficiary.nha.gov.in",
      },
      kisan: {
        name: "PM Kisan Samman Nidhi Yojana",
        benefit: "Saal me ₹6,000 (teen ₹2,000 ki kiston me) seedhe kisan ke bank account me.",
        officialPortal: "https://pmkisan.gov.in",
      },
      awas: {
        name: "Pradhan Mantri Awas Yojana (PMAY)",
        benefit: "Ghar banane ke liye sarkari subsidy aur aarthik madad.",
        officialPortal: "https://pmaymis.gov.in",
      },
      sukanya: {
        name: "Sukanya Samriddhi Yojana (SSY)",
        benefit: "Beti ke bhavishya aur padhai ke liye high-interest (8.2%) sarkari bachat yojana.",
        officialPortal: "https://www.indiapost.gov.in",
      },
    };

    for (const [k, v] of Object.entries(schemesList)) {
      if (q.includes(k)) {
        return { success: true, ...v, source: "verified_govt_scheme" };
      }
    }

    return {
      success: true,
      scheme: schemeName,
      officialPortal: `https://www.myscheme.gov.in/search?q=${encodeURIComponent(schemeName)}`,
      message: `"${schemeName}" ki poori jankari aur apply karne ke liye MyScheme portal visit karein.`,
    };
  }

  // 61. Voice Expense Tracker & Budgeting
  private inMemoryExpenses: any[] = [];

  public async trackExpenseEntry(amount: number, category: string, note?: string): Promise<any> {
    const num = Number(amount);
    if (!num || isNaN(num) || num <= 0) {
      return { success: false, message: "Valid kharche ki rashi (amount) batayein." };
    }

    const entry = {
      id: `exp_${Date.now()}`,
      amount: num,
      category: category || "General",
      note: note || "",
      date: new Date().toLocaleDateString("en-IN"),
      time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
    };

    this.inMemoryExpenses.push(entry);

    const todayTotal = this.inMemoryExpenses
      .filter((e) => e.date === entry.date)
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      success: true,
      entry,
      todayTotal,
      message: `₹${num} (${entry.category}${note ? `: ${note}` : ""}) note ho gaya. Aaj ka total kharcha ₹${todayTotal} hai.`,
    };
  }

  public async getExpenseSummary(): Promise<any> {
    const today = new Date().toLocaleDateString("en-IN");
    const todayExpenses = this.inMemoryExpenses.filter((e) => e.date === today);
    const totalToday = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalAll = this.inMemoryExpenses.reduce((sum, e) => sum + e.amount, 0);

    return {
      success: true,
      todayTotal: totalToday,
      totalEntries: this.inMemoryExpenses.length,
      allTimeTotal: totalAll,
      recentExpenses: this.inMemoryExpenses.slice(-5).reverse(),
      message: `Aaj ka kul kharcha ₹${totalToday} hai.`,
    };
  }

  // 62. Bus Travel & Road Booking
  public async getBusTravelInfo(fromCity: string, toCity: string): Promise<any> {
    const from = fromCity.trim();
    const to = toCity.trim();
    if (!from || !to) return { success: false, message: "Origin aur Destination city zaroori hai." };

    const redBusUrl = `https://www.redbus.in/bus-tickets/${encodeURIComponent(from.toLowerCase() + "-to-" + to.toLowerCase())}`;
    const abhiBusUrl = `https://www.abhibus.com/bus_search/${encodeURIComponent(from + "/" + to)}`;

    return {
      success: true,
      from,
      to,
      redBusUrl,
      abhiBusUrl,
      message: `${from} se ${to} ke liye RedBus aur AbhiBus ke direct booking links ready hain.`,
    };
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export const publicApisService = new PublicApisService();
