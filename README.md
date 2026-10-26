# Claude Usage Meter

A physical desktop device that displays Claude subscription usage in real time.

**Current Status: Phase 1 & 2 Complete**
- Local data bridge server
- Browser-based dashboard prototype

## Architecture

```
Claude Code CLI
      |
      | Status-line JSON (stdin)
      v
capture.sh (saves to ~/.claude-meter/usage.json)
      |
      v
Node.js Bridge Server (localhost:3847)
      |
      | GET /api/usage
      v
Browser Dashboard / ESP32 (future)
```

## Quick Start

### 1. Test with Mock Data

```bash
cd bridge
npm run mock
```

Open `dashboard/index.html` in a browser. You should see simulated usage data.

### 2. Configure Claude Code Status-Line

The capture script requires `jq` to be installed:

```bash
# macOS
brew install jq

# Verify
jq --version
```

Make the capture script executable:

```bash
chmod +x bridge/capture.sh
```

Add the status-line configuration to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/Users/kylelangford/vercel/claude-counter/bridge/capture.sh",
    "refreshInterval": 60
  }
}
```

**Important:** Use the absolute path to `capture.sh`.

If you have an existing `settings.json`, merge the `statusLine` key with your existing settings.

### 3. Run the Bridge Server (Live Mode)

```bash
cd bridge
npm start
```

The server will read from `~/.claude-meter/usage.json` (created by the capture script).

### 4. View the Dashboard

Open `dashboard/index.html` in your browser. The dashboard polls the bridge server every 5 seconds.

**Note:** You may need to serve the files via HTTP due to CORS. A simple option:

```bash
cd dashboard
python3 -m http.server 8080
```

Then open: http://localhost:8080

## API Reference

### GET /api/usage

Returns current Claude usage data.

**Response:**

```json
{
  "fiveHour": {
    "usedPercent": 34.5,
    "resetsAt": "2026-10-23T01:00:00Z",
    "resetsAtEpoch": 1761354000
  },
  "sevenDay": {
    "usedPercent": 62.8,
    "resetsAt": "2026-10-26T12:00:00Z",
    "resetsAtEpoch": 1761652800
  },
  "updatedAt": "2026-10-22T22:00:00Z",
  "updatedAtEpoch": 1761343200,
  "stale": false,
  "source": "claude-code-statusline"
}
```

**Field Notes:**
- `fiveHour` / `sevenDay`: May be `null` if not available
- `stale`: `true` if data is older than 5 minutes
- `source`: "mock" in mock mode, "claude-code-statusline" in live mode

### GET /health

Server health check.

### GET /

Server info and endpoint list.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | Server port |
| `API_TOKEN` | (none) | Bearer token for authentication |
| `MOCK_MODE` | `false` | Use mock data instead of real capture |
| `DATA_DIR` | `~/.claude-meter` | Directory for usage.json |
| `STALE_THRESHOLD_MS` | `300000` | How old before data is considered stale (5 min) |

### Dashboard URL Parameters

| Parameter | Description |
|-----------|-------------|
| `api` | Override API URL |
| `token` | Bearer token for API |
| `poll` | Poll interval in milliseconds |

Example: `index.html?api=http://192.168.1.100:3847/api/usage&poll=10000`

## Data Availability

**Rate limit data is only available when:**
- You're a Claude Pro or Max subscriber
- Claude Code has made at least one API request in the current session
- The rate limit windows haven't expired

**The data updates when:**
- A new assistant message arrives
- `/compact` finishes
- A rate-limit window resets

**Limitations:**
- Data only updates while Claude Code is running
- When your Mac sleeps, no new data is captured
- The 5-minute stale threshold helps detect when data stops flowing

## Files

```
claude-counter/
├── bridge/
│   ├── capture.sh      # Status-line capture script
│   ├── server.cjs      # Node.js HTTP server
│   └── package.json
├── dashboard/
│   ├── index.html      # UI prototype
│   ├── styles.css      # Dark theme styles
│   └── app.js          # Polling and display logic
└── README.md
```

## Troubleshooting

### "No usage data available"

