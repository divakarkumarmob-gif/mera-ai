import fs from "fs";
import path from "path";

export interface ContactEntry {
  id: string;
  name: string;
  phone: string;
  relation?: string;
  dateAdded: string;
  timestamp: number;
}

const dbDir = path.resolve("data");
try {
  fs.mkdirSync(dbDir, { recursive: true });
} catch {}

const contactsFilePath = path.join(dbDir, "contacts.json");

class ContactsService {
  private contacts: ContactEntry[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(contactsFilePath)) {
        this.contacts = JSON.parse(fs.readFileSync(contactsFilePath, "utf-8"));
      }
    } catch {
      this.contacts = [];
    }
  }

  private persist() {
    try {
      fs.writeFileSync(contactsFilePath, JSON.stringify(this.contacts, null, 2), "utf-8");
    } catch (e) {
      console.error("[ContactsService] Failed to persist contacts.json:", e);
    }
  }

  public saveContact(name: string, phone: string, relation?: string): ContactEntry {
    const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, "").trim();
    const existingIndex = this.contacts.findIndex(
      (c) => c.name.toLowerCase() === name.toLowerCase().trim()
    );

    const now = Date.now();
    const entry: ContactEntry = {
      id: Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      phone: cleanPhone.startsWith("91") && cleanPhone.length === 12 ? cleanPhone : cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone,
      relation: relation?.trim() || "",
      dateAdded: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    };

    if (existingIndex >= 0) {
      this.contacts[existingIndex] = entry;
    } else {
      this.contacts.push(entry);
    }

    this.persist();
    return entry;
  }

  public findContact(query: string): ContactEntry | undefined {
    const q = query.toLowerCase().trim();
    // Direct name match
    let found = this.contacts.find((c) => c.name.toLowerCase() === q);
    if (found) return found;

    // Partial name match
    found = this.contacts.find((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
    if (found) return found;

    // Relation match (e.g. "mummy", "brother", "papa")
    found = this.contacts.find((c) => c.relation && (c.relation.toLowerCase().includes(q) || q.includes(c.relation.toLowerCase())));
    if (found) return found;

    // Direct phone number match
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

  public getAllContacts(): ContactEntry[] {
    return this.contacts;
  }

  public compileContactsForPrompt(): string {
    if (this.contacts.length === 0) {
      return "No contacts saved yet. When DK gives you a contact name & number, use 'save_contact' to save them.";
    }
    return this.contacts
      .map((c) => `- ${c.name}${c.relation ? ` (${c.relation})` : ""}: +${c.phone}`)
      .join("\n");
  }
}

export const contactsService = new ContactsService();
