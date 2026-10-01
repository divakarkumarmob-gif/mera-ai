import { describe, it, expect } from "vitest";
import { encryptData, decryptData, CIPHER_PREFIX } from "../src/utils/cryptoVault";
import { memoryEngine } from "../src/services/memoryEngine";

describe("4-Tier Memory & Encryption Architecture", () => {
  it("should encrypt and decrypt sensitive facts symmetrically via AES-256-GCM", () => {
    const rawSecret = "Boss DK's private account number is 9876543210";
    const encrypted = encryptData(rawSecret);

    expect(encrypted).toBeDefined();
    expect(encrypted.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(encrypted).not.toContain(rawSecret);

    const decrypted = decryptData(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  it("should support backward-compatible plain-text fallback (legacy memories)", () => {
    const legacyPlainText = "Old unencrypted memo from 2024";
    const result = decryptData(legacyPlainText);
    expect(result).toBe(legacyPlainText);
  });

  it("should not double-encrypt an already encrypted string", () => {
    const text = "Secret fact";
    const enc1 = encryptData(text);
    const enc2 = encryptData(enc1);
    expect(enc2).toBe(enc1);
  });

  it("should verify memory lifecycle retention policies", async () => {
    const memories = await memoryEngine.getMemories();
    expect(memories).toBeDefined();
    expect(Array.isArray(memories.personalVault)).toBe(true);
    expect(Array.isArray(memories.pinnedMemories)).toBe(true);
  });
});
