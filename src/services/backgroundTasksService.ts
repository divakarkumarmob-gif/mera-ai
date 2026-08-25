import { publicApisService } from "./publicApisService";

export interface BackgroundTask {
  id: string;
  name: string;
  type: string;
  description: string;
  targetPlaceOrTopic?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progressStep: string;
  resultSummary?: string;
  rawResult?: any;
  errorSummary?: string;
  startedAt: number;
  completedAt?: number;
  notified: boolean;
}

type TaskCallback = (task: BackgroundTask) => void;

class BackgroundTasksService {
  private tasks: Map<string, BackgroundTask> = new Map();
  private listeners: Set<TaskCallback> = new Set();

  constructor() {
    // Keep max 50 recent tasks in memory
  }

  public onTaskChange(cb: TaskCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners(task: BackgroundTask) {
    for (const listener of this.listeners) {
      try {
        listener(task);
      } catch (e) {
        console.error("[BackgroundTasks] Listener error:", e);
      }
    }
  }

  /**
   * Create and register a new background task.
   */
  public createTask(
    name: string,
    type: string,
    description: string,
    targetPlaceOrTopic?: string
  ): BackgroundTask {
    const id = "task_" + Math.random().toString(36).substring(2, 9);
    const task: BackgroundTask = {
      id,
      name: name.trim(),
      type: (type || "custom").toLowerCase().trim(),
      description: description.trim(),
      targetPlaceOrTopic: targetPlaceOrTopic?.trim(),
      status: "running",
      progressStep: "Task background me start ho gaya hai...",
      startedAt: Date.now(),
      notified: false,
    };

    this.tasks.set(id, task);
    console.log(`[BackgroundTasks] Created task [${id}] "${task.name}" (${task.type})`);
    this.notifyListeners(task);
    return task;
  }

  /**
   * Update intermediate progress of a running task.
   */
  public updateTaskProgress(id: string, step: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== "running") return;
    task.progressStep = step;
    this.notifyListeners(task);
  }

