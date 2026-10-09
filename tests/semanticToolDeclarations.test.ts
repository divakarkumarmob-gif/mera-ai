import { describe, it, expect } from "vitest";
import { semanticIntentEngine } from "../src/services/semanticIntentEngine";

describe("SemanticIntentEngine Tool Declarations", () => {
  it("should return function declarations without any duplicates", () => {
    const declarations = semanticIntentEngine.getBossFunctionDeclarations();
    expect(declarations.length).toBeGreaterThan(0);

    const names = declarations.map((d: any) => d.name);
    const uniqueNames = new Set(names);

    expect(names.length).toBe(uniqueNames.size);
    expect(names).toContain("get_news");
    expect(names).toContain("search_rail_pnr_status");
  });

  it("should have valid schema for all function declarations", () => {
    const declarations = semanticIntentEngine.getBossFunctionDeclarations();
    for (const d of declarations) {
      expect(d.name).toBeDefined();
      expect(typeof d.name).toBe("string");
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.description).toBeDefined();
      expect(typeof d.description).toBe("string");
      if (d.parameters) {
        expect(d.parameters.type).toBe("OBJECT");
      }
    }
  });
});
