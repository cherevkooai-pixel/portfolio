from . import db, stats, time_utils as tu

BADGE_LABELS = {
    "streak_7": "🔥 7-Day Streak",
    "streak_30": "💪 30-Day Streak",
    "streak_60": "🏔 60-Day Streak",
    "finisher_90": "👑 90-Day Finisher",
    "perfect_week": "✅ Perfect Week",
    "money_week_1k": "💰 $1k Week",
}

_STREAK_THRESHOLDS = [(7, "streak_7"), (30, "streak_30"), (60, "streak_60"), (90, "finisher_90")]


def check_streak_badges(user_id: int) -> list:
    streak = stats.current_streak(user_id)
    today = tu.today_toronto().isoformat()
    newly = []
    for threshold, code in _STREAK_THRESHOLDS:
        if streak >= threshold and db.award_badge(user_id, code, today):
            newly.append(BADGE_LABELS[code])
    return newly


def check_week_badges(user_id: int, day_from: int, day_to: int) -> list:
    today = tu.today_toronto().isoformat()
    newly = []
    if stats.completed_in_range(user_id, day_from, day_to) == 7 and db.award_badge(
        user_id, "perfect_week", today
    ):
        newly.append(BADGE_LABELS["perfect_week"])
    if stats.money_in_range(user_id, day_from, day_to) >= 1000 and db.award_badge(
        user_id, "money_week_1k", today
    ):
        newly.append(BADGE_LABELS["money_week_1k"])
    return newly
