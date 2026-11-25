"""Self-check for the challenge bot. Runs the real handler chain against a fake
Telegram (no network) and an isolated database.

    python3 test_bot.py

Exits 0 if everything passes, 1 if anything broke.
"""
import asyncio
import os
import sys
import re
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser

PROJ = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJ)
os.chdir(tempfile.mkdtemp())  # isolate: never touch the live challenge.db
os.environ["DB_PATH"] = os.path.join(os.getcwd(), "test.db")

from telegram import (
    Bot, CallbackQuery, Chat, Document, Message, MessageEntity, PhotoSize,
    Sticker, Update, User,
)

from bot import config, db, scheduler as sch, time_utils as tu, ui
from bot.main import build_app

CHAT_ID = config.GROUP_CHAT_ID
UID = config.USER_ID_1
STRANGER = 111222333

_mid = [1000]
SENT_TEXTS, SENT_CARDS, DELETED, EDITED = [], [], [], []
FAILURES = []


def next_mid():
    _mid[0] += 1
    return _mid[0]


class FakeBot(Bot):
    def __init__(self):
        super().__init__(token="123456:AAFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEF")

    async def initialize(self):
        self._bot_user = User(id=999, first_name="SENSEI", is_bot=True, username="Sensei90Bot")
        self._initialized = True

    async def shutdown(self):
        self._initialized = False

    async def get_me(self, *a, **kw):
        return self._bot_user

    def _msg(self, chat_id, text=None, caption=None):
        c = Chat(id=chat_id, type="supergroup")
        c.set_bot(self)
        m = Message(message_id=next_mid(), date=datetime.now(timezone.utc),
                    chat=c, text=text, caption=caption)
        m.set_bot(self)
        return m

    async def send_message(self, chat_id=None, text=None, **kw):
        SENT_TEXTS.append(text)
        return self._msg(chat_id, text=text)

    async def send_photo(self, chat_id=None, photo=None, caption=None, **kw):
        SENT_CARDS.append(caption)
        return self._msg(chat_id, caption=caption)

    async def edit_message_caption(self, chat_id=None, message_id=None, caption=None, **kw):
        EDITED.append((message_id, caption))
        return self._msg(chat_id, caption=caption)

    async def edit_message_text(self, chat_id=None, message_id=None, text=None, **kw):
        return self._msg(chat_id, text=text)

    async def answer_callback_query(self, *a, **kw):
        return True

    async def delete_message(self, chat_id=None, message_id=None, **kw):
        DELETED.append(message_id)
        return True


def _chat(bot, chat_id=CHAT_ID):
    c = Chat(id=chat_id, type="supergroup")
    c.set_bot(bot)
    return c


def text_update(bot, text, uid=UID, chat_id=CHAT_ID):
    ents = []
    if text.startswith("/"):
        ents = [MessageEntity(type=MessageEntity.BOT_COMMAND, offset=0,
                              length=len(text.split()[0]))]
    m = Message(message_id=next_mid(), date=datetime.now(timezone.utc),
                chat=_chat(bot, chat_id),
                from_user=User(id=uid, first_name="Serhii", is_bot=False),
                text=text, entities=ents)
    m.set_bot(bot)
    u = Update(update_id=next_mid(), message=m)
    u.set_bot(bot)
    return u


def photo_update(bot, caption=None, uid=UID):
    m = Message(message_id=next_mid(), date=datetime.now(timezone.utc),
                chat=_chat(bot),
                from_user=User(id=uid, first_name="Serhii", is_bot=False),
                photo=[PhotoSize(file_id="P1", file_unique_id="u1", width=10, height=10)],
                caption=caption)
    m.set_bot(bot)
    u = Update(update_id=next_mid(), message=m)
    u.set_bot(bot)
    return u


