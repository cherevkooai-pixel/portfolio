from . import db, time_utils as tu


def _day_satisfied(entry) -> bool:
    if entry is None:
        return False
    return bool(entry["completed_bool"]) or bool(entry["skipped_bool"])


def current_streak(user_id: int) -> int:
    today = tu.today_day_number()
    streak = 0
    d = today
    today_entry = db.get_entry(user_id, today)
    if today_entry and today_entry["completed_bool"]:
        streak = 1
        d = today - 1
    else:
        d = today - 1
    while d >= 1:
        e = db.get_entry(user_id, d)
        if _day_satisfied(e):
            streak += 1
            d -= 1
        else:
            break
    return streak


def longest_streak(user_id: int) -> int:
    entries = {e["day_number"]: e for e in db.all_entries_for_user(user_id)}
    last_day = min(tu.today_day_number(), 90)
    longest = run = 0
    for d in range(1, last_day + 1):
        if _day_satisfied(entries.get(d)):
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return longest


def total_completed(user_id: int) -> int:
    return sum(1 for e in db.all_entries_for_user(user_id) if e["completed_bool"])


def total_money(user_id: int) -> float:
    return sum(
        e["amount"] or 0 for e in db.all_entries_for_user(user_id) if e["amount"] is not None
    )


def money_in_range(user_id: int, day_from: int, day_to: int) -> float:
    return sum(
        e["amount"] or 0
        for e in db.entries_in_range(user_id, day_from, day_to)
        if e["amount"] is not None
    )


def completed_in_range(user_id: int, day_from: int, day_to: int) -> int:
    return sum(1 for e in db.entries_in_range(user_id, day_from, day_to) if e["completed_bool"])


def missing_today(user_id: int) -> list:
    today = tu.today_day_number()
    e = db.get_entry(user_id, today)
    missing = []
    if not e or not e["photo_file_id"]:
        missing.append("photo")
    if not e or not e["physique_note"]:
        missing.append("physique note")
    if not e or not e["verse"]:
        missing.append("verse")
    if not e or not e["verse_note"]:
        missing.append("why it hit")
    if not e or e["amount"] is None:
        missing.append("$ amount")
    if not e or not e["action"]:
        missing.append("business action")
    return missing


def is_complete_today(user_id: int) -> bool:
    return len(missing_today(user_id)) == 0
