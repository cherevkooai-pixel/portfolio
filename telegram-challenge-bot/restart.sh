#!/bin/bash
# Restart the bot. It runs as a launchd service, so this asks launchd to
# recycle it — that keeps the auto-restart-on-crash behaviour intact.
LABEL="com.serhii.challengebot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
cd "$(dirname "$0")" || exit 1

if [ ! -f "$PLIST" ]; then
    echo "LaunchAgent missing at $PLIST"
    exit 1
fi

launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null \
    || { launchctl unload "$PLIST" 2>/dev/null; launchctl load -w "$PLIST"; }

sleep 6
if pgrep -f "bot.main" > /dev/null; then
    echo "✅ Bot restarted (PID $(pgrep -f 'bot.main' | tr '\n' ' '))"
    echo "   Log: $(pwd)/bot.log"
else
    echo "❌ Not running. Last 20 log lines:"
    tail -20 bot.log
    exit 1
fi
