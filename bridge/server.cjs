/**
 * Claude Meter Bridge Server
 *
 * A minimal Node.js server that exposes Claude Code usage data via HTTP API.
 * The ESP32 (or browser dashboard) polls this endpoint to get current usage.
 *
 * Data flow:
 * 1. Claude Code triggers status-line script (capture.sh)
 * 2. capture.sh extracts rate limits and saves to ~/.claude-meter/usage.json
 * 3. This server reads that file and serves it via GET /api/usage
 *
 * Environment variables:
 * - PORT: Server port (default: 3847)
 * - API_TOKEN: Bearer token for authentication (required in production)
 * - MOCK_MODE: Set to "true" to serve mock data (for development)
 * - DATA_DIR: Directory containing usage.json (default: ~/.claude-meter)
 * - STALE_THRESHOLD_MS: How old data can be before marked stale (default: 5 minutes)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const PORT = parseInt(process.env.PORT || '3847', 10);
const API_TOKEN = process.env.API_TOKEN || '';
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.claude-meter');
const DATA_FILE = path.join(DATA_DIR, 'usage.json');
const STALE_THRESHOLD_MS = parseInt(process.env.STALE_THRESHOLD_MS || String(5 * 60 * 1000), 10);

// Mock data for development
const MOCK_DATA = {
  fiveHour: {
    usedPercent: 34.5,
    resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
    resetsAtEpoch: Math.floor(Date.now() / 1000) + 2 * 60 * 60
  },
  sevenDay: {
    usedPercent: 62.8,
    resetsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
    resetsAtEpoch: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60
  },
  updatedAt: new Date().toISOString(),
  updatedAtEpoch: Math.floor(Date.now() / 1000),
  source: 'mock'
};

/**
 * Read and parse the usage data file
 */
function readUsageData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return null;
    }
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading usage data: ${error.message}`);
    return null;
  }
}

/**
 * Get usage data with stale detection
 */
function getUsageData() {
  if (MOCK_MODE) {
    // In mock mode, return fresh mock data with current timestamps
    return {
      ...MOCK_DATA,
      updatedAt: new Date().toISOString(),
      updatedAtEpoch: Math.floor(Date.now() / 1000),
      stale: false
    };
  }

  const data = readUsageData();

  if (!data) {
    return {
      fiveHour: null,
      sevenDay: null,
      updatedAt: null,
      updatedAtEpoch: null,
      stale: true,
      error: 'No usage data available. Claude Code may not have run yet, or rate limit data is not available for your subscription.'
    };
  }

  // Check if data is stale
  const updatedAt = data.updatedAtEpoch ? data.updatedAtEpoch * 1000 : 0;
  const age = Date.now() - updatedAt;
  const stale = age > STALE_THRESHOLD_MS;

  return {
    ...data,
    stale,
    ageMs: age
  };
}

/**
 * Validate API token if configured
 */
function validateToken(req) {
  if (!API_TOKEN) {
    // No token configured - allow all requests (development mode)
    return true;
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  return token === API_TOKEN;
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * HTTP request handler
 */
function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // Only allow GET requests
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  // Route: GET /api/usage
  if (url.pathname === '/api/usage') {
    if (!validateToken(req)) {
      sendJson(res, 401, { error: 'Unauthorized. Provide valid Bearer token.' });
      return;
    }

    const data = getUsageData();
    sendJson(res, 200, data);
    return;
  }

  // Route: GET /health
  if (url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      mockMode: MOCK_MODE,
      dataFile: DATA_FILE,
      dataExists: fs.existsSync(DATA_FILE)
    });
    return;
  }

  // Route: GET / (info)
  if (url.pathname === '/') {
    sendJson(res, 200, {
      name: 'Claude Meter Bridge',
      version: '1.0.0',
      endpoints: {
        '/api/usage': 'GET - Returns current Claude usage data',
        '/health': 'GET - Server health check'
      },
      mockMode: MOCK_MODE
    });
    return;
  }

  // 404 for everything else
  sendJson(res, 404, { error: 'Not found' });
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(50));
  console.log('  Claude Meter Bridge Server');
  console.log('='.repeat(50));
  console.log('');
  console.log(`  Mode:      ${MOCK_MODE ? 'MOCK (development)' : 'LIVE'}`);
  console.log(`  Port:      ${PORT}`);
  console.log(`  Data file: ${DATA_FILE}`);
  console.log(`  Auth:      ${API_TOKEN ? 'ENABLED' : 'DISABLED (development)'}`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    http://localhost:${PORT}/api/usage`);
  console.log(`    http://localhost:${PORT}/health`);
  console.log('');

  if (!MOCK_MODE && !fs.existsSync(DATA_FILE)) {
    console.log('  NOTE: No usage data file found yet.');
    console.log('  Configure Claude Code status-line to start capturing data.');
    console.log('');
  }

  console.log('  Press Ctrl+C to stop');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => {
    process.exit(0);
  });
});
