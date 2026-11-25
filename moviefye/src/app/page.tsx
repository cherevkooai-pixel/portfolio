import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
        Track. Earn XP. Compete.
      </span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Every watch counts.
      </h1>
      <p className="max-w-md text-muted">
        Log the movies and shows you watch, build a streak, and climb the leaderboard with
        friends.
      </p>
      <Link
        href="/log"
        className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground shadow-sm transition-transform hover:scale-[1.03] active:scale-[0.98]"
      >
        Log a watch
      </Link>
    </main>
  );
}
