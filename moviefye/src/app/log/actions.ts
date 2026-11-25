"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseWatchLogInput } from "@/lib/watchLogInput";
import { applyWatchLog, XP_PER_LOG, XP_REVIEW_BONUS } from "@/lib/streak";

export type LogWatchState = {
  error: string | null;
  success: { xpEarned: number; currentStreak: number } | null;
};

export async function logWatch(
  _prevState: LogWatchState,
  formData: FormData
): Promise<LogWatchState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be logged in to log a watch.", success: null };
  }

  const parsed = parseWatchLogInput(formData);
  if (!parsed.ok) {
    return { error: parsed.error, success: null };
  }

  const loggedAt = new Date();
  const hasReview = !!parsed.data.notes;
  const xpEarned = XP_PER_LOG + (hasReview ? XP_REVIEW_BONUS : 0);
  const streakUpdate = applyWatchLog(user, loggedAt, xpEarned);

  await db.$transaction(async (tx) => {
    const watchLog = await tx.watchLog.create({
      data: {
        userId: user.id,
        tmdbId: parsed.data.tmdbId,
        mediaType: parsed.data.mediaType,
        title: parsed.data.title,
        posterPath: parsed.data.posterPath,
        watchedAt: parsed.data.watchedAt,
        rating: parsed.data.rating,
        notes: parsed.data.notes,
      },
    });

    if (parsed.data.tmdbId > 0) {
      await tx.film.upsert({
        where: {
          tmdbId_mediaType: { tmdbId: parsed.data.tmdbId, mediaType: parsed.data.mediaType },
        },
        update: {},
        create: {
          tmdbId: parsed.data.tmdbId,
          mediaType: parsed.data.mediaType,
          title: parsed.data.title,
          posterPath: parsed.data.posterPath,
        },
      });
    }

    await tx.post.create({
      data: {
        authorId: user.id,
        type: "watch_log",
        watchLogId: watchLog.id,
        visibility: "friends",
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        xp: streakUpdate.xp,
        currentStreak: streakUpdate.currentStreak,
        longestStreak: streakUpdate.longestStreak,
        lastLoggedDate: streakUpdate.lastLoggedDate,
      },
    });
  });

  revalidatePath("/log");
  return {
    error: null,
    success: { xpEarned, currentStreak: streakUpdate.currentStreak },
  };
}
