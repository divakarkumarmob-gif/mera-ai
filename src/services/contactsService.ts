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

    // Direct name match
    const directSnap = await contactsCollection().where("nameLower", "==", q).limit(1).get();
    if (!directSnap.empty) return this.stripInternal(directSnap.docs[0].data());

    // Partial name / relation match — Firestore doesn't support "contains" queries
    // natively, so we scan (fine for a small personal contacts book).
    const allSnap = await contactsCollection().get();
    const all = allSnap.docs.map((d) => d.data());

    let found = all.find((c) => c.nameLower?.includes(q) || q.includes(c.nameLower));
    if (found) return this.stripInternal(found);

    found = all.find((c) => c.relation && (c.relation.toLowerCase().includes(q) || q.includes(c.relation.toLowerCase())));
    if (found) return this.stripInternal(found);

    // Direct phone number match (no lookup needed, just format it)
    const cleanPhone = query.replace(/[\s\-\(\)\+]/g, "");
    if (/^\d{10,15}$/.test(cleanPhone)) {
      return {
        id: "temp",
        name: query,
        phone: cleanPhone.startsWith("91") && cleanPhone.length === 12 ? cleanPhone : cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone,
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
