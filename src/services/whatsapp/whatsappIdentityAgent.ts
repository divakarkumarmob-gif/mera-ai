import { contactsService, ContactEntry } from "../contactsService";

export type SenderRole =
  | "BOSS"
  | "GIRLFRIEND"
  | "MOM"
  | "DAD"
  | "BROTHER"
  | "SISTER"
  | "FRIEND"
  | "FAMILY"
  | "SAVED_CONTACT"
  | "UNKNOWN";

export type ModelTier = "ADVANCED" | "MEDIUM" | "LOW";

export type PersonaType = "CHIEF_OF_STAFF" | "HUMAN_NATURAL" | "DK_ASSISTANT";

export interface SenderIdentity {
  role: SenderRole;
  displayName: string;
  contactName: string;
  phone: string;
  relation: string;
  isOwner: boolean;
  isKnownContact: boolean;
  modelTier: ModelTier;
  personaType: PersonaType;
}

export class WhatsAppIdentityAgent {
  /**
   * Resolves the full identity, relationship, model tier, and persona for an incoming sender.
   */
  public async resolveIdentity(
    senderPhone: string,
    senderDisplayName: string,
    replyJid: string,
    isSenderOwner: boolean
  ): Promise<SenderIdentity> {
    const cleanPhone = (senderPhone || "").replace(/\D/g, "");

    // 1. Check if Boss / Owner
    if (isSenderOwner) {
      return {
        role: "BOSS",
        displayName: "Boss (DK)",
        contactName: "DK",
        phone: cleanPhone || "me",
        relation: "owner",
        isOwner: true,
        isKnownContact: true,
        modelTier: "ADVANCED",
        personaType: "CHIEF_OF_STAFF",
      };
    }

    // 2. Query contacts book in contactsService
    let contact: ContactEntry | undefined;
    try {
      if (cleanPhone) {
        contact = await contactsService.findContact(cleanPhone);
      }
      if ((!contact || contact.id === "temp") && senderDisplayName && senderDisplayName !== "Unknown") {
        const byName = await contactsService.findContact(senderDisplayName);
        if (byName && byName.id !== "temp") {
          contact = byName;
        }
      }
    } catch (e) {
      console.warn("[IdentityAgent] Contact lookup warning:", e);
    }

    // A "temp" ID indicates an unsaved number placeholder, not a saved contact
    if (contact && contact.id === "temp") {
      contact = undefined;
    }

    // If contact is marked as owner/boss/self
    const rawRelation = (contact?.relation || "").toLowerCase().trim();
    if (rawRelation === "owner" || rawRelation === "boss" || rawRelation === "self") {
      return {
        role: "BOSS",
        displayName: "Boss (DK)",
        contactName: contact?.name || "DK",
        phone: cleanPhone || contact?.phone || "me",
        relation: "owner",
        isOwner: true,
        isKnownContact: true,
        modelTier: "ADVANCED",
        personaType: "CHIEF_OF_STAFF",
      };
    }

    // 3. Resolve role from saved contact relation
    if (contact) {
      const contactName = contact.name || senderDisplayName || "Friend";
      const relation = rawRelation;

      let role: SenderRole = "SAVED_CONTACT";
      if (/\b(?:girlfriend|gf|crush|jaan|lover|babu|shona)\b/i.test(relation)) {
        role = "GIRLFRIEND";
      } else if (/\b(?:mom|mother|mummy|maa|ammi)\b/i.test(relation)) {
        role = "MOM";
      } else if (/\b(?:dad|father|papa|pitaji|abbu|bauji)\b/i.test(relation)) {
        role = "DAD";
      } else if (/\b(?:bhai|brother|bro|bhaiya)\b/i.test(relation)) {
        role = "BROTHER";
      } else if (/\b(?:sister|behen|didi|chhoti)\b/i.test(relation)) {
        role = "SISTER";
      } else if (/\b(?:friend|bestfriend|dost|bff|yaar|buddy)\b/i.test(relation)) {
        role = "FRIEND";
      } else if (/\b(?:family|chacha|mama|tau|bua|mousi|cousin|relative)\b/i.test(relation)) {
        role = "FAMILY";
      }

      return {
        role,
        displayName: contactName,
        contactName,
        phone: cleanPhone || contact.phone,
        relation,
        isOwner: false,
        isKnownContact: true,
        modelTier: "MEDIUM",
        personaType: "HUMAN_NATURAL", // Law: All saved contacts get 100% human reply, zero AI reveal
      };
    }

    // 4. Unknown Contact (Unsaved number / stranger)
    return {
      role: "UNKNOWN",
      displayName: senderDisplayName && senderDisplayName !== "Unknown" ? senderDisplayName : (cleanPhone ? `+${cleanPhone}` : "Guest"),
      contactName: senderDisplayName || "Guest",
      phone: cleanPhone,
      relation: "unknown",
      isOwner: false,
      isKnownContact: false,
      modelTier: "LOW",
      personaType: "DK_ASSISTANT", // Law: Unknown contacts get DK ka Assistant persona
    };
  }
}

export const whatsappIdentityAgent = new WhatsAppIdentityAgent();
