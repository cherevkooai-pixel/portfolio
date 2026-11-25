export type Tier = {
  level: number;
  name: string;
  threshold: number;
  /** Tailwind ring color for the avatar ring at this tier. */
  ringClassName: string;
  /** Accent color for the tier emblem / pet glow. */
  colorClassName: string;
  /**
   * Streak-pet artwork for this tier, served from /public/pets/.
   * Falls back to the inline SVG mascot when the file isn't present.
   */
  petImage: string;
  /** What the pet is holding/wearing at this tier — used as alt text and in the badge gallery. */
  petDescription: string;
};

// 10-tier ladder matching the streak-pet artwork, on a stretched XP curve so
// tiers keep their meaning deep into long-term play.
export const TIERS: Tier[] = [
  {
    level: 1,
    name: "Newcomer",
    threshold: 0,
    ringClassName: "ring-border",
    colorClassName: "text-muted",
    petImage: "/pets/tier-1.png",
    petDescription: "Flame with a fresh popcorn bucket",
  },
  {
    level: 2,
    name: "Moviegoer",
    threshold: 100,
    ringClassName: "ring-brand-teal",
    colorClassName: "text-brand-teal",
    petImage: "/pets/tier-2.png",
    petDescription: "Flame in 3D glasses",
  },
  {
    level: 3,
    name: "Regular",
    threshold: 250,
    ringClassName: "ring-brand-teal",
    colorClassName: "text-brand-teal",
    petImage: "/pets/tier-3.png",
    petDescription: "Flame with a clapperboard",
  },
  {
    level: 4,
    name: "Collector",
    threshold: 500,
    ringClassName: "ring-brand-purple",
    colorClassName: "text-brand-purple",
    petImage: "/pets/tier-4.png",
    petDescription: "Flame holding a film reel",
  },
  {
    level: 5,
    name: "Critic",
    threshold: 900,
    ringClassName: "ring-brand-purple",
    colorClassName: "text-brand-purple",
    petImage: "/pets/tier-5.png",
    petDescription: "Flame taking notes",
  },
  {
    level: 6,
    name: "Movie Buff",
    threshold: 1400,
    ringClassName: "ring-brand-coral",
    colorClassName: "text-brand-coral",
    petImage: "/pets/tier-6.png",
    petDescription: "Flame reclining with 3D glasses and a drink",
  },
  {
    level: 7,
    name: "Cinephile",
    threshold: 2100,
    ringClassName: "ring-brand-coral",
    colorClassName: "text-brand-coral",
    petImage: "/pets/tier-7.png",
    petDescription: "Flame in a director's chair with a megaphone",
  },
  {
    level: 8,
    name: "Film Lover",
    threshold: 3000,
    ringClassName: "ring-brand-orange",
    colorClassName: "text-brand-orange",
    petImage: "/pets/tier-8.png",
    petDescription: "Flame in shades with VIP popcorn",
  },
  {
    level: 9,
    name: "Auteur",
    threshold: 4200,
    ringClassName: "ring-brand-orange",
    colorClassName: "text-brand-orange",
    petImage: "/pets/tier-9.png",
    petDescription: "Flame behind the camera",
  },
  {
    level: 10,
    name: "Movie Legend",
    threshold: 6000,
    ringClassName: "ring-gamify",
    colorClassName: "text-gamify",
    petImage: "/pets/tier-10.png",
    petDescription: "Crowned flame on a film-reel throne",
  },
];

export function getTierForXp(xp: number): {
  tier: Tier;
  next: Tier | null;
  /** 0-1 progress from the current tier's threshold toward the next. 1 when maxed. */
  progress: number;
  /** XP still needed to reach the next tier; 0 when maxed. */
  xpToNext: number;
} {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (xp >= tier.threshold) current = tier;
  }

  const next = TIERS.find((t) => t.threshold > current.threshold) ?? null;
  const progress = next
    ? (xp - current.threshold) / (next.threshold - current.threshold)
    : 1;

  return {
    tier: current,
    next,
    progress: Math.min(1, Math.max(0, progress)),
    xpToNext: next ? Math.max(0, next.threshold - xp) : 0,
  };
}
