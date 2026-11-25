export const XP_PER_LOG = 10;
export const XP_REVIEW_BONUS = 5;
export const XP_DAILY_LOGIN = 2;
export const XP_LIKE = 1;
export const XP_LIKE_DAILY_CAP = 10;

export type StreakState = {
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastLoggedDate: Date | null;
};

function toUtcDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function applyWatchLog(
  state: StreakState,
  loggedAt: Date,
  xpEarned: number = XP_PER_LOG
): StreakState {
  const today = toUtcDateOnly(loggedAt);
  const last = state.lastLoggedDate ? toUtcDateOnly(state.lastLoggedDate) : null;

  let currentStreak: number;
  if (last === null) {
    currentStreak = 1;
  } else if (last === today) {
    currentStreak = state.currentStreak;
  } else if (today - last === ONE_DAY_MS) {
    currentStreak = state.currentStreak + 1;
  } else {
    currentStreak = 1;
  }

  return {
    xp: state.xp + xpEarned,
    currentStreak,
    longestStreak: Math.max(state.longestStreak, currentStreak),
    lastLoggedDate: loggedAt,
  };
}
