export type TmdbSearchResult = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  year: string | null;
};

const MOCK_CATALOG: TmdbSearchResult[] = [
  { tmdbId: 27205, mediaType: "movie", title: "Inception", posterPath: "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg", year: "2010" },
  { tmdbId: 155, mediaType: "movie", title: "The Dark Knight", posterPath: "/qJ2tW6WMUDux911r6m7haRef0WH.jpg", year: "2008" },
  { tmdbId: 1396, mediaType: "tv", title: "Breaking Bad", posterPath: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", year: "2008" },
  { tmdbId: 550, mediaType: "movie", title: "Fight Club", posterPath: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", year: "1999" },
  { tmdbId: 1399, mediaType: "tv", title: "Game of Thrones", posterPath: "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", year: "2011" },
];

function isMockMode(): boolean {
  return !process.env.TMDB_API_KEY;
}

export function tmdbMode(): "live" | "mock" {
  return isMockMode() ? "mock" : "live";
}

async function searchMock(query: string): Promise<TmdbSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return MOCK_CATALOG.filter((item) => item.title.toLowerCase().includes(q));
}

function isV4ReadAccessToken(key: string): boolean {
  // v4 read access tokens are long JWTs (three dot-separated segments);
  // v3 API keys are a bare 32-character hex string.
  return key.includes(".");
}

async function searchLive(query: string): Promise<TmdbSearchResult[]> {
  const key = process.env.TMDB_API_KEY!;
  const url = new URL("https://api.themoviedb.org/3/search/multi");
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");

  const headers: HeadersInit = {};
  if (isV4ReadAccessToken(key)) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`TMDB search failed with status ${res.status}`);
  }

  const data = (await res.json()) as {
    results: Array<{
      id: number;
      media_type: string;
      title?: string;
      name?: string;
      poster_path: string | null;
      release_date?: string;
      first_air_date?: string;
    }>;
  };

  return data.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({
      tmdbId: r.id,
      mediaType: r.media_type as "movie" | "tv",
      title: (r.title ?? r.name ?? "Untitled").trim(),
      posterPath: r.poster_path,
      year: (r.release_date ?? r.first_air_date ?? "").slice(0, 4) || null,
    }));
}

export async function searchTitles(query: string): Promise<TmdbSearchResult[]> {
  if (isMockMode()) {
    return searchMock(query);
  }
  return searchLive(query);
}
