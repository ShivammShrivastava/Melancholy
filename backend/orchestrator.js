/**
 * orchestrator.js
 * ---------------
 * The single entry point the frontend teammate calls to go from "raw Hinglish
 * message in" to "stored structured order out". Hides all internal routing
 * (online LLM attempt → offline rules fallback) and the Firestore write
 * behind one async function call.
 *
 * Usage from a UI button handler:
 *   import { handleIncomingMessage } from './orchestrator.js';
 *   const result = await handleIncomingMessage("2 kurta navy blue, parso tak", "tailor");
 *   // result = { orderId, customer, items, due_date, amount, ... }
 */
import { parseMessage } from './parse-message.js';
import { createOrder } from './order-service.js';

/**
 * Parse a raw customer message and store the resulting order in Firestore.
 *
 * @param {string} rawMessage - the raw Hinglish message text from the customer
 * @param {string} domain - one of tailor|tiffin|electrician|baker
 * @param {object} [options] - optional overrides
 * @param {string} [options.receivedAt] - ISO-8601 timestamp; defaults to now.
 *   In production this is always now(), but the batch runner passes the
 *   per-message received_at from the test file so date resolution anchors
 *   correctly.
 * @returns {Promise<{orderId: string, customer, items, due_date, amount,
 *   references_prior_order, confidence, needs_clarification}>}
 */
export async function handleIncomingMessage(rawMessage, domain, options = {}) {
  const receivedAt = options.receivedAt || new Date().toISOString();

  // Step 1: Parse — tries online LLM (8s timeout), falls back to rules-parser
  const parsed = await parseMessage(rawMessage, receivedAt, domain);

  // Step 2: Store — writes to Firestore (local cache if offline, queues for
  // server sync on reconnect automatically via persistentLocalCache)
  const orderData = {
    ...parsed,
    received_at: receivedAt,
    raw_message: rawMessage,
    domain,
  };

  const orderId = await createOrder(orderData);

  // Return the parsed result plus the generated orderId so the UI can
  // display confirmation and navigate to the order detail view
  return { orderId, ...parsed };
}
