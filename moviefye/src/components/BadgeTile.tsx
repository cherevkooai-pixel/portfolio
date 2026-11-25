export function BadgeTile({
  name,
  threshold,
  unlocked,
}: {
  name: string;
  threshold: number;
  unlocked: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center ${
        unlocked ? "border-gamify bg-gamify/10" : "border-border bg-surface opacity-50"
      }`}
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-lg font-bold ${
          unlocked ? "border-gamify text-gamify" : "border-border text-muted"
        }`}
      >
        {name.charAt(0)}
      </span>
      <span className="text-xs font-medium">{name}</span>
      <span className="text-[11px] text-muted">{threshold} XP</span>
    </div>
  );
}
