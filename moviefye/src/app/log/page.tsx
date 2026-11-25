import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { tmdbMode } from "@/lib/tmdb";
import { MovieCardRow } from "@/components/MovieCard";
import { LogWatchForm } from "./LogWatchForm";

export default async function LogPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const logs = await db.watchLog.findMany({
    where: { userId: user.id },
    orderBy: { watchedAt: "desc" },
    take: 20,
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Log a watch</h1>
        {tmdbMode() === "mock" && (
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted">
            Mock search — set TMDB_API_KEY for real titles
          </span>
        )}
      </div>

      <div className="mb-8 grid grid-cols-3 gap-3">
        <StatCard label="XP" value={user.xp} color="text-gamify" />
        <StatCard label="Current streak" value={user.currentStreak} color="text-flame" />
        <StatCard label="Longest streak" value={user.longestStreak} color="text-gamify" />
      </div>

      <LogWatchForm />

      <h2 className="mb-3 mt-12 text-lg font-semibold tracking-tight">Recent logs</h2>
      {logs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Nothing logged yet — your first watch starts the streak.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {logs.map((log) => (
            <li
              key={log.id}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <MovieCardRow
                title={log.title}
                mediaType={log.mediaType === "manual" ? "manual" : log.mediaType}
                posterPath={log.posterPath}
                rating={log.rating}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-3 text-center">
      <div className={`font-display text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
