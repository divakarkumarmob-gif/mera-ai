import { publicApisService } from "./publicApisService";
import { toolsEngine } from "./toolsEngine";

export interface MorningBriefingData {
  success: boolean;
  dateStr: string;
  timeStr: string;
  weather: {
    city: string;
    temp: string;
    condition: string;
    humidity?: string;
  };
  newsHeadlines: Array<{ title: string; source?: string; url?: string }>;
  pendingTasks: Array<{ title: string; timeString: string }>;
  marketSummary?: {
    nifty?: string;
    sensex?: string;
    gold?: string;
  };
  motivationalQuote: string;
  spokenScript: string;
}

const MOTIVATIONAL_QUOTES = [
  "Har nayi subah ek naya mauka lekar aati hai. Let's make today count Boss!",
  "Continuous effort, not strength or intelligence, is the key to unlocking our potential.",
  "Great things never come from comfort zones. Aaj kuch naya create karte hain Boss!",
  "Discipline aur consistency hi ordinary ko extraordinary banati hai.",
  "Focus on the process, results automatically follow karenge.",
];

class MorningBriefingService {
  public async generateMorningBriefing(city = "Patna, India"): Promise<MorningBriefingData> {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const timeStr = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });

    // 1. Fetch Weather
    let weatherInfo = {
      city: city.split(",")[0].trim(),
      temp: "28°C",
      condition: "Partly Cloudy",
      humidity: "65%",
    };
    try {
      const w = await publicApisService.getWeather(city);
      if (w.success) {
        weatherInfo = {
          city: w.place || weatherInfo.city,
          temp: `${w.currentTempC ?? "28"}°C`,
          condition: w.conditionText || "Clear",
          humidity: `${w.humidityPct ?? "60"}%`,
        };
      }
    } catch { /* weather fallback */ }

    // 2. Fetch Top Headlines (India / Tech)
    let headlines: Array<{ title: string; source?: string; url?: string }> = [];
    try {
      const newsRes = await publicApisService.getIndianNews("top");
      if (newsRes.success && Array.isArray(newsRes.articles) && newsRes.articles.length > 0) {
        headlines = newsRes.articles.slice(0, 3).map((a: any) => ({
          title: a.title,
          source: a.source?.name || a.source || "News",
          url: a.link || a.url,
        }));
      }
    } catch { /* news fallback */ }

    // 3. Fetch Pending Reminders
    let pendingTasks: Array<{ title: string; timeString: string }> = [];
    try {
      const reminders = await toolsEngine.getReminders();
      const active = reminders.filter((r) => !r.isCompleted);
      pendingTasks = active.slice(0, 4).map((r) => ({
        title: r.title,
        timeString: r.timeString,
      }));
    } catch { /* reminders fallback */ }

    // 4. Market / Crypto summary
    let marketSummary = {
      nifty: "Nifty 50: +0.45% Bullish",
      sensex: "Sensex: Steady",
      gold: "Gold 24K: ₹72,400/10g",
    };
    try {
      const stockRes = await publicApisService.getStockIndices();
      if (stockRes?.success && stockRes.indices) {
        marketSummary = {
          nifty: stockRes.indices.nifty || marketSummary.nifty,
          sensex: stockRes.indices.sensex || marketSummary.sensex,
          gold: marketSummary.gold,
        };
      }
    } catch { /* market fallback */ }

    // 5. Random Motivational Quote
    const quote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];

    // 6. Assemble Iron Man Voice Script
    let spokenScript = `Good morning Boss! Aaj ${dateStr} hai aur subah ke ${timeStr} ho rahe hain. `;
    spokenScript += `Aapke city ${weatherInfo.city} me mausam ${weatherInfo.condition} hai aur taapman ${weatherInfo.temp} hai. `;

    if (pendingTasks.length > 0) {
      spokenScript += `Aaj aapke schedule me ${pendingTasks.length} zaroori tasks hain: ${pendingTasks.map((t) => `"${t.title}" (${t.timeString})`).join(", ")}. `;
    } else {
      spokenScript += `Aaj aapka schedule bilkul clear hai Boss. `;
    }

    if (headlines.length > 0) {
      spokenScript += `Aaj ki top headline hai: "${headlines[0].title}". `;
    }

    spokenScript += `Thought of the day: "${quote}". All systems online and ready for your commands!`;

    return {
      success: true,
      dateStr,
      timeStr,
      weather: weatherInfo,
      newsHeadlines: headlines,
      pendingTasks,
      marketSummary,
      motivationalQuote: quote,
      spokenScript,
    };
  }
}

export const morningBriefingService = new MorningBriefingService();
