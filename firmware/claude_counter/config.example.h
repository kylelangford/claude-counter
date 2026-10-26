// Claude Meter Configuration
// Copy this file to config.h and fill in your values.
// config.h is gitignored to protect your credentials.

#ifndef CONFIG_H
#define CONFIG_H

// Wi-Fi credentials
#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASSWORD "your-wifi-password"

// Bridge server settings
// Find your Mac's local IP: System Settings → Network → Wi-Fi → Details → IP Address
#define BRIDGE_HOST "192.168.1.xxx"
#define BRIDGE_PORT 3847

// Optional: API token (leave empty if not configured on server)
#define API_TOKEN ""

// Polling interval in milliseconds (30-60 seconds recommended)
#define POLL_INTERVAL_MS 30000

// Display brightness (0-255)
#define DISPLAY_BRIGHTNESS 200

#endif
