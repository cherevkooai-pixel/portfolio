"""One-time helper: prints the chat id(s) Telegram has recent updates for,
so you can copy the group's id into .env as GROUP_CHAT_ID.

Usage: add the bot to the group, send any message in it, then run:
    python3 scripts/get_chat_id.py
"""
import os
import sys
import urllib.request
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

TOKEN = os.environ["BOT_TOKEN"]

with urllib.request.urlopen(
    f"https://api.telegram.org/bot{TOKEN}/getUpdates", timeout=10
) as resp:
    data = json.load(resp)

if not data.get("ok"):
    print("Error:", data)
    sys.exit(1)

results = data.get("result", [])
if not results:
    print("No updates yet. Add the bot to your group and send a message there, then retry.")
    sys.exit(0)

seen = {}
for update in results:
    msg = update.get("message") or update.get("channel_post")
    if not msg:
        continue
    chat = msg["chat"]
    seen[chat["id"]] = f"{chat.get('type')} — {chat.get('title') or chat.get('first_name')}"

for chat_id, label in seen.items():
    print(f"{chat_id}\t{label}")

print("\nCopy the group chat id (type 'group' or 'supergroup') into .env as GROUP_CHAT_ID.")
