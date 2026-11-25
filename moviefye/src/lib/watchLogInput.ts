export type WatchLogInput = {
  tmdbId: number;
  mediaType: string;
  title: string;
  posterPath: string | null;
  watchedAt: Date;
  rating: number | null;
  notes: string | null;
};

export type ParseResult =
  | { ok: true; data: WatchLogInput }
  | { ok: false; error: string };

export function parseWatchLogInput(formData: FormData): ParseResult {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    return { ok: false, error: "Title is required." };
  }
  if (title.length > 200) {
    return { ok: false, error: "Title must be 200 characters or fewer." };
  }

  const mediaTypeRaw = String(formData.get("mediaType") ?? "manual").trim();
  const mediaType = ["movie", "tv", "manual"].includes(mediaTypeRaw) ? mediaTypeRaw : "manual";

  const tmdbIdRaw = formData.get("tmdbId");
  const tmdbId = tmdbIdRaw ? Number(tmdbIdRaw) : 0;
  if (!Number.isInteger(tmdbId) || tmdbId < 0) {
    return { ok: false, error: "Invalid title reference." };
  }

  const posterPathRaw = formData.get("posterPath");
  const posterPath = posterPathRaw ? String(posterPathRaw) : null;

  const watchedAtRaw = String(formData.get("watchedAt") ?? "");
  const watchedAt = watchedAtRaw ? new Date(watchedAtRaw) : new Date();
  if (Number.isNaN(watchedAt.getTime())) {
    return { ok: false, error: "Invalid watch date." };
  }
  if (watchedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { ok: false, error: "Watch date can't be in the future." };
  }

  const ratingRaw = formData.get("rating");
  let rating: number | null = null;
  if (ratingRaw !== null && String(ratingRaw).trim() !== "") {
    rating = Number(ratingRaw);
    // 10-point scale in half-point steps: 0.5, 1, 1.5 … 10.
    if (
      !Number.isFinite(rating) ||
      rating < 0.5 ||
      rating > 10 ||
      !Number.isInteger(rating * 2)
    ) {
      return { ok: false, error: "Rating must be between 0.5 and 10, in half-point steps." };
    }
  }

  const notesRaw = formData.get("notes");
  const notes = notesRaw ? String(notesRaw).trim().slice(0, 2000) : null;

  return {
    ok: true,
    data: { tmdbId, mediaType, title, posterPath, watchedAt, rating, notes: notes || null },
  };
}
