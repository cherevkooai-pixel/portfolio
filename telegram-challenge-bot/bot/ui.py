"""Presentation layer.

Every user-facing string is built here so the bot speaks with one consistent
visual language. All output is HTML — anything a user typed must go through
esc() before it lands in a message.
"""
import html

from . import config, db, stats, time_utils as tu

TOTAL_DAYS = 90
BAR_WIDTH = 10
TOTAL_STEPS = 6  # photo, physique note, verse, why, amount, action
FILLED, EMPTY = "▰", "▱"
RULE = "━━━━━━━━━━━━━━━"

# scope key -> (icon, button label)
SCOPES = (
    ("challenge", "🏁", "Challenge (90 days)"),
    ("month", "📅", "This month"),
    ("week", "🗓", "This week"),
)
SCOPE_ICONS = {k: i for k, i, _ in SCOPES}


# ---------------- primitives ----------------

def esc(value) -> str:
    """HTML-escape anything that came from a human."""
    return html.escape("" if value is None else str(value), quote=False)


def clip(value, limit: int = 200) -> str:
    text = ("" if value is None else str(value)).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def progress_bar(day: int, width: int = BAR_WIDTH) -> str:
    done = max(0, min(day, TOTAL_DAYS))
    filled = int(round(width * done / TOTAL_DAYS))
    pct = int(round(100 * done / TOTAL_DAYS))
    return f"{FILLED * filled}{EMPTY * (width - filled)} {pct}%"


def day_line(day: int = None) -> str:
    d = tu.today_day_number() if day is None else day
    shown = max(1, min(d, TOTAL_DAYS))
    return f"Day {shown} of {TOTAL_DAYS} · {max(TOTAL_DAYS - d, 0)} to go"


def name_of(uid: int) -> str:
    u = db.get_user(uid)
    return esc(u["name"] if u else uid)


def money(value) -> str:
    return f"${(value or 0):,.0f}"


# ---------------- goals ----------------

def period_index(scope: str, day: int) -> int:
    if scope == "challenge":
        return 0
    if scope == "month":
        return tu.month_index(day)
    return tu.week_index(day)


def scope_label(scope: str, day: int) -> str:
    if scope == "challenge":
        return "90-day"
    if scope == "month":
        return f"Month {tu.month_index(day)}"
    return f"Week {tu.week_index(day)}"


def goal_lines(uid: int, day: int, indent: str = "") -> list:
    """One line per scope; unset goals show a gentle nudge instead of blanks."""
    out = []
    for scope, icon, _ in SCOPES:
        g = db.get_goal(uid, scope, period_index(scope, day))
        label = scope_label(scope, day)
        if g:
            out.append(f"{indent}{icon} <i>{label}</i> · {esc(clip(g['text']))}")
        else:
            out.append(f"{indent}{icon} <i>{label}</i> · <i>not set</i>")
    return out


def week_goal_line(uid: int, day: int) -> str:
    """The single most actionable goal — used on cards and reminders."""
    g = db.get_goal(uid, "week", tu.week_index(day))
    if not g:
        return ""
    return f"🎯 <i>{scope_label('week', day)}</i> · {esc(clip(g['text'], 90))}"


# ---------------- screens ----------------

def help_screen(day: int) -> str:
    return (
        f"🔥 <b>90 HARD</b>\n"
        f"{day_line(day)}\n"
        f"{progress_bar(day)}\n\n"
        f"<b>DAILY</b>\n"
        f"/log · log today's three\n"
        f"/edit today · fix today's entry\n"
        f"/clear · wipe today and restart\n\n"
        f"<b>GOALS</b>\n"
        f"/goals · see both our goals\n"
        f"/setgoal · set a 90-day, month or week goal\n\n"
        f"<b>PROGRESS</b>\n"
        f"/stats · your numbers\n"
        f"/today · who's done today\n"
        f"/leaderboard · head to head\n\n"
        f"<b>SAFETY NET</b>\n"
        f"/skip · spend your one skip pass"
    )


def stats_screen(uid: int, day: int) -> str:
    u = db.get_user(uid)
    skip = "spent" if (u and u["skip_pass_used"]) else "available"
    owed = db.total_forfeits(uid)
    lines = [
        f"📊 <b>{name_of(uid).upper()}</b>",
        day_line(day),
        progress_bar(day),
        "",
        f"🔥 Streak · <b>{stats.current_streak(uid)}-day</b>"
        f"  (best {stats.longest_streak(uid)})",
        f"✅ Completed · <b>{stats.total_completed(uid)}/{TOTAL_DAYS}</b>",
        f"💵 Earned · <b>{money(stats.total_money(uid))}</b>",
        f"🎟 Skip pass · <b>{skip}</b>",
    ]
    if owed:
        lines.append(f"⚠️ Forfeits · <b>{money(owed)}</b>")

    earned = db.get_badges(uid)
    if earned:
        lines += ["", "🏅 <b>BADGES</b>",
                  "   " + "  ".join(b["badge_code"] for b in earned)]

    lines += ["", "🎯 <b>GOALS</b>"] + goal_lines(uid, day)
    return "\n".join(lines)


