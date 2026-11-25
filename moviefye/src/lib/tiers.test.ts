import { describe, expect, it } from "vitest";
import { getTierForXp, TIERS } from "./tiers";

describe("tier ladder", () => {
  it("has 10 tiers on a strictly increasing XP curve", () => {
    expect(TIERS).toHaveLength(10);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].threshold).toBeGreaterThan(TIERS[i - 1].threshold);
      expect(TIERS[i].level).toBe(i + 1);
    }
  });

  it("starts every new user at the first tier", () => {
    const { tier, next } = getTierForXp(0);
    expect(tier.name).toBe("Newcomer");
    expect(next?.name).toBe("Moviegoer");
  });

  it("stays on a tier until the next threshold is actually reached", () => {
    expect(getTierForXp(99).tier.name).toBe("Newcomer");
    expect(getTierForXp(100).tier.name).toBe("Moviegoer");
  });

  it("reports progress and remaining XP toward the next tier", () => {
    const { progress, xpToNext } = getTierForXp(50); // halfway from 0 to 100
    expect(progress).toBeCloseTo(0.5);
    expect(xpToNext).toBe(50);
  });

  it("caps out at the final tier", () => {
    const { tier, next, progress, xpToNext } = getTierForXp(999_999);
    expect(tier.name).toBe("Movie Legend");
    expect(next).toBeNull();
    expect(progress).toBe(1);
    expect(xpToNext).toBe(0);
  });

  it("gives every tier its own pet artwork path", () => {
    const paths = TIERS.map((t) => t.petImage);
    expect(new Set(paths).size).toBe(TIERS.length);
  });
});
