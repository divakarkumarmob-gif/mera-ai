import * as crypto from "crypto";
import { db } from "./firebaseAdmin";

export interface VaultSecretItem {
  key: string;
  category: string;
  updatedAt: string;
}

const vaultCollection = () => db.collection("secure_vault");
const MASTER_SECRET = process.env.VAULT_MASTER_KEY || "friday_super_secret_master_vault_key_2026";

class SecureVaultService {
  // In-memory encrypted cache for instant retrieval & offline resilience
  private inMemoryVault: Map<string, { key: string; category: string; encryptedData: string; iv: string; tag: string; updatedAt: string }> = new Map();

  private getKey(): Buffer {
    return crypto.createHash("sha256").update(MASTER_SECRET).digest();
  }

  private encrypt(text: string): { iv: string; encryptedData: string; tag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.getKey(), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return {
      iv: iv.toString("hex"),
      encryptedData: encrypted,
      tag,
    };
  }

  private decrypt(encryptedData: string, ivHex: string, tagHex: string): string {
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  public async storeSecret(
    keyName: string,
    secretValue: string,
    category = "General"
  ): Promise<{ success: boolean; message: string }> {
    const key = (keyName || "").toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
    const val = (secretValue || "").trim();

    if (!key || !val) {
      throw new Error("Secret key name aur value provide karna zaroori hai.");
    }

    const { iv, encryptedData, tag } = this.encrypt(val);
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const entry = {
      key,
      category,
      encryptedData,
      iv,
      tag,
      updatedAt: now,
    };

    // Cache in memory
    this.inMemoryVault.set(key, entry);

    try {
      await vaultCollection().doc(key).set(entry);
    } catch (e: any) {
      console.warn("[SecureVault] Firestore write note (cached locally):", e?.message || e);
    }

    return {
      success: true,
      message: `Boss, "${keyName}" ka secret AES-256 encryption ke saath vault me surakshit save ho gaya hai!`,
    };
  }

  public async retrieveSecret(
    keyName: string
  ): Promise<{ success: boolean; key: string; secretValue?: string; message: string }> {
    const key = (keyName || "").toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
    let data = this.inMemoryVault.get(key);

    if (!data) {
      try {
        const doc = await vaultCollection().doc(key).get();
        if (doc.exists) {
          data = doc.data() as any;
          if (data) this.inMemoryVault.set(key, data);
        }
      } catch {}
    }

    if (!data) {
      return {
        success: false,
        key,
        message: `Boss, vault me "${keyName}" naam ka koi secret nahi mila.`,
      };
    }

    try {
      const decrypted = this.decrypt(data.encryptedData, data.iv, data.tag);
      return {
        success: true,
        key: data.key,
        secretValue: decrypted,
        message: `Boss, "${keyName}" ka decrypted secret mil gaya: "${decrypted}".`,
      };
    } catch (err: any) {
      return {
        success: false,
        key,
        message: `Vault decrypt error: Master key mismatch.`,
      };
    }
  }

  public async deleteSecret(keyName: string): Promise<{ success: boolean; message: string }> {
    const key = (keyName || "").toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
    this.inMemoryVault.delete(key);

    try {
      await vaultCollection().doc(key).delete();
    } catch {}

    return {
      success: true,
      message: `Boss, vault se "${keyName}" secret successfully delete kar diya gaya hai.`,
    };
  }

  public async listSecretKeys(): Promise<{ success: boolean; keys: VaultSecretItem[]; message: string }> {
    let keys: VaultSecretItem[] = [];

    try {
      const snap = await vaultCollection().get();
      keys = snap.docs.map((d) => {
        const data = d.data();
        return {
          key: data.key,
          category: data.category || "General",
          updatedAt: data.updatedAt,
        };
      });
    } catch {
      keys = Array.from(this.inMemoryVault.values()).map((v) => ({
        key: v.key,
        category: v.category,
        updatedAt: v.updatedAt,
      }));
    }

    return {
      success: true,
      keys,
      message: `Boss, vault me total ${keys.length} encrypted keys saved hain: ${keys.map((k) => k.key).join(", ") || "None"}.`,
    };
  }
}

export const secureVaultService = new SecureVaultService();
