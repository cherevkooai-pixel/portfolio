function FlameIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2c.5 3-1.5 4.5-3 6.5C7.2 10.5 6 12.5 6 15a6 6 0 0 0 12 0c0-2-1-3.5-2-5 0 1.5-.8 2.5-1.5 2.5-.9 0-1-1-1-2 0-2.5-1.8-4.5-1.5-8.5Z" />
    </svg>
  );
}

export function StreakFlame({
  days,
  size = "sm",
  atRisk = false,
}: {
  days: number;
  size?: "sm" | "lg";
  atRisk?: boolean;
}) {
  const color = days === 0 ? "text-muted" : atRisk ? "text-warning" : "text-flame";

  if (size === "lg") {
    return (
      <div className="flex flex-col items-center gap-2">
        <FlameIcon className={`h-16 w-16 ${color}`} />
        <span className="font-display text-4xl font-bold">{days}</span>
        <span className="text-sm text-muted">day{days === 1 ? "" : "s"} in a row</span>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`}>
      <FlameIcon className="h-4 w-4" />
      {days}
    </span>
  );
}
