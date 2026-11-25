import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.environ["BOT_TOKEN"]
USER_ID_1 = int(os.environ["USER_ID_1"])
USER_ID_2 = int(os.environ["USER_ID_2"])
GROUP_CHAT_ID = int(os.environ["GROUP_CHAT_ID"])

START_DATE = os.environ.get("START_DATE", "2026-09-01")
REMINDER_TIMES = [t.strip() for t in os.environ.get("REMINDER_TIMES", "09:00,15:00,20:30").split(",")]
DEADLINE_TIME = os.environ.get("DEADLINE_TIME", "23:30")
FORFEIT_AMOUNT = float(os.environ.get("FORFEIT_AMOUNT", "20"))
BACKUP_DIR = os.environ.get("BACKUP_DIR", "backups")
DB_PATH = os.environ.get("DB_PATH", "challenge.db")

TIMEZONE = "America/Toronto"

# Tuple, not a set: membership still works, and iteration order stays stable so
# /today and /leaderboard always list the two of you in the same order.
ALLOWED_USER_IDS = (USER_ID_1, USER_ID_2)
