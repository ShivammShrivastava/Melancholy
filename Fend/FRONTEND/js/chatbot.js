/* ═══════════════════════════════════════════════════════════════
   KaamFlow — AI Chatbot Intent Router (js/chatbot.js)
   Pattern-matches queries against canned intents and returns
   derived answers from mock data. Zero network calls.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── INTENT DEFINITIONS ───
  var INTENTS = [
    {
      id: 'due_today',
      patterns: [/what.*(due|pending).*today/i, /due today/i, /aaj.*due/i, /today.*order/i, /kya.*aaj.*due/i],
      handler: _handleDueToday,
    },
    {
      id: 'overdue',
      patterns: [/overdue/i, /late.*order/i, /missed.*deadline/i, /past.*due/i],
      handler: _handleOverdue,
    },
    {
      id: 'customer_balance',
      patterns: [/who.*owe/i, /money.*pending/i, /pending.*payment/i, /payment.*due/i, /paisa|paise|rupee/i, /owes.*money/i, /kitna.*baaki/i],
      handler: _handleCustomerBalance,
    },
    {
      id: 'customer_history',
      patterns: [/what.*did\s+(\w+).*order/i, /(\w+).*last.*order/i, /(\w+).*order.*history/i, /(\w+).*ka.*order/i, /(\w+).*ne.*kya.*order/i],
      handler: _handleCustomerHistory,
    },
    {
      id: 'weekly_capacity',
      patterns: [/how.*busy/i, /weekly.*capacity/i, /week.*schedule/i, /this.*week/i, /is.*hafte/i, /kitna.*kaam/i, /workload/i],
      handler: _handleWeeklyCapacity,
    },
    {
      id: 'total_orders',
      patterns: [/how.*many.*order/i, /total.*order/i, /kitne.*order/i, /order.*count/i],
      handler: _handleTotalOrders,
    },
    {
      id: 'new_orders',
      patterns: [/new.*order/i, /recent.*order/i, /latest.*order/i, /naye.*order/i],
      handler: _handleNewOrders,
    },
    {
      id: 'revenue',
      patterns: [/total.*revenue/i, /total.*earning/i, /kitna.*kama/i, /how.*much.*earn/i, /income/i, /total.*amount/i],
      handler: _handleRevenue,
    },
    {
      id: 'greeting',
      patterns: [/^(hi|hello|hey|namaste|namaskar)\b/i],
      handler: _handleGreeting,
    },
    {
      id: 'help',
      patterns: [/help/i, /what.*can.*you.*do/i, /kya.*kar.*sakte/i],
      handler: _handleHelp,
    },
  ];

  // ─── INTENT HANDLERS ───
  function _handleDueToday() {
    var orders = DataStore.getDueTodayOrders();
    var count = orders.length;
    if (count === 0) {
      return {
        prose: 'No orders are due today. Enjoy your free time! 🎉',
        resultCard: null,
      };
    }
    return {
      prose: count + ' order' + (count > 1 ? 's are' : ' is') + ' due today. Here\'s the breakdown:',
      resultCard: {
        type: 'order_list',
        title: 'Due Today',
        orders: orders.map(_formatOrderBrief),
      },
    };
  }

  function _handleOverdue() {
    var orders = DataStore.getOverdueOrders();
    var count = orders.length;
    if (count === 0) {
      return { prose: 'Great news! You have no overdue orders. Everything is on track. ✅', resultCard: null };
    }
    var totalAmount = orders.reduce(function (s, o) { return s + (o.amount || 0); }, 0);
    return {
      prose: count + ' order' + (count > 1 ? 's are' : ' is') + ' overdue, totaling ' + DataStore.formatCurrency(totalAmount) + '. Please prioritize these:',
      resultCard: {
        type: 'order_list',
        title: 'Overdue Orders',
        orders: orders.map(_formatOrderBrief),
        highlight: 'danger',
      },
    };
  }

  function _handleCustomerBalance() {
    var overduePayments = DataStore.getOverduePayments();
    if (overduePayments.length === 0) {
      return { prose: 'All customers are paid up! No pending dues. 💰', resultCard: null };
    }
    var totalPending = overduePayments.reduce(function (s, p) { return s + p.pending; }, 0);
    return {
      prose: overduePayments.length + ' customer' + (overduePayments.length > 1 ? 's have' : ' has') + ' pending payments totaling ' + DataStore.formatCurrency(totalPending) + ':',
      resultCard: {
        type: 'balance_list',
        title: 'Pending Payments',
        items: overduePayments.map(function (op) {
          return {
            name: op.customer.name,
            amount: DataStore.formatCurrency(op.pending),
            since: DataStore.formatDate(op.dueSince),
            customerId: op.customer.id,
          };
        }),
      },
    };
  }

  function _handleCustomerHistory(text) {
    // Extract customer name from the query
    var name = _extractName(text);
    if (!name) {
      return { prose: 'Which customer are you asking about? Please include their name in your question.', resultCard: null };
    }

    var customer = DataStore.getCustomerByName(name);
    if (!customer) {
      // Try partial match
      var customers = DataStore.getCustomers();
      var lower = name.toLowerCase();
      customer = customers.find(function (c) { return c.name.toLowerCase().includes(lower); });
    }
    if (!customer) {
      return { prose: 'I couldn\'t find a customer named "' + name + '". Check the Customers page for the full list.', resultCard: null };
    }

    var orders = DataStore.getCustomerOrders(customer.id);
    if (orders.length === 0) {
      return { prose: customer.name + ' hasn\'t placed any orders yet.', resultCard: null };
    }

    var lastOrder = orders.sort(function (a, b) { return (b._created_at || '').localeCompare(a._created_at || ''); })[0];
    return {
      prose: customer.name + ' has ' + orders.length + ' order' + (orders.length > 1 ? 's' : '') + '. Their last order was:',
      resultCard: {
        type: 'order_detail',
        title: 'Last Order — ' + customer.name,
        order: _formatOrderDetail(lastOrder),
      },
    };
  }

  function _handleWeeklyCapacity() {
    var capacity = DataStore.getWeeklyCapacity();
    var totalOrders = capacity.reduce(function (s, d) { return s + d.count; }, 0);
    var busiestDay = capacity.reduce(function (max, d) { return d.count > max.count ? d : max; }, { count: 0 });
    var todayCount = capacity.find(function (d) { return d.isToday; });

    var prose = 'This week you have ' + totalOrders + ' order' + (totalOrders > 1 ? 's' : '') + ' total.';
    if (todayCount) prose += ' Today: ' + todayCount.count + ' order' + (todayCount.count !== 1 ? 's' : '') + '.';
    if (busiestDay.count > 0) prose += ' Busiest day: ' + busiestDay.label + ' (' + busiestDay.count + ').';

    return {
      prose: prose,
      resultCard: {
        type: 'capacity',
        title: 'Weekly Workload',
        days: capacity,
      },
    };
  }

  function _handleTotalOrders() {
    var orders = DataStore.getOrders();
    var byStatus = {};
    orders.forEach(function (o) {
      byStatus[o._status] = (byStatus[o._status] || 0) + 1;
    });
    return {
      prose: 'You have ' + orders.length + ' total orders: ' +
        (byStatus.new || 0) + ' new, ' +
        (byStatus.in_progress || 0) + ' in progress, ' +
        (byStatus.ready || 0) + ' ready, ' +
        (byStatus.completed || 0) + ' completed, ' +
        (byStatus.overdue || 0) + ' overdue.',
      resultCard: null,
    };
  }

  function _handleNewOrders() {
    var orders = DataStore.getOrders({ status: 'new' });
    if (orders.length === 0) return { prose: 'No new orders at the moment.', resultCard: null };
    return {
      prose: orders.length + ' new order' + (orders.length > 1 ? 's' : '') + ':',
      resultCard: { type: 'order_list', title: 'New Orders', orders: orders.map(_formatOrderBrief) },
    };
  }

  function _handleRevenue() {
    var orders = DataStore.getOrders();
    var total = orders.reduce(function (s, o) { return s + (o.amount || 0); }, 0);
    var paid = DataStore.getPayments().reduce(function (s, p) { return s + p.amount; }, 0);
    return {
      prose: 'Total order value: ' + DataStore.formatCurrency(total) + '. Amount received: ' + DataStore.formatCurrency(paid) + '. Pending: ' + DataStore.formatCurrency(total - paid) + '.',
      resultCard: null,
    };
  }

  function _handleGreeting() {
    return {
      prose: 'Hello! 👋 I\'m KaamFlow AI. Ask me about your orders, dues, payments, or workload. I work completely offline!',
      resultCard: null,
    };
  }

  function _handleHelp() {
    return {
      prose: 'I can help you with:\n• Due & overdue orders\n• Customer payment balances\n• Customer order history\n• Weekly capacity\n• Revenue summary\n\nTry: "What is due today?" or "Who owes me money?"',
      resultCard: null,
    };
  }

  // ─── HELPER FORMATTERS ───
  function _formatOrderBrief(order) {
    return {
      id: order.id,
      customer: order.customer,
      items: order.items.map(function (it) { return it.quantity + '× ' + it.description; }).join(', '),
      dueDate: DataStore.formatDate(order.due_date),
      amount: DataStore.formatCurrency(order.amount),
      status: order._status,
      paymentStatus: order._payment_status,
    };
  }

  function _formatOrderDetail(order) {
    return {
      id: order.id,
      customer: order.customer,
      items: order.items.map(function (it) {
        return {
          description: it.description,
          quantity: it.quantity,
          attributes: it.attributes,
        };
      }),
      dueDate: DataStore.formatDate(order.due_date),
      amount: DataStore.formatCurrency(order.amount),
      status: order._status,
      paymentStatus: order._payment_status,
      domain: order._domain,
    };
  }

  function _extractName(text) {
    var lower = text.toLowerCase();
    // Check against known customers
    var customers = DataStore.getCustomers();
    for (var i = 0; i < customers.length; i++) {
      var name = customers[i].name.toLowerCase();
      var firstName = name.split(' ')[0];
      if (lower.includes(name) || lower.includes(firstName)) {
        return customers[i].name;
      }
    }
    // Try to extract a capitalized name
    var nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    if (nameMatch && nameMatch[1].toLowerCase() !== 'what' && nameMatch[1].toLowerCase() !== 'who') {
      return nameMatch[1];
    }
    return null;
  }

  // ─── SUGGESTED QUERIES ───
  var SUGGESTED_QUERIES = [
    'What is due today?',
    'Who owes me money?',
    'What did Rahul order last time?',
    'How busy am I this week?',
  ];

  // ═══════════════════════════════════════════════════════════════
  // MAIN QUERY FUNCTION
  // ═══════════════════════════════════════════════════════════════
  function answerQuery(text) {
    if (!text || !text.trim()) {
      return {
        prose: 'Please type a question to get started!',
        resultCard: null,
      };
    }

    var input = text.trim();

    // Try each intent
    for (var i = 0; i < INTENTS.length; i++) {
      var intent = INTENTS[i];
      for (var j = 0; j < intent.patterns.length; j++) {
        if (intent.patterns[j].test(input)) {
          var response = intent.handler(input);
          // Save to chat history
          DataStore.addChatMessage({ role: 'user', text: input });
          DataStore.addChatMessage({ role: 'assistant', text: response.prose, resultCard: response.resultCard });
          return response;
        }
      }
    }

    // Fallback
    var fallback = {
      prose: 'I couldn\'t find a match for that — try asking about due orders, overdue payments, a customer\'s order history, or your weekly workload.',
      resultCard: null,
    };
    DataStore.addChatMessage({ role: 'user', text: input });
    DataStore.addChatMessage({ role: 'assistant', text: fallback.prose });
    return fallback;
  }

  // ─── EXPORT ───
  window.Chatbot = {
    answerQuery:     answerQuery,
    SUGGESTED_QUERIES: SUGGESTED_QUERIES,
  };
})();
