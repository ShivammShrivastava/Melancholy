/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Shell Injection (js/shell.js)
   Injects sidebar, topbar, offline banner, and floating chat
   widget into every page. Handles nav highlighting and device
   switching.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── SESSION GUARD ───
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var noAuthPages = ['login.html', 'index.html', ''];
  if (noAuthPages.indexOf(currentPage) === -1) {
    var session = DataStore.getSession();
    if (!session) {
      window.location.href = 'login.html';
      return;
    }
  }

  // ─── NAV ITEMS ───
  var NAV_ITEMS = [
    { id: 'overview',        label: 'Overview',          icon: 'layout-grid',     href: 'overview.html' },
    { id: 'orders',          label: 'Orders',            icon: 'file-text',       href: 'orders.html' },
    { id: 'customers',       label: 'Customers',         icon: 'users',           href: 'customers.html' },
    { id: 'money',           label: 'Money',             icon: 'wallet',          href: 'money.html' },
    { id: 'due-overdue',     label: 'Due & Overdue',     icon: 'alert-circle',    href: 'due-overdue.html',  alert: true },
    { id: 'weekly-capacity', label: 'Weekly Capacity',   icon: 'bar-chart-3',     href: 'overview.html#capacity' },
    { id: 'sync-center',     label: 'Sync Center',       icon: 'refresh-cw',      href: 'sync-center.html' },
  ];

  // Determine active page
  var activePage = currentPage.replace('.html', '');
  if (activePage === '' || activePage === 'index') activePage = 'overview';

  // ─── RENDER SHELL ───
  function renderShell() {
    var app = document.getElementById('app');
    if (!app) return;

    // Create gradient top bar
    var topGradient = document.createElement('div');
    topGradient.id = 'top-gradient-bar';
    topGradient.style.cssText = 'position:fixed;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#06b6d4,#3b82f6,#22c55e);z-index:100;';
    document.body.prepend(topGradient);

    // Create offline banner
    var offlineBanner = document.createElement('div');
    offlineBanner.id = 'offline-banner';
    offlineBanner.className = 'offline-banner';
    offlineBanner.innerHTML = '<i data-lucide="wifi-off" style="width:16px;height:16px"></i> You\'re offline — KaamFlow still works. Changes will sync when you\'re back online.';
    document.body.appendChild(offlineBanner);

    // Wrap existing content
    var mainContent = app.innerHTML;
    app.innerHTML = '';
    app.className = 'app-layout';

    // Build sidebar
    var sidebar = _buildSidebar();
    app.appendChild(sidebar);

    // Build main area
    var mainArea = document.createElement('div');
    mainArea.className = 'main-area';

    var topbar = _buildTopbar();
    mainArea.appendChild(topbar);

    var content = document.createElement('div');
    content.className = 'main-content';
    content.id = 'main-content';
    content.innerHTML = mainContent;
    mainArea.appendChild(content);

    app.appendChild(mainArea);

    // Add floating chat widget
    _buildChatWidget();

    // Initialize Lucide icons
    setTimeout(function () {
      if (window.lucide) lucide.createIcons();
    }, 100);
  }

  // ─── SIDEBAR ───
  function _buildSidebar() {
    var sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.id = 'sidebar';

    // Logo
    var logoHtml = '<a href="overview.html" class="sidebar-logo">' +
      '<div class="sidebar-logo-icon"><i data-lucide="zap" style="width:18px;height:18px;color:white"></i></div>' +
      '<div><span style="font-size:16px;font-weight:700;color:#0f172a">KaamFlow</span>' +
      '<div style="font-size:11px;color:#94a3b8;font-weight:400;margin-top:-2px">AI Order Manager</div></div></a>';

    // Primary action button
    var actionBtn = '<button class="sidebar-action-btn" onclick="window.location.href=\'create-order.html\'">' +
      '<i data-lucide="sparkles" style="width:16px;height:16px"></i><span>AI Inbox</span></button>';

    // Nav items
    var navHtml = '<ul class="sidebar-nav">';
    NAV_ITEMS.forEach(function (item) {
      var isActive = activePage === item.id;
      var classes = 'sidebar-nav-item' + (isActive ? ' active' : '');
      var alertIcon = item.alert ? '<span style="color:#ef4444;font-weight:700;margin-right:-4px">!</span> ' : '';
      navHtml += '<li><a href="' + item.href + '" class="' + classes + '" data-nav="' + item.id + '">' +
        (item.alert ? '' : '<i data-lucide="' + item.icon + '" style="width:18px;height:18px"></i>') +
        alertIcon +
        '<span>' + item.label + '</span></a></li>';
    });
    navHtml += '</ul>';

    // Device switcher
    var device = DataStore.getActiveDevice();
    var deviceInfo = DataStore.getDeviceInfo();
    var deviceSwitcher = '<div class="device-switcher" id="device-switcher">' +
      '<i data-lucide="' + deviceInfo.icon + '" style="width:16px;height:16px"></i>' +
      '<select id="device-select" onchange="Shell.switchDevice(this.value)">' +
      '<option value="deviceA"' + (device === 'deviceA' ? ' selected' : '') + '>📱 Rahul\'s Phone</option>' +
      '<option value="deviceB"' + (device === 'deviceB' ? ' selected' : '') + '>📱 Rahul\'s Tablet</option>' +
      '</select></div>';

    // Bottom section
    var bottomHtml = '<div class="sidebar-bottom">' +
      deviceSwitcher +
      '<a href="#" class="sidebar-nav-item" style="margin-top:8px"><i data-lucide="settings" style="width:18px;height:18px"></i><span>Settings</span></a>' +
      '<a href="#" class="sidebar-nav-item" onclick="Shell.toggleOffline(event)"><i data-lucide="wifi" style="width:18px;height:18px" id="offline-toggle-icon"></i><span>Offline Mode</span></a>' +
      '</div>';

    sidebar.innerHTML = logoHtml + actionBtn + navHtml + bottomHtml;
    return sidebar;
  }

  // ─── TOPBAR ───
  function _buildTopbar() {
    var topbar = document.createElement('div');
    topbar.className = 'topbar';
    topbar.id = 'topbar';

    var status = StatusManager.getStatus();
    var pillClass = status.online ? 'online' : 'offline';
    var dotClass = status.online ? 'green' : 'amber';

    topbar.innerHTML = '<div id="status-pill" class="status-pill ' + pillClass + '">' +
      '<span class="status-dot ' + dotClass + '"></span>' +
      '<span class="status-text">' + status.text + '</span></div>';

    return topbar;
  }

  // ─── FLOATING CHAT WIDGET ───
  function _buildChatWidget() {
    // Don't show on the ask-kaamflow page itself
    if (activePage === 'ask-kaamflow') return;

    // Chat button
    var btn = document.createElement('button');
    btn.className = 'chat-widget-btn';
    btn.id = 'chat-widget-btn';
    btn.innerHTML = '<i data-lucide="message-circle" style="width:24px;height:24px"></i>';
    btn.onclick = function () { Shell.toggleChat(); };
    document.body.appendChild(btn);

    // Chat panel
    var panel = document.createElement('div');
    panel.className = 'chat-panel';
    panel.id = 'chat-panel';

    panel.innerHTML = '<div class="chat-panel-header">' +
      '<div style="width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1e40af);border-radius:50%;display:flex;align-items:center;justify-content:center">' +
      '<i data-lucide="bot" style="width:18px;height:18px;color:white"></i></div>' +
      '<div><div style="font-weight:600;font-size:14px">Ask KaamFlow</div>' +
      '<div style="font-size:12px;color:#64748b">Works offline · AI-powered search</div></div>' +
      '<button onclick="Shell.toggleChat()" style="margin-left:auto;background:none;border:none;cursor:pointer;color:#94a3b8">' +
      '<i data-lucide="x" style="width:18px;height:18px"></i></button></div>' +
      '<div class="chat-panel-body" id="chat-widget-messages"></div>' +
      '<div style="padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #e2e8f0" id="chat-widget-suggestions"></div>' +
      '<div class="chat-panel-input">' +
      '<input type="text" class="input" id="chat-widget-input" placeholder="Ask anything..." ' +
      'onkeypress="if(event.key===\'Enter\')Shell.sendChatMessage()">' +
      '<button class="btn btn-primary btn-sm" onclick="Shell.sendChatMessage()">' +
      '<i data-lucide="send" style="width:16px;height:16px"></i></button></div>';

    document.body.appendChild(panel);

    // Populate suggestions
    setTimeout(function () {
      var sugContainer = document.getElementById('chat-widget-suggestions');
      if (sugContainer) {
        Chatbot.SUGGESTED_QUERIES.forEach(function (q) {
          var chip = document.createElement('button');
          chip.className = 'chip';
          chip.style.cssText = 'cursor:pointer;font-size:12px;padding:3px 10px;';
          chip.textContent = q;
          chip.onclick = function () {
            document.getElementById('chat-widget-input').value = q;
            Shell.sendChatMessage();
          };
          sugContainer.appendChild(chip);
        });
      }
    }, 50);
  }

  // ─── CHAT FUNCTIONS ───
  function toggleChat() {
    var panel = document.getElementById('chat-panel');
    var btn = document.getElementById('chat-widget-btn');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      btn.innerHTML = '<i data-lucide="x" style="width:24px;height:24px"></i>';
      document.getElementById('chat-widget-input').focus();
    } else {
      btn.innerHTML = '<i data-lucide="message-circle" style="width:24px;height:24px"></i>';
    }
    if (window.lucide) lucide.createIcons();
  }

  function sendChatMessage() {
    var input = document.getElementById('chat-widget-input');
    var messagesContainer = document.getElementById('chat-widget-messages');
    if (!input || !messagesContainer || !input.value.trim()) return;

    var query = input.value.trim();
    input.value = '';

    // Hide suggestions after first message
    var sug = document.getElementById('chat-widget-suggestions');
    if (sug) sug.style.display = 'none';

    // Add user bubble
    var userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = query;
    messagesContainer.appendChild(userBubble);

    // Get response
    var response = Chatbot.answerQuery(query);

    // Add assistant bubble
    setTimeout(function () {
      var assistantBubble = document.createElement('div');
      assistantBubble.className = 'chat-bubble assistant';
      assistantBubble.innerHTML = _formatChatResponse(response);
      messagesContainer.appendChild(assistantBubble);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      if (window.lucide) lucide.createIcons();
    }, 300);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function _formatChatResponse(response) {
    var html = '<div>' + response.prose.replace(/\n/g, '<br>') + '</div>';

    if (response.resultCard) {
      html += '<div style="margin-top:10px;padding:10px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;font-size:13px">';

      if (response.resultCard.type === 'order_list') {
        response.resultCard.orders.forEach(function (o) {
          var statusClass = o.status === 'overdue' ? 'badge-danger' : o.status === 'ready' ? 'badge-success' : o.status === 'in_progress' ? 'badge-warning' : 'badge-info';
          html += '<div style="padding:6px 0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">' +
            '<div><strong>' + o.customer + '</strong> · ' + o.items + '</div>' +
            '<div style="text-align:right"><div>' + o.amount + '</div><span class="badge ' + statusClass + '" style="font-size:11px">' + o.status.replace('_', ' ') + '</span></div></div>';
        });
      } else if (response.resultCard.type === 'balance_list') {
        response.resultCard.items.forEach(function (b) {
          html += '<div style="padding:6px 0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between">' +
            '<strong>' + b.name + '</strong><span style="color:#ef4444;font-weight:600">' + b.amount + '</span></div>';
        });
      } else if (response.resultCard.type === 'order_detail') {
        var od = response.resultCard.order;
        html += '<div style="font-weight:600;margin-bottom:6px">' + od.id + ' — ' + od.customer + '</div>';
        od.items.forEach(function (it) {
          html += '<div>' + it.quantity + '× ' + it.description + '</div>';
        });
        html += '<div style="margin-top:4px;color:#64748b">Due: ' + od.dueDate + ' · ' + od.amount + '</div>';
      } else if (response.resultCard.type === 'capacity') {
        html += '<div style="display:flex;align-items:flex-end;gap:4px;height:40px;margin-top:6px">';
        response.resultCard.days.forEach(function (d) {
          var h = Math.max(4, d.count * 12);
          var color = d.isToday ? '#3b82f6' : '#cbd5e1';
          html += '<div style="flex:1;text-align:center"><div style="height:' + h + 'px;background:' + color + ';border-radius:3px 3px 0 0;margin:0 auto;width:80%"></div>' +
            '<div style="font-size:10px;color:#64748b;margin-top:2px">' + d.label + '</div></div>';
        });
        html += '</div>';
      }

      html += '</div>';
    }

    return html;
  }

  // ─── DEVICE SWITCHING ───
  function switchDevice(deviceId) {
    DataStore.setActiveDevice(deviceId);
    window.location.reload();
  }

  // ─── OFFLINE TOGGLE (for demo) ───
  function toggleOffline(e) {
    if (e) e.preventDefault();
    // This is a visual demo toggle — real offline is handled by browser
    var banner = document.getElementById('offline-banner');
    if (banner) {
      banner.classList.toggle('show');
      setTimeout(function () { banner.classList.remove('show'); }, 4000);
    }
  }

  // ─── RENDER RESULT CARDS (shared utility for pages) ───
  function renderConfidenceRing(confidence, size) {
    size = size || 64;
    var pct = Math.round(confidence * 100);
    var r = (size / 2) - 4;
    var circumference = 2 * Math.PI * r;
    var offset = circumference * (1 - confidence);

    return '<div class="confidence-ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle class="ring-bg" cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '"/>' +
      '<circle class="ring-fill" cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" ' +
      'stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" ' +
      'style="stroke:' + (pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444') + '"/>' +
      '</svg><span class="ring-text">' + pct + '%</span></div>';
  }

  function renderStatusBadge(status) {
    var map = {
      'new':         { class: 'badge-info',    label: 'New',         dot: '#3b82f6' },
      'in_progress': { class: 'badge-warning', label: 'In Progress', dot: '#f59e0b' },
      'ready':       { class: 'badge-success', label: 'Ready',       dot: '#22c55e' },
      'completed':   { class: 'badge-success', label: 'Completed',   dot: '#22c55e' },
      'overdue':     { class: 'badge-danger',  label: 'Overdue',     dot: '#ef4444' },
    };
    var info = map[status] || map['new'];
    return '<span class="badge ' + info.class + '"><span style="width:6px;height:6px;border-radius:50%;background:' + info.dot + ';display:inline-block"></span> ' + info.label + '</span>';
  }

  function renderPaymentBadge(status) {
    var map = {
      'paid':    { class: 'badge-success', label: 'Paid' },
      'unpaid':  { class: 'badge-danger',  label: 'Pending' },
      'partial': { class: 'badge-warning', label: 'Partial' },
    };
    var info = map[status] || map['unpaid'];
    return '<span class="badge ' + info.class + '">' + info.label + '</span>';
  }

  function renderPaymentPill(status, amount) {
    if (status === 'paid') return '<span class="badge badge-success">Paid</span>';
    var formatted = DataStore.formatCurrency(amount);
    return '<span class="badge badge-danger">' + formatted + ' pending</span>';
  }

  function renderAvatar(name, size, customerId) {
    size = size || 'md';
    var initials = DataStore.getInitials(name);
    var colorClass = DataStore.getAvatarColor(customerId || name);
    return '<div class="avatar avatar-' + size + ' ' + colorClass + '">' + initials + '</div>';
  }

  function renderAttributeChips(attributes) {
    if (!attributes || Object.keys(attributes).length === 0) return '';
    var html = '';
    for (var key in attributes) {
      var val = attributes[key];
      var label = key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      if (typeof val === 'boolean') {
        html += '<span class="chip chip-checked"><i data-lucide="check" style="width:12px;height:12px"></i> ' + label + '</span> ';
      } else {
        html += '<span class="chip">' + label + ': <strong>' + val + '</strong></span> ';
      }
    }
    return html;
  }

  // ─── EXPORT ───
  window.Shell = {
    render:               renderShell,
    toggleChat:           toggleChat,
    sendChatMessage:      sendChatMessage,
    switchDevice:         switchDevice,
    toggleOffline:        toggleOffline,
    renderConfidenceRing: renderConfidenceRing,
    renderStatusBadge:    renderStatusBadge,
    renderPaymentBadge:   renderPaymentBadge,
    renderPaymentPill:    renderPaymentPill,
    renderAvatar:         renderAvatar,
    renderAttributeChips: renderAttributeChips,
  };

  // Auto-render when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderShell);
  } else {
    renderShell();
  }
})();
