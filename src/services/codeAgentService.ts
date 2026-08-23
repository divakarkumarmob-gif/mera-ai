import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { githubService } from "./githubService";
import { whatsappBotService } from "./whatsappBotService";

// ---------------------------------------------------------------------------
// Coding agent: DK gives an instruction (voice or dashboard) → agent analyzes
// the repo (diagnostic-first, like a human reviewer would) → proposes a plan
// → DK approves via the dashboard OR by replying "yes"/"ok" on WhatsApp →
// only then does it write anything, always as a new branch + Pull Request,
// never directly to the base branch.
//
// Firestore layout: codeAgentRequests/{id}
// ---------------------------------------------------------------------------

const MODEL_CHAIN = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const APPROVE_WORDS = new Set(["yes", "ok", "okay", "haan", "yep", "yeah", "y"]);

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

export interface CodeAgentRequest {
  id: string;
  instruction: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
  plan?: CodeAgentPlan;
  branchUrl?: string;
  prUrl?: string;
  error?: string;
}

const requestsCol = () => db.collection("codeAgentRequests");

async function callModel(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[CodeAgent] GEMINI_API_KEY not set.");
    return null;
  }
  const ai = new GoogleGenAI({ apiKey });
  for (const model of MODEL_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      const text = response.text;
      if (text) {
        console.log(`[CodeAgent] Model call succeeded using ${model}`);
        return text;
      }
    } catch (e: any) {
      console.error(`[CodeAgent] ${model} failed (${e?.message || e}), trying next model...`);
    }
  }
  console.error("[CodeAgent] All models in the fallback chain failed.");
  return null;
}

class CodeAgentService {
  /** Kicks off a new request: creates the Firestore doc, then analyzes in the background. */
  public async createRequest(instruction: string): Promise<string> {
    const id = Math.random().toString(36).substring(2, 10);
    const now = Date.now();
    const request: CodeAgentRequest = {
      id,
      instruction: instruction.trim(),
      status: "analyzing",
      createdAt: now,
      updatedAt: now,
    };
    await requestsCol().doc(id).set(request);
    this.analyze(id).catch((e) => {
      console.error(`[CodeAgent] Analysis failed for request ${id}:`, e);
      this.markFailed(id, e?.message || String(e));
    });
    return id;
  }

