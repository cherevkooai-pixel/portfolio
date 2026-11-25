export function XpToast({ xpEarned, currentStreak }: { xpEarned: number; currentStreak: number }) {
  return (
    <div className="animate-celebrate absolute -top-3 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-gamify px-4 py-2 text-sm font-display font-semibold text-gamify-foreground shadow-lg">
      +{xpEarned} XP · {currentStreak} day streak
    </div>
  );
}
