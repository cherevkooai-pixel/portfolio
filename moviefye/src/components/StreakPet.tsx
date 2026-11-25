"use client";

import { useState } from "react";
import { getTierForXp, type Tier } from "@/lib/tiers";

const SIZES = {
  sm: "h-10 w-10",
  md: "h-20 w-20",
  lg: "h-40 w-40",
} as const;

/**
 * Inline fallback mascot, used until the tier artwork PNGs are added to
 * /public/pets/. Deliberately simple: a friendly flame with a face.
 */
function FlameFallback({ className, glowClassName }: { className: string; glowClassName: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`${className} ${glowClassName}`} aria-hidden="true">
      <path
        d="M32 4c2 10-4 14-8.5 19.5C19 29 16 34 16 40a16 16 0 0 0 32 0c0-5.5-2.5-9.5-5.5-13.5-.5 4-2.5 6.5-4.5 6.5-2.5 0-3-2.5-3-5.5C35 20 30.5 13 32 4Z"
        fill="currentColor"
      />
      <ellipse cx="26" cy="42" rx="2.6" ry="3.4" fill="#1c1917" />
      <ellipse cx="38" cy="42" rx="2.6" ry="3.4" fill="#1c1917" />
      <path
        d="M28.5 49c1 1.4 2.2 2.1 3.5 2.1s2.5-.7 3.5-2.1"
        stroke="#1c1917"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function StreakPet({
  xp = 0,
  tier: tierOverride,
  size = "md",
  className = "",
}: {
  xp?: number;
  tier?: Tier;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [artworkFailed, setArtworkFailed] = useState(false);
  const tier = tierOverride ?? getTierForXp(xp).tier;
  const sizeClass = SIZES[size];

  if (artworkFailed) {
    return (
      <span className={`inline-flex ${className}`} title={`${tier.name} — ${tier.petDescription}`}>
        <FlameFallback className={sizeClass} glowClassName={tier.colorClassName} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tier.petImage}
      alt={`${tier.name} — ${tier.petDescription}`}
      title={`${tier.name} — ${tier.petDescription}`}
      onError={() => setArtworkFailed(true)}
      className={`${sizeClass} object-contain ${className}`}
    />
  );
}
