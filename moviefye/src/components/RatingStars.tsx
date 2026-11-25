"use client";

import { useId, useState } from "react";

const STAR_PATH =
  "M10 1.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z";

/**
 * A single star rendered at 0, 50 or 100% fill.
 * Half fill uses a clipPath so the partial star keeps the exact star silhouette.
 */
function Star({ fill, className }: { fill: 0 | 0.5 | 1; className?: string }) {
  const clipId = useId();

  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={fill === 0.5 ? 10 : 20} height="20" />
        </clipPath>
      </defs>
      <path d={STAR_PATH} className="fill-none stroke-border stroke-[1.5]" />
      {fill > 0 && (
        <path d={STAR_PATH} className="fill-gamify" clipPath={`url(#${clipId})`} />
      )}
    </svg>
  );
}

function fillFor(starIndex: number, value: number): 0 | 0.5 | 1 {
  // starIndex is 1-5; each star covers 2 points of the 10-point scale.
  const filledPoints = value - (starIndex - 1) * 2;
  if (filledPoints >= 2) return 1;
  if (filledPoints >= 1) return 0.5;
  return 0;
}

/** Read-only display of a 10-point rating as 5 half-fillable stars. */
export function RatingStars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" title={`${value} out of 10`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} fill={fillFor(star, value)} className="h-3.5 w-3.5" />
      ))}
    </div>
  );
}

/**
 * Interactive 10-point rating input. Each star has two hit targets (left half =
 * .5, right half = whole), and there's a native range input for keyboard and
 * screen-reader users so the control isn't mouse-only.
 */
export function RatingStarsInput({ name }: { name: string }) {
  const [value, setValue] = useState(0);
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={value || ""} />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map((star) => {
            const half = (star - 1) * 2 + 1;
            const whole = star * 2;
            return (
              <span key={star} className="relative inline-flex">
                <Star fill={fillFor(star, shown)} className="h-7 w-7" />
                <button
                  type="button"
                  aria-label={`Rate ${half} out of 10`}
                  onMouseEnter={() => setHovered(half)}
                  onClick={() => setValue(value === half ? 0 : half)}
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                />
                <button
                  type="button"
                  aria-label={`Rate ${whole} out of 10`}
                  onMouseEnter={() => setHovered(whole)}
                  onClick={() => setValue(value === whole ? 0 : whole)}
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                />
              </span>
            );
          })}
        </div>

        <span className="font-display text-sm font-bold text-gamify tabular-nums">
          {shown ? `${shown}/10` : "—"}
        </span>
      </div>

      <label className="sr-only" htmlFor={`${name}-range`}>
        Rating out of 10
      </label>
      <input
        id={`${name}-range`}
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="h-1 w-40 cursor-pointer accent-gamify"
      />
    </div>
  );
}
