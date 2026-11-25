import asyncio

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from . import badges, config, db, parsing, stats, time_utils as tu, ui

# /log flow states
PHOTO, PHYSIQUE_NOTE, VERSE, VERSE_NOTE, AMOUNT, ACTION = range(6)
# /edit flow states
EDIT_CHOOSE, EDIT_VALUE = range(6, 8)
# /setgoal flow states
SETGOAL_CHOOSE, SETGOAL_TEXT = range(8, 10)

FIELD_LABELS = {
    "physique_note": "💪 Physique note",
    "verse": "📖 Verse",
    "verse_note": "📖 Why it hit",
    "amount": "💰 Amount",
    "action": "💰 Business action",
}


def _allowed(update: Update) -> bool:
    if update.effective_chat is None or update.effective_user is None:
        return False
    if update.effective_chat.id != config.GROUP_CHAT_ID:
        return False
    return update.effective_user.id in config.ALLOWED_USER_IDS


async def _guard(update: Update) -> bool:
    if not _allowed(update):
        return False
    user = update.effective_user
    db.ensure_user(user.id, user.first_name or str(user.id))
    return True


def countdown_line() -> str:
    return ui.day_line()


async def _reply(update, text, **kwargs):
    """Send to the chat rather than replying to a specific message.

    This bot deletes messages as it goes (the /log flow cleans up after
    itself), so reply_text() regularly targets a message that no longer
    exists and fails with "Message to be replied not found" — which kills
    the whole handler and looks like the bot is dead.
    """
    return await update.effective_chat.send_message(text, parse_mode="HTML", **kwargs)


async def _send(message_or_query_msg, text, **kwargs):
    """Same safety for places that only have a Message object to hand."""
    return await message_or_query_msg.chat.send_message(
        text, parse_mode="HTML", **kwargs
    )


# How long a throwaway reply (/stats, /today, /help) stays before it's swept.
EPHEMERAL_TTL = 90


def _track(context: ContextTypes.DEFAULT_TYPE, message):
    """Queue a message for deletion once the current flow finishes.

    Everything a flow produces — the command that started it, every question
    the bot asks, every answer typed back — is clutter the moment the card is
    posted. Only the card, the goals board and the leaderboard survive.
    """
    if message is None:
        return
    context.user_data.setdefault("log_msg_ids", []).append(message.message_id)


async def _delete(context: ContextTypes.DEFAULT_TYPE, message_id: int):
    try:
        await context.bot.delete_message(
            chat_id=config.GROUP_CHAT_ID, message_id=message_id
        )
    except Exception:
        # Already gone, older than Telegram's 48h delete window, or we're not
        # an admin. None of those are worth killing the flow over.
        pass


async def _cleanup_tracked(context: ContextTypes.DEFAULT_TYPE):
    """Delete every message the finished flow left behind."""
    for mid in context.user_data.pop("log_msg_ids", []):
        await _delete(context, mid)


async def _sweep_job(context: ContextTypes.DEFAULT_TYPE):
    await _delete(context, context.job.data)


def _autodelete(context: ContextTypes.DEFAULT_TYPE, message, delay: int = EPHEMERAL_TTL):
    """Bin a read-only reply after `delay` seconds — long enough to read it,
    short enough that the chat stays just cards, goals and the leaderboard."""
    if message is None or context.job_queue is None:
        return
    context.job_queue.run_once(_sweep_job, delay, data=message.message_id)


async def _reply_ephemeral(update, context, text, **kwargs):
    """Answer a throwaway command: the question and the answer both self-erase."""
    sent = await _reply(update, text, **kwargs)
    _autodelete(context, update.message, delay=0)
    _autodelete(context, sent)
    return sent


def _photo_file_id(message):
    """Telegram delivers a compressed photo as .photo, but an uncompressed one
    ('Send as File') arrives as .document instead. Accept both — otherwise
    every photo sent as a file is silently ignored and /log looks broken."""
    if message.photo:
        return message.photo[-1].file_id
    doc = getattr(message, "document", None)
    if doc is not None and (doc.mime_type or "").startswith("image/"):
        return doc.file_id
    return None


# ---------------- simple commands ----------------

