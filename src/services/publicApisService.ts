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

  // 15. Nearby places — OpenStreetMap Overpass API (free, no key)
  // Uses Nominatim for geocoding + Overpass for amenity search.
  public async getNearbyPlaces(place: string, amenity: string): Promise<any> {
    const geo = await fetchJson(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`,
    );
    const loc = geo?.[0];
    if (!loc) return { success: false, message: `"${place}" location nahi mili.` };

    const query = `[out:json][timeout:10];node["amenity"="${amenity}"](around:3000,${loc.lat},${loc.lon});out 8;`;
    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });
    const data = await overpassRes.json();
    const places = (data.elements || []).slice(0, 8).map((el: any) => ({
      name: el.tags?.name || "Unnamed",
      lat: el.lat,
      lon: el.lon,
    }));
    return { success: true, near: place, amenity, count: places.length, places };
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

  // 27. News — NewsData.io
  public async getNews(topic?: string, country = "in"): Promise<any> {
    const key = process.env.NEWSDATA_API_KEY;
    if (!key) return { success: false, message: "NEWSDATA_API_KEY .env me set nahi hai." };
    const params = new URLSearchParams({ apikey: key, country, language: "en" });
    if (topic) params.set("q", topic);
    try {
      const data = await fetchJson(`https://newsdata.io/api/1/latest?${params.toString()}`);
      const articles = (data.results || []).slice(0, 5).map((a: any) => ({
        title: a.title,
        source: a.source_id,
        link: a.link,
        pubDate: a.pubDate,
      }));
      return { success: true, count: articles.length, articles };
    } catch (e: any) {
      return { success: false, message: `News fetch fail hui: ${e?.message || e}` };
    }
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

  // 34. Maps/directions — OpenRouteService
  public async getDirections(fromPlace: string, toPlace: string): Promise<any> {
    const key = process.env.OPENROUTESERVICE_API_KEY;
    if (!key) return { success: false, message: "OPENROUTESERVICE_API_KEY .env me set nahi hai." };

    const geocode = async (place: string) => {
      const data = await fetchJson(
        `https://api.openrouteservice.org/geocode/search?api_key=${key}&text=${encodeURIComponent(place)}&size=1`
      );
      const coords = data?.features?.[0]?.geometry?.coordinates;
      return coords ? { lon: coords[0], lat: coords[1] } : null;
    };

    try {
      const [from, to] = await Promise.all([geocode(fromPlace), geocode(toPlace)]);
      if (!from) return { success: false, message: `"${fromPlace}" location nahi mili.` };
      if (!to) return { success: false, message: `"${toPlace}" location nahi mili.` };

      const routeRes = await fetch(
        `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${key}&start=${from.lon},${from.lat}&end=${to.lon},${to.lat}`
      );
      const routeData = await routeRes.json();
      const summary = routeData?.features?.[0]?.properties?.summary;
      if (!summary) return { success: false, message: "Route calculate nahi ho paya." };

      return {
        success: true,
        from: fromPlace,
        to: toPlace,
        distanceKm: (summary.distance / 1000).toFixed(1),
        durationMinutes: (summary.duration / 60).toFixed(0),
      };
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