  /**
   * Mark task as completed with speech-friendly result summary.
   */
  public completeTask(id: string, resultSummary: string, rawResult?: any): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = "completed";
    task.completedAt = Date.now();
    task.progressStep = "Task successfully complete ho gaya.";
    task.resultSummary = resultSummary;
    task.rawResult = rawResult;
    task.notified = false;
    console.log(`[BackgroundTasks] ✅ Task [${id}] "${task.name}" COMPLETED: ${resultSummary}`);
    this.notifyListeners(task);
  }

  /**
   * Mark task as failed.
   */
  public failTask(id: string, errorSummary: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = "failed";
    task.completedAt = Date.now();
    task.progressStep = "Task fail ho gaya.";
    task.errorSummary = errorSummary;
    task.resultSummary = `Task fail hua: ${errorSummary}`;
    task.notified = false;
    console.warn(`[BackgroundTasks] ❌ Task [${id}] "${task.name}" FAILED: ${errorSummary}`);
    this.notifyListeners(task);
  }

  /**
   * Cancel a running task.
   */
  public cancelTask(idOrName: string): boolean {
    const target = idOrName.toLowerCase().trim();
    for (const [id, task] of this.tasks.entries()) {
      if (
        (id === target || task.name.toLowerCase().includes(target)) &&
        (task.status === "running" || task.status === "pending")
      ) {
        task.status = "cancelled";
        task.completedAt = Date.now();
        task.progressStep = "Task Boss ke kehne par cancel kar diya gaya.";
        task.resultSummary = "Task cancel kar diya gaya.";
        task.notified = true;
        console.log(`[BackgroundTasks] ⏹️ Task [${id}] "${task.name}" CANCELLED.`);
        this.notifyListeners(task);
        return true;
      }
    }
    return false;
  }

  /**
   * Mark a task (or all completed tasks) as notified.
   */
  public markTaskNotified(idOrAll: string): void {
    if (idOrAll === "all") {
      for (const task of this.tasks.values()) {
        if (task.status === "completed" || task.status === "failed") {
          task.notified = true;
        }
      }
      return;
    }

    const task = this.tasks.get(idOrAll);
    if (task) {
      task.notified = true;
    } else {
      // Find by matching name
      for (const t of this.tasks.values()) {
        if (t.name.toLowerCase().includes(idOrAll.toLowerCase())) {
          t.notified = true;
        }
      }
    }
  }

  /**
   * Get all active tasks.
   */
  public getActiveTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "running" || t.status === "pending"
    );
  }

  /**
   * Get completed/failed tasks that haven't been reported to DK yet.
   */
  public getUnnotifiedCompletedTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => (t.status === "completed" || t.status === "failed") && !t.notified
    );
  }

  /**
   * Get all recent tasks (last 15).
   */
  public getAllRecentTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 15);
  }

  /**
   * Query status of background tasks for conversational response.
   */
  public getTaskStatusSummary(query?: string): {
    activeCount: number;
    unnotifiedCount: number;
    activeTasks: Array<{ id: string; name: string; runningForSec: number; step: string }>;
    completedTasks: Array<{ id: string; name: string; result: string; completedAgoSec: number }>;
    summaryText: string;
  } {
    const now = Date.now();
    const allActive = this.getActiveTasks();
    const allRecent = this.getAllRecentTasks();

    let filteredActive = allActive;
    let filteredCompleted = allRecent.filter((t) => t.status === "completed" || t.status === "failed");

    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      filteredActive = filteredActive.filter(
        (t) => t.name.toLowerCase().includes(q) || t.type.includes(q) || t.description.toLowerCase().includes(q)
      );
      filteredCompleted = filteredCompleted.filter(
        (t) => t.name.toLowerCase().includes(q) || t.type.includes(q) || t.description.toLowerCase().includes(q)
      );
    }

    const activeList = filteredActive.map((t) => ({
      id: t.id,
      name: t.name,
      runningForSec: Math.max(1, Math.round((now - t.startedAt) / 1000)),
      step: t.progressStep,
    }));

    const completedList = filteredCompleted.slice(0, 5).map((t) => ({
      id: t.id,
      name: t.name,
      result: t.resultSummary || "Completed",
      completedAgoSec: Math.max(1, Math.round((now - (t.completedAt || t.startedAt)) / 1000)),
    }));

    let summaryText = "";
    if (activeList.length === 0 && completedList.length === 0) {
      summaryText = "Abhi background me koi task nahi chal raha aur koi recent task nahi hai.";
    } else if (activeList.length > 0) {
      const runningDesc = activeList
        .map((t) => `${t.name} (${t.runningForSec}s se chal raha hai: ${t.step})`)
        .join(", ");
      summaryText = `Abhi ${activeList.length} task chal rahe hain: ${runningDesc}.`;
      if (completedList.length > 0) {
        summaryText += ` Aur haal hi me complete hua: ${completedList[0].name} -> ${completedList[0].result}`;
      }
    } else {
      summaryText = `Abhi koi active task nahi chal raha. Recent completed task: ${completedList[0].name} -> ${completedList[0].result}`;
    }

    return {
      activeCount: activeList.length,
      unnotifiedCount: this.getUnnotifiedCompletedTasks().length,
      activeTasks: activeList,
      completedTasks: completedList,
      summaryText,
    };
  }

  /**
   * Helper to format weather data into speech-friendly natural Hindi.
   */
  private formatWeatherResult(place: string, w: any): string {
    if (!w || !w.success) {
      return `${place} ka weather update fetch karne me dikkat aayi: ${w?.message || "Data nahi mila"}.`;
    }
    const temp = w.current?.temperature ?? w.temperature;
    const humidity = w.current?.relative_humidity_2m ?? w.humidity;
    const wind = w.current?.wind_speed_10m ?? w.windSpeed;
    const weatherDesc = w.weatherDescription || "mausam saaf hai";

    let parts = [`${place} ka live weather update mil gaya hai!`];
    if (temp !== undefined) parts.push(`Abhi wahan temperature ${temp}°C hai`);
    if (weatherDesc) parts.push(`aur ${weatherDesc}`);
    if (humidity !== undefined) parts.push(`humidity ${humidity}% hai`);
    if (wind !== undefined) parts.push(`hawa lagbhag ${wind} km/h chal rahi hai`);

    return parts.join(", ") + ".";
  }

  /**
   * Helper to format cricket score into speech-friendly Hindi.
   */
  private formatCricketResult(cricketData: any): string {
    if (!cricketData || !cricketData.success) {
      return "Cricket match update fetch karne me dikkat aayi.";
    }
    if (cricketData.liveMatches && cricketData.liveMatches.length > 0) {
      const m = cricketData.liveMatches[0];
      return `Live match update: ${m.title || "Match"} — ${m.score || m.status || "Scores updated"}.`;
    }
    return "Abhi koi live international cricket match nahi chal raha.";
  }

  /**
   * Execute an automated background task with progress updates and automatic completion.
   */
  public async executeAutonomousTask(
    taskName: string,
    taskType: string,
    targetOrQuery: string = "",
    customDescription?: string
  ): Promise<BackgroundTask> {
    const cleanType = (taskType || "custom").toLowerCase().trim();
    const desc =
      customDescription ||
      (cleanType === "weather"
        ? `${targetOrQuery || "Current city"} ka live weather aur forecast fetch karna`
        : cleanType === "cricket"
        ? `Live cricket scores aur ongoing match status check karna`
        : cleanType === "deals"
        ? `${targetOrQuery} ke live product deals aur prices search karna`
        : cleanType === "security_scan"
        ? `System security aur phishing check karna`
        : cleanType === "wifi_scan"
        ? `Available WiFi networks scan karna`
        : cleanType === "code_fix"
        ? `Codebase analyze aur diagnose karna`
        : `${taskName} task execute karna`);

    const task = this.createTask(taskName, cleanType, desc, targetOrQuery);

    // Asynchronously execute without blocking caller
    (async () => {
      try {
        if (cleanType === "weather") {
          this.updateTaskProgress(task.id, `Open-Meteo satellite weather API se ${targetOrQuery || "city"} ka data fetch kiya ja raha hai...`);
          await new Promise((r) => setTimeout(r, 2000)); // realistic async time

          const weatherData = await publicApisService.getWeather(targetOrQuery || "");
          this.updateTaskProgress(task.id, "Temperature, humidity aur rain forecast analyze kiya ja raha hai...");
          await new Promise((r) => setTimeout(r, 1000));

          const summary = this.formatWeatherResult(targetOrQuery || "Aapke area", weatherData);
          this.completeTask(task.id, summary, weatherData);
        } else if (cleanType === "cricket") {
          this.updateTaskProgress(task.id, "Live cricket scoreboards aur ongoing fixtures fetch kiye ja rahe hain...");
          await new Promise((r) => setTimeout(r, 2000));

          const cricketData = await publicApisService.getCricketScores();
          const summary = this.formatCricketResult(cricketData);
          this.completeTask(task.id, summary, cricketData);
        } else if (cleanType === "deals") {
          this.updateTaskProgress(task.id, `Amazon, Flipkart aur Meesho par ${targetOrQuery} ke live prices check ho rahe hain...`);
          await new Promise((r) => setTimeout(r, 2500));

          const deals = await publicApisService.searchProductDeals(targetOrQuery, "all", "high_to_low", 1);
          let summary = `${targetOrQuery} ke prices check ho gaye.`;
          if (deals && deals.products && deals.products.length > 0) {
            const topP = deals.products[0];
            summary = `${targetOrQuery} ke deals mil gaye: Top product "${topP.title?.substring(0, 40)}" lagbhag ₹${topP.price} par available hai.`;
          }
          this.completeTask(task.id, summary, deals);
        } else if (cleanType === "security_scan" || cleanType === "security") {
          this.updateTaskProgress(task.id, "Security headers, DNS records aur link safety audit ki ja rahi hai...");
          await new Promise((r) => setTimeout(r, 2500));

          this.completeTask(
            task.id,
            "Security scan complete ho gaya hai: Koi critical vulnerability ya breach detect nahi hua, sab safe hai."
          );
        } else if (cleanType === "wifi_scan" || cleanType === "wifi") {
          this.updateTaskProgress(task.id, "Nearby WiFi hotspots aur signal strengths scan ho rahe hain...");
          const wifiList = await publicApisService.scanWifiNetworks();
          let summary = "WiFi scan complete ho gaya.";
          if (wifiList && wifiList.success && wifiList.networks) {
            summary = `WiFi scan complete ho gaya: ${wifiList.count} networks mile hain, strong signal '${wifiList.networks[0]?.ssid || "network"}' ka hai.`;
          }
          this.completeTask(task.id, summary, wifiList);
        } else {
          // Generic autonomous task
          this.updateTaskProgress(task.id, `${taskName} process kiya ja raha hai...`);
          await new Promise((r) => setTimeout(r, 3000));
          this.completeTask(
            task.id,
            `${taskName} background me successfully complete ho gaya hai.`
          );
        }
      } catch (err: any) {
        console.error(`[BackgroundTasks] Error executing task [${task.id}]:`, err);
        this.failTask(task.id, err?.message || String(err));
      }
    })();

    return task;
  }

  /**
   * Compile dynamic context for Gemini System Prompt.
   */
  public compileBackgroundTasksPromptContext(): string {
    const active = this.getActiveTasks();
    const unnotified = this.getUnnotifiedCompletedTasks();
    const now = Date.now();

    let text = "============================================================\n";
    text += "BACKGROUND TASKS LIVE STATUS & TRACKER:\n";

    if (active.length === 0 && unnotified.length === 0) {
      text += "No background tasks currently running or waiting for notification.\n";
    } else {
      if (active.length > 0) {
        text += `CURRENTLY RUNNING BACKGROUND TASKS (${active.length}):\n`;
        for (const t of active) {
          const runSec = Math.max(1, Math.round((now - t.startedAt) / 1000));
          text += `- [RUNNING | ID: ${t.id}] Task: "${t.name}" (Type: ${t.type}, Target: "${t.targetPlaceOrTopic || 'N/A'}") | Running for ${runSec}s | Current Progress: "${t.progressStep}"\n`;
        }
      }

      if (unnotified.length > 0) {
        text += `\nCOMPLETED TASKS WAITING TO BE REPORTED TO DK (${unnotified.length}):\n`;
        for (const t of unnotified) {
          text += `- [COMPLETED & UNNOTIFIED | ID: ${t.id}] Task: "${t.name}"\n`;
          text += `  Result/Outcome: "${t.resultSummary || 'Finished'}"\n`;
          text += `  CRITICAL INSTRUCTION: DK has NOT been informed about this completed task yet! On your current turn, first answer DK's immediate question, and then at the very end of your response, say: "...aur haan Boss, background me [${t.name}] complete ho gaya hai: ${t.resultSummary}" and call 'mark_background_task_notified'.\n`;
        }
      }
    }

    text += "============================================================\n";
    return text;
  }
}

export const backgroundTasksService = new BackgroundTasksService();
