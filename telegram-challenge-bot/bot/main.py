import fcntl
import logging
import sys

from telegram import BotCommand, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ConversationHandler,
    MessageHandler,
    PicklePersistence,
    TypeHandler,
    filters,
)

from . import config, db, handlers, scheduler

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
# httpx logs every poll at INFO — one line every 10s, each containing the full
# API URL and therefore the bot token. That buried the only lines worth reading
# under a megabyte of noise and wrote the token to disk thousands of times.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)

LOCK_PATH = "bot.lock"
_lock_handle = None


def acquire_single_instance_lock():
    """Two bots polling one token makes Telegram deliver each update to only
    one of them at random, which looks exactly like 'the bot is broken'.
    Refuse to start if another instance already holds the lock."""
    global _lock_handle
    _lock_handle = open(LOCK_PATH, "w")
    try:
        fcntl.flock(_lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(
            "Another instance of this bot is already running.\n"
            "Stop it first (Ctrl+C in its window, or: pkill -f 'bot.main')."
        )
        sys.exit(1)


MENU = [
    ("log", "Log today's three"),
    ("goals", "See our goals"),
    ("setgoal", "Set a 90-day / month / week goal"),
    ("stats", "Your numbers"),
    ("today", "Who's done today"),
    ("leaderboard", "Head to head"),
    ("edit", "Fix today's entry"),
    ("clear", "Wipe today's entry and start over"),
    ("purge", "Clean the chat down to just the cards"),
    ("skip", "Spend your one skip pass"),
    ("cancel", "Get out of a stuck flow"),
    ("help", "All commands"),
]


async def _publish_command_menu(app: Application):
    """Puts the commands behind Telegram's / button so nothing has to be memorised."""
    await app.bot.set_my_commands([BotCommand(c, d) for c, d in MENU])


async def _on_startup(app: Application):
    """Single post_init hook — the builder keeps only one, so both startup
    jobs have to run from here."""
    await _publish_command_menu(app)
    await _startup_check(app)


def build_app(bot=None) -> Application:
    """Build the Application. `bot` is only passed by tests (a fake Bot);
    normal runs use the configured token."""
    db.init_db()
    builder = Application.builder()
    builder = builder.bot(bot) if bot is not None else builder.token(config.BOT_TOKEN)
    if bot is None:
        # Keeps half-finished /log conversations (and the message ids queued
        # for cleanup) alive across a restart.
        builder = builder.persistence(PicklePersistence(filepath="bot_state.pickle"))
        builder = builder.post_init(_on_startup)
    app = builder.build()

    # A photo sent uncompressed ("Send as File") arrives as a document, not a
    # photo. Matching only filters.PHOTO silently drops those.
    PHOTO_IN = filters.PHOTO | filters.Document.IMAGE
    # Anything that isn't the answer the current step wants. Without a catch-all
    # the update matches nothing at all and the bot goes quiet mid-flow, which
    # is exactly what "the log feature doesn't work" looked like.
    OTHER = ~filters.COMMAND & ~filters.StatusUpdate.ALL

    def step(handler, wanted):
        """The step's real handler, then a catch-all that re-asks the question."""
        return [
            MessageHandler(wanted & ~filters.COMMAND, handler),
            MessageHandler(OTHER, handlers.step_wrong_input),
        ]

    log_conv = ConversationHandler(
        entry_points=[
            CommandHandler("log", handlers.cmd_log),
            MessageHandler(PHOTO_IN, handlers.on_photo),
        ],
        states={
            handlers.PHOTO: step(handlers.on_photo, PHOTO_IN),
            handlers.PHYSIQUE_NOTE: step(handlers.step_physique_note, filters.TEXT),
            handlers.VERSE: step(handlers.step_verse, filters.TEXT),
            handlers.VERSE_NOTE: step(handlers.step_verse_note, filters.TEXT),
            handlers.AMOUNT: step(handlers.step_amount, filters.TEXT),
            handlers.ACTION: step(handlers.step_action, filters.TEXT),
        },
        fallbacks=[
            CommandHandler("cancel", handlers.cmd_cancel),
            CommandHandler("clear", handlers.cmd_clear),
        ],
        name="log_conv",
        persistent=bot is None,
        # Without this, /log is swallowed whenever a conversation is already
        # open — you get stuck on a step forever with no way back in.
        allow_reentry=True,
    )

    edit_conv = ConversationHandler(
        entry_points=[CommandHandler("edit", handlers.cmd_edit)],
        states={
            handlers.EDIT_CHOOSE: [CallbackQueryHandler(handlers.edit_choose)],
            handlers.EDIT_VALUE: [
                MessageHandler((filters.TEXT | PHOTO_IN) & ~filters.COMMAND, handlers.edit_value)
            ],
        },
        fallbacks=[CommandHandler("cancel", handlers.cmd_cancel)],
        name="edit_conv",
        persistent=bot is None,
        allow_reentry=True,
        # An abandoned /edit used to sit open forever, swallowing later input.
        conversation_timeout=300,
    )

    setgoal_conv = ConversationHandler(
        entry_points=[CommandHandler("setgoal", handlers.cmd_setgoal)],
        states={
            handlers.SETGOAL_CHOOSE: [
                CallbackQueryHandler(handlers.setgoal_choose, pattern="^goal_")
            ],
            handlers.SETGOAL_TEXT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handlers.setgoal_text)
            ],
        },
        fallbacks=[CommandHandler("cancel", handlers.cmd_cancel)],
        name="setgoal_conv",
        persistent=bot is None,
        allow_reentry=True,
        # A half-finished /setgoal used to stay open forever. Because it is
        # checked first and waits on plain text, it would then eat every text
        # step of /log — you'd answer "physique note" and get a goals board.
        conversation_timeout=300,
    )

    # Order matters: handlers in one group are tried in turn and the first match
    # wins. The two short, targeted flows go first; /log is last because it
    # claims any bare photo as an entry point and would otherwise hijack the
    # photo that /edit is waiting for.
    app.add_handler(setgoal_conv)
    app.add_handler(edit_conv)
    app.add_handler(log_conv)
    app.add_handler(CommandHandler("goals", handlers.cmd_goals))
    app.add_handler(CommandHandler("stats", handlers.cmd_stats))
    app.add_handler(CommandHandler("today", handlers.cmd_today))
    app.add_handler(CommandHandler("leaderboard", handlers.cmd_leaderboard))
    app.add_handler(CommandHandler("skip", handlers.cmd_skip))
    app.add_handler(CommandHandler("clear", handlers.cmd_clear))
    app.add_handler(CommandHandler("purge", handlers.cmd_purge))
    # Also registered outside the flows so it's a real escape hatch even when
    # no conversation is open.
    app.add_handler(CommandHandler("cancel", handlers.cmd_cancel))
    app.add_handler(CommandHandler("help", handlers.cmd_help))
    app.add_handler(CommandHandler("start", handlers.cmd_help))
    app.add_handler(CallbackQueryHandler(handlers.on_skip_callback, pattern="^skip_"))
    app.add_handler(CallbackQueryHandler(handlers.on_clear_callback, pattern="^clear_"))
    app.add_handler(CallbackQueryHandler(handlers.on_purge_callback, pattern="^purge_"))

    # Group -1 runs before everything and consumes nothing: one line per update
    # actually delivered. This is the only way to tell "my handler is wrong"
    # apart from "Telegram never sent it" — which is the difference between a
    # code bug and a group-permissions problem.
    app.add_handler(TypeHandler(Update, _log_update), group=-1)

    app.add_error_handler(_on_error)

    app.job_queue.run_repeating(scheduler.tick, interval=60, first=5)
    return app


