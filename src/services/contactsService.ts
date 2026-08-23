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
  public async saveContact(name: string, phone: string, relation?: string): Promise<ContactEntry> {
    const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, "").trim();
    const now = Date.now();

    const normalizedPhone =
      cleanPhone.startsWith("91") && cleanPhone.length === 12
        ? cleanPhone
        : cleanPhone.length === 10
        ? `91${cleanPhone}`
        : cleanPhone;

    // Check for an existing contact with the same name (case-insensitive) to update in place
    const existingSnap = await contactsCollection()
      .where("nameLower", "==", name.toLowerCase().trim())
      .limit(1)
      .get();

    const id = existingSnap.empty ? Math.random().toString(36).substring(2, 9) : existingSnap.docs[0].id;

    const entry: ContactEntry = {
      id,
      name: name.trim(),
      phone: normalizedPhone,
      relation: relation?.trim() || "",
      dateAdded: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    };

    await contactsCollection()
      .doc(id)
      .set({ ...entry, nameLower: name.toLowerCase().trim() });

    return entry;
  }

  public async findContact(query: string): Promise<ContactEntry | undefined> {
    const q = query.toLowerCase().trim();
    const cleanDigits = query.replace(/\D/g, "");

    // Fetch all contacts to perform search
    const allSnap = await contactsCollection().get();
    const all = allSnap.docs.map((d) => this.stripInternal(d.data()));

    // 1. Phone matching (exact or last 10 digits match against saved contacts)
    if (cleanDigits.length >= 10) {
      const queryLast10 = cleanDigits.slice(-10);
      const phoneMatch = all.find((c) => {
        const cDigits = (c.phone || "").replace(/\D/g, "");
        return cDigits === cleanDigits || (cDigits.length >= 10 && cDigits.slice(-10) === queryLast10);
      });
      if (phoneMatch) return phoneMatch;
    }

    // 2. Direct name match
    const direct = all.find((c) => c.name?.toLowerCase().trim() === q);
    if (direct) return direct;

    // 3. Partial name match
    const nameMatch = all.find((c) => c.name?.toLowerCase().includes(q) || q.includes(c.name?.toLowerCase()));
    if (nameMatch) return nameMatch;

    // 4. Relation match
    const relMatch = all.find((c) => c.relation && (c.relation.toLowerCase().includes(q) || q.includes(c.relation.toLowerCase())));
    if (relMatch) return relMatch;

    // 5. Unsaved pure phone number fallback
    if (cleanDigits.length >= 10) {
      return {
        id: "temp",
        name: query,
        phone: cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits,
        dateAdded: new Date().toLocaleString("en-IN"),
        timestamp: Date.now(),
      };
    }

    return undefined;
  }

  public async getAllContacts(): Promise<ContactEntry[]> {
    const snap = await contactsCollection().orderBy("timestamp", "desc").get();
    return snap.docs.map((d) => this.stripInternal(d.data()));
  }

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
