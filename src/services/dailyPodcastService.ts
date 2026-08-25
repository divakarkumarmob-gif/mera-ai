import { publicApisService } from "./publicApisService";

export interface DailyPodcastEpisode {
  success: boolean;
  episodeTitle: string;
  durationEstimate: string;
  storiesCount: number;
  podcastScript: string;
  keyHighlights: string[];
  generatedAt: string;
}

class DailyPodcastService {
  public async generateDailyPodcast(): Promise<DailyPodcastEpisode> {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });

    let newsArticles: any[] = [];
    try {
      const techNews = await publicApisService.getTechNews();
      if (techNews.success && Array.isArray(techNews.articles) && techNews.articles.length > 0) {
        newsArticles = techNews.articles.slice(0, 3);
      }
    } catch {}

    if (newsArticles.length === 0) {
      newsArticles = [
        {
          title: "AI Autonomous Agents reshape engineering workflows worldwide",
          description: "New multi-agent frameworks are automating full-stack code repairs and real-time operations.",
        },
        {
          title: "Semiconductor and local hardware manufacturing accelerates in India",
          description: "Major investments boost domestic chip fabrication and high-performance computing labs.",
        },
        {
          title: "Open-source multimodal models match proprietary performance benchmarks",
          description: "Lightweight on-device AI enables fast real-time voice and vision on edge devices.",
        },
      ];
    }

    const highlights = newsArticles.map((a) => a.title);

    let script = `🎙️ [Intro Music Beat / Jingle] \n`;
    script += `Hello and welcome to Friday Tech Drop! Main hu aapki AI host Friday, aur aaj hai ${dateStr}. Chaliye shuru karte hain aaj ke 3 sabse bade game-changing tech updates!\n\n`;

    newsArticles.forEach((article, idx) => {
      script += `🔥 Story #${idx + 1}: ${article.title}\n`;
      script += `${article.description || "Is development se tech industry me naye tools aur faster development cycles dekhne ko mil rahe hain."}\n\n`;
    });

    script += `✨ Friday's Take: "Technology me har din naye doors open ho rahe hain. The best way to predict the future is to build it!"\n\n`;
    script += `🎙️ Ye tha aaj ka 2-minute Tech Podcast. Stay sharp, stay innovative, and have an amazing day Boss! [Outro Jingle]`;

    return {
      success: true,
      episodeTitle: `Friday Tech Drop — ${dateStr}`,
      durationEstimate: "~2 Minutes",
      storiesCount: newsArticles.length,
      podcastScript: script,
      keyHighlights: highlights,
      generatedAt: now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
    };
  }
}

export const dailyPodcastService = new DailyPodcastService();
