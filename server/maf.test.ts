import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  BUILD_SECTIONS,
  BUILD_STEPS,
  GENERATION_MESSAGES,
  PLATFORM_IMAGE_FORMATS,
  getPlatformImageFormat,
} from "../shared/maf-constants";

describe("MAF foundation constants", () => {
  it("defines the four BUILD sections in order", () => {
    expect(BUILD_SECTIONS).toEqual(["research", "offer", "brand", "strategy"]);
  });

  it("defines every BUILD step exactly once", () => {
    const keys = BUILD_SECTIONS.flatMap(section => BUILD_STEPS[section].map(step => step.key));
    expect(keys).toEqual(["1a", "1b", "2a", "2b", "2c", "3a", "3b", "3c", "4a", "4b"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps offer capture manual and downstream synthesis automated", () => {
    expect(BUILD_STEPS.offer.find(step => step.key === "2a")).toMatchObject({
      hasIntake: true,
      hasAI: false,
    });
    expect(BUILD_STEPS.offer.find(step => step.key === "2b")).toMatchObject({
      hasIntake: false,
      hasAI: true,
    });
  });

  it("provides progress messages for generated BUILD steps", () => {
    const generatedSteps = BUILD_SECTIONS.flatMap(section => BUILD_STEPS[section])
      .filter(step => step.hasAI)
      .map(step => step.key);
    for (const stepKey of generatedSteps) {
      expect(GENERATION_MESSAGES[stepKey]?.length).toBeGreaterThan(0);
    }
  });

  it("defines honest requested image formats without claiming exact pixels", () => {
    expect(PLATFORM_IMAGE_FORMATS.instagram).toEqual({
      label: "Instagram square",
      aspectRatio: "1:1",
    });
    expect(PLATFORM_IMAGE_FORMATS.linkedin).toEqual({
      label: "LinkedIn landscape",
      aspectRatio: "16:9",
    });
    expect(getPlatformImageFormat("unsupported")).toEqual({
      label: "Landscape image",
      aspectRatio: "16:9",
    });
    expect(PLATFORM_IMAGE_FORMATS.instagram).not.toHaveProperty("width");
    expect(PLATFORM_IMAGE_FORMATS.instagram).not.toHaveProperty("height");
  });
});

describe("system health", () => {
  it("is available in a local workspace", async () => {
    const ctx = {
      workspaceId: 1,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    } satisfies TrpcContext;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.system.health({ timestamp: Date.now() })).resolves.toEqual({ ok: true });
  });
});
