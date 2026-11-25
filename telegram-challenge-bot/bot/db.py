import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    name TEXT,
    skip_pass_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
    user_id INTEGER NOT NULL,
    day_number INTEGER NOT NULL,
    date TEXT NOT NULL,
    photo_file_id TEXT,
    physique_note TEXT,
    verse TEXT,
    verse_note TEXT,
    amount REAL,
    action TEXT,
    completed_bool INTEGER NOT NULL DEFAULT 0,
    skipped_bool INTEGER NOT NULL DEFAULT 0,
    card_message_id INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day_number)
);

CREATE TABLE IF NOT EXISTS badges (
    user_id INTEGER NOT NULL,
    badge_code TEXT NOT NULL,
    earned_date TEXT NOT NULL,
    PRIMARY KEY (user_id, badge_code)
);

CREATE TABLE IF NOT EXISTS forfeits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    reason TEXT,
    date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL,            -- challenge | month | week
    period_index INTEGER NOT NULL,  -- challenge 0, month 1-3, week 1-13
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, scope, period_index)
);

CREATE TABLE IF NOT EXISTS schedule_log (
    job_key TEXT PRIMARY KEY,
    fired_at TEXT NOT NULL
);
"""


def _connect():
    # Self-heal: if the database file is missing (deleted, moved, first run),
    # recreate the schema rather than handing back a table-less connection.
    missing = not os.path.exists(config.DB_PATH)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    if missing:
        conn.executescript(SCHEMA)
        conn.commit()
    return conn


def init_db():
    conn = _connect()
    conn.executescript(SCHEMA)
    # Migration for databases created before card_message_id existed.
    cols = [row[1] for row in conn.execute("PRAGMA table_info(entries)").fetchall()]
    if "card_message_id" not in cols:
        conn.execute("ALTER TABLE entries ADD COLUMN card_message_id INTEGER")
    conn.commit()
    conn.close()


@contextmanager
def cursor():
    conn = _connect()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    finally:
        conn.close()


def _utcnow():
    return datetime.now(timezone.utc).isoformat()


# ---------------- users ----------------

def ensure_user(user_id: int, name: str):
    with cursor() as cur:
        cur.execute(
            "INSERT INTO users(user_id, name, skip_pass_used) VALUES (?, ?, 0) "
            "ON CONFLICT(user_id) DO UPDATE SET name=excluded.name",
            (user_id, name),
        )


def get_user(user_id: int):
    with cursor() as cur:
        cur.execute("SELECT * FROM users WHERE user_id=?", (user_id,))
        return cur.fetchone()


def use_skip_pass(user_id: int):
    with cursor() as cur:
        cur.execute("UPDATE users SET skip_pass_used=1 WHERE user_id=?", (user_id,))


# ---------------- entries ----------------

def get_entry(user_id: int, day_number: int):
    with cursor() as cur:
        cur.execute(
            "SELECT * FROM entries WHERE user_id=? AND day_number=?",
            (user_id, day_number),
        )
        return cur.fetchone()


def upsert_entry_fields(user_id: int, day_number: int, date_str: str, **fields):
    existing = get_entry(user_id, day_number)
    if existing is None:
        cols = ["user_id", "day_number", "date", "created_at"] + list(fields.keys())
        vals = [user_id, day_number, date_str, _utcnow()] + list(fields.values())
        placeholders = ",".join("?" for _ in vals)
        with cursor() as cur:
            cur.execute(
                f"INSERT INTO entries ({','.join(cols)}) VALUES ({placeholders})", vals
            )
    elif fields:
        set_clause = ",".join(f"{k}=?" for k in fields)
        with cursor() as cur:
            cur.execute(
                f"UPDATE entries SET {set_clause} WHERE user_id=? AND day_number=?",
                list(fields.values()) + [user_id, day_number],
            )


def recompute_completed(user_id: int, day_number: int) -> bool:
    e = get_entry(user_id, day_number)
    if not e:
        return False
    complete = bool(
        e["photo_file_id"]
        and e["physique_note"]
        and e["verse"]
        and e["verse_note"]
        and e["amount"] is not None
        and e["action"]
    )
    with cursor() as cur:
        cur.execute(
            "UPDATE entries SET completed_bool=? WHERE user_id=? AND day_number=?",
            (1 if complete else 0, user_id, day_number),
        )
    return complete


def mark_skipped(user_id: int, day_number: int, date_str: str):
    upsert_entry_fields(user_id, day_number, date_str, skipped_bool=1)


def all_card_message_ids() -> set:
    """Every card currently posted in the chat — the set /purge must not touch."""
    with cursor() as cur:
        rows = cur.execute(
            "SELECT card_message_id FROM entries WHERE card_message_id IS NOT NULL"
        ).fetchall()
    return {r["card_message_id"] for r in rows}


def set_card_message_id(user_id: int, day_number: int, message_id: int):
    with cursor() as cur:
        cur.execute(
            "UPDATE entries SET card_message_id=? WHERE user_id=? AND day_number=?",
            (message_id, user_id, day_number),
        )


def delete_entry(user_id: int, day_number: int):
    with cursor() as cur:
        cur.execute(
            "DELETE FROM entries WHERE user_id=? AND day_number=?", (user_id, day_number)
        )


def all_entries_for_user(user_id: int):
    with cursor() as cur:
        cur.execute(
            "SELECT * FROM entries WHERE user_id=? ORDER BY day_number", (user_id,)
        )
        return cur.fetchall()


def entries_in_range(user_id: int, day_from: int, day_to: int):
    with cursor() as cur:
        cur.execute(
            "SELECT * FROM entries WHERE user_id=? AND day_number BETWEEN ? AND ? "
            "ORDER BY day_number",
            (user_id, day_from, day_to),
        )
        return cur.fetchall()


# ---------------- badges ----------------

def award_badge(user_id: int, badge_code: str, date_str: str) -> bool:
    with cursor() as cur:
        cur.execute(
            "INSERT OR IGNORE INTO badges(user_id, badge_code, earned_date) VALUES (?,?,?)",
            (user_id, badge_code, date_str),
        )
        return cur.rowcount > 0


def get_badges(user_id: int):
    with cursor() as cur:
        cur.execute(
            "SELECT * FROM badges WHERE user_id=? ORDER BY earned_date", (user_id,)
        )
        return cur.fetchall()


# ---------------- forfeits ----------------

def add_forfeit(user_id: int, amount: float, reason: str, date_str: str):
    with cursor() as cur:
        cur.execute(
            "INSERT INTO forfeits(user_id, amount, reason, date) VALUES (?,?,?,?)",
            (user_id, amount, reason, date_str),
        )


def total_forfeits(user_id: int) -> float:
    with cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) AS t FROM forfeits WHERE user_id=?",
            (user_id,),
        )
        return cur.fetchone()["t"]


# ---------------- goals ----------------

def set_goal(user_id: int, scope: str, period_index: int, text: str):
    with cursor() as cur:
        cur.execute(
            "INSERT INTO goals(user_id, scope, period_index, text, updated_at) "
            "VALUES (?,?,?,?,?) "
            "ON CONFLICT(user_id, scope, period_index) "
            "DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
            (user_id, scope, period_index, text, _utcnow()),
        )


def get_goal(user_id: int, scope: str, period_index: int):
    with cursor() as cur:
        cur.execute(
            "SELECT * FROM goals WHERE user_id=? AND scope=? AND period_index=?",
            (user_id, scope, period_index),
        )
        return cur.fetchone()


# ---------------- schedule_log (idempotency) ----------------

def has_fired(job_key: str) -> bool:
    with cursor() as cur:
        cur.execute("SELECT 1 FROM schedule_log WHERE job_key=?", (job_key,))
        return cur.fetchone() is not None


def mark_fired(job_key: str):
    with cursor() as cur:
        cur.execute(
            "INSERT OR IGNORE INTO schedule_log(job_key, fired_at) VALUES (?,?)",
            (job_key, _utcnow()),
        )
