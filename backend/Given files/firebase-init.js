/**
 * firebase-init.js
 * ----------------
 * Initializes Firestore with offline persistence. Uses the modern
 * `persistentLocalCache()` API (NOT the older `enableIndexedDbPersistence()`
 * call) — this is what actually gives Objective 2's offline CRUD
 * requirement: reads/writes work against a local IndexedDB cache, writes
 * made offline queue up and flush automatically on reconnect.
 *
 * Loaded via CDN as ES modules — no npm install, no bundler, matches the
 * plain HTML/CSS/JS frontend. Import this module wherever `db` is needed:
 *   import { db } from './firebase-init.js';
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  initializeFirestore,
  persistentLocalCache,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);

// persistentLocalCache(): Firestore caches every read/write locally in
// IndexedDB. Writes made offline apply optimistically to the local cache
// immediately (the UI updates before the network confirms anything) and
// queue as pending mutations; on reconnect they flush to the server in
// order and reconcile back into the local cache. Reads are served from
// this cache whether online or offline, which is what lets the query
// layer (due-today, who-owes-money, etc.) work with zero network.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});