def today_screen(day: int) -> str:
    lines = [f"📅 <b>TODAY</b> · {day_line(day)}", progress_bar(day), ""]
    for uid in config.ALLOWED_USER_IDS:
        entry = db.get_entry(uid, day)
        name = name_of(uid)
        if entry and entry["skipped_bool"]:
            lines.append(f"🎟 <b>{name}</b> · skip pass used")
            continue
        missing = stats.missing_today(uid)
        if not missing:
            lines.append(f"✅ <b>{name}</b> · locked in")
        elif len(missing) == TOTAL_STEPS:
            lines.append(f"⏳ <b>{name}</b> · not started")
        else:
            done = TOTAL_STEPS - len(missing)
            lines.append(f"⏳ <b>{name}</b> · {done}/{TOTAL_STEPS} — needs {', '.join(missing)}")
    return "\n".join(lines)


def leaderboard_screen(day: int) -> str:
    ranked = sorted(
        config.ALLOWED_USER_IDS,
        key=lambda u: (stats.total_completed(u), stats.total_money(u), stats.current_streak(u)),
        reverse=True,
    )
    medals = ["🥇", "🥈"]
    lines = ["🏆 <b>LEADERBOARD</b>", day_line(day), progress_bar(day), ""]
    for i, uid in enumerate(ranked):
        lines.append(f"{medals[i] if i < len(medals) else '•'} <b>{name_of(uid)}</b>")
        lines.append(
            f"    🔥 {stats.current_streak(uid)}-day"
            f"  ·  ✅ {stats.total_completed(uid)}/{TOTAL_DAYS}"
            f"  ·  💵 {money(stats.total_money(uid))}"
        )
        if i < len(ranked) - 1:
            lines.append("")
    return "\n".join(lines)


def goals_screen(day: int) -> str:
    lines = ["🎯 <b>GOALS</b>", day_line(day), ""]
    for i, uid in enumerate(config.ALLOWED_USER_IDS):
        lines.append(f"{RULE}\n<b>{name_of(uid).upper()}</b>")
        lines += goal_lines(uid, day)
        if i < len(config.ALLOWED_USER_IDS) - 1:
            lines.append("")
    lines += ["", "<i>/setgoal to change yours</i>"]
    return "\n".join(lines)


def card_caption(uid: int, day: int, new_badges: list) -> str:
    """The one message that survives in the chat — make it count."""
    e = db.get_entry(uid, day)
    lines = [
        f"🏆 <b>{name_of(uid).upper()}</b> · Day {max(1, min(day, TOTAL_DAYS))}/{TOTAL_DAYS}",
        progress_bar(day),
        "",
        "💪 <b>PHYSIQUE</b>",
        esc(clip(e["physique_note"])),
        "",
        "📖 <b>MENTAL</b>",
        f"“{esc(clip(e['verse']))}”",
        f"↳ <i>{esc(clip(e['verse_note']))}</i>",
        "",
        "💰 <b>MONEY</b>",
        f"<b>{money(e['amount'])}</b> · {esc(clip(e['action']))}",
        "",
        RULE,
        f"🔥 {stats.current_streak(uid)}-day streak"
        f" · 💵 {money(stats.total_money(uid))} total",
    ]
    goal = week_goal_line(uid, day)
    if goal:
        lines.append(goal)
    if new_badges:
        lines.append(f"🏅 <b>NEW BADGE</b> · {esc(', '.join(new_badges))}")
    return "\n".join(lines)


def reminder_screen(day: int, blocks: list, is_deadline: bool) -> str:
    head = "⚠️ <b>LAST CALL</b>" if is_deadline else "⏰ <b>CHECK IN</b>"
    return "\n".join([
        f"{head} · {day_line(day)}",
        "",
        "\n\n".join(blocks),
        "",
        "<i>/log to knock it out</i>",
    ])


def morning_board(day: int) -> str:
    """Posted once every morning — the daily reminder of what we're chasing."""
    lines = [
        f"🌅 <b>DAY {max(1, min(day, TOTAL_DAYS))}</b> · {max(TOTAL_DAYS - day, 0)} to go",
        progress_bar(day),
        "",
        "🎯 <b>TODAY WE'RE CHASING</b>",
    ]
    for uid in config.ALLOWED_USER_IDS:
        lines.append("")
        lines.append(f"{RULE}\n<b>{name_of(uid).upper()}</b>")
        lines += goal_lines(uid, day)
        entry = db.get_entry(uid, day)
        if entry and entry["completed_bool"]:
            lines.append("✅ <i>today already logged</i>")
    lines += ["", "<i>/log when you're done · /setgoal to change a goal</i>"]
    return "\n".join(lines)
