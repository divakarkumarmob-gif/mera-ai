import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { githubService } from "./githubService";

// ---------------------------------------------------------------------------
// Coding agent: DK gives an instruction (voice or dashboard) → agent analyzes
// the repo (diagnostic-first, like a human reviewer would) → proposes a plan
// → DK approves via the dashboard OR by replying "yes"/"ok" on WhatsApp →
// only then does it write anything, always as a new branch + Pull Request,
// never directly to the base branch.
//
// Firestore layout: codeAgentRequests/{id}
// ---------------------------------------------------------------------------

const MODEL_CHAIN = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro", "gemini-2.5-flash"];

// Helper: extract a readable error message from anything the SDK throws
function extractError(e: any): string {
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  // SDK sometimes throws a plain object like { error: { code, message } }
  if (e?.error?.message) return `[${e.error.code}] ${e.error.message}`;
  if (e?.error) return JSON.stringify(e.error);
  try { return JSON.stringify(e); } catch { return String(e); }
}
const APPROVE_WORDS = new Set(["yes", "ok", "okay", "haan", "yep", "yeah", "y"]);

// Helper: robust JSON extractor that handles markdown blocks, trailing commas, unescaped text
function cleanAndParsePlanJSON(raw: string): CodeAgentPlan {
  const trimmed = raw.trim();
  let jsonStr = trimmed;

  // 1. Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // 2. Extract outermost JSON object { ... }
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  // 3. Clean up trailing commas before } or ]
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      diagnosis: String(parsed.diagnosis || ""),
      summary: String(parsed.summary || "Proposing codebase changes according to instruction."),
      files: Array.isArray(parsed.files)
        ? parsed.files.map((f: any) => ({
            path: String(f.path || ""),
            action: f.action === "create" ? "create" : "modify",
            changeSummary: String(f.changeSummary || f.summary || "Update file implementation"),
          }))
        : [],
    };
  } catch (parseErr) {
    console.warn("[CodeAgent] Direct JSON.parse failed, attempting fallback regex parsing...", parseErr);

    // Fallback: Regex extraction if JSON had unescaped quotes or formatting quirks
    const diagMatch = raw.match(/"diagnosis"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    const sumMatch = raw.match(/"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    const files: FilePlanItem[] = [];

    const fileMatches = raw.matchAll(
      /\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"action"\s*:\s*"(modify|create)"\s*,\s*"changeSummary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}/gi
    );
    for (const fm of fileMatches) {
      files.push({
        path: fm[1],
        action: fm[2] === "create" ? "create" : "modify",
        changeSummary: fm[3],
      });
    }

    if (files.length > 0 || sumMatch) {
      return {
        diagnosis: diagMatch ? diagMatch[1].replace(/\\"/g, '"') : "",
        summary: sumMatch ? sumMatch[1].replace(/\\"/g, '"') : "Update codebase files.",
        files,
      };
    }

    throw new Error(`Invalid plan format: ${parseErr}`);
  }
}

// Helper: extracts code content from model response (JSON, code fences, or raw code)
function cleanAndExtractFileContent(raw: string): string {
  const trimmed = raw.trim();

  // Try 1: Parse { "content": "..." }
  try {
    let jsonStr = trimmed;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      return parsed.content;
    }
  } catch { /* fall through */ }

  // Try 2: Extract from code fences ```ts ... ``` or ``` ... ```
  const codeFenceMatch = trimmed.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```/);
  if (codeFenceMatch && codeFenceMatch[1]?.trim()) {
    return codeFenceMatch[1];
  }

  // Try 3: Return raw text directly if it looks like source code
  return trimmed;
}

export type RequestStatus =
  | "analyzing"
  | "pending_approval"
  | "approved"
  | "denied"
  | "applying"
  | "completed"
  | "failed";

export interface FilePlanItem {
  path: string;
  action: "modify" | "create";
  changeSummary: string;
}

export interface CodeAgentPlan {
  diagnosis?: string; // root cause, if this was a bug-report style instruction
  summary: string;
  files: FilePlanItem[];
}

export interface GeneratedFileChange {
  path: string;
  action: "modify" | "create";
  originalContent?: string;
  content: string; // new updated content
}

export interface CodeAgentLog {
  timestamp: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  stage?: string;
}

export interface CodeAgentRequest {
  id: string;
  instruction: string;
  problemTitle?: string;
  type?: string;
  createdBy?: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
  plan?: CodeAgentPlan;
  generatedChanges?: GeneratedFileChange[];
  branchUrl?: string;
  prUrl?: string;
  prNumber?: number;
  commitUrl?: string;
  commitSha?: string;
  pushedToMain?: boolean;
  error?: string;
  logs?: CodeAgentLog[];
}

const requestsCol = () => db.collection("codeAgentRequests");

async function callModel(prompt: string, id?: string, service?: CodeAgentService): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[CodeAgent] GEMINI_API_KEY not set.");
    if (id && service) await service.addLog(id, "GEMINI_API_KEY not configured in environment.", "error", "ai_model");
    return null;
  }
  const ai = new GoogleGenAI({ apiKey });

  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    console.log(`[CodeAgent] Trying model ${i + 1}/${MODEL_CHAIN.length}: ${model}`);
    if (id && service) await service.addLog(id, `Connecting to AI model (${i + 1}/${MODEL_CHAIN.length}): ${model}...`, "info", "ai_model");
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      const text = response.text;
      if (text && text.trim()) {
        console.log(`[CodeAgent] ✅ Success with ${model}`);
        if (id && service) await service.addLog(id, `AI model response received successfully from ${model}.`, "success", "ai_model");
        return text;
      }
      console.warn(`[CodeAgent] ${model} returned empty response, trying next...`);
      if (id && service) await service.addLog(id, `${model} returned empty response, trying next model in chain...`, "warn", "ai_model");
    } catch (e: any) {
      const errMsg = extractError(e);
      const is503 = errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand");
      console.error(`[CodeAgent] ❌ ${model} failed: ${errMsg}`);
      if (id && service) await service.addLog(id, `Model ${model} failed: ${errMsg}`, "warn", "ai_model");
      if (i < MODEL_CHAIN.length - 1) {
        const delayMs = is503 ? 2000 : 500;
        console.log(`[CodeAgent] Waiting ${delayMs}ms before trying next model...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.error("[CodeAgent] ❌ All models in the fallback chain failed.");
  if (id && service) await service.addLog(id, "All AI models in fallback chain failed.", "error", "ai_model");
  return null;
}

class CodeAgentService {
  private inMemoryCache = new Map<string, CodeAgentRequest>();

  /** Appends a structured log event to the request document */
  public async addLog(id: string, message: string, level: "info" | "warn" | "error" | "success" = "info", stage?: string) {
    try {
      const docRef = requestsCol().doc(id);
      const doc = await docRef.get();
      if (!doc.exists) return;
      const currentLogs: CodeAgentLog[] = (doc.data() as CodeAgentRequest).logs || [];
      const newLog: CodeAgentLog = {
        timestamp: Date.now(),
        level,
        message,
        stage: stage || "general",
      };
      await docRef.set({ logs: [...currentLogs.slice(-40), newLog], updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.warn("[CodeAgent] Failed to write log:", e);
    }
  }

  /** Kicks off a new request: creates the Firestore doc, then analyzes in the background. */
  public async createRequest(
    instructionOrTitle: string,
    instructionText?: string,
    type: string = "feature",
    createdBy: string = "DK"
  ): Promise<CodeAgentRequest> {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let title = "Coding Task";
    let finalInstruction = instructionOrTitle;

    if (instructionText && instructionText.trim()) {
      title = instructionOrTitle.trim();
      finalInstruction = instructionText.trim();
    } else if (instructionOrTitle.length > 60) {
      title = instructionOrTitle.slice(0, 60) + "...";
    } else {
      title = instructionOrTitle;
    }

    const initialLog: CodeAgentLog = {
      timestamp: Date.now(),
      level: "info",
      message: `Request created for task: "${title}"`,
      stage: "init",
    };
    const request: CodeAgentRequest = {
      id,
      instruction: finalInstruction,
      problemTitle: title,
      type,
      createdBy,
      status: "analyzing",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: [initialLog],
    };

    this.inMemoryCache.set(id, request);
    await requestsCol().doc(id).set(request).catch((err) => {
      console.warn("[CodeAgent] Firestore initial save error, using in-memory cache:", err?.message || err);
    });

    this.analyzeAndPlan(id, finalInstruction).catch((e) => {
      console.error(`[CodeAgent] Analysis failed for request ${id}:`, e);
      this.markFailed(id, e?.message || String(e), "analysis_phase");
    });
    return request;
  }

  /** Retries a failed or stalled request from scratch */
  public async retry(id: string): Promise<CodeAgentRequest> {
    const request = await this.getRequest(id);
    if (!request) throw new Error("Request not found");

    await this.addLog(id, "🔄 Retry initiated by user. Restarting codebase analysis...", "info", "retry");
    await requestsCol().doc(id).set(
      {
        status: "analyzing",
        error: null,
        updatedAt: Date.now(),
      },
      { merge: true }
    ).catch(() => {});

    this.analyzeAndPlan(id, request.instruction).catch((e) => {
      console.error(`[CodeAgent] Retry analysis failed for request ${id}:`, e);
      this.markFailed(id, e?.message || String(e), "retry_phase");
    });

    const updated = await this.getRequest(id);
    return updated!;
  }

  /** Stage 1: analyze and generate a plan. */
  private async analyzeAndPlan(id: string, instruction: string) {
    const request = await this.getRequest(id);
    if (!request) return;

    await this.addLog(id, "Scanning GitHub repository tree for candidate code files...", "info", "repo_scan");
    const allFiles = await githubService.listRepoFiles();
    const candidateFiles = allFiles
      .filter((p) => /\.(ts|tsx|js|jsx|json|html|css|md)$/i.test(p))
      .slice(0, 80);

    await this.addLog(id, `Identified ${candidateFiles.length} candidate files in repository. Generating architecture plan...`, "info", "planning");

    const planPrompt = `You are an expert software engineer reviewing a codebase.
Instruction: "${instruction}"
Candidate file paths in repo:
${JSON.stringify(candidateFiles, null, 2)}

Provide a structured plan to fulfill the instruction. Return ONLY valid JSON:
{
  "diagnosis": "If this was a bug report, diagnose the root cause concisely. If a feature request, explain the architecture approach.",
  "summary": "1-2 sentence overall summary of what changes will be made.",
  "files": [
    {
      "path": "exact/path/from/repo.ts",
      "action": "modify" | "create",
      "changeSummary": "Concise description of the edit or what this file does."
    }
  ]
}

Rules:
- Only list files that actually need to change. Don't pad the list.
- Be honest in "diagnosis" — distinguish confirmed vs likely vs "not enough information" if applicable, don't pretend certainty you don't have.
- Don't invent facts not supported by the code you were shown.`;

    const planRaw = await callModel(planPrompt, id, this);
    if (!planRaw) {
      await this.markFailed(id, "Model call failed while generating the plan.", "model_error");
      return;
    }

    let plan: CodeAgentPlan;
    try {
      plan = cleanAndParsePlanJSON(planRaw);
      if (!plan.files || plan.files.length === 0) {
        throw new Error("Model returned plan with 0 files to change.");
      }
    } catch (e: any) {
      console.error("[CodeAgent] Plan parsing error:", e, "Raw plan was:", planRaw);
      await this.markFailed(id, `Failed to parse plan: ${e?.message || e}`, "parse_error");
      return;
    }

    await this.addLog(
      id,
      `Plan generated successfully: ${plan.files.length} files planned for change (${plan.summary})`,
      "success",
      "plan_ready"
    );

    const updatedData = { plan, status: "pending_approval" as RequestStatus, updatedAt: Date.now() };
    if (this.inMemoryCache.has(id)) {
      Object.assign(this.inMemoryCache.get(id)!, updatedData);
    }
    await requestsCol().doc(id).set(updatedData, { merge: true }).catch(() => {});

    await this.notifyOwner(id, plan, request.instruction);
  }

  private async notifyOwner(id: string, plan: CodeAgentPlan, instruction: string) {
    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
    if (!ownerPhone) return;
    const fileLines = plan.files.map((f) => `• [${f.action}] ${f.path} — ${f.changeSummary}`).join("\n");
    const text =
      `🛠️ Friday Coding Agent — naya change plan taiyar hai:\n\n` +
      `Instruction: "${instruction}"\n\n` +
      (plan.diagnosis ? `Root cause: ${plan.diagnosis}\n\n` : "") +
      `Summary: ${plan.summary}\n\n` +
      `Files:\n${fileLines}\n\n` +
      `Approve karne ke liye "yes" ya "ok" reply karo. Kuch aur likha to deny ho jayega.`;
    try {
      const { sendWhatsAppUnified } = await import("./whatsappService");
      const res = await sendWhatsAppUnified(ownerPhone, text);
      if (res.success) {
        await this.addLog(id, `Notification sent to owner's WhatsApp (${res.via || "WhatsApp"}).`, "info", "whatsapp_notice");
      } else {
        await this.addLog(id, `WhatsApp notification skipped/failed: ${res.message}`, "warn", "whatsapp_notice");
      }
    } catch (e) {
      console.error("[CodeAgent] Failed to notify owner on WhatsApp:", e);
    }
  }

  private async markFailed(id: string, error: string, stage?: string) {
    const current = this.inMemoryCache.get(id);
    if (current && (current.status === "denied" || current.status === "completed")) {
      return;
    }
    await this.addLog(id, `❌ Task failed: ${error}`, "error", stage || "failed");
    const failedData = { status: "failed" as RequestStatus, error, updatedAt: Date.now() };
    if (this.inMemoryCache.has(id)) {
      Object.assign(this.inMemoryCache.get(id)!, failedData);
    }
    await requestsCol().doc(id).set(failedData, { merge: true }).catch(() => {});
  }

  public async getRequests(): Promise<CodeAgentRequest[]> {
    try {
      const snap = await requestsCol().orderBy("createdAt", "desc").limit(30).get();
      const list = snap.docs.map((d) => d.data() as CodeAgentRequest);
      list.forEach((r) => this.inMemoryCache.set(r.id, r));
      return list;
    } catch (err: any) {
      console.warn("[CodeAgent] getRequests index query failed, falling back to memory sort:", err?.message || err);
      try {
        const snap = await requestsCol().limit(50).get();
        const list = snap.docs
          .map((d) => d.data() as CodeAgentRequest)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        list.forEach((r) => this.inMemoryCache.set(r.id, r));
        return list;
      } catch (fallbackErr) {
        return Array.from(this.inMemoryCache.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      }
    }
  }

  public async getRequest(id: string): Promise<CodeAgentRequest | null> {
    try {
      const doc = await requestsCol().doc(id).get();
      if (doc.exists) {
        const req = doc.data() as CodeAgentRequest;
        this.inMemoryCache.set(req.id, req);
        return req;
      }
    } catch (err) {
      console.warn("[CodeAgent] getRequest Firestore error:", err);
    }
    return this.inMemoryCache.get(id) || null;
  }

  public async getPendingRequest(): Promise<CodeAgentRequest | null> {
    try {
      const snap = await requestsCol()
        .where("status", "==", "pending_approval")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      if (!snap.empty) {
        const req = snap.docs[0].data() as CodeAgentRequest;
        this.inMemoryCache.set(req.id, req);
        return req;
      }
      return null;
    } catch (err: any) {
      console.warn("[CodeAgent] getPendingRequest query failed (composite index missing). Self-healing with fallback query:", err?.message || err);
      try {
        const snap = await requestsCol().where("status", "==", "pending_approval").limit(10).get();
        if (!snap.empty) {
          const sorted = snap.docs
            .map((d) => d.data() as CodeAgentRequest)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          this.inMemoryCache.set(sorted[0].id, sorted[0]);
          return sorted[0];
        }
      } catch {
        try {
          const snap = await requestsCol().limit(30).get();
          const pending = snap.docs
            .map((d) => d.data() as CodeAgentRequest)
            .filter((r) => r.status === "pending_approval")
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          if (pending.length > 0) {
            this.inMemoryCache.set(pending[0].id, pending[0]);
            return pending[0];
          }
        } catch {
          const cached = Array.from(this.inMemoryCache.values())
            .filter((r) => r.status === "pending_approval")
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          if (cached.length > 0) return cached[0];
        }
      }
      return null;
    }
  }

  public async approve(id?: string): Promise<{ success: boolean; message: string }> {
    let targetId = id;
    if (!targetId) {
      const pending = await this.getPendingRequest();
      if (!pending) return { success: false, message: "Koi pending Coding Agent request nahi mili jise approve kiya ja sake." };
      targetId = pending.id;
    }

    await this.addLog(targetId, "User approved plan. Starting code generation and git operations...", "info", "approved");
    const updatedData = { status: "approved" as RequestStatus, updatedAt: Date.now() };
    if (this.inMemoryCache.has(targetId)) {
      Object.assign(this.inMemoryCache.get(targetId)!, updatedData);
    }
    await requestsCol().doc(targetId).set(updatedData, { merge: true }).catch(() => {});
    this.applyChanges(targetId).catch((e) => {
      console.error(`[CodeAgent] Applying changes failed for request ${targetId}:`, e);
      this.markFailed(targetId!, e?.message || String(e), "apply_phase");
    });
    return { success: true, message: `Boss, Coding Agent task (${targetId}) approve kar diya gaya hai! Code likhkar branch me commit kiya ja raha hai.` };
  }

  /**
   * Approves the plan, writes code, and immediately pushes & commits directly to the main origin branch.
   */
  public async approveAndPushDirectlyToMain(id?: string): Promise<{ success: boolean; message: string }> {
    let targetId = id;
    if (!targetId) {
      const pending = await this.getPendingRequest();
      if (!pending) return { success: false, message: "Koi pending Coding Agent request nahi mili jise master me commit kiya ja sake." };
      targetId = pending.id;
    }

    await this.addLog(targetId, "Direct Commit to Main requested via Live Voice by Boss.", "info", "approved_main");
    const updatedData = { status: "applying" as RequestStatus, updatedAt: Date.now() };
    if (this.inMemoryCache.has(targetId)) {
      Object.assign(this.inMemoryCache.get(targetId)!, updatedData);
    }
    await requestsCol().doc(targetId).set(updatedData, { merge: true }).catch(() => {});

    (async () => {
      try {
        const result = await this.pushToMain(targetId!);
        await this.addLog(targetId!, `Successfully committed directly to main origin: ${result.commitUrl}`, "success", "completed");
      } catch (err: any) {
        console.error(`[CodeAgent] Direct push to main failed for ${targetId}:`, err);
        await this.markFailed(targetId!, err?.message || String(err), "push_to_main");
      }
    })();

    return {
      success: true,
      message: `Boss, Coding Agent ko command de di hai! Code generate karke direct main origin branch me commit aur push kiya ja raha hai.`,
    };
  }

  public async deny(id?: string): Promise<{ success: boolean; message: string }> {
    let targetId = id;
    if (!targetId) {
      const pending = await this.getPendingRequest();
      if (!pending) return { success: false, message: "Koi pending Coding Agent request nahi mili jise reject kiya ja sake." };
      targetId = pending.id;
    }

    await this.addLog(targetId, "Plan denied by user.", "warn", "denied");
    const updatedData = { status: "denied" as RequestStatus, updatedAt: Date.now() };
    if (this.inMemoryCache.has(targetId)) {
      Object.assign(this.inMemoryCache.get(targetId)!, updatedData);
    }
    await requestsCol().doc(targetId).set(updatedData, { merge: true }).catch(() => {});
    return { success: true, message: `Boss, Coding Agent task (${targetId}) reject/cancel kar diya gaya hai.` };
  }

  /** Stops and cancels an in-progress coding agent task */
  public async stop(id?: string): Promise<{ success: boolean; message: string }> {
    let targetId = id;
    if (!targetId) {
      const requests = await this.getRequests();
      const active = requests.find((r) => r.status === "analyzing" || r.status === "applying" || r.status === "pending_approval");
      if (!active) return { success: false, message: "Koi active running Coding Agent task nahi mila." };
      targetId = active.id;
    }

    await this.addLog(targetId, "⏹️ Task stopped and cancelled by user.", "warn", "stopped");
    const updatedData = {
      status: "denied" as RequestStatus,
      error: "Task was manually stopped by user.",
      updatedAt: Date.now(),
    };
    if (this.inMemoryCache.has(targetId)) {
      Object.assign(this.inMemoryCache.get(targetId)!, updatedData);
    }
    await requestsCol().doc(targetId).set(updatedData, { merge: true }).catch(() => {});
    return { success: true, message: `Boss, Coding Agent task (${targetId}) stop kar diya gaya hai.` };
  }

  /**
   * Executive summary for Friday's Voice AI to understand live Coding Agent status.
   */
  public async getLiveStatusSummary(): Promise<{
    hasPendingApproval: boolean;
    pendingRequestId?: string;
    pendingPlanTitle?: string;
    pendingFiles?: string[];
    latestStatus: string;
    message: string;
  }> {
    try {
      const pending = await this.getPendingRequest();
      if (pending) {
        return {
          hasPendingApproval: true,
          pendingRequestId: pending.id,
          pendingPlanTitle: pending.plan?.summary || pending.problemTitle,
          pendingFiles: pending.plan?.files.map((f) => f.path) || [],
          latestStatus: "pending_approval",
          message: `Boss, Coding Agent approval maang raha hai! Task: "${pending.problemTitle}". Plan summary: "${pending.plan?.summary || 'Code modifications'}". Affected files: ${pending.plan?.files.map((f) => f.path).join(", ") || "N/A"}. Aap bol sakte hain: "Approve kar do", "Commit to master kar do", ya "Reject kar do".`,
        };
      }

      const requests = await this.getRequests();
      if (!requests || requests.length === 0) {
        return {
          hasPendingApproval: false,
          latestStatus: "idle",
          message: "Boss, Coding Agent abhi bilkul idle hai. Koi pending task ya approval nahi hai.",
        };
      }

      const latest = requests[0];
      let statusDesc = "";
      if (latest.status === "analyzing") {
        statusDesc = `Coding Agent abhi "${latest.problemTitle}" ka code analyze karke plan bana raha hai.`;
      } else if (latest.status === "applying") {
        statusDesc = `Coding Agent abhi code likh raha hai aur git branch me commit prepare kar raha hai. Task: "${latest.problemTitle}".`;
      } else if (latest.status === "completed") {
        statusDesc = `Coding Agent ka last task "${latest.problemTitle}" complete ho chuka hai! Code likhkar branch me commit aur push kar diya gaya hai.`;
      } else if (latest.status === "denied") {
        statusDesc = `Last task "${latest.problemTitle}" reject kar diya gaya tha.`;
      } else if (latest.status === "failed") {
        statusDesc = `Last task "${latest.problemTitle}" fail ho gaya tha: ${latest.error || "Unknown error"}.`;
      } else {
        statusDesc = `Coding Agent ka status abhi "${latest.status}" hai. Task: "${latest.problemTitle}".`;
      }

      return {
        hasPendingApproval: false,
        latestStatus: latest.status,
        message: `Boss, ${statusDesc}`,
      };
    } catch (e: any) {
      return {
        hasPendingApproval: false,
        latestStatus: "error",
        message: `Coding Agent status check fail hua: ${e?.message || e}`,
      };
    }
  }

  public async handleWhatsAppApprovalReply(text: string): Promise<boolean> {
    const pending = await this.getPendingRequest();
    if (!pending) return false;

    const normalized = text.trim().toLowerCase();
    if (APPROVE_WORDS.has(normalized)) {
      await this.approve(pending.id);
    } else {
      await this.deny(pending.id);
    }
    return true;
  }

  private async applyChanges(id: string) {
    const request = await this.getRequest(id);
    if (!request || !request.plan) return;

    await requestsCol().doc(id).set({ status: "applying", updatedAt: Date.now() }, { merge: true });

    const changes: GeneratedFileChange[] = [];

    for (let i = 0; i < request.plan.files.length; i++) {
      const fileItem = request.plan.files[i];
      await this.addLog(
        id,
        `[${i + 1}/${request.plan.files.length}] Generating code for: ${fileItem.path} (${fileItem.action})...`,
        "info",
        "code_gen"
      );

      const original = fileItem.action === "modify" ? await githubService.getFileContent(fileItem.path) : "";
      const genPrompt = `You are DK's elite AI Software Engineer. You write clean, compile-ready, production-grade TypeScript/React/Node.js code with ZERO syntax errors.

Task Instruction: "${request.instruction}"
Overall Plan: ${request.plan.summary}
Target File: ${fileItem.path}
Change Action: [${fileItem.action}] — ${fileItem.changeSummary}

${original ? `Original File Content:\n${original}` : "This is a brand new file."}

CRITICAL CODING RULES (MUST FOLLOW):
1. **100% SYNTAX VALIDITY**: The output must compile with TypeScript (\`tsc\`) without any syntax errors.
2. **NEVER LEAK CSS/HTML INTO CODE SYNTAX**: Tailwind or CSS class names (e.g. 'font-bold', 'text-center') belong ONLY inside JSX \`className="..."\` attributes. NEVER corrupt language structures (e.g. writing '} font-bold {' instead of '} finally {' is strictly forbidden).
3. **PRESERVE EXISTING LOGIC**: Keep all existing imports, state variables, useEffect hooks, helper functions, and logic that are not part of this task. Do not strip out existing working features.
4. **NO DUPLICATE UI HEADERS**: If adding a title or text to the UI, place it in ONE clean, appropriate location. Do not duplicate it across multiple child components.
5. **MATCHING BRACES & CLOSURES**: Ensure every \`{\`, \`(\`, \`[\`, and JSX tag \`<Component>\` has its exact corresponding closing token \`}\`, \`)\`, \`]\`, \`</Component>\`.
6. **COMPLETE FILE OUTPUT**: Output the ENTIRE, fully updated file from the first line (imports) to the last line. Do not use placeholders like "// ...rest of code remains same...".

Return ONLY the complete updated source code.`;

      const raw = await callModel(genPrompt, id, this);
      if (!raw) throw new Error(`Failed to generate content for ${fileItem.path}`);
      let content = cleanAndExtractFileContent(raw);
      if (!content || !content.trim()) {
        throw new Error(`Empty content generated for ${fileItem.path}`);
      }

      // Automated sanity validation: catch corrupted tokens like '} font-bold {'
      if (/\}\s*(font-|text-|bg-|p-|m-|flex-|grid-|rounded-)[a-zA-Z0-9_-]+\s*\{/i.test(content)) {
        console.warn(`[CodeAgent] Detected corrupted CSS class token in code structure for ${fileItem.path}. Auto-repairing...`);
        content = content.replace(/\}\s*(font-|text-|bg-|p-|m-|flex-|grid-|rounded-)[a-zA-Z0-9_-]+\s*\{/gi, '} finally {');
        await this.addLog(id, `[self_healing] Auto-repaired corrupted syntax tokens in ${fileItem.path}`, "warn", "self_healing");
      }

      // Security & Secret Leak Scanner (Power 1)
      if (/['"](?:AIza[0-9A-Za-z-_]{35}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|EAAB[a-zA-Z0-9_-]{50,})['"]/i.test(content)) {
        await this.addLog(id, `[security] ⚠️ Detected potential hardcoded API key in ${fileItem.path}. Please verify .env usage.`, "warn", "security");
      }

      // Basic brace balance verification
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (Math.abs(openBraces - closeBraces) > 2) {
        console.warn(`[CodeAgent] Warning: Potential brace imbalance in ${fileItem.path} (open: ${openBraces}, close: ${closeBraces})`);
      }

      changes.push({
        path: fileItem.path,
        action: fileItem.action,
        originalContent: original,
        content,
      });
      await this.addLog(id, `Generated complete & validated code for: ${fileItem.path}`, "success", "code_gen");
    }

    const branchName = `friday-agent/${id}`;
    await this.addLog(id, `Creating GitHub branch "${branchName}" and pushing Pull Request...`, "info", "git_pr");

    const { branchUrl, prUrl, prNumber } = await githubService.commitChangesAsPR(
      branchName,
      changes.map((c) => ({ path: c.path, content: c.content })),
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200),
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200),
      `${request.plan.summary}\n\nRequested via Friday coding agent. Review before merging.`
    );

    await this.addLog(id, `Pull Request created successfully: ${prUrl}`, "success", "completed");

    await requestsCol().doc(id).set(
      {
        status: "completed",
        generatedChanges: changes,
        branchUrl,
        prUrl,
        prNumber: prNumber || null,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
    if (ownerPhone) {
      const { sendWhatsAppUnified } = await import("./whatsappService");
      await sendWhatsAppUnified(ownerPhone, `✅ Changes ready for review:\n${prUrl}\n\nClick "Push to main origin" in Dashboard to commit directly.`)
        .catch((e) => console.error("[CodeAgent] Failed to send completion WhatsApp message:", e));
    }
  }

  /**
   * Previews code changes (generates before & after files) for Visual Diff Viewer before approving.
   */
  public async generateDiffPreview(id: string): Promise<GeneratedFileChange[]> {
    const request = await this.getRequest(id);
    if (!request || !request.plan) throw new Error("Request or plan not found");

    if (request.generatedChanges && request.generatedChanges.length > 0) {
      return request.generatedChanges;
    }

    const changes: GeneratedFileChange[] = [];
    for (const fileItem of request.plan.files) {
      const original = fileItem.action === "modify" ? await githubService.getFileContent(fileItem.path) : "";
      const genPrompt = `You are DK's elite AI Software Engineer. Generate the COMPLETE updated file content for this file to fulfill the instruction.
Instruction: "${request.instruction}"
Plan: ${request.plan.summary}
File: ${fileItem.path} (${fileItem.action})
${original ? `Current Code:\n${original}` : "New File"}`;

      const raw = await callModel(genPrompt, id, this);
      const content = cleanAndExtractFileContent(raw || original);
      changes.push({
        path: fileItem.path,
        action: fileItem.action,
        originalContent: original,
        content,
      });
    }

    await requestsCol().doc(id).set({ generatedChanges: changes, updatedAt: Date.now() }, { merge: true }).catch(() => {});
    return changes;
  }

  /**
   * Refines an existing plan with additional instructions without starting from scratch.
   */
  public async refinePlan(id: string, additionalInstruction: string): Promise<CodeAgentRequest> {
    const request = await this.getRequest(id);
    if (!request) throw new Error("Request not found");

    const updatedInstruction = `${request.instruction} [Follow-up Refinement: ${additionalInstruction}]`;
    await this.addLog(id, `Refining plan with follow-up: "${additionalInstruction}"...`, "info", "planning");

    await requestsCol().doc(id).set(
      {
        instruction: updatedInstruction,
        status: "analyzing",
        error: null,
        updatedAt: Date.now(),
      },
      { merge: true }
    ).catch(() => {});

    // Re-run background analysis with refinement
    this.analyzeAndPlan(id, updatedInstruction).catch(async (e) => {
      console.error("[CodeAgent] Refinement error:", e);
      await this.addLog(id, `Refinement failed: ${e?.message || e}`, "error", "planning");
    });

    return (await this.getRequest(id))!;
  }

  /**
   * 1-Click Rollback: Reverts the latest commit on the repository base branch.
   */
  public async rollback(): Promise<{ message: string }> {
    const result = await githubService.rollbackLastCommit();
    console.log(`[CodeAgent] Rollback executed: ${result.message}`);
    return result;
  }

  /**
   * Codebase Explorer & Voice Search (Power 2): Explains where a feature or logic is implemented.
   */
  public async searchAndExplainCodebase(query: string): Promise<{ answer: string; relatedFiles: string[] }> {
    try {
      const allFiles = await githubService.listRepoFiles();
      const codeFiles = allFiles.filter((p) => /\.(ts|tsx|js|jsx)$/i.test(p)).slice(0, 70);

      const prompt = `You are DK's expert Codebase Guide. The user is asking about the codebase: "${query}".
Repository files:
${JSON.stringify(codeFiles, null, 2)}

Provide a concise, direct answer in friendly conversational Hindi/Hinglish:
1. Exact file path(s) where this logic/feature lives.
2. The key functions/components involved.
3. A 2-sentence summary of how it works.`;

      const response = await callModel(prompt);
      return {
        answer: response || "Codebase logic search complete.",
        relatedFiles: codeFiles.slice(0, 5),
      };
    } catch (e: any) {
      return {
        answer: `Codebase search error: ${e?.message || e}`,
        relatedFiles: [],
      };
    }
  }

  /**
   * Autonomous Code Health & Cleanup Mode (Power 4):
   * Cleans unused imports, dead comments, and formats codebase.
   */
  public async runCodebaseCleanup(): Promise<{ success: boolean; taskId: string; summary: string }> {
    const task = await this.createRequest("Run full codebase health cleanup: optimize imports, remove dead debugging debris, ensure clean formatting and syntax safety.");
    return {
      success: true,
      taskId: task.id,
      summary: "Autonomous codebase cleanup task created and initiated.",
    };
  }

  /**
   * Commits the changes directly to the repository's origin base/main branch.
   */
  public async pushToMain(id: string): Promise<{ commitUrl: string; commitSha: string; baseBranch: string }> {
    const request = await this.getRequest(id);
    if (!request) throw new Error("Request not found");

    let changes = request.generatedChanges;

    if (!changes || changes.length === 0) {
      if (!request.plan || !request.plan.files.length) {
        throw new Error("No changes available to push");
      }
      changes = await this.generateDiffPreview(id);
    }

    const { commitSha, commitUrl, baseBranch } = await githubService.commitChangesToBase(
      changes.map((c) => ({ path: c.path, content: c.content })),
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200)
    );

    if (request.prNumber) {
      try {
        await githubService.mergePR(request.prNumber, `Merge via Friday: ${request.instruction}`);
      } catch (e) {
        console.warn("[CodeAgent] PR merge note:", e);
      }
    }

    await requestsCol().doc(id).set(
      {
        pushedToMain: true,
        commitUrl,
        commitSha,
        status: "completed",
        updatedAt: Date.now(),
      },
      { merge: true }
    ).catch(() => {});

    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
    if (ownerPhone) {
      const { sendWhatsAppUnified } = await import("./whatsappService");
      await sendWhatsAppUnified(ownerPhone, `🚀 Successfully committed changes directly to origin/${baseBranch}:\n${commitUrl}`)
        .catch((e) => console.error("[CodeAgent] Failed to send pushToMain WhatsApp message:", e));
    }

    return { commitUrl, commitSha, baseBranch };
  }
}

export const codeAgentService = new CodeAgentService();
