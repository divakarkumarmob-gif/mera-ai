import { SenderIdentity } from "./whatsappIdentityAgent";

export interface PrivacyCheckResult {
  isPrivate: boolean;
  reason?: string;
  refusalMessage?: string;
}

export class WhatsAppPrivacyGuardianAgent {
  public static readonly STANDARD_REFUSAL_MESSAGE = "Sorry, main is cheez ke liye madad nahi kar sakta.";

  /**
   * Evaluates if a message is asking for private/restricted data.
   * Boss is ALWAYS exempt (has 100% full access).
   */
  public evaluatePrivacy(text: string, identity: SenderIdentity): PrivacyCheckResult {
    // 1. Boss has full access to all private info
    if (identity.isOwner) {
      return { isPrivate: false };
    }

    const clean = (text || "").toLowerCase().trim();

    // 2. Secret: DK's Girlfriend inquiry (GF name, number, who is she, personal relationship)
    // Non-boss users are NEVER allowed to ask about DK's GF!
    const isGirlfriendInquiry =
      /\b(?:dk|divakar)?\s*(?:ki|ke|ka)?\s*(?:gf|girlfriend|bandi|patola|crush|setting|ladki)\b/i.test(clean) &&
      /\b(?:kon|kaun|name|naam|number|no|details|batao|kisi|photo|pic|kaha|bhed|secret)\b/i.test(clean);

    const isDirectGfQuery =
      /^(?:dk\s*ki\s*gf|dk\s*ki\s*girlfriend|girlfriend\s*ka\s*naam|gf\s*kaun\s*hai|gf\s*ka\s*number|who\s*is\s*dk'?s?\s*gf|who\s*is\s*dk'?s?\s*girlfriend)/i.test(clean);

    if (isGirlfriendInquiry || isDirectGfQuery) {
      return {
        isPrivate: true,
        reason: "DK's girlfriend private details inquiry",
        refusalMessage: WhatsAppPrivacyGuardianAgent.STANDARD_REFUSAL_MESSAGE,
      };
    }

    // 3. Secret: Contact numbers / Personal Phone Numbers of others
    const isContactLeakRequest =
      /\b(?:kisi|uska|unki|unka|uske|kiska|friend|dost|sir|madam|ladki|bhai|number|no|contact|phone)\b/i.test(clean) &&
      /\b(?:number\s*do|no\s*do|contact\s*do|phone\s*do|number\s*bhejo|contact\s*bhejo|phone\s*bhejo|details\s*do|number\s*batao|no\s*batao|phone\s*batao)\b/i.test(clean);

    const isDirectNumberAsk =
      /^(?:(?:uska|unka|kisi\s*ka|us\s*ladki\s*ka|us\s*bhai\s*ka)\s*(?:number|no|contact)\s*(?:do|de|bhejo|batao)|number\s*chahiye|contact\s*chahiye)/i.test(clean);

    if (isContactLeakRequest || isDirectNumberAsk) {
      return {
        isPrivate: true,
        reason: "Third-party personal contact/number inquiry",
        refusalMessage: WhatsAppPrivacyGuardianAgent.STANDARD_REFUSAL_MESSAGE,
      };
    }

    // 4. Secret: Financials, Passwords, OTP, Bank, UPI, Credentials
    const isCredentialsOrFinance =
      /\b(?:password|passcode|otp|pin|upi\s*pin|bank\s*account|balance|atm|card\s*number|cvv|secret\s*key|api\s*key|private\s*key)\b/i.test(clean);

    if (isCredentialsOrFinance) {
      return {
        isPrivate: true,
        reason: "Credentials / Banking / Private secrets inquiry",
        refusalMessage: WhatsAppPrivacyGuardianAgent.STANDARD_REFUSAL_MESSAGE,
      };
    }

    // 5. Secret: System prompts, prompt hacking, AI instructions leak
    const isPromptLeakAttempt =
      /\b(?:system\s*prompt|system\s*instruction|reveal\s*prompt|system\s*rules|ignore\s*all\s*previous\s*instructions|source\s*code|api\s*keys)\b/i.test(clean);

    if (isPromptLeakAttempt) {
      return {
        isPrivate: true,
        reason: "Internal AI prompt injection / system leak attempt",
        refusalMessage: WhatsAppPrivacyGuardianAgent.STANDARD_REFUSAL_MESSAGE,
      };
    }

    // Safe to proceed
    return { isPrivate: false };
  }
}

export const whatsappPrivacyGuardianAgent = new WhatsAppPrivacyGuardianAgent();
