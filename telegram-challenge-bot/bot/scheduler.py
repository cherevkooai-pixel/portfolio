import os
import shutil

from telegram.ext import ContextTypes

from . import config, db, reports, stats, time_utils as tu, ui


# A reminder more than this far past its slot is stale (the bot was asleep or
# restarted); mark it done instead of dumping old pings into the chat.
STALE_AFTER_MINUTES = 120


def _all_reminder_slots():
    """Regular reminder times, then the deadline as a final 'last call' slot."""
    return list(config.REMINDER_TIMES) + [config.DEADLINE_TIME]


def _minutes_since(hhmm_now: str, hhmm_slot: str) -> int:
    def to_min(s):
        h, m = s.split(":")
        return int(h) * 60 + int(m)

    return to_min(hhmm_now) - to_min(hhmm_slot)


async def tick(context: ContextTypes.DEFAULT_TYPE):
    now = tu.now_toronto()
    hhmm = now.strftime("%H:%M")
    today_iso = now.date().isoformat()

    # Nightly backup — once per calendar day.
    backup_key = f"backup_{today_iso}"
    if now.hour == 0 and not db.has_fired(backup_key):
        _run_backup()
        db.mark_fired(backup_key)

    day = tu.today_day_number()
    if day < 1:
        return

    # Reminders (3 configured times + 1 deadline "last call"), only while
    # something is still missing for at least one person.
    slots = _all_reminder_slots()
    for idx, slot_time in enumerate(slots):
        key = f"reminder_{day}_{idx}"
        if hhmm >= slot_time and not db.has_fired(key):
            if _minutes_since(hhmm, slot_time) <= STALE_AFTER_MINUTES:
                if idx == 0:
                    # First slot of the day is the goals board — it always posts,
                    # so we both get reminded of what we're chasing every day.
                    await _send_morning_board(context, day)
                else:
                    await _send_reminder(context, day, is_deadline=(idx == len(slots) - 1))
            db.mark_fired(key)

    # Midnight rollover for the day that just ended.
    if hhmm >= "00:00":
        prev_day = day - 1
        rollover_key = f"rollover_{prev_day}"
        if 1 <= prev_day and not db.has_fired(rollover_key):
            await _process_rollover(context, prev_day)
            db.mark_fired(rollover_key)

            if prev_day % 7 == 0:
                weekly_key = f"weekly_{prev_day}"
                if not db.has_fired(weekly_key):
                    await reports.send_weekly_report(context, prev_day)
                    db.mark_fired(weekly_key)

            if prev_day == 90:
                final_key = "final_report"
                if not db.has_fired(final_key):
                    await reports.send_final_report(context)
                    db.mark_fired(final_key)


def _run_backup():
    os.makedirs(config.BACKUP_DIR, exist_ok=True)
    if os.path.exists(config.DB_PATH):
        dest = os.path.join(config.BACKUP_DIR, f"challenge_{tu.today_toronto().isoformat()}.db")
        shutil.copy2(config.DB_PATH, dest)


async def _post(context, text: str):
    return await context.bot.send_message(
        chat_id=config.GROUP_CHAT_ID, text=text, parse_mode="HTML"
    )


async def _send_morning_board(context, day: int):
    await _post(context, ui.morning_board(day))


async def _send_reminder(context, day: int, is_deadline: bool):
    blocks = []
    for uid in config.ALLOWED_USER_IDS:
        entry = db.get_entry(uid, day)
        if entry and entry["skipped_bool"]:
            continue  # they've spent their skip pass today — don't nag
        missing = stats.missing_today(uid)
        if not missing:
            continue
        block = [f"⏳ <b>{ui.name_of(uid)}</b> still needs:"]
        block += [f"   • {m}" for m in missing]
        goal = ui.week_goal_line(uid, day)
        if goal:
            block.append(f"   {goal}")
        blocks.append("\n".join(block))

    if not blocks:
        return  # both done — no reminder needed

    await _post(context, ui.reminder_screen(day, blocks, is_deadline))


async def _process_rollover(context, day: int):
    date_str = tu.date_for_day(day).isoformat()
    for uid in config.ALLOWED_USER_IDS:
        e = db.get_entry(uid, day)
        u = db.get_user(uid)
        name = u["name"] if u else str(uid)

        if e and e["completed_bool"]:
            continue  # nothing to do — streak & badges handled at log time

        if e and e["skipped_bool"]:
            await _post(
                context,
                f"🎟 <b>{ui.esc(name)}</b> spent their skip pass on Day {day}. "
                f"Streak preserved.",
            )
            continue

        db.add_forfeit(uid, config.FORFEIT_AMOUNT, f"Missed Day {day}", date_str)
        await _post(
            context,
            f"🔗 <b>CHAIN BROKEN</b>\n{ui.esc(name)} missed Day {day}.\n"
            f"⚠️ +{ui.money(config.FORFEIT_AMOUNT)} forfeit.",
        )
