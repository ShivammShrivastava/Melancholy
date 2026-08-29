/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Firebase Bridge (js/firebase-bridge.js)
   Connects the frontend DataStore (localStorage) to Firestore.
   
   This script runs as a <script type="module"> AFTER data.js loads.
   It overrides key DataStore methods so every write goes to BOTH
   localStorage (for instant UI) and Firestore (for server sync).
   
   Firestore's persistentLocalCache ensures offline reads/writes
   work identically — the bridge is transparent to all UI code.
   ═══════════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  initializeFirestore,
  persistentLocalCache,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, orderBy,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// ─── Firebase Config ───
const firebaseConfig = {
  apiKey: 'AIzaSyDye0uVLYOmPHGjybXFpsDEhGypVHEtTFU',
  authDomain: 'melancholy-90b90.firebaseapp.com',
  projectId: 'melancholy-90b90',
  storageBucket: 'melancholy-90b90.firebasestorage.app',
  messagingSenderId: '628496826318',
  appId: '1:628496826318:web:62ee0ee028f6c167f4359f',
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

// ─── Device ID (stable per browser install) ───
function getDeviceId() {
  let id = localStorage.getItem('kaamflow_deviceId');
  if (!id) {
    id = 'device-' + crypto.randomUUID().slice(0, 8);
    localStorage.setItem('kaamflow_deviceId', id);
  }
  return id;
}

// ─── Firestore Collections ───
const ORDERS_COL = 'orders';
const CUSTOMERS_COL = 'customers';
const PAYMENTS_COL = 'payments';

// ─── Sync flag to avoid infinite loops ───
let _firestoreSyncing = false;

// ─── SEED FIRESTORE (first run only) ───
async function seedFirestoreIfEmpty() {
  try {
    const ordersSnap = await getDocs(collection(db, ORDERS_COL));
    if (ordersSnap.empty) {
      console.log('[firebase-bridge] Seeding Firestore with initial data...');
      const orders = window.DataStore.getOrders();
      const customers = window.DataStore.getCustomers();
      const payments = window.DataStore.getPayments();

      const promises = [];
      orders.forEach(function(o) {
        promises.push(setDoc(doc(db, ORDERS_COL, o.id), {
          ...o,
          last_modified: new Date().toISOString(),
          device_id: getDeviceId(),
        }));
      });
      customers.forEach(function(c) {
        promises.push(setDoc(doc(db, CUSTOMERS_COL, c.id), c));
      });
      payments.forEach(function(p) {
        promises.push(setDoc(doc(db, PAYMENTS_COL, p.id), p));
      });

      await Promise.all(promises);
      console.log('[firebase-bridge] Seeded', orders.length, 'orders,', customers.length, 'customers,', payments.length, 'payments');
    } else {
      console.log('[firebase-bridge] Firestore already has data, pulling to localStorage...');
      // Pull Firestore data into localStorage so DataStore is in sync
      await pullOrdersFromFirestore();
    }
  } catch (err) {
    console.warn('[firebase-bridge] Seed/pull error (offline?):', err.message);
  }
}

// ─── Pull orders from Firestore → localStorage ───
async function pullOrdersFromFirestore() {
  try {
    const snap = await getDocs(collection(db, ORDERS_COL));
    if (!snap.empty) {
      const orders = [];
      snap.forEach(function(d) { orders.push(d.data()); });
      const key = 'kaamflow_' + window.DataStore.getActiveDevice() + '_orders';
      localStorage.setItem(key, JSON.stringify(orders));
    }
  } catch (err) {
    console.warn('[firebase-bridge] Pull error:', err.message);
  }
}

// ─── Override DataStore.saveOrder ───
const _originalSaveOrder = window.DataStore.saveOrder;
window.DataStore.saveOrder = function(order) {
  // 1. Save to localStorage (instant UI update)
  const result = _originalSaveOrder(order);

  // 2. Save to Firestore (background, queues if offline)
  if (!_firestoreSyncing) {
    const firestoreOrder = {
      ...order,
      last_modified: new Date().toISOString(),
      device_id: getDeviceId(),
    };
    setDoc(doc(db, ORDERS_COL, order.id), firestoreOrder).catch(function(err) {
      console.warn('[firebase-bridge] Firestore write error:', err.message);
    });
  }

  return result;
};

// ─── Override DataStore.deleteOrder ───
const _originalDeleteOrder = window.DataStore.deleteOrder;
window.DataStore.deleteOrder = function(id) {
  // 1. Delete from localStorage
  _originalDeleteOrder(id);

  // 2. Delete from Firestore
  if (!_firestoreSyncing) {
    deleteDoc(doc(db, ORDERS_COL, id)).catch(function(err) {
      console.warn('[firebase-bridge] Firestore delete error:', err.message);
    });
  }
};

// ─── Override DataStore.saveCustomer ───
const _originalSaveCustomer = window.DataStore.saveCustomer;
window.DataStore.saveCustomer = function(customer) {
  const result = _originalSaveCustomer(customer);

  if (!_firestoreSyncing) {
    setDoc(doc(db, CUSTOMERS_COL, customer.id), customer).catch(function(err) {
      console.warn('[firebase-bridge] Firestore customer write error:', err.message);
    });
  }

  return result;
};

// ─── Override DataStore.recordPayment ───
const _originalRecordPayment = window.DataStore.recordPayment;
window.DataStore.recordPayment = function(payment) {
  const result = _originalRecordPayment(payment);

  if (!_firestoreSyncing) {
    setDoc(doc(db, PAYMENTS_COL, result.id), result).catch(function(err) {
      console.warn('[firebase-bridge] Firestore payment write error:', err.message);
    });
  }

  return result;
};

// ─── Real-time listener: Firestore → localStorage ───
function startRealtimeSync() {
  onSnapshot(collection(db, ORDERS_COL), function(snapshot) {
    if (snapshot.metadata.hasPendingWrites) return; // Skip local echoes

    const orders = [];
    snapshot.forEach(function(d) { orders.push(d.data()); });

    if (orders.length > 0) {
      _firestoreSyncing = true;
      const key = 'kaamflow_' + window.DataStore.getActiveDevice() + '_orders';
      localStorage.setItem(key, JSON.stringify(orders));
      _firestoreSyncing = false;

      // Dispatch a custom event so pages can refresh their UI
      window.dispatchEvent(new CustomEvent('kaamflow:ordersUpdated', { detail: { orders } }));
    }
  }, function(err) {
    console.warn('[firebase-bridge] Snapshot listener error:', err.message);
  });
}

// ─── Online/offline status indicator ───
function updateConnectionStatus() {
  const isOnline = navigator.onLine;
  const indicator = document.getElementById('connection-status');
  if (indicator) {
    indicator.textContent = isOnline ? '● Online' : '● Offline';
    indicator.style.color = isOnline ? '#22c55e' : '#ef4444';
  }
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ─── Initialize ───
console.log('[firebase-bridge] Initializing Firebase bridge...');
seedFirestoreIfEmpty().then(function() {
  startRealtimeSync();
  updateConnectionStatus();
  console.log('[firebase-bridge] ✅ Firebase bridge active — data syncs to Firestore');
});

// Expose db for debugging
window._firebaseDB = db;
window._firebaseDeviceId = getDeviceId;
