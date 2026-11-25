# 90-Day Challenge Bot

A private Telegram bot for exactly two people tracking a 90-day challenge:
💪 physique (photo required), 📖 a Bible verse, 💰 money made + one
productive business action — every day.

Bot: **@Sensei90Bot**

## What it does

- `/log` — guided daily entry (or just send a photo with a caption and
  it'll parse what it can, then ask for anything missing)
- 3 daily reminders + 1 "last call" at the deadline, only pinging what's
  still missing
- Streaks, one skip pass per person (preserves streak, no forfeit),
  $20 forfeit on a real miss
- Badges: 🔥 7-day, 💪 30-day, 🏔 60-day, 👑 90-day finisher,
  ✅ Perfect Week, 💰 $1k Week
- A recap every 7 days (days hit, $ made, streaks, badges, top verse)
- A final report-card image for each of you after Day 90 (before/after
  photos, totals, badges, top verses)
- Everything survives a restart — no duplicate reminders, no lost data

## One-time setup

### 1. Bot must be a group ADMIN with "Delete Messages"

This is required — without it Telegram blocks the bot from deleting the
question/answer messages, so your chat fills up instead of showing only
cards.

Group settings → Administrators → Add Admin → **@Sensei90Bot** → make
sure **Delete Messages** is on.

Also make sure Group Privacy is **disabled** for the bot
(@BotFather → /mybots → @Sensei90Bot → Bot Settings → Group Privacy),
otherwise it can't see your photos and text at all.

### 2. Only ever run ONE instance

Two copies polling the same token makes Telegram hand each message to
only one of them at random — it looks exactly like "the bot is broken".
The bot now refuses to start if another instance is running, but if you
ever need to clear them out:

```bash
pkill -f "bot.main"
```

### 3. Install and run

```bash
cd telegram_challenge_bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m bot.main
```

Leave it running — it needs to stay running 24/7 for the daily reminders
to fire (a cheap always-on VPS, a home mini-PC, or a Raspberry Pi all
work; running it only on your laptop means no reminders while it's
asleep/closed).

### 4. Config (`.env`)

Already filled in: `BOT_TOKEN`, `USER_ID_1` (you), `USER_ID_2` (your
friend), `START_DATE` (2026-09-01). Only `GROUP_CHAT_ID` is missing —
add it after step 2. Adjust `REMINDER_TIMES`, `DEADLINE_TIME`, or
`FORFEIT_AMOUNT` if you want different values.

## Commands

| Command | What it does |
|---|---|
| `/log` | Log today's physique photo, verse, and money |
| `/stats` | Your streak, total $, days completed, forfeits, skip pass |
| `/today` | Who's done today and what's missing |
| `/leaderboard` | Both of you, side by side |
| `/skip` | Use your one skip pass (confirm first) |
| `/goals` | See both our 90-day, month and week goals |
| `/setgoal` | Set or change one of your goals |
| `/edit today` | Fix any field of today's entry (the card updates in place) |
| `/clear` | Wipe today's entry and its card, and start over |
| `/clean` | Sweep the chat clutter — every card is kept |
| `/help` | Show commands |

## Goals

Each of you keeps three goals at once:

- 🏁 **Challenge** — the one thing for all 90 days
- 📅 **Month** — resets on day 31 and 61
- 🗓 **Week** — resets every 7 days

Set them with `/setgoal`, see them with `/goals`. They also show up
automatically: the week goal rides along on every card and reminder, and
the **morning board** posts all of them at the first reminder slot every
single day, so neither of you can forget what you're chasing.

## Keeping the chat clean

Two different brooms, easy to mix up:

- **`/clear`** — deletes *today's data*: the entry and its card. Use it to
  redo a day.
- **`/clean`** — deletes *chat clutter only*: stats, reminders, prompts,
  goal boards, help screens. **Every card and every weekly report stays,
  and no logged data is touched.**

The `/log` flow already cleans up after itself. `/clean` is for everything
else that piles up over 90 days.

## Checking it still works

```bash
python3 test_bot.py
```

Runs the real handler chain against a fake Telegram and a throwaway
database — never touches your live data. Exits 0 if everything's fine.

## Notes

- The bot token was shared in plain chat — once everything's confirmed
  working, consider regenerating it via @BotFather (`/revoke`) as
  hygiene, then update `.env`.
- Nightly DB backups are written to `backups/`.
- `.env` is gitignored — never commit it.
