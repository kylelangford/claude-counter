#!/bin/bash
# Debug wrapper - logs all input received from Claude Code

DATA_DIR="${CLAUDE_METER_DATA_DIR:-$HOME/.claude-meter}"
DEBUG_LOG="$DATA_DIR/debug.log"

mkdir -p "$DATA_DIR"

# Read all input
input=$(cat)

# Log timestamp and input
{
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
    echo "$input" | head -c 5000
    echo ""
    echo ""
} >> "$DEBUG_LOG"

# Also run the original capture script
echo "$input" | /Users/kylelangford/vercel/claude-counter/bridge/capture.sh

exit 0