# /help, /stats and /today are throwaway lookups — they self-erase.
# /leaderboard and /goals are boards worth keeping, so they stay.

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    await _reply_ephemeral(update, context, ui.help_screen(tu.today_day_number()))


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    await _reply_ephemeral(
        update, context, ui.stats_screen(update.effective_user.id, tu.today_day_number())
    )


async def cmd_today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    await _reply_ephemeral(update, context, ui.today_screen(tu.today_day_number()))


async def cmd_leaderboard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    _autodelete(context, update.message, delay=0)  # the board stays, the command goes
    await _reply(update, ui.leaderboard_screen(tu.today_day_number()))


async def cmd_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    _autodelete(context, update.message, delay=0)
    u = db.get_user(update.effective_user.id)
    if u["skip_pass_used"]:
        await _reply_ephemeral(update, context, "🎟 Your skip pass is already spent — none left.")
        return
    buttons = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🎟 Use it", callback_data="skip_confirm"),
                InlineKeyboardButton("Cancel", callback_data="skip_cancel"),
            ]
        ]
    )
    await _reply(
        update,
        f"🎟 <b>SKIP PASS</b>\n{ui.day_line()}\n\n"
        "You get <b>one</b> for the whole 90 days. Spend it on today?\n"
        "<i>Your streak survives. This can't be undone.</i>",
        reply_markup=buttons,
    )


async def on_skip_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not _allowed(update):
        return
    uid = update.effective_user.id
    _autodelete(context, query.message)  # the dialog is clutter either way
    if query.data == "skip_cancel":
        await query.edit_message_text("Cancelled.")
        return
    u = db.get_user(uid)
    if u and u["skip_pass_used"]:
        await query.edit_message_text("Already used.")
        return
    day = tu.today_day_number()
    date_str = tu.date_for_day(day).isoformat()
    db.mark_skipped(uid, day, date_str)
    db.use_skip_pass(uid)
    await query.edit_message_text(
        f"🎟 <b>Skip pass spent</b> · Day {day}\nStreak preserved. That was your only one.",
        parse_mode="HTML",
    )


# ---------------- /log guided flow ----------------

