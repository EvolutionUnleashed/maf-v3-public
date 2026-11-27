import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const routersSource = readFileSync(join(__dirname, "routers.ts"), "utf-8");

describe("MAF Writing Rules enforcement", () => {
  it("defines the MAF_WRITING_RULES constant", () => {
    expect(routersSource).toContain("const MAF_WRITING_RULES = `");
  });

  it("includes all 5 mandatory rules in the constant", () => {
    expect(routersSource).toContain("1. NO ANAPHORA");
    expect(routersSource).toContain("2. NO NEGATIVE PARALLELISM");
    expect(routersSource).toContain("3. NO WEAK COMPARISONS");
    expect(routersSource).toContain("4. READABILITY: FLESCH-KINCAID GRADE 6 (DEFAULT)");
    expect(routersSource).toContain("5. GENERAL QUALITY STANDARDS");
  });

  it("includes banned pattern examples for anaphora", () => {
    expect(routersSource).toContain('"We believe... We build... We deliver..."');
    expect(routersSource).toContain('"Stop guessing. Stop wasting. Stop settling."');
  });

  it("includes banned pattern examples for negative parallelism", () => {
    expect(routersSource).toContain('"We don\'t do X. We do Y."');
    expect(routersSource).toContain('"Not a template. A strategy."');
  });

  it("includes banned pattern examples for weak comparisons", () => {
    expect(routersSource).toContain('"Most people..."');
    expect(routersSource).toContain('"Unlike most businesses..."');
  });

  it("includes FK Grade 6 readability specifications", () => {
    expect(routersSource).toContain("Short sentences (average 10-15 words)");
    expect(routersSource).toContain('"use" not "utilize"');
    expect(routersSource).toContain("Active voice by default");
  });

  it("includes Brand Voice override clause for FK Grade 6", () => {
    expect(routersSource).toContain(
      "Brand Voice document explicitly specifies a different"
    );
    expect(routersSource).toContain(
      "still avoid the\n   banned patterns in rules 1-3 above"
    );
  });

  it("injects MAF_WRITING_RULES into all 5 invokeLLM system prompts", () => {
    // Count occurrences of ${MAF_WRITING_RULES} in template literals
    const injections = routersSource.match(/\$\{MAF_WRITING_RULES\}/g) || [];
    // Should be at least 6: 5 invokeLLM system prompts + 1 buildStepPrompt return
    expect(injections.length).toBeGreaterThanOrEqual(6);
  });

  it("injects MAF_WRITING_RULES into buildStepPrompt return value", () => {
    // The buildStepPrompt function should append rules to every prompt
    expect(routersSource).toContain(
      "return `${basePrompt}\\n\\n${MAF_WRITING_RULES}`"
    );
  });

  it("critic agent evaluates Writing Rules Compliance as axis #6", () => {
    expect(routersSource).toContain("WRITING RULES COMPLIANCE");
  });

  it("has zero competitor/competitive references in prompts", () => {
    // Extract only the prompt-related sections (not comments or variable names)
    const lines = routersSource.split("\n");
    const promptLines = lines.filter(
      (l) =>
        l.includes("competitor") ||
        l.includes("competitive") ||
        l.includes("Competitive") ||
        l.includes("Competitor")
    );
    // Should be zero
    expect(promptLines.length).toBe(0);
  });
});
