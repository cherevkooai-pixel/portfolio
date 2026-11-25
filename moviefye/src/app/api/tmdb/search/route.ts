import { NextRequest, NextResponse } from "next/server";
import { searchTitles } from "@/lib/tmdb";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchTitles(query);
    return NextResponse.json({ results: results.slice(0, 8) });
  } catch (err) {
    return NextResponse.json(
      { results: [], error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 }
    );
  }
}
