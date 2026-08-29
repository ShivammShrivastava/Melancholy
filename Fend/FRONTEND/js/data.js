/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Data Layer (js/data.js)
   Mock dataset + localStorage read/write helpers.
   All "data layer" logic is isolated here behind clean function
   signatures so teammates can swap for real API calls later.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const PREFIX = 'kaamflow_';

  // ─── DEVICE LABELS ───
  const DEVICE_INFO = {
    deviceA: { id: 'deviceA', name: "Rahul's Phone", type: 'phone', icon: 'smartphone', lastActive: '2 min ago' },
    deviceB: { id: 'deviceB', name: "Rahul's Tablet", type: 'tablet', icon: 'tablet', lastActive: '8 min ago' },
  };

  // ─── ATTRIBUTE VOCABULARY (closed per domain) ───
  const ATTRIBUTE_VOCAB = {
    tailor:      ['color', 'fabric', 'chest', 'waist', 'length', 'sleeve', 'size', 'fit'],
    tiffin:      ['portion', 'spice_level', 'meal', 'roti_count', 'jain', 'days'],
    electrician: ['appliance', 'issue', 'room', 'brand', 'wattage'],
    baker:       ['flavour', 'weight_kg', 'egg_free', 'tier', 'message_on_cake', 'shape'],
  };

  // ─── STORAGE HELPERS ───
  function _read(key) {
    try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : null; }
    catch (e) { console.warn('LS read fail:', key, e); return null; }
  }
  function _write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.warn('LS write fail:', key, e); }
  }
  function _deviceKey(key) { return PREFIX + getActiveDevice() + '_' + key; }
  function _sharedKey(key) { return PREFIX + key; }

  // ─── DEVICE MANAGEMENT ───
  function getActiveDevice() {
    return _read(_sharedKey('activeDevice')) || 'deviceA';
  }
  function setActiveDevice(deviceId) {
    if (!DEVICE_INFO[deviceId]) return;
    _write(_sharedKey('activeDevice'), deviceId);
  }
  function getDeviceInfo(deviceId) { return DEVICE_INFO[deviceId || getActiveDevice()]; }
  function getAllDevices() { return Object.values(DEVICE_INFO); }

  // ─── SESSION ───
  function getSession() { return _read(_sharedKey('session')); }
  function setSession(user) { _write(_sharedKey('session'), user); }
  function clearSession() { localStorage.removeItem(_sharedKey('session')); }

  // ─── SEED DATA ───
  const SEED_CUSTOMERS = [
    { id: 'cust-1', name: 'Rahul Mehra',   phone: '+91 98765 43210', since: '2025-03-15', domain: 'tailor' },
    { id: 'cust-2', name: 'Priya Patel',   phone: '+91 87654 32109', since: '2024-11-02', domain: 'baker' },
    { id: 'cust-3', name: 'Amit Kumar',    phone: '+91 76543 21098', since: '2025-06-20', domain: 'electrician' },
    { id: 'cust-4', name: 'Sunita Devi',   phone: '+91 65432 10987', since: '2025-01-08', domain: 'tiffin' },
    { id: 'cust-5', name: 'Vikram Singh',  phone: '+91 99887 76655', since: '2024-09-14', domain: 'tailor' },
    { id: 'cust-6', name: 'Neha Gupta',    phone: '+91 88776 65544', since: '2025-05-11', domain: 'baker' },
    { id: 'cust-7', name: 'Rajesh Verma',  phone: '+91 77665 54433', since: '2025-07-03', domain: 'electrician' },
    { id: 'cust-8', name: 'Meena Joshi',   phone: '+91 66554 43322', since: '2024-12-19', domain: 'tiffin' },
  ];

  const SEED_ORDERS = [
    // ── Tailor orders ──
    {
      id: 'ord-001', customer: 'Rahul Mehra', _customer_id: 'cust-1', _domain: 'tailor',
      items: [
        { description: 'Kurta Pajama', quantity: 2, attributes: { color: 'Navy Blue', fabric: 'Cotton Silk', chest: 42, length: 40 } },
      ],
      due_date: '2026-08-29', amount: 4500, references_prior_order: true,
      confidence: 0.94, needs_clarification: false,
      _status: 'in_progress', _payment_status: 'unpaid', _created_at: '2026-08-25T10:30:00',
    },
    {
      id: 'ord-002', customer: 'Vikram Singh', _customer_id: 'cust-5', _domain: 'tailor',
      items: [
        { description: 'Sherwani', quantity: 1, attributes: { color: 'Ivory Gold', fabric: 'Brocade Silk', chest: 44, length: 44, fit: 'Slim' } },
      ],
      due_date: '2026-08-25', amount: 12000, references_prior_order: false,
      confidence: 0.91, needs_clarification: false,
      _status: 'overdue', _payment_status: 'partial', _created_at: '2026-08-15T14:20:00',
    },
    {
      id: 'ord-003', customer: 'Rahul Mehra', _customer_id: 'cust-1', _domain: 'tailor',
      items: [
        { description: 'Formal Shirt', quantity: 3, attributes: { color: 'White', fabric: 'Linen', chest: 42, sleeve: 'Full', fit: 'Regular' } },
      ],
      due_date: '2026-08-30', amount: 3600, references_prior_order: true,
      confidence: 0.97, needs_clarification: false,
      _status: 'new', _payment_status: 'unpaid', _created_at: '2026-08-28T09:15:00',
    },
    {
      id: 'ord-013', customer: 'Vikram Singh', _customer_id: 'cust-5', _domain: 'tailor',
      items: [
        { description: 'Kurta', quantity: 2, attributes: { color: 'Maroon', fabric: 'Chanderi', length: 42, fit: 'Relaxed' } },
      ],
      due_date: '2026-09-02', amount: 3000, references_prior_order: true,
      confidence: 0.89, needs_clarification: false,
      _status: 'new', _payment_status: 'unpaid', _created_at: '2026-08-29T08:00:00',
    },

    // ── Tiffin orders ──
    {
      id: 'ord-004', customer: 'Sunita Devi', _customer_id: 'cust-4', _domain: 'tiffin',
      items: [
        { description: 'Monthly Tiffin Plan', quantity: 1, attributes: { portion: '2 Person', spice_level: 'Medium', meal: 'Lunch + Dinner', roti_count: 6, jain: false, days: 30 } },
      ],
      due_date: '2026-09-01', amount: 6000, references_prior_order: true,
      confidence: 0.96, needs_clarification: false,
      _status: 'in_progress', _payment_status: 'paid', _created_at: '2026-08-01T08:00:00',
    },
    {
      id: 'ord-005', customer: 'Meena Joshi', _customer_id: 'cust-8', _domain: 'tiffin',
      items: [
        { description: 'Weekly Lunch Tiffin', quantity: 1, attributes: { portion: '1 Person', spice_level: 'Mild', meal: 'Lunch', roti_count: 4, jain: true, days: 7 } },
      ],
      due_date: '2026-08-29', amount: 1400, references_prior_order: false,
      confidence: 0.92, needs_clarification: false,
      _status: 'ready', _payment_status: 'paid', _created_at: '2026-08-22T11:00:00',
    },

    // ── Baker orders ──
    {
      id: 'ord-006', customer: 'Priya Patel', _customer_id: 'cust-2', _domain: 'baker',
      items: [
        { description: 'Birthday Cake', quantity: 1, attributes: { flavour: 'Chocolate Truffle', weight_kg: 1.5, egg_free: false, tier: 1, message_on_cake: 'Happy Birthday Ananya!', shape: 'Round' } },
      ],
      due_date: '2026-08-29', amount: 2500, references_prior_order: true,
      confidence: 0.95, needs_clarification: false,
      _status: 'in_progress', _payment_status: 'partial', _created_at: '2026-08-26T16:30:00',
    },
    {
      id: 'ord-007', customer: 'Neha Gupta', _customer_id: 'cust-6', _domain: 'baker',
      items: [
        { description: 'Butter Cookies', quantity: 24, attributes: { flavour: 'Vanilla Almond', weight_kg: 0.5, egg_free: true } },
        { description: 'Chocolate Brownies', quantity: 12, attributes: { flavour: 'Dark Chocolate', weight_kg: 0.75, egg_free: false } },
      ],
      due_date: '2026-08-31', amount: 800, references_prior_order: false,
      confidence: 0.88, needs_clarification: false,
      _status: 'new', _payment_status: 'unpaid', _created_at: '2026-08-28T13:45:00',
    },
    {
      id: 'ord-008', customer: 'Priya Patel', _customer_id: 'cust-2', _domain: 'baker',
      items: [
        { description: 'Wedding Cake', quantity: 1, attributes: { flavour: 'Red Velvet', weight_kg: 5, egg_free: false, tier: 3, message_on_cake: 'Riya & Arjun', shape: 'Square' } },
      ],
      due_date: '2026-08-26', amount: 15000, references_prior_order: true,
      confidence: 0.93, needs_clarification: false,
      _status: 'overdue', _payment_status: 'partial', _created_at: '2026-08-10T10:00:00',
    },

    // ── Electrician orders ──
    {
      id: 'ord-009', customer: 'Amit Kumar', _customer_id: 'cust-3', _domain: 'electrician',
      items: [
        { description: 'Ceiling Fan Repair', quantity: 1, attributes: { appliance: 'Ceiling Fan', issue: 'Not spinning', room: 'Bedroom', brand: 'Havells' } },
      ],
      due_date: '2026-08-29', amount: 800, references_prior_order: false,
      confidence: 0.90, needs_clarification: false,
      _status: 'ready', _payment_status: 'unpaid', _created_at: '2026-08-27T09:00:00',
    },
    {
      id: 'ord-010', customer: 'Rajesh Verma', _customer_id: 'cust-7', _domain: 'electrician',
      items: [
        { description: 'Full House Wiring', quantity: 1, attributes: { appliance: 'Wiring', issue: 'New installation', room: 'Entire House', brand: 'Polycab', wattage: 5000 } },
      ],
      due_date: '2026-08-27', amount: 5000, references_prior_order: false,
      confidence: 0.86, needs_clarification: false,
      _status: 'overdue', _payment_status: 'unpaid', _created_at: '2026-08-18T15:30:00',
    },
    {
      id: 'ord-011', customer: 'Amit Kumar', _customer_id: 'cust-3', _domain: 'electrician',
      items: [
        { description: 'AC Service & Gas Refill', quantity: 2, attributes: { appliance: 'Split AC', issue: 'Not cooling', room: 'Living Room', brand: 'Daikin', wattage: 1500 } },
      ],
      due_date: '2026-08-30', amount: 1500, references_prior_order: true,
      confidence: 0.92, needs_clarification: false,
      _status: 'new', _payment_status: 'unpaid', _created_at: '2026-08-28T17:00:00',
    },

    // ── Cross-domain / mixed ──
    {
      id: 'ord-012', customer: 'Sunita Devi', _customer_id: 'cust-4', _domain: 'tiffin',
      items: [
        { description: 'Party Catering Thali', quantity: 25, attributes: { portion: '1 Person', spice_level: 'Low', meal: 'Dinner', roti_count: 3, jain: false } },
      ],
      due_date: '2026-08-29', amount: 3500, references_prior_order: false,
      confidence: 0.87, needs_clarification: false,
      _status: 'in_progress', _payment_status: 'unpaid', _created_at: '2026-08-27T12:00:00',
    },
    {
      id: 'ord-014', customer: 'Meena Joshi', _customer_id: 'cust-8', _domain: 'baker',
      items: [
        { description: 'Pineapple Cake', quantity: 1, attributes: { flavour: 'Pineapple', weight_kg: 1, egg_free: true, tier: 1, shape: 'Round' } },
        { description: 'Samosa Platter', quantity: 30, attributes: {} },
      ],
      due_date: '2026-08-28', amount: 1800, references_prior_order: false,
      confidence: 0.84, needs_clarification: false,
      _status: 'completed', _payment_status: 'paid', _created_at: '2026-08-24T14:00:00',
    },
  ];

  // ─── PAYMENTS SEED ───
  const SEED_PAYMENTS = [
    { id: 'pay-1', customer_id: 'cust-4', order_id: 'ord-004', amount: 6000, date: '2026-08-01', method: 'UPI' },
    { id: 'pay-2', customer_id: 'cust-8', order_id: 'ord-005', amount: 1400, date: '2026-08-22', method: 'Cash' },
    { id: 'pay-3', customer_id: 'cust-2', order_id: 'ord-006', amount: 1000, date: '2026-08-26', method: 'UPI' },
    { id: 'pay-4', customer_id: 'cust-5', order_id: 'ord-002', amount: 5000, date: '2026-08-17', method: 'Cash' },
    { id: 'pay-5', customer_id: 'cust-2', order_id: 'ord-008', amount: 7500, date: '2026-08-12', method: 'UPI' },
    { id: 'pay-6', customer_id: 'cust-8', order_id: 'ord-014', amount: 1800, date: '2026-08-28', method: 'Cash' },
  ];

  // ─── INIT / SEED ───
  function initData() {
    // Seed both devices if not already initialized
    ['deviceA', 'deviceB'].forEach(function (dev) {
      var oKey = PREFIX + dev + '_orders';
      if (!_read(oKey)) _write(oKey, SEED_ORDERS);
      var cKey = PREFIX + dev + '_customers';
      if (!_read(cKey)) _write(cKey, SEED_CUSTOMERS);
      var pKey = PREFIX + dev + '_payments';
      if (!_read(pKey)) _write(pKey, SEED_PAYMENTS);
      var sqKey = PREFIX + dev + '_syncQueue';
      if (!_read(sqKey)) _write(sqKey, []);
    });
    if (!_read(_sharedKey('chatHistory'))) _write(_sharedKey('chatHistory'), []);
    if (!_read(_sharedKey('activityLog'))) _write(_sharedKey('activityLog'), []);
    if (!_read(_sharedKey('activeDevice'))) _write(_sharedKey('activeDevice'), 'deviceA');
  }

  // ─── ORDER CRUD ───
  function getOrders(filters) {
    var orders = _read(_deviceKey('orders')) || [];
    if (!filters) return orders;
    if (filters.status && filters.status !== 'all') {
      orders = orders.filter(function (o) { return o._status === filters.status; });
    }
    if (filters.search) {
      var q = filters.search.toLowerCase();
      orders = orders.filter(function (o) {
        return o.customer.toLowerCase().includes(q) ||
               o.id.toLowerCase().includes(q) ||
               o.items.some(function (it) { return it.description.toLowerCase().includes(q); });
      });
    }
    if (filters.domain) {
      orders = orders.filter(function (o) { return o._domain === filters.domain; });
    }
    return orders;
  }

  function getOrder(id) {
    var orders = getOrders();
    return orders.find(function (o) { return o.id === id; }) || null;
  }

  function saveOrder(order) {
    var orders = _read(_deviceKey('orders')) || [];
    var idx = orders.findIndex(function (o) { return o.id === order.id; });
    if (idx >= 0) orders[idx] = order;
    else orders.unshift(order);
    _write(_deviceKey('orders'), orders);
    _addToSyncQueue('save_order', 'Order ' + order.id + ' saved', order.id);
    return order;
  }

  function deleteOrder(id) {
    var orders = _read(_deviceKey('orders')) || [];
    orders = orders.filter(function (o) { return o.id !== id; });
    _write(_deviceKey('orders'), orders);
    _addToSyncQueue('delete_order', 'Order ' + id + ' deleted', id);
  }

  function generateOrderId() {
    var orders = _read(_deviceKey('orders')) || [];
    var maxNum = 0;
    orders.forEach(function (o) {
      var n = parseInt(o.id.replace('ord-', ''), 10);
      if (n > maxNum) maxNum = n;
    });
    return 'ord-' + String(maxNum + 1).padStart(3, '0');
  }

  // ─── CUSTOMER CRUD ───
  function getCustomers() { return _read(_deviceKey('customers')) || []; }

  function getCustomer(id) {
    return getCustomers().find(function (c) { return c.id === id; }) || null;
  }

  function getCustomerByName(name) {
    if (!name) return null;
    var n = name.toLowerCase();
    return getCustomers().find(function (c) { return c.name.toLowerCase() === n; }) || null;
  }

  function saveCustomer(customer) {
    var customers = _read(_deviceKey('customers')) || [];
    var idx = customers.findIndex(function (c) { return c.id === customer.id; });
    if (idx >= 0) customers[idx] = customer;
    else customers.unshift(customer);
    _write(_deviceKey('customers'), customers);
    return customer;
  }

  function generateCustomerId() {
    var customers = getCustomers();
    var maxNum = 0;
    customers.forEach(function (c) {
      var n = parseInt(c.id.replace('cust-', ''), 10);
      if (n > maxNum) maxNum = n;
    });
    return 'cust-' + (maxNum + 1);
  }

  function getCustomerOrders(customerId) {
    return getOrders().filter(function (o) { return o._customer_id === customerId; });
  }

  function getCustomerTotalSpent(customerId) {
    var payments = getPayments().filter(function (p) { return p.customer_id === customerId; });
    return payments.reduce(function (sum, p) { return sum + p.amount; }, 0);
  }

  function getCustomerPendingDues(customerId) {
    var orders = getCustomerOrders(customerId);
    var totalPaid = getCustomerTotalSpent(customerId);
    var totalAmount = orders.reduce(function (sum, o) { return sum + (o.amount || 0); }, 0);
    return Math.max(0, totalAmount - totalPaid);
  }

  // ─── PAYMENTS ───
  function getPayments() { return _read(_deviceKey('payments')) || []; }

  function recordPayment(payment) {
    var payments = getPayments();
    if (!payment.id) payment.id = 'pay-' + (payments.length + 1);
    if (!payment.date) payment.date = new Date().toISOString().slice(0, 10);
    payments.push(payment);
    _write(_deviceKey('payments'), payments);
    _addToSyncQueue('record_payment', 'Payment ₹' + payment.amount + ' recorded for ' + payment.customer_id, payment.id);
    return payment;
  }

  // ─── SYNC QUEUE ───
  function getSyncQueue() { return _read(_deviceKey('syncQueue')) || []; }

  function _addToSyncQueue(action, description, refId) {
    var queue = getSyncQueue();
    queue.unshift({
      id: 'sq-' + Date.now(),
      action: action,
      description: description,
      ref_id: refId,
      timestamp: new Date().toISOString(),
      status: navigator.onLine ? 'synced' : 'pending',
    });
    // Keep last 50 entries
    if (queue.length > 50) queue = queue.slice(0, 50);
    _write(_deviceKey('syncQueue'), queue);
  }

  function clearSyncQueue() {
    _write(_deviceKey('syncQueue'), []);
  }

  function getPendingSyncCount() {
    return getSyncQueue().filter(function (s) { return s.status === 'pending'; }).length;
  }

  // ─── ACTIVITY LOG (shared, for audit trail) ───
  function getActivityLog() { return _read(_sharedKey('activityLog')) || []; }

  function addToActivityLog(entry) {
    var log = getActivityLog();
    log.unshift({
      id: 'act-' + Date.now(),
      timestamp: new Date().toISOString(),
      device: getActiveDevice(),
      deviceName: getDeviceInfo().name,
      ...entry,
    });
    if (log.length > 100) log = log.slice(0, 100);
    _write(_sharedKey('activityLog'), log);
  }

  // ─── CHAT HISTORY ───
  function getChatHistory() { return _read(_sharedKey('chatHistory')) || []; }

  function addChatMessage(msg) {
    var history = getChatHistory();
    history.push({ ...msg, timestamp: new Date().toISOString() });
    _write(_sharedKey('chatHistory'), history);
  }

  function clearChatHistory() {
    _write(_sharedKey('chatHistory'), []);
  }

  // ─── COMPUTED STATS ───
  function getStats() {
    var orders = getOrders();
    var today = new Date().toISOString().slice(0, 10);

    var todaysOrders = orders.filter(function (o) { return o.due_date === today; });
    var dueToday = orders.filter(function (o) { return o.due_date === today && o._status !== 'completed'; });
    var overdue = orders.filter(function (o) {
      return o.due_date && o.due_date < today && o._status !== 'completed';
    });
    var pendingMoney = orders.reduce(function (sum, o) {
      if (o._payment_status === 'unpaid') return sum + (o.amount || 0);
      if (o._payment_status === 'partial') return sum + Math.floor((o.amount || 0) * 0.5);
      return sum;
    }, 0);

    return {
      todaysOrders: todaysOrders.length,
      dueToday: dueToday.length,
      overdue: overdue.length,
      pendingMoney: pendingMoney,
    };
  }

  function getTodaysPriorities() {
    var today = new Date().toISOString().slice(0, 10);
    return getOrders().filter(function (o) {
      return o.due_date === today && o._status !== 'completed';
    }).sort(function (a, b) { return (a._created_at || '').localeCompare(b._created_at || ''); });
  }

  function getOverdueOrders() {
    var today = new Date().toISOString().slice(0, 10);
    return getOrders().filter(function (o) {
      return o.due_date && o.due_date < today && o._status !== 'completed';
    });
  }

  function getDueTodayOrders() {
    var today = new Date().toISOString().slice(0, 10);
    return getOrders().filter(function (o) {
      return o.due_date === today && o._status !== 'completed';
    });
  }

  function getWeeklyCapacity() {
    var days = [];
    var now = new Date();
    // Start from Monday of the current week
    var dayOfWeek = now.getDay();
    var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    var monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);

    var labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(monday.getDate() + i);
      var dateStr = d.toISOString().slice(0, 10);
      var count = getOrders().filter(function (o) { return o.due_date === dateStr; }).length;
      days.push({ label: labels[i], date: dateStr, count: count, isToday: dateStr === now.toISOString().slice(0, 10) });
    }
    return days;
  }

  function getOverduePayments() {
    var today = new Date().toISOString().slice(0, 10);
    var customers = getCustomers();
    var result = [];
    customers.forEach(function (c) {
      var pending = getCustomerPendingDues(c.id);
      if (pending > 0) {
        var oldestUnpaid = getCustomerOrders(c.id)
          .filter(function (o) { return o._payment_status !== 'paid' && o.due_date; })
          .sort(function (a, b) { return a.due_date.localeCompare(b.due_date); })[0];
        result.push({
          customer: c,
          pending: pending,
          dueSince: oldestUnpaid ? oldestUnpaid.due_date : today,
        });
      }
    });
    return result;
  }

  // ─── UTILITY HELPERS ───
  function formatCurrency(amount) {
    if (amount == null) return 'Not mentioned';
    return '₹' + amount.toLocaleString('en-IN');
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'Not set';
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    var now = new Date();
    var then = new Date(dateStr);
    var diffMs = now - then;
    var diffMin = Math.floor(diffMs / 60000);
    var diffHr = Math.floor(diffMin / 60);
    var diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + ' min ago';
    if (diffHr < 24) return diffHr + 'h ago';
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return diffDay + ' days ago';
    return formatDate(dateStr.slice(0, 10));
  }

  function daysBetween(dateStr1, dateStr2) {
    var d1 = new Date(dateStr1);
    var d2 = new Date(dateStr2);
    return Math.floor((d2 - d1) / 86400000);
  }

  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
  }

  function getAvatarColor(id) {
    var num = 0;
    for (var i = 0; i < (id || '').length; i++) num += id.charCodeAt(i);
    return 'avatar-' + ((num % 8) + 1);
  }

  function getAttributeVocab(domain) {
    return ATTRIBUTE_VOCAB[domain] || [];
  }

  // ─── RESET (for demo/testing) ───
  function resetAllData() {
    var keys = Object.keys(localStorage).filter(function (k) { return k.startsWith(PREFIX); });
    keys.forEach(function (k) { localStorage.removeItem(k); });
    initData();
  }

  // ─── EXPORT ───
  window.DataStore = {
    init:               initData,
    reset:              resetAllData,

    // Device
    getActiveDevice:    getActiveDevice,
    setActiveDevice:    setActiveDevice,
    getDeviceInfo:      getDeviceInfo,
    getAllDevices:       getAllDevices,

    // Session
    getSession:         getSession,
    setSession:         setSession,
    clearSession:       clearSession,

    // Orders
    getOrders:          getOrders,
    getOrder:           getOrder,
    saveOrder:          saveOrder,
    deleteOrder:        deleteOrder,
    generateOrderId:    generateOrderId,

    // Customers
    getCustomers:       getCustomers,
    getCustomer:        getCustomer,
    getCustomerByName:  getCustomerByName,
    saveCustomer:       saveCustomer,
    generateCustomerId: generateCustomerId,
    getCustomerOrders:  getCustomerOrders,
    getCustomerTotalSpent:   getCustomerTotalSpent,
    getCustomerPendingDues:  getCustomerPendingDues,

    // Payments
    getPayments:        getPayments,
    recordPayment:      recordPayment,

    // Sync queue
    getSyncQueue:       getSyncQueue,
    clearSyncQueue:     clearSyncQueue,
    getPendingSyncCount: getPendingSyncCount,

    // Activity log
    getActivityLog:     getActivityLog,
    addToActivityLog:   addToActivityLog,

    // Chat
    getChatHistory:     getChatHistory,
    addChatMessage:     addChatMessage,
    clearChatHistory:   clearChatHistory,

    // Stats
    getStats:           getStats,
    getTodaysPriorities: getTodaysPriorities,
    getOverdueOrders:   getOverdueOrders,
    getDueTodayOrders:  getDueTodayOrders,
    getWeeklyCapacity:  getWeeklyCapacity,
    getOverduePayments: getOverduePayments,

    // Utils
    formatCurrency:     formatCurrency,
    formatDate:         formatDate,
    relativeTime:       relativeTime,
    daysBetween:        daysBetween,
    getInitials:        getInitials,
    getAvatarColor:     getAvatarColor,
    getAttributeVocab:  getAttributeVocab,
    ATTRIBUTE_VOCAB:    ATTRIBUTE_VOCAB,
    DEVICE_INFO:        DEVICE_INFO,
  };

  // Auto-init
  initData();
})();
