import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ results: [] }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const users = await db.user.findMany({
    where: {
      username: { contains: query },
      NOT: { id: user.id },
    },
    select: { username: true },
    take: 10,
  });

  return NextResponse.json({ results: users.map((u) => u.username) });
}
