import { GoogleGenAI } from "@google/genai";
import { db } from "./firebaseAdmin";
import { githubService } from "./githubService";
import { sendWhatsAppUnified } from "./whatsappService";

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

  // 1. Strip markdown code fences if present (