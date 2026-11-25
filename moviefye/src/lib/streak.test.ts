import { describe, expect, it } from "vitest";
import { applyWatchLog, XP_PER_LOG, XP_REVIEW_BONUS } from "./streak";

const EMPTY = {
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastLoggedDate: null as Date | null,
};

describe("applyWatchLog", () => {
  it("starts a streak of 1 on the first ever log", () => {
    const result = applyWatchLog(EMPTY, new Date("2026-01-01T10:00:00Z"));
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.xp).toBe(XP_PER_LOG);
  });

  it("does not increase the streak for a second log on the same UTC day", () => {
    const first = applyWatchLog(EMPTY, new Date("2026-01-01T10:00:00Z"));
    const second = applyWatchLog(first, new Date("2026-01-01T22:00:00Z"));
    expect(second.currentStreak).toBe(1);
    expect(second.xp).toBe(XP_PER_LOG * 2);
  });

  it("increments the streak on the very next UTC day", () => {
    const first = applyWatchLog(EMPTY, new Date("2026-01-01T10:00:00Z"));
    const second = applyWatchLog(first, new Date("2026-01-02T05:00:00Z"));
    expect(second.currentStreak).toBe(2);
    expect(second.longestStreak).toBe(2);
  });

  it("resets the streak to 1 after a gap of more than one day", () => {
    const first = applyWatchLog(EMPTY, new Date("2026-01-01T10:00:00Z"));
    const second = applyWatchLog(first, new Date("2026-01-05T05:00:00Z"));
    expect(second.currentStreak).toBe(1);
  });

  it("keeps the longest streak after the current streak resets", () => {
    let state = applyWatchLog(EMPTY, new Date("2026-01-01T10:00:00Z"));
    state = applyWatchLog(state, new Date("2026-01-02T10:00:00Z"));
    state = applyWatchLog(state, new Date("2026-01-03T10:00:00Z"));
    expect(state.longestStreak).toBe(3);
    state = applyWatchLog(state, new Date("2026-01-10T10:00:00Z"));
    expect(state.currentStreak).toBe(1);
    expect(state.longestStreak).toBe(3);
  });

  it("always awards XP regardless of streak behavior", () => {
    let state = applyWatchLog(EMPTY, new Date("2026-01-01T10:00:00Z"));
    state = applyWatchLog(state, new Date("2026-01-01T12:00:00Z"));
    state = applyWatchLog(state, new Date("2026-01-10T12:00:00Z"));
    expect(state.xp).toBe(XP_PER_LOG * 3);
  });

  it("accepts a custom xp amount for a log with a review bonus", () => {
    const result = applyWatchLog(
      EMPTY,
      new Date("2026-01-01T10:00:00Z"),
      XP_PER_LOG + XP_REVIEW_BONUS
    );
    expect(result.xp).toBe(XP_PER_LOG + XP_REVIEW_BONUS);
  });
});