async def cmd_log(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return ConversationHandler.END
    context.user_data["log_day"] = tu.today_day_number()
    _track(context, update.message)
    return await _ask_next(update, context)


async def on_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Entry point for a bare photo message, or the PHOTO state's handler."""
    if not await _guard(update):
        return ConversationHandler.END
    uid = update.effective_user.id
    day = tu.today_day_number()
    context.user_data["log_day"] = day
    _track(context, update.message)
    date_str = tu.date_for_day(day).isoformat()
    file_id = _photo_file_id(update.message)
    if file_id is None:
        return await _ask_next(update, context)
    fields = {"photo_file_id": file_id}
    fields.update(parsing.parse_caption(update.message.caption))
    db.upsert_entry_fields(uid, day, date_str, **fields)
    db.recompute_completed(uid, day)
    return await _ask_next(update, context)


async def _ask_next(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    day = context.user_data.get("log_day", tu.today_day_number())
    e = db.get_entry(uid, day)

    if not e or not e["photo_file_id"]:
        prompt = (f"💪 <b>1 of 6</b> · Physique\n"
                  f"<i>{ui.day_line(day)}</i>\n\n"
                  f"Send today's photo.")
        state = PHOTO
    elif not e["physique_note"]:
        prompt = "💪 <b>2 of 6</b> · Physique note\n\nWeight, workout, how you felt?"
        state = PHYSIQUE_NOTE
    elif not e["verse"]:
        prompt = "📖 <b>3 of 6</b> · Verse\n\nToday's Bible verse?"
        state = VERSE
    elif not e["verse_note"]:
        prompt = "📖 <b>4 of 6</b> · Why it hit\n\nOne line — why did it land today?"
        state = VERSE_NOTE
    elif e["amount"] is None:
        prompt = "💰 <b>5 of 6</b> · Money\n\nHow much did you make today?"
        state = AMOUNT
    elif not e["action"]:
        goal = ui.week_goal_line(uid, day)
        prompt = "💰 <b>6 of 6</b> · Business\n\nWhat did you do to move it forward?"
        if goal:
            prompt += f"\n\n{goal}"
        state = ACTION
    else:
        return await _finish_entry(update, context)

    sent = await _reply(update, prompt)
    _track(context, sent)
    return state


async def _handle_text_step(update: Update, context: ContextTypes.DEFAULT_TYPE, field: str):
    if not await _guard(update):
        return ConversationHandler.END
    uid = update.effective_user.id
    day = context.user_data.get("log_day", tu.today_day_number())
    date_str = tu.date_for_day(day).isoformat()
    text = update.message.text.strip()
    _track(context, update.message)

    if field == "amount":
        cleaned = text.replace("$", "").replace(",", "").strip()
        try:
            value = float(cleaned)
        except ValueError:
            sent = await _reply(update, "That's not a number — try <code>250</code> or <code>$250</code>.")
            _track(context, sent)
            return AMOUNT
        db.upsert_entry_fields(uid, day, date_str, amount=value)
    else:
        db.upsert_entry_fields(uid, day, date_str, **{field: text})

    db.recompute_completed(uid, day)
    return await _ask_next(update, context)


async def step_physique_note(update: Update, context: ContextTypes.DEFAULT_TYPE):
    return await _handle_text_step(update, context, "physique_note")


async def step_verse(update: Update, context: ContextTypes.DEFAULT_TYPE):
    return await _handle_text_step(update, context, "verse")


async def step_verse_note(update: Update, context: ContextTypes.DEFAULT_TYPE):
    return await _handle_text_step(update, context, "verse_note")


async def step_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    return await _handle_text_step(update, context, "amount")


async def step_action(update: Update, context: ContextTypes.DEFAULT_TYPE):
    return await _handle_text_step(update, context, "action")


async def step_wrong_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Catch anything that doesn't fit the current step — a sticker, a voice
    note, text where a photo belongs.

    Without this the update matches no handler at all, so the bot says nothing
    and the flow looks dead. Silence is what 'the log feature doesn't work'
    actually looks like from the chat. Re-ask the current question instead.
    """
    if not await _guard(update):
        return ConversationHandler.END
    _track(context, update.message)
    return await _ask_next(update, context)


async def _post_or_update_card(context: ContextTypes.DEFAULT_TYPE, uid: int, day: int,
                               new_badges: list, force_repost: bool = False):
    """Post the day's card, or update it in place if one already exists — so an
    /edit never leaves a card showing stale numbers."""
    e = db.get_entry(uid, day)
    if e is None or not e["photo_file_id"]:
        return
    caption = ui.card_caption(uid, day, new_badges)

    if e["card_message_id"] and force_repost:
        try:
            await context.bot.delete_message(
                chat_id=config.GROUP_CHAT_ID, message_id=e["card_message_id"]
            )
        except Exception:
            pass
    elif e["card_message_id"]:
        try:
            await context.bot.edit_message_caption(
                chat_id=config.GROUP_CHAT_ID,
                message_id=e["card_message_id"],
                caption=caption,
            )
            return
        except Exception:
            pass  # card was deleted or is uneditable — fall through and repost

    card = await context.bot.send_photo(
        chat_id=config.GROUP_CHAT_ID,
        photo=e["photo_file_id"],
        caption=caption,
    )
    db.set_card_message_id(uid, day, card.message_id)


async def _finish_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    day = context.user_data.get("log_day", tu.today_day_number())
    new_badges = badges.check_streak_badges(uid)

    await _post_or_update_card(context, uid, day, new_badges)
    await _cleanup_tracked(context)
    context.user_data.pop("log_day", None)
    return ConversationHandler.END


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Sweep before clearing — user_data holds the ids, so wiping it first would
    # strand every question and answer in the chat permanently.
    _track(context, update.message)
    await _cleanup_tracked(context)
    context.user_data.clear()
    sent = await update.effective_chat.send_message("Cancelled.")
    _autodelete(context, sent, delay=15)
    return ConversationHandler.END


# ---------------- /clear (wipe today's entry) ----------------

async def cmd_clear(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return ConversationHandler.END
    day = tu.today_day_number()
    e = db.get_entry(update.effective_user.id, day)
    _autodelete(context, update.message, delay=0)
    if not e:
        await _reply_ephemeral(update, context, "Nothing to clear — today's log hasn't been started.")
        return ConversationHandler.END
    buttons = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🗑 Clear it", callback_data="clear_confirm"),
                InlineKeyboardButton("Cancel", callback_data="clear_cancel"),
            ]
        ]
    )
    await _reply(
        update,
        f"🗑 <b>CLEAR TODAY</b>\n{ui.day_line()}\n\n"
        "Wipes today's entry and its card so you can start fresh.\n"
        "<i>This can't be undone.</i>",
        reply_markup=buttons,
    )
    return ConversationHandler.END


async def on_clear_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not _allowed(update):
        return
    _autodelete(context, query.message)  # the dialog is clutter either way
    if query.data == "clear_cancel":
        await query.edit_message_text("Cancelled.")
        return

    uid = update.effective_user.id
    day = tu.today_day_number()
    e = db.get_entry(uid, day)

    # Remove any half-finished /log question/answer messages still hanging around.
    await _cleanup_tracked(context)

    if e and e["card_message_id"]:
        try:
            await context.bot.delete_message(chat_id=config.GROUP_CHAT_ID, message_id=e["card_message_id"])
        except Exception:
            pass

    db.delete_entry(uid, day)
    await query.edit_message_text(
        f"🗑 <b>Day {day} cleared</b>\nSend /log to start fresh.", parse_mode="HTML"
    )


# ---------------- /purge (wipe the chat back to just the cards) ----------------

# How far back to sweep. Telegram gives bots no way to list a chat's history,
# so the only option is to walk message ids downward from the newest one.
PURGE_SCAN = 3000
# Telegram starts refusing bulk deletes past roughly 30 calls/second.
PURGE_DELAY = 0.05


async def _purge_chat(context: ContextTypes.DEFAULT_TYPE, keep: set) -> tuple:
    """Delete every message in the group except the ids in `keep`.

    Returns (deleted, kept). Failures are silent and expected: most ids in the
    range never existed, and Telegram refuses deletes it doesn't like.
    """
    probe = await context.bot.send_message(
        chat_id=config.GROUP_CHAT_ID, text="🧹 Cleaning up…"
    )
    top = probe.message_id
    deleted = 0
    for mid in range(max(1, top - PURGE_SCAN), top):
        if mid in keep:
            continue
        try:
            await context.bot.delete_message(chat_id=config.GROUP_CHAT_ID, message_id=mid)
            deleted += 1
        except Exception:
            pass  # never existed, already gone, or undeletable — all fine
        await asyncio.sleep(PURGE_DELAY)
    await _delete(context, top)
    return deleted, len(keep)


async def cmd_purge(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    _autodelete(context, update.message, delay=0)
    cards = db.all_card_message_ids()
    buttons = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🧹 Wipe it", callback_data="purge_confirm"),
                InlineKeyboardButton("Cancel", callback_data="purge_cancel"),
            ]
        ]
    )
    await _reply(
        update,
        f"🧹 <b>PURGE CHAT</b>\n{ui.day_line()}\n\n"
        f"Deletes <b>every</b> message in this group except the "
        f"<b>{len(cards)}</b> daily card{'' if len(cards) == 1 else 's'}.\n\n"
        "<i>That includes your own conversation. This can't be undone.</i>",
        reply_markup=buttons,
    )


async def on_purge_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not _allowed(update):
        return
    if query.data == "purge_cancel":
        await query.edit_message_text("Cancelled.")
        _autodelete(context, query.message, delay=10)
        return

    await query.edit_message_text("🧹 Cleaning… this takes a minute.")
    # The dialog itself must go too, so it isn't in the keep set.
    deleted, kept = await _purge_chat(context, keep=db.all_card_message_ids())
    sent = await context.bot.send_message(
        chat_id=config.GROUP_CHAT_ID,
        parse_mode="HTML",
        text=f"🧹 <b>Chat cleaned</b>\nRemoved {deleted} message"
             f"{'' if deleted == 1 else 's'} · kept {kept} card{'' if kept == 1 else 's'}.",
    )
    _autodelete(context, sent, delay=30)


# ---------------- /edit today ----------------

async def cmd_edit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return ConversationHandler.END
    if not context.args or context.args[0].lower() != "today":
        await _reply_ephemeral(update, context, "Usage: <code>/edit today</code>")
        return ConversationHandler.END
    context.user_data["edit_day"] = tu.today_day_number()
    _track(context, update.message)
    buttons = [[InlineKeyboardButton(label, callback_data=key)] for key, label in FIELD_LABELS.items()]
    buttons.append([InlineKeyboardButton("💪 Retake photo", callback_data="photo")])
    sent = await _reply(
        update, "✏️ <b>EDIT TODAY</b>\n\nWhat do you want to fix?",
        reply_markup=InlineKeyboardMarkup(buttons),
    )
    _track(context, sent)
    return EDIT_CHOOSE


async def edit_choose(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not _allowed(update):
        return ConversationHandler.END
    field = query.data
    context.user_data["edit_field"] = field
    if field == "photo":
        sent = await _send(query.message, "Send the new photo.")
    else:
        sent = await _send(query.message, f"Send the new value for: {FIELD_LABELS[field]}")
    _track(context, sent)
    return EDIT_VALUE


async def edit_value(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return ConversationHandler.END
    uid = update.effective_user.id
    day = context.user_data.get("edit_day", tu.today_day_number())
    date_str = tu.date_for_day(day).isoformat()
    field = context.user_data.get("edit_field")

    _track(context, update.message)

    if field == "photo":
        file_id = _photo_file_id(update.message)
        if file_id is None:
            sent = await _reply(update, "Please send a photo.")
            _track(context, sent)
            return EDIT_VALUE
        db.upsert_entry_fields(uid, day, date_str, photo_file_id=file_id)
    elif field == "amount":
        try:
            value = float(update.message.text.replace("$", "").replace(",", "").strip())
        except ValueError:
            sent = await _reply(update, "Send a number.")
            _track(context, sent)
            return EDIT_VALUE
        db.upsert_entry_fields(uid, day, date_str, amount=value)
    else:
        db.upsert_entry_fields(uid, day, date_str, **{field: update.message.text.strip()})

    complete = db.recompute_completed(uid, day)
    if complete:
        # A new photo can't be swapped into an existing card's caption, so that
        # one gets reposted; text edits update the card in place.
        await _post_or_update_card(context, uid, day, [], force_repost=(field == "photo"))

    await _cleanup_tracked(context)
    context.user_data.pop("edit_day", None)
    context.user_data.pop("edit_field", None)
    return ConversationHandler.END


# ---------------- goals ----------------

async def cmd_goals(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return
    _autodelete(context, update.message, delay=0)  # the board stays, the command goes
    await _reply(update, ui.goals_screen(tu.today_day_number()))


async def cmd_setgoal(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return ConversationHandler.END
    day = tu.today_day_number()
    buttons = [
        [InlineKeyboardButton(f"{icon} {label}", callback_data=f"goal_{scope}")]
        for scope, icon, label in ui.SCOPES
    ]
    _track(context, update.message)
    sent = await _reply(
        update,
        f"🎯 <b>SET A GOAL</b>\n{ui.day_line(day)}\n\nWhich one?",
        reply_markup=InlineKeyboardMarkup(buttons),
    )
    _track(context, sent)
    return SETGOAL_CHOOSE


async def setgoal_choose(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not _allowed(update):
        return ConversationHandler.END
    scope = query.data.replace("goal_", "", 1)
    day = tu.today_day_number()
    context.user_data["goal_scope"] = scope

    existing = db.get_goal(update.effective_user.id, scope, ui.period_index(scope, day))
    current = f"\n\nNow: <i>{ui.esc(existing['text'])}</i>" if existing else ""
    sent = await _send(
        query.message,
        f"{ui.SCOPE_ICONS[scope]} <b>{ui.scope_label(scope, day)} goal</b>"
        f"{current}\n\nSend the new goal in one message.",
    )
    _track(context, sent)
    return SETGOAL_TEXT


async def setgoal_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await _guard(update):
        return ConversationHandler.END
    scope = context.user_data.get("goal_scope")
    if not scope:
        return ConversationHandler.END
    day = tu.today_day_number()
    _track(context, update.message)

    db.set_goal(update.effective_user.id, scope, ui.period_index(scope, day),
                update.message.text.strip())
    await _cleanup_tracked(context)
    context.user_data.pop("goal_scope", None)

    # The goals board is the one message worth keeping.
    await context.bot.send_message(
        chat_id=config.GROUP_CHAT_ID,
        text=ui.goals_screen(day),
        parse_mode="HTML",
    )
    return ConversationHandler.END
