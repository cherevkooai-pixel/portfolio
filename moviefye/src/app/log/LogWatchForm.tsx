"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { logWatch, type LogWatchState } from "./actions";
import { RatingStarsInput } from "@/components/RatingStars";
import { MovieCardRow } from "@/components/MovieCard";
import { XpToast } from "@/components/XpToast";
import type { TmdbSearchResult } from "@/lib/tmdb";

const initialState: LogWatchState = { error: null, success: null };

export function LogWatchForm() {
  const [state, formAction, pending] = useActionState(logWatch, initialState);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [selected, setSelected] = useState<TmdbSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ xpEarned: number; currentStreak: number } | null>(null);
  const [ratingKey, setRatingKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!query.trim() || selected) {
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, selected]);

  useEffect(() => {
    if (!pending && state.success && formRef.current) {
      formRef.current.reset();
      setQuery("");
      setResults([]);
      setSelected(null);
      setRatingKey((k) => k + 1);
      setToast(state.success);
    }
  }, [pending, state]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timeout);
  }, [toast]);

  return (
    <div className="relative">
      {toast && <XpToast xpEarned={toast.xpEarned} currentStreak={toast.currentStreak} />}

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm"
      >
        <div
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setResults([]);
            }
          }}
        >
          <label htmlFor="title" className="mb-1 block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="Search a movie or show, or type a title manually"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent"
          />
          {searching && <p className="mt-1 text-xs text-muted">Searching…</p>}
          {!selected && query.trim() && results.length > 0 && (
            <ul className="animate-pop-in mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {results.map((r) => (
                <li key={`${r.mediaType}-${r.tmdbId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setQuery(r.title);
                      setResults([]);
                    }}
                    className="w-full px-3 py-2 text-left transition-colors hover:bg-background"
                  >
                    <MovieCardRow
                      title={r.title}
                      year={r.year}
                      mediaType={r.mediaType}
                      posterPath={r.posterPath}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!selected && results.length === 0 && (
            <p className="mt-1 text-xs text-muted">
              No result selected — this will log a manual entry.
            </p>
          )}
        </div>

        <input type="hidden" name="mediaType" value={selected?.mediaType ?? "manual"} />
        <input type="hidden" name="tmdbId" value={selected?.tmdbId ?? ""} />
        <input type="hidden" name="posterPath" value={selected?.posterPath ?? ""} />

        <div>
          <label htmlFor="watchedAt" className="mb-1 block text-sm font-medium">
            Watched on
          </label>
          <input
            id="watchedAt"
            name="watchedAt"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent"
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium">Rating (optional)</span>
          <RatingStarsInput key={ratingKey} name="rating" />
        </div>

        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent"
          />
        </div>

        {state.error && <p className="text-sm text-flame">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
        >
          {pending ? "Logging…" : "Log watch"}
        </button>
      </form>
    </div>
  );
}
