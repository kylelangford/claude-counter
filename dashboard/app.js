/**
 * Claude Meter Dashboard
 *
 * Polls the local bridge server and displays usage data.
 * Designed to prototype the ESP32 display UI in a browser.
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    apiUrl: 'http://localhost:3847/api/usage',
    apiToken: '', // Set if API_TOKEN is configured on server
    pollIntervalMs: 5000, // Poll every 5 seconds
    countdownIntervalMs: 1000 // Update countdown every second
  };

  // Parse URL params for configuration overrides
  const params = new URLSearchParams(window.location.search);
  if (params.has('api')) CONFIG.apiUrl = params.get('api');
  if (params.has('token')) CONFIG.apiToken = params.get('token');
  if (params.has('poll')) CONFIG.pollIntervalMs = parseInt(params.get('poll'), 10);

  // DOM Elements
  const elements = {
    status: document.getElementById('status'),
    primaryLabel: document.getElementById('primary-label'),
    primaryValue: document.getElementById('primary-value'),
    primaryBar: document.getElementById('primary-bar'),
    primaryCountdown: document.getElementById('primary-countdown'),
    secondaryLabel: document.getElementById('secondary-label'),
    secondaryValue: document.getElementById('secondary-value'),
    secondaryBar: document.getElementById('secondary-bar'),
    secondaryCountdown: document.getElementById('secondary-countdown'),
    context: document.getElementById('context'),
    updated: document.getElementById('updated')
  };

  // State
  let usageData = null;
  let lastFetchTime = null;
  let connectionState = 'disconnected'; // 'connected', 'disconnected', 'stale'

  /**
   * Format percentage for display
   */
  function formatPercent(value) {
    if (value == null) return '--%';
    return Math.round(value) + '%';
  }

  /**
   * Format token count
   */
  function formatTokens(value) {
    if (value == null) return '--';
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
    return value.toString();
  }

  /**
   * Format countdown time from epoch timestamp
   */
  function formatCountdown(resetsAtEpoch) {
    if (!resetsAtEpoch) return '--:--:--';

    const now = Math.floor(Date.now() / 1000);
    const diff = resetsAtEpoch - now;

    if (diff <= 0) return 'Now';

    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;

    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }

  /**
   * Format relative time for "last updated"
   */
  function formatRelativeTime(isoString) {
    if (!isoString) return '--';

    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  /**
   * Get severity class based on percentage
   */
  function getSeverityClass(percent) {
    if (percent == null) return '';
    if (percent >= 95) return 'danger';
    if (percent >= 80) return 'warning';
    return '';
  }

  /**
   * Update connection status indicator
   */
  function updateStatus(state) {
    connectionState = state;
    elements.status.textContent = state.charAt(0).toUpperCase() + state.slice(1);
    elements.status.className = 'status ' + state;
  }

  /**
   * Update a usage block display
   */
  function updateUsageBlock(label, value, valueText, barPercent, countdown, labelEl, valueEl, barEl, countdownEl) {
    const block = valueEl.closest('.usage-block');

    labelEl.textContent = label;

    if (value == null) {
      valueEl.textContent = '--%';
      valueEl.className = 'usage-value';
      barEl.style.width = '0%';
      barEl.className = 'progress-fill';
      countdownEl.textContent = 'N/A';
      block.classList.add('unavailable');
      return;
    }

    block.classList.remove('unavailable');

    const severity = getSeverityClass(barPercent);

    valueEl.textContent = valueText;
    valueEl.className = 'usage-value' + (severity ? ' ' + severity : '');

    barEl.style.width = Math.min(barPercent || 0, 100) + '%';
    barEl.className = 'progress-fill' + (severity ? ' ' + severity : '');

    countdownEl.textContent = countdown;
  }

  /**
   * Update entire display with current data
   */
  function updateDisplay() {
    // Blocks always show rate limits; missing windows render as unavailable
    const fh = usageData?.fiveHour;
    updateUsageBlock(
      '5-HOUR',
      fh,
      formatPercent(fh?.usedPercent),
      fh?.usedPercent,
      formatCountdown(fh?.resetsAtEpoch),
      elements.primaryLabel,
      elements.primaryValue,
      elements.primaryBar,
      elements.primaryCountdown
    );

    const sd = usageData?.sevenDay;
    updateUsageBlock(
      '7-DAY',
      sd,
      formatPercent(sd?.usedPercent),
      sd?.usedPercent,
      formatCountdown(sd?.resetsAtEpoch),
      elements.secondaryLabel,
      elements.secondaryValue,
      elements.secondaryBar,
      elements.secondaryCountdown
    );

    // Context is secondary info in the footer
    const ctx = usageData?.context;
    elements.context.textContent = ctx
      ? `Ctx ${formatPercent(ctx.usedPercent)} of ${formatTokens(ctx.totalTokens)}`
      : 'Ctx --';

    // Update last updated time
    elements.updated.textContent = 'Updated: ' + formatRelativeTime(usageData?.updatedAt);
  }

  /**
   * Update only countdown timers (called every second)
   */
  function updateCountdowns() {
    if (usageData?.fiveHour?.resetsAtEpoch) {
      elements.primaryCountdown.textContent = formatCountdown(usageData.fiveHour.resetsAtEpoch);
    }
    if (usageData?.sevenDay?.resetsAtEpoch) {
      elements.secondaryCountdown.textContent = formatCountdown(usageData.sevenDay.resetsAtEpoch);
    }

    // Also update "last updated" relative time
    elements.updated.textContent = 'Updated: ' + formatRelativeTime(usageData?.updatedAt);
  }

  /**
   * Fetch usage data from bridge server
   */
  async function fetchUsage() {
    try {
      const headers = {};
      if (CONFIG.apiToken) {
        headers['Authorization'] = 'Bearer ' + CONFIG.apiToken;
      }

      const response = await fetch(CONFIG.apiUrl, { headers });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      usageData = data;
      lastFetchTime = Date.now();

      // Determine connection state
      if (data.stale) {
        updateStatus('stale');
      } else if (data.fiveHour || data.sevenDay || data.context) {
        updateStatus('connected');
      } else {
        updateStatus('stale');
      }

      updateDisplay();

    } catch (error) {
      console.error('Fetch error:', error);
      updateStatus('disconnected');

      // Keep showing last known data if available
      if (!usageData) {
        usageData = {
          fiveHour: null,
          sevenDay: null,
          context: null,
          updatedAt: null
        };
        updateDisplay();
      }
    }
  }

  /**
   * Initialize dashboard
   */
  function init() {
    console.log('Claude Meter Dashboard');
    console.log('API URL:', CONFIG.apiUrl);
    console.log('Poll interval:', CONFIG.pollIntervalMs + 'ms');

    // Initial fetch
    fetchUsage();

    // Poll for updates
    setInterval(fetchUsage, CONFIG.pollIntervalMs);

    // Update countdowns every second
    setInterval(updateCountdowns, CONFIG.countdownIntervalMs);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
