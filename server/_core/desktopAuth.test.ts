import { describe, expect, it } from "vitest";
import { desktopHealthProof, safeDesktopNext } from "./desktopAuth";

describe("desktop bootstrap redirect", () => {
  it("keeps local application routes", () => {
    expect(safeDesktopNext("/settings/integrations?desktop=1&firstRun=1")).toBe(
      "/settings/integrations?desktop=1&firstRun=1",
    );
  });

  it.each([
    "https://example.com",
    "//example.com/path",
    "/\\example.com",
    "/setup\r\nX-Test: injected",
    null,
  ])("rejects an unsafe redirect target: %s", value => {
    expect(safeDesktopNext(value)).toBe("/setup?desktop=1");
  });
});

describe("desktop health proof", () => {
  it("binds the response to both the secret and a fresh challenge", () => {
    const token = "a".repeat(64);
    const challenge = "b".repeat(64);
    expect(desktopHealthProof(token, challenge)).toBe(
      "f6cbb37b326d36f2f27d294ac3bb46a6aac29c1c9936b985576041bfb338ae70",
    );
    expect(desktopHealthProof(token, "c".repeat(64))).not.toBe(
      desktopHealthProof(token, challenge),
    );
  });

  it("rejects malformed tokens and challenges", () => {
    expect(desktopHealthProof("short", "b".repeat(64))).toBeNull();
    expect(desktopHealthProof("a".repeat(64), "not-hex".repeat(8))).toBeNull();
  });
});
