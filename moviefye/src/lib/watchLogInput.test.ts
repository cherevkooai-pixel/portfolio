import { describe, expect, it } from "vitest";
import { parseWatchLogInput } from "./watchLogInput";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("parseWatchLogInput", () => {
  it("rejects a missing title", () => {
    const result = parseWatchLogInput(fd({ watchedAt: "2026-01-01" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a manual entry with just a title", () => {
    const result = parseWatchLogInput(fd({ title: "Some Movie" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("Some Movie");
      expect(result.data.mediaType).toBe("manual");
      expect(result.data.tmdbId).toBe(0);
    }
  });

  it("accepts a TMDB-backed entry", () => {
    const result = parseWatchLogInput(
      fd({
        title: "Inception",
        mediaType: "movie",
        tmdbId: "27205",
        posterPath: "/poster.jpg",
        watchedAt: "2026-01-01",
        rating: "9.5",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tmdbId).toBe(27205);
      expect(result.data.mediaType).toBe("movie");
      expect(result.data.posterPath).toBe("/poster.jpg");
      expect(result.data.rating).toBe(9.5);
    }
  });

  it("rejects a future watch date", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
    const result = parseWatchLogInput(fd({ title: "X", watchedAt: future }));
    expect(result.ok).toBe(false);
  });

  it("rejects a rating above 10", () => {
    const result = parseWatchLogInput(fd({ title: "X", rating: "11" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a rating below the 0.5 minimum", () => {
    const result = parseWatchLogInput(fd({ title: "X", rating: "0" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a half-point rating", () => {
    const result = parseWatchLogInput(fd({ title: "X", rating: "8.5" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rating).toBe(8.5);
  });

  it("accepts the full 10", () => {
    const result = parseWatchLogInput(fd({ title: "X", rating: "10" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rating).toBe(10);
  });

  it("rejects a rating that isn't on a half-point step", () => {
    const result = parseWatchLogInput(fd({ title: "X", rating: "7.3" }));
    expect(result.ok).toBe(false);
  });

  it("falls back to manual for an unrecognized mediaType", () => {
    const result = parseWatchLogInput(fd({ title: "X", mediaType: "bogus" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.mediaType).toBe("manual");
  });
});
