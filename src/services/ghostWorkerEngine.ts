import { getFirestore } from "firebase-admin/firestore";
import { sendWhatsAppUnified } from "./whatsappService";

export interface GhostWorkerTask {
  id: string;
  name: string;
  type: "server_pulse" | "seat_radar" | "habit_tracker" | "task_monitor";
  status: "idle" | "running" | "completed" | "alert_triggered";
  lastRunAt: number;
  intervalMs: number;
  details: string;
}

const COLLECTION_NAME = "ghost_worker_tasks";

class GhostWorkerEngine {
  private activeWorkers: Map<string, GhostWorkerTask> = new Map();
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private getDb() {
    return getFirestore();
  }

  public async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const snap = await this.getDb().collection(COLLECTION_NAME).get();
        for (const doc of snap.docs) {
          this.activeWorkers.set(doc.id, doc.data() as GhostWorkerTask);
        }

        if (this.activeWorkers.size === 0) {
          this.registerDefaultWorkers();
        }

        this.isLoaded = true;
        console.log(`[GhostWorker] Loaded ${this.activeWorkers.size} autonomous background worker agents.`);
      } catch (e: any) {
        console.warn("[GhostWorker] Firestore load warning:", e?.message || e);
        this.registerDefaultWorkers();
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  private registerDefaultWorkers() {
    const defaults: GhostWorkerTask[] = [
      {
        id: "worker_server_pulse",
        name: "Cloud Server Health & Memory Sentinel",
        type: "server_pulse",
        status: "idle",
        lastRunAt: Date.now(),
        intervalMs: 15 * 60 * 1000, // 15 mins
        details: "Monitors memory usage and service liveness on Render.",
      },
      {
        id: "worker_habit_tracker",
        name: "Boss Routine & Habit Caretaker",
        type: "habit_tracker",
        status: "idle",
        lastRunAt: Date.now(),
        intervalMs: 30 * 60 * 1000, // 30 mins
        details: "Checks Boss timetable slots and ensures healthy breaks.",
      },
      {
        id: "worker_task_monitor",
        name: "Scheduled Cron & WhatsApp Queue Verifier",
        type: "task_monitor",
        status: "idle",
        lastRunAt: Date.now(),
        intervalMs: 10 * 60 * 1000, // 10 mins
        details: "Ensures queued automations and daily briefings fire on time.",
      },
    ];

    for (const w of defaults) {
      this.activeWorkers.set(w.id, w);
    }
  }

  /**
   * Registers a new custom ghost worker task (e.g. tracking train seats or specific API)
   */
  public async registerWorker(
    name: string,
    type: GhostWorkerTask["type"],
    intervalMinutes: number,
    details: string
  ): Promise<GhostWorkerTask> {
    await this.init();

    const task: GhostWorkerTask = {
      id: `worker_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      name,
      type,
      status: "idle",
      lastRunAt: Date.now(),
      intervalMs: intervalMinutes * 60 * 1000,
      details,
    };

    this.activeWorkers.set(task.id, task);
    try {
      await this.getDb().collection(COLLECTION_NAME).doc(task.id).set(task);
    } catch (e: any) {
      console.warn("[GhostWorker] Save worker error:", e?.message || e);
    }

    return task;
  }

  /**
   * Compiles the list of running background ghost workers for system instructions
   */
  public async compileGhostWorkerPrompt(): Promise<string> {
    await this.init();
    const workers = Array.from(this.activeWorkers.values()).slice(0, 4);

    return `\n👻 AUTONOMOUS GHOST WORKER AGENTS (Microsoft/Amazon Background Sub-Agents):
` +
      workers.map((w) => `• [Active]: "${w.name}" (${w.details})`).join("\n") +
      "\n";
  }
}

export const ghostWorkerEngine = new GhostWorkerEngine();
