import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getFriends } from "@/lib/friends";
import { LeaderboardRow } from "@/components/LeaderboardRow";

export default async function LeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const friends = await getFriends(user.id);
  const ranked = [user, ...friends].sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    return b.longestStreak - a.longestStreak;
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Leaderboard</h1>

      {friends.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Add friends to start a leaderboard.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {ranked.map((person, index) => (
          <LeaderboardRow
            key={person.id}
            rank={index + 1}
            name={person.username ?? person.name}
            xp={person.xp}
            currentStreak={person.currentStreak}
            isSelf={person.id === user.id}
          />
        ))}
      </ol>
    </div>
  );
}
