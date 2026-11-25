#!/bin/bash
# Stop the bot and keep it stopped (launchd won't restart it until you
# run restart.sh again).
launchctl unload "$HOME/Library/LaunchAgents/com.serhii.challengebot.plist" 2>/dev/null
sleep 2
if pgrep -f "bot.main" > /dev/null; then
    echo "Still running — forcing."
    pkill -9 -f "bot.main"
else
    echo "🛑 Bot stopped."
fi
