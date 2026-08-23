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
  content: string;
}

export interface CodeAgentRequest {
  id: string;
  instruction: string;
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
}

const requestsCol = () => db.collection("codeAgentRequests");

async function callModel(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[CodeAgent] GEMINI_API_KEY not set.");
    return null;
  }
  const ai = new GoogleGenAI({ apiKey });

  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    console.log(`[CodeAgent] Trying model ${i + 1}/${MODEL_CHAIN.length}: ${model}`);
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      const text = response.text;
      if (text && text.trim()) {
        console.log(`[CodeAgent] ✅ Success with ${model}`);
        return text;
      }
      console.warn(`[CodeAgent] ${model} returned empty response, trying next...`);
    } catch (e: any) {
      const errMsg = extractError(e);
      const is503 = errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand");
      console.error(`[CodeAgent] ❌ ${model} failed: ${errMsg}`);
      if (i < MODEL_CHAIN.length - 1) {
        // Wait 2s before next attempt to let transient 503 spikes clear
        const delayMs = is503 ? 2000 : 500;
        console.log(`[CodeAgent] Waiting ${delayMs}ms before trying next model...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.error("[CodeAgent] ❌ All models in the fallback chain failed.");
  return null;
}

class CodeAgentService {
  /** Kicks off a new request: creates the Firestore doc, then analyzes in the background. */
  public async createRequest(instruction: string): Promise<string> {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const request: CodeAgentRequest = {
      id,
      instruction,
      status: "analyzing",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await requestsCol().doc(id).set(request);
    this.analyzeAndPlan(id, instruction).catch((e) => {
      console.error(`[CodeAgent] Analysis failed for request ${id}:`, e);
      this.markFailed(id, e?.message || String(e));
    });
    return id;
  }

  /** Stage 1: analyze and generate a plan. */
  private async analyzeAndPlan(id: string, instruction: string) {
    const doc = await requestsCol().doc(id).get();
    if (!doc.exists) return;
    const request = doc.data() as CodeAgentRequest;

    const allFiles = await githubService.listRepoFiles();
    const candidateFiles = allFiles
      .filter((p) => /\.(ts|tsx|js|jsx|json|html|css|md)$/i.test(p))
      .slice(0, 80);

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
    const { branchUrl, prUrl, prNumber } = await githubService.commitChangesAsPR(
      branchName,
      changes,
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200),
      `Friday Coding Agent: ${request.instruction}`.slice(0, 200),
      `${request.plan.summary}\n\nRequested via Friday coding agent. Review before merging.`
    );

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
      await whatsappBotService
        .sendMessage(ownerPhone, `✅ Changes ready for review:\n${prUrl}\n\nClick "Push to main origin" in Dashboard to commit directly.`)
        .catch((e) => console.error("[CodeAgent] Failed to send completion WhatsApp message:", e));
    }
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
      // Generate if not cached
      changes = [];
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
        changes.push({ path: fileItem.path, content });
      }
    }

    const { commitSha, commitUrl, baseBranch } = await githubService.commitChangesToBase(
      changes,
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
    );

    const ownerPhone = process.env.OWNER_WHATSAPP_NUMBER;
    if (ownerPhone) {
      await whatsappBotService
        .sendMessage(ownerPhone, `🚀 Successfully committed changes directly to origin/${baseBranch}:\n${commitUrl}`)
        .catch((e) => console.error("[CodeAgent] Failed to send pushToMain WhatsApp message:", e));
    }

    return { commitUrl, commitSha, baseBranch };
  }
}

export const codeAgentService = new CodeAgentService();