def doc_photo_update(bot, uid=UID):
    """A photo sent uncompressed ('Send as File') — arrives as a document."""
    m = Message(message_id=next_mid(), date=datetime.now(timezone.utc),
                chat=_chat(bot),
                from_user=User(id=uid, first_name="Serhii", is_bot=False),
                document=Document(file_id="D1", file_unique_id="d1",
                                  file_name="me.jpg", mime_type="image/jpeg"))
    m.set_bot(bot)
    u = Update(update_id=next_mid(), message=m)
    u.set_bot(bot)
    return u


def sticker_update(bot, uid=UID):
    """Input that fits no step — the flow must answer, not go silent."""
    m = Message(message_id=next_mid(), date=datetime.now(timezone.utc),
                chat=_chat(bot),
                from_user=User(id=uid, first_name="Serhii", is_bot=False),
                sticker=Sticker(file_id="S1", file_unique_id="s1", width=1, height=1,
                                is_animated=False, is_video=False, type="regular"))
    m.set_bot(bot)
    u = Update(update_id=next_mid(), message=m)
    u.set_bot(bot)
    return u


def cb_update(bot, data):
    msg = Message(message_id=next_mid(), date=datetime.now(timezone.utc),
                  chat=_chat(bot), text="prompt")
    msg.set_bot(bot)
    q = CallbackQuery(id=str(next_mid()),
                      from_user=User(id=UID, first_name="Serhii", is_bot=False),
                      chat_instance="ci", data=data, message=msg)
    q.set_bot(bot)
    u = Update(update_id=next_mid(), callback_query=q)
    u.set_bot(bot)
    return u


_ALLOWED_TAGS = re.compile(r"</?(b|i|u|s|code|pre|a)(\s[^>]*)?>")


def _html_problems(text):
    """Telegram rejects unbalanced or unsupported tags — catch that here."""
    class V(HTMLParser):
        def __init__(self):
            super().__init__()
            self.stack, self.bad = [], []

        def handle_starttag(self, tag, attrs):
            self.stack.append(tag)

        def handle_endtag(self, tag):
            if not self.stack or self.stack[-1] != tag:
                self.bad.append(f"mismatched </{tag}>")
            else:
                self.stack.pop()

    v = V()
    v.feed(text)
    problems = v.bad + ([f"unclosed {v.stack}"] if v.stack else [])
    for m in re.finditer(r"</?[a-zA-Z]+[^>]*>", text):
        if not _ALLOWED_TAGS.fullmatch(m.group()):
            problems.append(f"unsupported {m.group()}")
    return problems


def check(label, cond):
    print(("PASS  " if cond else "FAIL  ") + label)
    if not cond:
        FAILURES.append(label)


