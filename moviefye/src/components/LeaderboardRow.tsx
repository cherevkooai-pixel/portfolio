import { Avatar } from "@/components/Avatar";
import { StreakFlame } from "@/components/StreakFlame";

export function LeaderboardRow({
  rank,
  name,
  xp,
  currentStreak,
  isSelf = false,
}: {
  rank: number;
  name: string;
  xp: number;
  currentStreak: number;
  isSelf?: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
        isSelf ? "border-accent bg-accent/10" : "border-border bg-surface"
      }`}
    >
      <span className="w-5 text-center text-xs font-semibold text-muted">{rank}</span>
      <Avatar name={name} xp={xp} size="sm" />
      <span className="flex-1 font-medium">{isSelf ? "You" : name}</span>
      <StreakFlame days={currentStreak} />
      <span className="font-display font-semibold text-gamify">{xp} XP</span>
    </li>
  );
}