async def _log_update(update, context):
    m = update.effective_message
    if m is None:
        logging.info("UPDATE non-message: %s", type(update).__name__)
        return
    if m.photo:
        kind = "PHOTO"
    elif m.document:
        kind = f"DOC({m.document.mime_type})"
    elif m.text:
        kind = "text"
    else:
        kind = "other"
    logging.info(
        "UPDATE chat=%s user=%s %s %r",
        m.chat_id,
        m.from_user.id if m.from_user else None,
        kind,
        (m.text or m.caption or "")[:50],
    )


async def _on_error(update, context):
    """Without this an exception inside a handler vanishes into the log and the
    flow just stops — indistinguishable from the bot being dead. Say so."""
    logging.exception("handler failed on update: %s", update, exc_info=context.error)
    chat = getattr(update, "effective_chat", None)
    if chat is not None and chat.id == config.GROUP_CHAT_ID:
        try:
            await context.bot.send_message(
                chat_id=chat.id,
                text="⚠️ Something broke on my end. Send /log to pick up where you left off.",
            )
        except Exception:
            pass


async def _startup_check(app):
    """Deleting messages needs admin rights. Without them the /log cleanup
    fails silently and the chat just fills up, so say so out loud instead."""
    try:
        me = await app.bot.get_me()
        member = await app.bot.get_chat_member(config.GROUP_CHAT_ID, me.id)
        status = getattr(member, "status", "")
        can_delete = bool(getattr(member, "can_delete_messages", False))
        if status != "administrator" or not can_delete:
            logging.warning("Bot is '%s' with can_delete_messages=%s", status, can_delete)
            await app.bot.send_message(
                chat_id=config.GROUP_CHAT_ID,
                parse_mode="HTML",
                text=(
                    "⚠️ <b>I'm not an admin here.</b>\n\n"
                    "I can post, but I can't delete messages — so the chat "
                    "won't stay clean after /log.\n\n"
                    "Fix: group name → <b>Administrators</b> → <b>Add Admin</b> "
                    "→ me → turn on <b>Delete Messages</b>."
                ),
            )
    except Exception:
        logging.exception("startup permission check failed")


def main():
    acquire_single_instance_lock()
    app = build_app()
    app.run_polling(allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    main()
