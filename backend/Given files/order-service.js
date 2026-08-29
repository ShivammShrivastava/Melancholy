/**
 * order-service.js
 * ----------------
 * CRUD + query functions for order records. Everything here runs against
 * Firestore's local persistent cache (see firebase-init.js) — no network
 * required for any function in this file, whether online or offline.
 *
 * `last_modified` and `device_id` are stamped on every write; a teammate is
 * building the full sync/conflict-resolution logic on top of these two
 * fields (per conflict_scenarios.md) — this file just guarantees they're
 * always populated correctly, it doesn't implement the merge policy itself.
 */
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from './firebase-init.js';

const ORDERS_COLLECTION = 'orders';

// A stable per-browser-install identifier, used as the sync tie-break.
// Generated once and cached in localStorage-equivalent (here: a simple
// module-level constant seeded at first call) — swap for a more durable
// per-device ID scheme if the sync layer needs one that survives a full
// app reinstall.
function getDeviceId() {
  const key = 'devcraft_device_id';
  let id = window.localStorage?.getItem(key);
  if (!id) {
    id = `device-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    window.localStorage?.setItem(key, id);
  }
  return id;
}

/** Validates the combined order shape before any write. Throws on mismatch
 * rather than silently writing malformed documents — there's no TypeScript
 * here to catch this at compile time, so it has to be a runtime check. */
export function validateOrderShape(order) {
  const required = ['customer', 'items', 'due_date', 'amount', 'references_prior_order', 'confidence', 'needs_clarification'];
  for (const field of required) {
    if (!(field in order)) throw new Error(`order missing required field: ${field}`);
  }
  if (!Array.isArray(order.items)) throw new Error('order.items must be an array');
  return true;
}

export async function createOrder(order) {
  validateOrderShape(order);
  const orderId = order.order_id || `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fullOrder = {
    ...order,
    order_id: orderId,
    last_modified: new Date().toISOString(),
    device_id: getDeviceId(),
  };
  await setDoc(doc(db, ORDERS_COLLECTION, orderId), fullOrder);
  return orderId;
}

export async function getOrder(orderId) {
  const snap = await getDoc(doc(db, ORDERS_COLLECTION, orderId));
  return snap.exists() ? snap.data() : null;
}

export async function getAllOrders() {
  const snap = await getDocs(collection(db, ORDERS_COLLECTION));
  return snap.docs.map((d) => d.data());
}

export async function updateOrder(orderId, patch) {
  await updateDoc(doc(db, ORDERS_COLLECTION, orderId), {
    ...patch,
    last_modified: new Date().toISOString(),
    device_id: getDeviceId(),
  });
}

export async function deleteOrder(orderId) {
  await deleteDoc(doc(db, ORDERS_COLLECTION, orderId));
}

// --- Query layer (Objective 4) — all run against the local cache only ---

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function getDueToday() {
  const all = await getAllOrders();
  const today = todayISO();
  return all.filter((o) => o.due_date === today);
}

export async function getOverdue() {
  const all = await getAllOrders();
  const today = todayISO();
  return all.filter((o) => o.due_date && o.due_date < today);
}

export async function getCustomerBalance() {
  const all = await getAllOrders();
  const totals = {};
  for (const o of all) {
    if (!o.customer || o.amount == null) continue;
    totals[o.customer] = (totals[o.customer] || 0) + o.amount;
  }
  return Object.entries(totals).map(([customer, totalOwed]) => ({ customer, totalOwed }));
}

export async function getLastOrderForCustomer(customerName) {
  const all = await getAllOrders();
  const matches = all
    .filter((o) => o.customer === customerName)
    .sort((a, b) => (b.received_at || '').localeCompare(a.received_at || ''));
  return matches[0] || null;
}

export async function getWeeklyCapacity() {
  const all = await getAllOrders();
  const today = todayISO();
  const weekAhead = new Date();
  weekAhead.setDate(weekAhead.getDate() + 7);
  const weekAheadISO = weekAhead.toISOString().slice(0, 10);
  return all.filter((o) => o.due_date && o.due_date >= today && o.due_date <= weekAheadISO);
}
