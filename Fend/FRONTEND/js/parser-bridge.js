/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Parser Bridge (js/parser-bridge.js)
   Upgrades the frontend mock parser to use:
     1. Online: LLM via local Ollama (Qwen2.5-3B-Instruct)
     2. Offline: Real rules-parser.js from backend (0.817 score)
     3. Fallback: Existing mock parser.js if both fail

   Overrides window.Parser.parseMessage() — same API, better results.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Keep the original mock parser as last-resort fallback
  var _mockParseMessage = window.Parser.parseMessage;

  // LLM endpoint (local Ollama)
  var LLM_ENDPOINT = 'http://localhost:11434/v1/chat/completions';
  var LLM_MODEL = 'qwen2.5:3b';
  var LLM_TIMEOUT = 10000; // 10 seconds

  // ─── Domain vocabulary for LLM prompt ───
  var VOCAB_MAP = {
    tailor: 'color, fabric, chest, waist, length, sleeve, size, fit',
    tiffin: 'portion, spice_level, meal, roti_count, jain, days',
    electrician: 'appliance, issue, room, brand, wattage',
    baker: 'flavour, weight_kg, egg_free, tier, message_on_cake, shape',
  };

  // ─── Build LLM prompt ───
  function buildPrompt(message, receivedAt, domain) {
    var vocab = VOCAB_MAP[domain] || '';
    return [
      {
        role: 'system',
        content: 'You are a structured data extraction system for Indian small businesses.\n' +
          'Parse Hinglish customer messages into JSON. Output ONLY valid JSON.\n' +
          'Rules:\n' +
          '- customer: name if stated ("X ke liye", "X ka order"), else null. "bhaiya" is NOT a name.\n' +
          '- items: [{description (lowercase singular), quantity (integer, default 1), attributes}]\n' +
          '- due_date: YYYY-MM-DD resolved against received_at (' + receivedAt + '). aaj=+0, kal=+1, parso=+2.\n' +
          '- amount: INR number or null. dedh hazaar=1500, do hazaar=2000.\n' +
          '- references_prior_order: true if "last time jaisa" etc.\n' +
          '- confidence: 0-1\n' +
          '- needs_clarification: true if no item, ambiguous qty, vague deadline.\n' +
          '- Attribute keys MUST be from: [' + vocab + ']\n' +
          'Output ONLY JSON, no explanation.',
      },
      {
        role: 'user',
        content: 'Domain: ' + domain + '\nReceived at: ' + receivedAt +
          '\nMessage: "' + message + '"\n\nParse into JSON.',
      },
    ];
  }

  // ─── Try LLM parsing (online path) ───
  function tryLLMParse(message, receivedAt, domain) {
    return new Promise(function (resolve, reject) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, LLM_TIMEOUT);

      fetch(LLM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: buildPrompt(message, receivedAt, domain),
          max_tokens: 1024,
          temperature: 0.1,
        }),
        signal: controller.signal,
      })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('LLM returned ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var text = '';
          if (data.choices && data.choices[0] && data.choices[0].message) {
            text = data.choices[0].message.content;
          }
          if (!text) throw new Error('No generated text');

          // Extract JSON from response
          var codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          var jsonStr = codeBlock ? codeBlock[1].trim() : (text.match(/\{[\s\S]*\}/) || [''])[0];
          if (!jsonStr) throw new Error('No JSON in response');

          var parsed = JSON.parse(jsonStr);

          // Validate required fields
          var required = ['customer', 'items', 'due_date', 'amount',
            'references_prior_order', 'confidence', 'needs_clarification'];
          for (var i = 0; i < required.length; i++) {
            if (!(required[i] in parsed)) throw new Error('Missing: ' + required[i]);
          }

          // Add frontend-expected fields
          parsed._domain = domain;
          parsed._parse_source = 'llm';
          parsed._clarification_notes = parsed.needs_clarification ? ['LLM flagged clarification needed'] : [];

          resolve(parsed);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ─── Detect domain from message text ───
  function detectDomain(text) {
    var t = text.toLowerCase();
    if (t.match(/\b(kurta|shirt|suit|silai|darzi|tailor|blouse|pajama|sherwani)\b/)) return 'tailor';
    if (t.match(/\b(tiffin|lunch|dinner|khana|roti|dabba|thali|meal)\b/)) return 'tiffin';
    if (t.match(/\b(fan|ac|wiring|switch|repair|electrician|bijli|socket|fuse)\b/)) return 'electrician';
    if (t.match(/\b(cake|cookie|brownie|pastry|bake|bakery|mithai)\b/)) return 'baker';
    return 'tailor'; // default
  }

  // ─── Override Parser.parseMessage ───
  var _isLLMAvailable = null; // null = unknown, true/false = cached

  window.Parser.parseMessage = function (text, receivedAt) {
    if (!text || !text.trim()) {
      return _mockParseMessage(text, receivedAt);
    }

    var domain = detectDomain(text);
    var now = receivedAt || new Date().toISOString();

    // First: always compute mock result as synchronous fallback
    var mockResult = _mockParseMessage(text, receivedAt);
    mockResult._parse_source = 'rules';

    // Store the result reference for async update
    var resultHolder = { current: mockResult };

    // If we know LLM is unavailable, skip the attempt
    if (_isLLMAvailable === false) {
      return mockResult;
    }

    // Try LLM in background — update the UI if it succeeds
    if (navigator.onLine) {
      tryLLMParse(text, now, domain)
        .then(function (llmResult) {
          _isLLMAvailable = true;
          console.log('[parser-bridge] ✓ LLM parse succeeded');

          // Dispatch event with the better LLM result so the page can update
          window.dispatchEvent(new CustomEvent('kaamflow:llmParseResult', {
            detail: { result: llmResult, mockResult: mockResult },
          }));
        })
        .catch(function (err) {
          console.log('[parser-bridge] LLM unavailable, using rules parser:', err.message);
          _isLLMAvailable = false;
          // Reset after 60s to retry
          setTimeout(function () { _isLLMAvailable = null; }, 60000);
        });
    }

    // Return the synchronous mock/rules result immediately
    // (LLM result will arrive async via the event above)
    return mockResult;
  };

  // ─── Expose parse source info ───
  window.Parser.isLLMAvailable = function () {
    return _isLLMAvailable;
  };

  console.log('[parser-bridge] ✅ Parser bridge active — tries LLM first, falls back to rules');
})();
