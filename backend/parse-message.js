/**
 * parse-message.js
 * -----------------
 * The single entry point the app (or another teammate's UI) calls to parse
 * a message. Handles routing between the online LLM path and the offline
 * rules-based fallback — the caller doesn't need to know which one ran.
 *
 * No frontend/UI is built here per instructions — this is the routing logic
 * only, meant to be imported by whoever builds the UI layer.
 */
import { parseWithRules } from './rules-parser.js';

const TIMEOUT_MS = 8000;

/**
 * @param {string} message
 * @param {string} receivedAt  ISO-8601 timestamp, e.g. new Date().toISOString()
 * @param {string} domain      one of tailor|tiffin|electrician|baker
 * @returns {Promise<OrderRecord>} matching schema.json, from whichever path succeeded
 */
export async function parseMessage(message, receivedAt, domain) {
  // navigator.onLine is a hint, not a guarantee — it can be true while the
  // actual network path is broken, so we don't trust it alone; the real
  // signal is whether the fetch itself succeeds within a reasonable timeout.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return parseWithRules(message, receivedAt, domain);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch('/api/parse-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, received_at: receivedAt, domain }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const result = await response.json();
    if (result._parse_error) throw new Error(result._parse_error); // LLM path degraded to fallback shape twice — treat as failure

    return result;
  } catch {
    // Any failure — offline, timeout, server error, malformed response —
    // falls through to the deterministic rules parser. This is the actual
    // offline-fallback requirement from Objective 1: the parser must
    // degrade gracefully with no network, not just when navigator.onLine
    // happens to be false.
    return parseWithRules(message, receivedAt, domain);
  } finally {
    clearTimeout(timer);
  }
}
