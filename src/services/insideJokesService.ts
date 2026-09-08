import { db } from "./firebaseAdmin";

export interface InsideJokeEntry {
  id: string;
  targetPerson: string; // "Boss DK", "Rohit", "All", etc.
  title: string;
  context: string;
  punchline: string;
  timestamp: number;
  dateStr: string;
}

const DEFAULT_INSIDE_JOKES: InsideJokeEntry[] = [
  {
    id: "joke_infinite_chai",
    targetPerson: "Boss DK",
    title: "The Chai Infinite Loop",
    context: "Boss coding marathon sessions powered by nonstop chai",
    punchline: "Boss ka code chai se chalta hai, compiler toh bas formality hai! ☕😂",
    timestamp: Date.now(),
    dateStr: "Core Lore",
  },
  {
    id: "joke_prod_bug_hunt",
    targetPerson: "Boss DK",
    title: "Late Night Bug Hunting",
    context: "Finding tricky edge-case bugs at 2 AM",
    punchline: "Bug chhip ke baitha tha, par DK Boss ke saamne koi bug bach nahi sakta! 🎯",
    timestamp: Date.now(),
    dateStr: "Core Lore",
  },
];

const jokesCol = () => db.collection("memory").doc("insideJokes").collection("entries");

class InsideJokesService {
  private inMemoryJokes: Map<string, InsideJokeEntry> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      for (const joke of DEFAULT_INSIDE_JOKES) {
        this.inMemoryJokes.set(joke.id, joke);
      }

      const snap = await jokesCol().get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const data = doc.data() as InsideJokeEntry;
          this.inMemoryJokes.set(data.id, data);
        }
      }
      this.isInitialized = true;
    } catch {
      this.isInitialized = true;
    }
  }

  /**
   * Records a new inside joke or shared funny memory.
   */
  public async recordInsideJoke(
    targetPerson: string,
    title: string,
    context: string,
    punchline: string
  ): Promise<InsideJokeEntry> {
    await this.initPromise;
    const id = `joke_${Date.now()}`;
    const dateStr = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

    const entry: InsideJokeEntry = {
      id,
      targetPerson,
      title,
      context,
      punchline,
      timestamp: Date.now(),
      dateStr,
    };

    this.inMemoryJokes.set(id, entry);
    try {
      await jokesCol().doc(id).set(entry);
    } catch (e: any) {
      console.warn("[InsideJokesService] Save joke warning:", e?.message || e);
    }

    return entry;
  }

  /**
   * Compiles the inside jokes prompt context.
   */
  public async compileInsideJokesPrompt(targetPerson = "Boss DK"): Promise<string> {
    await this.initPromise;
    const jokes = Array.from(this.inMemoryJokes.values()).slice(0, 5);

    if (jokes.length === 0) return "";

    return `============================================================
😂 SHARED INSIDE JOKES & SECRET LORE WITH BOSS:
${jokes.map((j, i) => `${i + 1}. [${j.title}] Context: ${j.context} -> Punchline/Callback: "${j.punchline}"`).join("\n")}
💡 USAGE: Occasionally drop these shared callbacks when the mood is light, playful, or during celebration to feel like a real long-time best friend!
============================================================`;
  }
}

export const insideJokesService = new InsideJokesService();