  /** Stage 1: pick relevant files. Stage 2: diagnostic analysis + plan (no code written yet). */
  private async analyze(id: string) {
    const doc = await requestsCol().doc(id).get();
    const request = doc.data() as CodeAgentRequest;
    if (!request) return;

    const allFiles = await githubService.listRepoFiles();

    const pickPrompt = `You are a senior engineer picking which files are relevant to investigate for this instruction from DK, the project owner.
Instruction: "${request.instruction}"

Full list of files in the repo:
${allFiles.join("\n")}

Return ONLY a JSON object: { "relevantFiles": ["path1", "path2", ...] }
Pick at most 8 files that are most likely relevant. Be selective.`;

    const pickRaw = await callModel(pickPrompt);
    let relevantFiles: string[] = [];
    try {
      relevantFiles = JSON.parse(pickRaw || "{}").relevantFiles || [];
    } catch {
      relevantFiles = [];
    }
    relevantFiles = relevantFiles.filter((f) => allFiles.includes(f)).slice(0, 8);

    if (relevantFiles.length === 0) {
      await this.markFailed(id, "Could not identify relevant files in the repo for this instruction.");
      return;
    }

    const fileContents = await githubService.getMultipleFiles(relevantFiles);
    const filesBlock = fileContents
      .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
      .join("\n\n");

    const planPrompt = `You are DK's AI coding agent working on his existing GitHub project. Analyze like a careful senior engineer — diagnostic first, never guess.

DK's instruction: "${request.instruction}"

Relevant file contents:
${filesBlock}

Return ONLY a JSON object matching this schema:
{
  "diagnosis": "If this is a bug/debug-style request, the likely root cause based on code analysis. Empty string if this is a feature request, not a bug report.",
  "summary": "2-4 sentence plain-language summary of what will change and why.",
  "files": [
    { "path": "exact/file/path.ts", "action": "modify" | "create", "changeSummary": "short description of what changes in this file" }
  ]
}

Rules:
- Only list files that actually need to change. Don't pad the list.
- Be honest in "diagnosis" — distinguish confirmed vs likely vs "not enough information" if applicable, don't pretend certainty you don't have.
- Don't invent facts not supported by the code you were shown.`;

    const planRaw = await callModel(planPrompt);
    if (!planRaw) {
      await this.markFailed(id, "Model call failed while generating the plan.");
      return;
    }

    let plan: CodeAgentPlan;
    try {
      const parsed = JSON.parse(planRaw);
      plan = {
        diagnosis: parsed.diagnosis || "",
        summary: parsed.summary || "",
        files: Array.isArray(parsed.files) ? parsed.files : [],
      };
    } catch (e) {
      await this.markFailed(id, "Failed to parse the plan returned by the model.");
      return;
    }

    await requestsCol().doc(id).set(
      { plan, status: "pending_approval", updatedAt: Date.now() },
      { merge: true }
    );

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
      await whatsappBotService.sendMessage(ownerPhone, text);
    } catch (e) {
      console.error("[CodeAgent] Failed to notify owner on WhatsApp:", e);
    }
  }

  private async markFailed(id: string, error: string) {
    await requestsCol().doc(id).set({ status: "failed", error, updatedAt: Date.now() }, { merge: true });
  }

  public async getRequests(): Promise<CodeAgentRequest[]> {
    const snap = await requestsCol().orderBy("createdAt", "desc").limit(30).get();
    return snap.docs.map((d) => d.data() as CodeAgentRequest);
  }

  public async getRequest(id: string): Promise<CodeAgentRequest | null> {
    const doc = await requestsCol().doc(id).get();
    return doc.exists ? (doc.data() as CodeAgentRequest) : null;
  }

  /** Returns the single most recent request still awaiting approval, if any — used to interpret a plain WhatsApp reply. */
  public async getPendingRequest(): Promise<CodeAgentRequest | null> {
    const snap = await requestsCol().where("status", "==", "pending_approval").orderBy("createdAt", "desc").limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data() as CodeAgentRequest;
  }

  public async approve(id: string) {
    await requestsCol().doc(id).set({ status: "approved", updatedAt: Date.now() }, { merge: true });
    this.applyChanges(id).catch((e) => {
      console.error(`[CodeAgent] Applying changes failed for request ${id}:`, e);
      this.markFailed(id, e?.message || String(e));
    });
  }

  public async deny(id: string) {
    await requestsCol().doc(id).set({ status: "denied", updatedAt: Date.now() }, { merge: true });
  }

  /**
   * If there's exactly one request pending approval, interprets a plain WhatsApp
   * reply as approve/deny. Returns true if it consumed the message this way.
   */
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

  /** Generates full new content for each planned file and commits them as a PR on a new branch. */
  private async applyChanges(id: string) {
    const request = await this.getRequest(id);
    if (!request || !request.plan) return;

    await requestsCol().doc(id).set({ status: "applying", updatedAt: Date.now() }, { merge: true });

    const changes: { path: string; content: string }[] = [];

    for (const fileItem of request.plan.files) {
      const original = fileItem.action === "modify" ? await githubService.getFileContent(fileItem.path) : "";
      const genPrompt = `You are DK's AI coding agent. Generate the COMPLETE new content for this file, applying the planned change. Return ONLY a JSON object: { "content": "...full file content..." } — no markdown fences, no explanation.

Instruction: "${request.instruction}"
Overall plan summary: ${request.plan.summary}
This file: ${fileItem.path}
Change needed: ${fileItem.changeSummary}
${original ? `Current content:\n${original}` : "This is a new file."}`;

      const raw = await callModel(genPrompt);
      if (!raw) throw new Error(`Failed to generate content for ${fileItem.path}`);
      let content: string;
      try {
        content = JSON.parse(raw).content;
      } catch {
        throw new Error(`Failed to parse generated content for ${fileItem.path}`);
      }
      if (typeof content !== "string" || !content.trim()) {
        throw new Error(`Empty content generated for ${fileItem.path}`);
      }
      changes.push({ path: fileItem.path, content });
    }

    const branchName = `friday-agent/${id}`;
    const { branchUrl, prUrl } = await githubService.commitChangesAsPR(
      branchName,
      changes,
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200),
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200),
      `${request.plan.summary}\n\nRequested via Friday coding agent. Review before merging.`
    );

    await requestsCol().doc(id).set(
      { status: "completed", branchUrl, prUrl, updatedAt: Date.now() },
      { merge: true }
    );

    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
    if (ownerPhone) {
      await whatsappBotService
        .sendMessage(ownerPhone, `✅ Changes ready for review: ${prUrl}`)
        .catch((e) => console.error("[CodeAgent] Failed to send completion WhatsApp message:", e));
    }
  }
}

export const codeAgentService = new CodeAgentService();
