import { describe, it, expect } from "vitest";
import { fridayFunctionDeclarations } from "../src/live/liveToolDeclarations";

describe("Live Tool Dispatcher Declarations", () => {
  it("should have valid declarations with non-empty names and descriptions", () => {
    expect(Array.isArray(fridayFunctionDeclarations)).toBe(true);
    expect(fridayFunctionDeclarations.length).toBeGreaterThan(20);

    const names = new Set<string>();
    for (const decl of fridayFunctionDeclarations) {
      expect(decl.name).toBeDefined();
      expect(decl.name?.length).toBeGreaterThan(0);
      expect(decl.description).toBeDefined();

      // Check for unintended duplicates
      expect(names.has(decl.name!)).toBe(false);
      names.add(decl.name!);
    }
  });

  it("should include core Friday companion tools", () => {
    const names = fridayFunctionDeclarations.map((d) => d.name);
    expect(names).toContain("search_long_term_vector_memory");
    expect(names).toContain("retrieve_smart_multi_tier_context");
    expect(names).toContain("remember_personal_fact");
    expect(names).toContain("save_daily_update");
    expect(names).toContain("generate_ai_photo");
  });
});
