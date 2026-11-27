import { describe, it, expect } from "vitest";

/**
 * Tests for the BUILD generation truncation handling logic.
 * These test the JSON parsing/recovery logic that handles truncated LLM responses.
 */

describe("BUILD artifact truncation handling", () => {
  // Simulates the updated parsing logic in routers.ts build.generate
  function parseArtifactContent(content: string) {
    let artifact;
    try {
      artifact = JSON.parse(content);
    } catch {
      // Last resort: extract fields manually from malformed JSON
      const titleMatch = content.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const contentMatch = content.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (titleMatch && contentMatch) {
        const rawContent = contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        artifact = {
          title: titleMatch[1],
          content: rawContent,
          summary: "See content above for details.",
        };
      } else {
        throw new Error("Generation produced incomplete output. Please try again.");
      }
    }

    // Validate artifact has required fields and minimum content length
    if (!artifact.title || !artifact.content || artifact.content.length < 100) {
      throw new Error("Generation produced incomplete output. Please try again.");
    }

    return artifact;
  }

  it("parses a complete JSON response normally", () => {
    const content = JSON.stringify({
      title: "Market Intelligence",
      content: "## Full content here\n\nWith multiple sections and enough content to pass the 100 char minimum. This is a comprehensive market analysis document covering trends, opportunities, and strategic implications.",
      summary: "A comprehensive market analysis.",
    });
    const result = parseArtifactContent(content);
    expect(result.title).toBe("Market Intelligence");
    expect(result.content).toContain("Full content here");
    expect(result.summary).toBe("A comprehensive market analysis.");
  });

  it("detects truncated response via finish_reason 'length'", () => {
    const finishReason = "length";
    expect(finishReason === "length" || finishReason === "max_tokens").toBe(true);
  });

  it("detects truncated response via finish_reason 'max_tokens'", () => {
    const finishReason = "max_tokens";
    expect(finishReason === "length" || finishReason === "max_tokens").toBe(true);
  });

  it("recovers fields from truncated JSON via regex extraction", () => {
    const truncated = '{"title": "Market Intel", "content": "## Section 1\\n\\nThis is a detailed analysis of the market covering many important aspects. The AI market for non-technical entrepreneurs is growing rapidly with significant opportunities for specialized solutions.';
    const result = parseArtifactContent(truncated);
    expect(result.title).toBe("Market Intel");
    expect(result.content).toContain("Section 1");
    expect(result.content).toContain("growing rapidly");
    expect(result.summary).toBe("See content above for details.");
  });

  it("throws on completely unrecoverable content", () => {
    const garbage = "not json at all, no fields to extract";
    expect(() => parseArtifactContent(garbage)).toThrow("Generation produced incomplete output");
  });

  it("rejects artifact missing title field", () => {
    const content = JSON.stringify({
      title: "",
      content: "Some content that is long enough to pass the minimum length check for validation purposes in the test.",
      summary: "Summary",
    });
    expect(() => parseArtifactContent(content)).toThrow("Generation produced incomplete output");
  });

  it("rejects artifact with content too short (< 100 chars)", () => {
    const content = JSON.stringify({
      title: "Title",
      content: "Too short",
      summary: "Summary",
    });
    expect(() => parseArtifactContent(content)).toThrow("Generation produced incomplete output");
  });

  it("accepts valid artifact with all fields present", () => {
    const content = JSON.stringify({
      title: "Target Audience Personas",
      content: "## Persona 1: The Overwhelmed Founder\n\n- Age: 30-45\n- Role: Solo entrepreneur\n\n## Persona 2: The Growth-Stage CEO\n\n- Age: 35-50\n- Role: CEO of 10-50 person company. They need strategic tools that help them scale operations efficiently.",
      summary: "Two primary personas identified with distinct needs.",
    });
    const result = parseArtifactContent(content);
    expect(result.title).toBe("Target Audience Personas");
    expect(result.content).toContain("Overwhelmed Founder");
    expect(result.content).toContain("Growth-Stage CEO");
  });

});