1. Ensure `jq` is installed: `jq --version`
2. Check capture script is executable: `ls -la bridge/capture.sh`
3. Verify settings.json path is absolute
4. Make a Claude Code request to trigger the status-line
5. Check if data file exists: `cat ~/.claude-meter/usage.json`

### "Stale" status

Data hasn't been updated in 5+ minutes. This happens when:
- Claude Code isn't running
- Your Mac is asleep
- No recent Claude Code activity

### Dashboard shows "Disconnected"

1. Ensure bridge server is running: `npm start`
2. Check server port: default is 3847
3. Try: `curl http://localhost:3847/api/usage`

### CORS errors in browser

Serve the dashboard via HTTP:
```bash
cd dashboard && python3 -m http.server 8080
```

## Phase 3: ESP32 Development

**Use Arduino IDE** (not PlatformIO) for this project. Waveshare provides Arduino-based examples with verified pin mappings, and Arduino IDE has fewer configuration variables for a first microcontroller project.

### Setup

1. **Install Arduino IDE 2.x** from https://www.arduino.cc/en/software

2. **Add ESP32-S3 board support:**
   - Open Arduino IDE → Settings
   - Add to "Additional boards manager URLs":
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - Tools → Board → Boards Manager → Search "esp32" → Install "esp32 by Espressif Systems"

3. **Install required libraries** (Tools → Manage Libraries):
   - `TFT_eSPI` (display driver)
   - `ArduinoJson` (JSON parsing)
   - `WiFi` (built-in with ESP32 board package)

4. **Configure TFT_eSPI for Waveshare board:**
   - Follow Waveshare wiki for User_Setup.h pin configuration
   - Their examples include the correct settings

### Development Steps

| Step | Test |
|------|------|
| 1. Connect board via USB-C | Mac recognizes serial port |
| 2. Select board in Arduino IDE | Tools → Board → ESP32S3 Dev Module |
| 3. Flash blink example | LED blinks |
| 4. Flash Waveshare display example | "Hello World" on screen |
| 5. Rotate display to landscape | 320×240 orientation |
| 6. Connect to Wi-Fi | Serial monitor shows IP |
| 7. HTTP GET to bridge server | JSON response in serial |
| 8. Parse JSON with ArduinoJson | Extract usage values |
| 9. Render progress bars | Match dashboard design |
| 10. Add error handling | Reconnect on Wi-Fi loss |

### ESP32 Sketch Structure

```
firmware/
└── claude_counter/
    ├── claude_counter.ino  # Main sketch (USB serial mode)
    ├── config.example.h    # Template for config.h
    └── config.h            # Wi-Fi credentials (gitignored, for future Wi-Fi mode)
```

This is the only copy of the sketch. `~/Documents/Arduino/claude_counter` is a
symlink to it, so it shows up in the Arduino IDE sketchbook.

**Board settings** (Tools menu): ESP32S3 Dev Module, USB Mode: Hardware CDC and
JTAG, **USB CDC On Boot: Enabled**. With CDC On Boot disabled, `Serial` goes to
the UART pins instead of the USB-C port and the board never receives data.

### Running in Serial Mode

```bash
cd bridge
npm run serial
```

The bridge auto-detects the board's port (override with `SERIAL_PORT=/dev/cu.usbmodemXXXX`)
and sends a compact JSON line every 5 seconds. Close the Arduino IDE Serial
Monitor first; only one program can hold the port.

### Key Differences from Browser Dashboard

- No CSS - draw rectangles and text directly
- Fixed-point math instead of floats where possible
- Store Wi-Fi credentials in `config.h` (gitignored)
- Poll interval: 30-60 seconds (not 5) to reduce power/traffic
- Implement exponential backoff on connection failures

### Resources

- Waveshare Wiki: https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-2
- TFT_eSPI docs: https://github.com/Bodmer/TFT_eSPI
- ArduinoJson: https://arduinojson.org/

## Security Notes

- The bridge server only runs locally
- No credentials are sent to the ESP32
- API token is optional but recommended for production
- The capture script only extracts rate limit percentages and timestamps
- No conversation content is captured or stored
