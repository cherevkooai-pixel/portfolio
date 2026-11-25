import { getTierForXp } from "@/lib/tiers";

const SIZES = {
  sm: "h-8 w-8 text-xs ring-2",
  md: "h-11 w-11 text-sm ring-2",
  lg: "h-20 w-20 text-2xl ring-4",
} as const;

export function Avatar({
  name,
  xp = 0,
  size = "md",
}: {
  name: string;
  xp?: number;
  size?: keyof typeof SIZES;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const { tier } = getTierForXp(xp);

  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full bg-surface-raised font-display font-semibold text-foreground ring-offset-2 ring-offset-background ${tier.ringClassName} ${SIZES[size]}`}
      title={tier.name}
    >
      {initial}
    </span>
  );
}
