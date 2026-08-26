import { db } from "./firebaseAdmin";

export interface ContactEntry {
  id: string;
  name: string;
  phone: string;
  relation?: string;
  dateAdded: string;
  timestamp: number;
}

// Firestore layout: contacts/{contactId}
const contactsCollection = () => db.collection("contacts");

class ContactsService {
  // In-memory contact cache for resilient offline performance
  private inMemoryContacts: Map<string, ContactEntry> = new Map();

  /**
   * Saves or updates a contact in Firestore with in-memory fallback.
   */
  public async saveContact(name: string, phone: string, relation?: string): Promise<ContactEntry> {
    const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, "").trim();
    const now = Date.now();

    // Normalize robustly using the last 10 digits — handles leading 0,
    // '91' country code, spaces mid-number, or any other stray formatting
    const last10 = cleanPhone.replace(/\D/g, "").slice(-10);
    const normalizedPhone = last10.length === 10 ? `91${last10}` : cleanPhone;
    const cleanName = (name || "Contact").trim();

    let id = Math.random().toString(36).substring(2, 9);

    // Try finding existing contact in Firestore or memory
    try {
      const existingSnap = await contactsCollection()
        .where("nameLower", "==", cleanName.toLowerCase())
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        id = existingSnap.docs[0].id;
      }
    } catch {
      // Memory fallback lookup
      for (const [memId, c] of this.inMemoryContacts.entries()) {
        if (c.name.toLowerCase() === cleanName.toLowerCase()) {
          id = memId;
          break;
        }
      }
    }

    const entry: ContactEntry = {
      id,
      name: cleanName,
      phone: normalizedPhone,
      relation: relation?.trim() || "",
      dateAdded: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    };

    // Cache locally
    this.inMemoryContacts.set(id, entry);

    // Save to Firestore with silent offline fallback
    try {
      await contactsCollection()
        .doc(id)
        .set({ ...entry, nameLower: cleanName.toLowerCase(), phoneLast10: last10 });
    } catch (e: any) {
      console.warn("[Contacts] Firestore save warning, stored in-memory:", e?.message || e);
    }

    return entry;
  }

  /**
   * Finds a contact by name, phone, relation, or boss/self alias.
   */
  public async findContact(query: string): Promise<ContactEntry | undefined> {
    const q = (query || "").toLowerCase().trim();
    const cleanDigits = query.replace(/\D/g, "");
    const queryLast10 = cleanDigits.slice(-10);

    // Fetch all contacts (Firestore + in-memory cache)
    const all = await this.getAllContacts();

    // 1. Phone matching — always compare by last 10 digits
    if (queryLast10.length === 10) {
      const phoneMatch = all.find((c) => {
        const cDigits = (c.phone || "").replace(/\D/g, "");
        return cDigits.slice(-10) === queryLast10;
      });
      if (phoneMatch) return phoneMatch;
    }

    // 2. Direct name match
    const direct = all.find((c) => c.name?.toLowerCase().trim() === q);
    if (direct) return direct;

    // 2.1 Boss / DK / Divakar / Self alias match
    const bossAliases = ["boss", "divakar", "dk", "divakar kumar", "self", "me", "mera number", "mere", "boss ka number"];
    if (bossAliases.includes(q)) {
      const bossMatch = all.find((c) => {
        const cName = c.name?.toLowerCase().trim() || "";
        const cRel = c.relation?.toLowerCase().trim() || "";
        return (
          cName === "dk" ||
          cName.includes("divakar") ||
          cName === "boss" ||
          cRel === "self" ||
          cRel === "owner" ||
          cRel === "boss"
        );
      });
      if (bossMatch) return bossMatch;

      // Check environment OWNER_WHATSAPP_NUMBER or provide clean default Boss contact
      const ownerEnv = (process.env.OWNER_WHATSAPP_NUMBER || process.env.BOSS_WHATSAPP_NUMBER || "").replace(/\D/g, "");
      const ownerLast10 = ownerEnv ? ownerEnv.slice(-10) : "";
      return {
        id: "owner_default",
        name: "DK (Boss)",
        phone: ownerLast10.length === 10 ? `91${ownerLast10}` : (ownerEnv || "919999999999"),
        relation: "owner",
        dateAdded: new Date().toLocaleString("en-IN"),
        timestamp: Date.now(),
      };
    }

    // 3. Partial name match
    const nameMatch = all.find((c) => c.name?.toLowerCase().includes(q) || q.includes(c.name?.toLowerCase()));
    if (nameMatch) return nameMatch;

    // 4. Relation match
    const relMatch = all.find((c) => c.relation && (c.relation.toLowerCase().includes(q) || q.includes(c.relation.toLowerCase())));
    if (relMatch) return relMatch;

    // 5. Unsaved pure phone number fallback
    if (queryLast10.length === 10) {
      return {
        id: "temp",
        name: query,
        phone: `91${queryLast10}`,
        dateAdded: new Date().toLocaleString("en-IN"),
        timestamp: Date.now(),
      };
    }

    return undefined;
  }

  /**
   * Deletes a contact by name or phone.
   */
  public async deleteContact(nameOrPhone: string): Promise<{ deleted: boolean; name?: string; phone?: string }> {
    try {
      const contact = await this.findContact(nameOrPhone);
      if (!contact || contact.id === "temp" || contact.id === "owner_default") {
        return { deleted: false };
      }

      this.inMemoryContacts.delete(contact.id);

      try {
        await contactsCollection().doc(contact.id).delete();
      } catch (err: any) {
        console.warn("[Contacts] Firestore delete warning:", err?.message || err);
      }

      return { deleted: true, name: contact.name, phone: contact.phone };
    } catch {
      return { deleted: false };
    }
  }

  /**
   * Retrieves all contacts, merging Firestore results and local memory cache.
   */
  public async getAllContacts(): Promise<ContactEntry[]> {
    let contacts: ContactEntry[] = [];
    try {
      const snap = await contactsCollection().orderBy("timestamp", "desc").get();
      contacts = snap.docs.map((d) => this.stripInternal(d.data()));
    } catch {
      contacts = Array.from(this.inMemoryContacts.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    // Cache locally
    contacts.forEach((c) => this.inMemoryContacts.set(c.id, c));
    return contacts;
  }

  /**
   * Compiles contact list as text for Gemini prompt injection.
   */
  public async compileContactsForPrompt(): Promise<string> {
    const contacts = await this.getAllContacts();
    if (contacts.length === 0) {
      return "No contacts saved yet. When DK gives you a contact name & number, use 'save_contact' to save them.";
    }
    return contacts.map((c) => `- ${c.name}${c.relation ? ` (${c.relation})` : ""}: +${c.phone}`).join("\n");
  }

  private stripInternal(data: FirebaseFirestore.DocumentData): ContactEntry {
    const { nameLower, ...rest } = data;
    return rest as ContactEntry;
  }
}

export const contactsService = new ContactsService();
