import { describe, expect, it } from "vitest";
import { matchesOutputSchema } from "./structured-output";

const schema = {
  type: "object",
  properties: {
    ideas: {
      type: "array", minItems: 1, maxItems: 2,
      items: {
        type: "object",
        properties: { title: { type: "string" }, score: { type: "integer" } },
        required: ["title", "score"], additionalProperties: false,
      },
    },
  },
  required: ["ideas"], additionalProperties: false,
};

describe("local structured output validation", () => {
  it("accepts workflow-compatible nested JSON", () => {
    expect(matchesOutputSchema({ ideas: [{ title: "An idea", score: 8 }] }, schema)).toBe(true);
  });
  it.each([
    null, [], { ideas: [] }, { ideas: "not an array" },
    { ideas: [{ title: "An idea" }] },
    { ideas: [{ title: 4, score: 8 }] },
    { ideas: [{ title: "An idea", score: 8.5 }] },
    { ideas: [{ title: "An idea", score: 8, extra: true }] },
    { ideas: [{ title: "An idea", score: 8 }], extra: true },
    { ideas: Array.from({ length: 3 }, () => ({ title: "An idea", score: 8 })) },
  ])("rejects malformed output %j", value => {
    expect(matchesOutputSchema(value, schema)).toBe(false);
  });
  it("enforces enums and does not accept inherited required fields", () => {
    expect(matchesOutputSchema("wrong", { type: "string", enum: ["OK"] })).toBe(false);
    expect(matchesOutputSchema(Object.create({ ideas: [] }), schema)).toBe(false);
  });
});
