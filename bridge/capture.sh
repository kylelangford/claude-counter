#!/bin/bash
# Claude Code Status-Line Capture Script
# This script receives JSON via stdin from Claude Code and saves usage data.
#
# Claude Code calls this script when:
# - A new assistant message arrives
# - Rate-limit windows reset
# - Various other events (see docs)
#
# The script extracts rate-limit data and saves it to a JSON file
# that the Node.js bridge server reads and serves via HTTP.

set -euo pipefail

# Configuration
DATA_DIR="${CLAUDE_METER_DATA_DIR:-$HOME/.claude-meter}"
DATA_FILE="$DATA_DIR/usage.json"

# Ensure data directory exists
mkdir -p "$DATA_DIR"

# Read JSON from stdin
input=$(cat)

# Exit if no input
if [ -z "$input" ]; then
    exit 0
fi

# Extract rate limit data using jq
# Use // empty to handle missing fields gracefully
five_hour_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_hour_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seven_day_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
seven_day_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# Extract context window data as fallback (percent of the session's actual window size)
context_used_pct=$(echo "$input" | jq -r '.context_window as $cw | if $cw.current_usage and $cw.context_window_size then (($cw.current_usage | .input_tokens + .output_tokens + .cache_creation_input_tokens + .cache_read_input_tokens) * 100 / $cw.context_window_size | floor) else empty end')
context_total=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
cost_usd=$(echo "$input" | jq -r '.cost.total_cost_usd // empty')
model_name=$(echo "$input" | jq -r '.model.display_name // empty')

# Get current timestamp
now=$(date +%s)
now_iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Previous data, so a session that hasn't received rate limits yet doesn't wipe them
prev_json=$(jq -c 'select(type == "object")' "$DATA_FILE" 2>/dev/null || true)

# Build output JSON with rate limits if available, context data as fallback.
# A missing window keeps the previous value until its reset time passes.
output_json=$(jq -n \
    --argjson prev "${prev_json:-null}" \
    --argjson now "$now" \
    --argjson five_pct "${five_hour_pct:-null}" \
    --argjson five_resets "${five_hour_resets:-null}" \
    --argjson seven_pct "${seven_day_pct:-null}" \
    --argjson seven_resets "${seven_day_resets:-null}" \
    --argjson context_pct "${context_used_pct:-null}" \
    --argjson context_total "${context_total:-null}" \
    --argjson cost "${cost_usd:-null}" \
    --arg model "${model_name:-}" \
    --arg updated_at "$now_iso" \
    --argjson updated_epoch "$now" \
    'def window($pct; $resets; $old):
        if $pct != null then {
            usedPercent: $pct,
            resetsAt: (if $resets != null then ($resets | todate) else null end),
            resetsAtEpoch: $resets
        } elif ($old.resetsAtEpoch // 0) > $now then $old
        else null end;
    {
        fiveHour: window($five_pct; $five_resets; $prev.fiveHour),
        sevenDay: window($seven_pct; $seven_resets; $prev.sevenDay),
        context: (
            if $context_pct != null then {
                usedPercent: $context_pct,
                totalTokens: $context_total
            } else null end
        ),
        cost: $cost,
        model: (if $model != "" then $model else null end),
        updatedAt: $updated_at,
        updatedAtEpoch: $updated_epoch,
        source: "claude-code-statusline"
    }'
)

# Write if we have rate limits OR context data
if [ -n "$five_hour_pct" ] || [ -n "$seven_day_pct" ] || [ -n "$context_used_pct" ]; then
    # Write to a temp file and rename, so readers never see a half-written file
    tmp_file=$(mktemp "$DATA_DIR/.usage.XXXXXX")
    echo "$output_json" > "$tmp_file"
    mv -f "$tmp_file" "$DATA_FILE"
fi

# Display from the merged data, so carried-over windows still show
five_hour_pct=$(echo "$output_json" | jq -r '.fiveHour.usedPercent // empty')
five_hour_resets=$(echo "$output_json" | jq -r '.fiveHour.resetsAtEpoch // empty')
seven_day_pct=$(echo "$output_json" | jq -r '.sevenDay.usedPercent // empty')
seven_day_resets=$(echo "$output_json" | jq -r '.sevenDay.resetsAtEpoch // empty')

# Display the status line: usage percentages and reset times
fmt_reset() {
    # $1 = epoch seconds; prints local time (macOS date -r, GNU date -d fallback)
    local epoch="$1" fmt="$2"
    date -r "$epoch" "+$fmt" 2>/dev/null || date -d "@$epoch" "+$fmt" 2>/dev/null || true
}

out=""
if [ -n "$five_hour_pct" ]; then
    out="5h: $(printf '%.0f' "$five_hour_pct")%"
    if [ -n "$five_hour_resets" ]; then
        out="$out (resets $(fmt_reset "$five_hour_resets" '%-I:%M%p'))"
    fi
fi
if [ -n "$seven_day_pct" ]; then
    [ -n "$out" ] && out="$out | "
    out="${out}7d: $(printf '%.0f' "$seven_day_pct")%"
    if [ -n "$seven_day_resets" ]; then
        out="$out (resets $(fmt_reset "$seven_day_resets" '%a %b %-d, %-I:%M%p'))"
    fi
fi
if [ -n "$context_used_pct" ]; then
    [ -n "$out" ] && out="$out | "
    out="${out}ctx ${context_used_pct}%"
fi
[ -n "$out" ] && echo "$out"

# Exit successfully (don't block Claude Code)
exit 0
