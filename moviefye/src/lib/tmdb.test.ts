import { describe, expect, it, beforeEach } from "vitest";
import { searchTitles, tmdbMode } from "./tmdb";

describe("tmdb mock mode", () => {
  beforeEach(() => {
    delete process.env.TMDB_API_KEY;
  });

  it("reports mock mode when no API key is set", () => {
    expect(tmdbMode()).toBe("mock");
  });

  it("returns no results for an empty query", async () => {
    const results = await searchTitles("");
    expect(results).toEqual([]);
  });

  it("finds a case-insensitive substring match", async () => {
    const results = await searchTitles("inception");
    expect(results.some((r) => r.title === "Inception")).toBe(true);
  });

  it("returns nothing for a query with no matches", async () => {
    const results = await searchTitles("zzz_no_such_title");
    expect(results).toEqual([]);
  });
});
