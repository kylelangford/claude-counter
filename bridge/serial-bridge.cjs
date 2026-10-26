/**
 * Serial Bridge for Claude Meter
 *
 * Reads usage data and sends it to the ESP32 via USB serial.
 * Run with: node serial-bridge.cjs
 */

const { SerialPort } = require('serialport');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration - use /dev/cu.* not /dev/tty.* on macOS (auto-detected if unset)
const SERIAL_PORT = process.env.SERIAL_PORT || '';
const BAUD_RATE = 115200;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '5000', 10);
const DATA_FILE = path.join(os.homedir(), '.claude-meter', 'usage.json');
const MOCK_MODE = process.env.MOCK_MODE === 'true';

// Mock data
const MOCK_DATA = {
  fiveHour: {
    usedPercent: 34.5,
    resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    resetsAtEpoch: Math.floor(Date.now() / 1000) + 2 * 60 * 60
  },
  sevenDay: {
    usedPercent: 62.8,
    resetsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    resetsAtEpoch: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60
  },
  stale: false,
  source: 'mock'
};

let port = null;

function readUsageData() {
  if (MOCK_MODE) {
    return {
      ...MOCK_DATA,
      updatedAt: new Date().toISOString(),
      updatedAtEpoch: Math.floor(Date.now() / 1000)
    };
  }

  try {
    if (!fs.existsSync(DATA_FILE)) {
      return null;
    }
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(content);

    // Check staleness
    const updatedAt = data.updatedAtEpoch ? data.updatedAtEpoch * 1000 : 0;
    const age = Date.now() - updatedAt;
    data.stale = age > 5 * 60 * 1000; // 5 minutes

    // fiveHour/sevenDay are rate limits only (or null); context and cost
    // stay in their own fields so the firmware can't mistake them
    return data;
  } catch (error) {
    console.error('Error reading usage data:', error.message);
    return null;
  }
}

function sendData() {
  if (!port || !port.isOpen) {
    console.log('Serial port not open, skipping...');
    return;
  }

  const data = readUsageData();

  if (!data) {
    console.log('No usage data available');
    return;
  }

  // Send only what the firmware uses, to keep each line well under its RX buffer.
  // nowEpoch lets the board (which has no clock) compute reset countdowns.
  const window = (w) => w ? { usedPercent: w.usedPercent, resetsAtEpoch: w.resetsAtEpoch } : null;
  const json = JSON.stringify({
    fiveHour: window(data.fiveHour),
    sevenDay: window(data.sevenDay),
    context: data.context ? { usedPercent: data.context.usedPercent } : null,
    stale: data.stale,
    nowEpoch: Math.floor(Date.now() / 1000)
  });
  console.log(`Sending: ${json}`);

  port.write(json + '\n', (err) => {
    if (err) {
      console.error('Write error:', err.message);
    }
  });
}

async function findSerialPort() {
  const ports = await SerialPort.list();

  // Look for the ESP32
  const esp = ports.find(p =>
    p.path.includes('usbmodem') ||
    p.path.includes('usbserial') ||
    p.path.includes('SLAB') ||
    p.path.includes('CP210')
  );

  if (esp) {
    // macOS lists /dev/tty.*; /dev/cu.* doesn't wait for carrier detect
    return esp.path.replace('/dev/tty.', '/dev/cu.');
  }

  // List available ports
  console.log('Available serial ports:');
  ports.forEach(p => console.log(`  ${p.path}`));

  return null;
}

async function main() {
  console.log('');
  console.log('='.repeat(50));
  console.log('  Claude Meter Serial Bridge');
  console.log('='.repeat(50));
  console.log('');
  console.log(`  Mode:      ${MOCK_MODE ? 'MOCK' : 'LIVE'}`);
  console.log(`  Data file: ${DATA_FILE}`);
  console.log(`  Interval:  ${POLL_INTERVAL_MS}ms`);
  console.log('');

  // Use configured serial port, or find the ESP32
  const serialPath = SERIAL_PORT || await findSerialPort();
  if (!serialPath) {
    console.error('No ESP32 serial port found. Set SERIAL_PORT to override.');
    process.exit(1);
  }
  console.log(`  Serial:    ${serialPath}`);
  console.log('');

  // Open serial port
  try {
    port = new SerialPort({
      path: serialPath,
      baudRate: BAUD_RATE
    });

    port.on('open', () => {
      console.log('Serial port opened');
      console.log('Waiting for ESP32 to initialize...');

      // Wait a bit for ESP32 to boot
      setTimeout(() => {
        console.log('Starting data transmission...');
        console.log('');

        // Send immediately, then on interval
        sendData();
        setInterval(sendData, POLL_INTERVAL_MS);
      }, 2000);
    });

    port.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`ESP32: ${msg}`);
      }
    });

    port.on('error', (err) => {
      console.error('Serial error:', err.message);
    });

    port.on('close', () => {
      console.log('Serial port closed');
    });

  } catch (error) {
    console.error('Failed to open serial port:', error.message);
    console.log('');
    console.log('Make sure:');
    console.log('  1. ESP32 is connected via USB');
    console.log('  2. Arduino IDE Serial Monitor is closed');
    console.log('  3. The port path is correct');
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (port && port.isOpen) {
    port.close();
  }
  process.exit(0);
});

main();