async def main():
    bot = FakeBot()
    app = build_app(bot=bot)
    await app.initialize()
    day = tu.today_day_number()

    # --- /log must always re-enter, even mid-conversation ---
    # Without allow_reentry, a half-finished /log traps you: only the current
    # step's handler runs, so /log itself is silently ignored forever and the
    # flow can never be restarted. This is what broke it in the real group.
    await app.process_update(text_update(bot, "/log"))   # opens flow, asks photo
    first = len(SENT_TEXTS)
    await app.process_update(text_update(bot, "/log"))   # again, mid-flow
    check("/log re-enters while a flow is open", len(SENT_TEXTS) > first)
    SENT_TEXTS.clear()

    # --- guided /log produces exactly one card ---
    for label in ["/log", None, "185 lbs, leg day", "Be strong and courageous",
                  "Needed the push today", "300", "Called 5 landscaping leads"]:
        await app.process_update(photo_update(bot) if label is None else text_update(bot, label))

    check("guided /log posts one card", len(SENT_CARDS) == 1)
    check("card names the day", bool(SENT_CARDS) and f"Day {max(1, min(day, 90))}/90" in SENT_CARDS[0])
    check("card shows the money", bool(SENT_CARDS) and "$300" in SENT_CARDS[0])
    # The whole point of the flow cleanup: the questions and the answers go,
    # the card stays. 7 inputs + 6 prompts were sent, so at least 10 deletions.
    after_log = list(DELETED)
    card_mid = db.get_entry(UID, day)["card_message_id"]
    check("log flow deletes its questions and answers", len(after_log) >= 10)
    check("log flow keeps the card", card_mid not in after_log)
    e = db.get_entry(UID, day)
    check("entry marked complete", e is not None and bool(e["completed_bool"]))
    card_id = e["card_message_id"]
    check("card id stored", card_id is not None)

    # --- /edit updates the same card instead of posting a new one ---
    DELETED.clear()
    await app.process_update(text_update(bot, "/edit today"))
    await app.process_update(cb_update(bot, "amount"))
    await app.process_update(text_update(bot, "750"))
    check("edit updates card in place", len(EDITED) == 1 and len(SENT_CARDS) == 1)
    check("edited card shows new amount", bool(EDITED) and "$750" in EDITED[0][1])
    check("edit targets the same message", bool(EDITED) and EDITED[0][0] == card_id)

    # --- /clear removes the entry and its card ---
    DELETED.clear()
    await app.process_update(text_update(bot, "/clear"))
    await app.process_update(cb_update(bot, "clear_confirm"))
    check("clear deletes the card", card_id in DELETED)
    check("clear removes the entry", db.get_entry(UID, day) is None)

    # --- the flow must never go silent ---
    # An input that fits no step used to match no handler at all: the bot said
    # nothing and the flow looked dead. It has to re-ask instead.
    SENT_TEXTS.clear()
    await app.process_update(text_update(bot, "/log"))     # asks for a photo
    SENT_TEXTS.clear()
    await app.process_update(sticker_update(bot))          # not a photo
    check("wrong input mid-flow gets a reply", len(SENT_TEXTS) > 0)
    await app.process_update(text_update(bot, "just chatting"))
    check("text where a photo belongs re-asks", len(SENT_TEXTS) > 1)

    # --- a photo sent as a file still counts ---
    await app.process_update(doc_photo_update(bot))
    e = db.get_entry(UID, day)
    check("photo sent as a file is accepted", e is not None and e["photo_file_id"] == "D1")
    await app.process_update(text_update(bot, "/cancel"))
    db.delete_entry(UID, day)

    # --- one-message logging (photo + caption) ---
    SENT_CARDS.clear()
    await app.process_update(photo_update(
        bot, caption='Felt strong\n"Be still and know" - Psalm 46:10\n$450 - closed a patio job'))
    e = db.get_entry(UID, day)
    check("photo+caption completes the day", e is not None and bool(e["completed_bool"]))
    check("photo+caption posts a card", len(SENT_CARDS) == 1)
    check("caption amount parsed", e is not None and e["amount"] == 450.0)

    # --- /purge wipes the chat but never the cards ---
    # The whole risk of this feature is deleting a card, so prove it doesn't.
    import bot.handlers as H
    H.PURGE_DELAY = 0        # no need to rate-limit a fake bot
    H.PURGE_SCAN = 40
    cards = db.all_card_message_ids()
    check("purge knows about the cards", len(cards) > 0)
    DELETED.clear()
    await app.process_update(text_update(bot, "/purge"))
    await app.process_update(cb_update(bot, "purge_confirm"))
    check("purge deletes chat messages", len(DELETED) > 5)
    check("purge spares every card", not (cards & set(DELETED)))

    DELETED.clear()
    await app.process_update(text_update(bot, "/purge"))
    await app.process_update(cb_update(bot, "purge_cancel"))
    check("purge cancel deletes nothing", len(DELETED) == 0)

    # --- read commands ---
    SENT_TEXTS.clear()
    for cmd in ["/stats", "/today", "/leaderboard", "/help"]:
        await app.process_update(text_update(bot, cmd))
    check("read commands all reply", len(SENT_TEXTS) == 4)
    check("/stats reports money", any("$450" in t for t in SENT_TEXTS))

    # --- access control ---
    SENT_TEXTS.clear()
    cards_before = len(SENT_CARDS)
    await app.process_update(text_update(bot, "/stats", uid=STRANGER))
    await app.process_update(photo_update(bot, caption="hi", uid=STRANGER))
    check("stranger is ignored", not SENT_TEXTS and len(SENT_CARDS) == cards_before)
    check("stranger stores nothing", db.get_entry(STRANGER, day) is None)
    SENT_TEXTS.clear()
    await app.process_update(text_update(bot, "/stats", chat_id=-999999))
    check("other chats are ignored", not SENT_TEXTS)

    # --- goals: set one, see it everywhere ---
    SENT_TEXTS.clear()
    await app.process_update(text_update(bot, "/setgoal"))
    await app.process_update(cb_update(bot, "goal_week"))
    await app.process_update(text_update(bot, "Call 50 businesses"))
    saved = db.get_goal(UID, "week", tu.week_index(day))
    check("week goal saved", saved is not None and saved["text"] == "Call 50 businesses")
    check("goals board posted after setting", any("Call 50 businesses" in t for t in SENT_TEXTS))

    SENT_TEXTS.clear()
    await app.process_update(text_update(bot, "/goals"))
    check("/goals shows the goal", any("Call 50 businesses" in t for t in SENT_TEXTS))

    await app.process_update(text_update(bot, "/setgoal"))
    await app.process_update(cb_update(bot, "goal_challenge"))
    await app.process_update(text_update(bot, "Hit $10k"))
    g = db.get_goal(UID, "challenge", 0)
    check("challenge goal saved", g is not None and g["text"] == "Hit $10k")
    check("month/week goals are separate", db.get_goal(UID, "month", tu.month_index(day)) is None)

    # --- every screen must be valid, Telegram-safe HTML ---
    screens = {
        "help": ui.help_screen(day),
        "stats": ui.stats_screen(UID, day),
        "today": ui.today_screen(day),
        "leaderboard": ui.leaderboard_screen(day),
        "goals": ui.goals_screen(day),
        "morning_board": ui.morning_board(day),
        "reminder": ui.reminder_screen(day, ["⏳ <b>x</b> needs stuff"], False),
    }
    bad = [name for name, text in screens.items() if _html_problems(text)]
    check("all screens emit valid HTML", not bad)
    check("morning board lists goals", "Hit $10k" in screens["morning_board"])

    # user text with < > & must not break the markup
    db.set_goal(UID, "week", tu.week_index(day), "<b>hack</b> & 5 < 10")
    check("user text is escaped", not _html_problems(ui.goals_screen(day)))
    db.set_goal(UID, "week", tu.week_index(day), "Call 50 businesses")

    # --- the reply_text trap ---
    # Replying *to* a message fails with "Message to be replied not found" once
    # that message has been deleted — and this bot deletes messages constantly,
    # which silently killed every handler. Sends must target the chat instead.
    src = open(os.path.join(PROJ, "bot", "handlers.py")).read()
    check("no handler replies to a specific message", ".reply_text(" not in src)

    # --- reminders don't fire stale, db self-heals ---
    check("fresh reminder fires", sch._minutes_since("09:05", "09:00") <= sch.STALE_AFTER_MINUTES)
    check("stale reminder suppressed", sch._minutes_since("20:00", "09:00") > sch.STALE_AFTER_MINUTES)
    os.remove(config.DB_PATH)
    db.ensure_user(UID, "Serhii")
    check("db rebuilds if deleted", db.get_user(UID) is not None)

    await app.shutdown()
    if FAILURES:
        print(f"\n{len(FAILURES)} CHECK(S) FAILED:")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("\nALL CHECKS PASSED")
    return 0


sys.exit(asyncio.run(main()))
