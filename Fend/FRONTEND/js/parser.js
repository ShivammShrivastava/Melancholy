/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Smart Order Intake Parser (js/parser.js)
   Mock parser that approximates the real pipeline closely
   enough to demo convincingly. Output matches schema.json exactly.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DATE LOOKUP TABLE ───
  // Hindi/colloquial date phrases resolved against receivedAt (not Date.now())
  var RELATIVE_DATES = {
    'aaj':      0,
    'aaj hi':   0,
    'today':    0,
    'kal':      1,
    'tomorrow': 1,
    'parso':    2,
    'parson':   2,
    'narsu':    3,
    'tarsu':    4,
  };

  var WEEKDAYS = {
    'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
    'friday': 5, 'saturday': 6, 'sunday': 0,
    'somvar': 1, 'mangalvar': 2, 'budhvar': 3, 'guruvar': 4,
    'shukravar': 5, 'shanivar': 6, 'ravivar': 0,
    'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 0,
  };

  // Unresolvable phrases → null + clarification
  var UNRESOLVABLE = ['jaldi', 'asap', 'urgent', 'jab ho jaye', 'jitna jaldi ho sake', 'jaldi se jaldi', 'quickly', 'fast', 'soon', 'immediately'];

  // ─── DATE RESOLVER ───
  function resolveDate(phrase, receivedAt) {
    if (!phrase || !phrase.trim()) return { date: null, resolved: false, source: null, unresolvable: false };

    var text = phrase.trim().toLowerCase();
    var base = receivedAt ? new Date(receivedAt) : new Date();

    // 1. Check unresolvable
    for (var i = 0; i < UNRESOLVABLE.length; i++) {
      if (text.includes(UNRESOLVABLE[i])) {
        return { date: null, resolved: false, source: phrase, unresolvable: true };
      }
    }

    // 2. Exact relative days (aaj, kal, parso, narsu, tarsu)
    for (var key in RELATIVE_DATES) {
      if (text === key || text.includes(key)) {
        var d = new Date(base);
        d.setDate(d.getDate() + RELATIVE_DATES[key]);
        return { date: _fmt(d), resolved: true, source: phrase, unresolvable: false };
      }
    }

    // 3. "agle <weekday>" / "next <weekday>"
    var nextDayMatch = text.match(/(?:agle|agla|next)\s+(\w+)/i);
    if (nextDayMatch) {
      var dayName = nextDayMatch[1].toLowerCase();
      if (WEEKDAYS[dayName] !== undefined) {
        var target = WEEKDAYS[dayName];
        var current = base.getDay();
        var diff = (target - current + 7) % 7;
        if (diff === 0) diff = 7;
        var rd = new Date(base);
        rd.setDate(rd.getDate() + diff);
        return { date: _fmt(rd), resolved: true, source: phrase, unresolvable: false };
      }
    }

    // 4. "is weekend" / "this weekend"
    if (text.includes('is weekend') || text.includes('this weekend') || text.includes('iss weekend')) {
      var sat = new Date(base);
      var satDiff = (6 - base.getDay() + 7) % 7;
      if (satDiff === 0) satDiff = 7;
      sat.setDate(sat.getDate() + satDiff);
      return { date: _fmt(sat), resolved: true, source: phrase, unresolvable: false };
    }

    // 5. "<N> tarikh" (Nth of current/next month)
    var tarikhMatch = text.match(/(\d{1,2})\s*(?:tarikh|tarik|tareekh|taarikh)/i);
    if (tarikhMatch) {
      var dayNum = parseInt(tarikhMatch[1], 10);
      var tDate = new Date(base.getFullYear(), base.getMonth(), dayNum);
      if (tDate <= base) {
        tDate.setMonth(tDate.getMonth() + 1);
      }
      return { date: _fmt(tDate), resolved: true, source: phrase, unresolvable: false };
    }

    // 6. "agle hafte" / "next week"
    if (text.includes('agle hafte') || text.includes('agla hafta') || text.includes('next week')) {
      var nw = new Date(base);
      nw.setDate(nw.getDate() + 7);
      return { date: _fmt(nw), resolved: true, source: phrase, unresolvable: false };
    }

    // 7. "<N> din me" / "in <N> days"
    var dinMatch = text.match(/(\d+)\s*(?:din|days?)\s*(?:me|mein|main|in)?/i) ||
                   text.match(/(?:in|within)\s*(\d+)\s*(?:din|days?)/i);
    if (dinMatch) {
      var numDays = parseInt(dinMatch[1], 10);
      var dd = new Date(base);
      dd.setDate(dd.getDate() + numDays);
      return { date: _fmt(dd), resolved: true, source: phrase, unresolvable: false };
    }

    // 8. Explicit date formats: DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY, etc.
    var explicitMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (explicitMatch) {
      var day = parseInt(explicitMatch[1], 10);
      var month = parseInt(explicitMatch[2], 10) - 1;
      var year = parseInt(explicitMatch[3], 10);
      if (year < 100) year += 2000;
      var ed = new Date(year, month, day);
      return { date: _fmt(ed), resolved: true, source: phrase, unresolvable: false };
    }

    // 9. Month name: "28 Aug" or "Aug 28"
    var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    var monthMatch = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i) ||
                     text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(\d{1,2})/i);
    if (monthMatch) {
      var md, mm;
      if (MONTHS[monthMatch[1].toLowerCase().slice(0,3)] !== undefined) {
        mm = MONTHS[monthMatch[1].toLowerCase().slice(0,3)];
        md = parseInt(monthMatch[2], 10);
      } else {
        md = parseInt(monthMatch[1], 10);
        mm = MONTHS[monthMatch[2].toLowerCase().slice(0,3)];
      }
      var mDate = new Date(base.getFullYear(), mm, md);
      if (mDate < base) mDate.setFullYear(mDate.getFullYear() + 1);
      return { date: _fmt(mDate), resolved: true, source: phrase, unresolvable: false };
    }

    // Not found
    return { date: null, resolved: false, source: phrase, unresolvable: false };
  }

  function _fmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ─── QUANTITY CONFLICT DETECTION ───
  function _detectQuantityConflict(text) {
    // Look for two different numbers near quantity-related words
    var quantityPatterns = [
      /(\d+)\s*(?:ya|or|aur)\s*(\d+)/gi,           // "2 ya 3" / "do ya teen"
      /(?:do|teen|char|paanch|chhe|saat|aath|nau|das)\s+(?:ya|or)\s+(?:do|teen|char|paanch|chhe|saat|aath|nau|das)/gi,
    ];

    var hindiNums = { ek: 1, do: 2, teen: 3, char: 4, paanch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };

    // Check for "do ya teen" style conflicts
    var hindiMatch = text.toLowerCase().match(/\b(ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s+(?:ya|or|aur)\s+(ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\b/i);
    if (hindiMatch) {
      return {
        conflict: true,
        first: hindiNums[hindiMatch[1].toLowerCase()] || 1,
        second: hindiNums[hindiMatch[2].toLowerCase()] || 1,
        phrase: hindiMatch[0],
      };
    }

    // Check for "2 ya 3" style conflicts
    var numMatch = text.match(/(\d+)\s*(?:ya|or|aur)\s*(\d+)/i);
    if (numMatch) {
      var n1 = parseInt(numMatch[1], 10);
      var n2 = parseInt(numMatch[2], 10);
      if (n1 !== n2) {
        return { conflict: true, first: n1, second: n2, phrase: numMatch[0] };
      }
    }

    return { conflict: false };
  }

  // ─── ITEM EXTRACTION ───
  function _extractItems(text) {
    var items = [];
    var lines = text.split(/[,;\n]+/);
    var cleanText = text.toLowerCase();

    // Detect domain
    var domain = _detectDomain(cleanText);

    lines.forEach(function (line) {
      line = line.trim();
      if (!line || line.length < 3) return;

      // Skip lines that are only date/customer/amount info
      if (line.match(/^(?:kal|parso|aaj|tomorrow|next|agle|₹|\d+\s*rupee)/i)) return;

      // Try to extract quantity
      var qty = 1;
      var qtyMatch = line.match(/^(\d+)\s+/);
      if (qtyMatch) {
        qty = parseInt(qtyMatch[1], 10);
        line = line.slice(qtyMatch[0].length);
      }

      // Extract description (clean up)
      var desc = line.replace(/\b(mujhe|chahiye|banao|bana do|karo|kar do|please|pls|bhai|sir|madam)\b/gi, '').trim();
      if (desc.length < 2) return;

      // Capitalize first letter
      desc = desc.charAt(0).toUpperCase() + desc.slice(1);

      // Extract attributes based on domain
      var attrs = _extractAttributes(text, domain);

      items.push({
        description: desc,
        quantity: qty,
        attributes: attrs,
      });
    });

    // If no items extracted, treat whole text as single item
    if (items.length === 0 && text.trim().length > 3) {
      var fallbackDesc = text.replace(/\b(mujhe|chahiye|banao|karo|kal|parso|aaj|please|bhai|sir)\b/gi, '').trim();
      items.push({
        description: fallbackDesc.charAt(0).toUpperCase() + fallbackDesc.slice(1),
        quantity: 1,
        attributes: _extractAttributes(text, domain),
      });
    }

    return { items: items, domain: domain };
  }

  // ─── DOMAIN DETECTION ───
  function _detectDomain(text) {
    var t = text.toLowerCase();
    var scores = { tailor: 0, tiffin: 0, electrician: 0, baker: 0 };

    // Tailor keywords
    if (t.match(/\b(kurta|shirt|pajama|blouse|suit|sherwani|lehenga|silai|stitching|stitch|cloth|kapda|darzi|tailor|fitting|fabric|cotton|silk|linen)\b/)) scores.tailor += 3;
    if (t.match(/\b(chest|waist|sleeve|collar|length|fit|size|measure)\b/)) scores.tailor += 2;

    // Tiffin keywords
    if (t.match(/\b(tiffin|lunch|dinner|khana|roti|sabzi|dal|rice|thali|meal|dabba|breakfast|nashta|catering)\b/)) scores.tiffin += 3;
    if (t.match(/\b(portion|spice|jain|veg|nonveg|plate|person)\b/)) scores.tiffin += 2;

    // Electrician keywords
    if (t.match(/\b(fan|ac|wiring|wire|switch|light|bulb|repair|fix|install|electrician|bijli|mcb|fuse|socket|plug|inverter)\b/)) scores.electrician += 3;
    if (t.match(/\b(appliance|room|brand|watt|volt|motor|circuit)\b/)) scores.electrician += 2;

    // Baker keywords
    if (t.match(/\b(cake|cookie|brownie|pastry|bread|bake|bakery|cupcake|muffin|sweet|mithai|barfi)\b/)) scores.baker += 3;
    if (t.match(/\b(flavour|flavor|egg.?free|eggless|tier|icing|fondant|cream|chocolate|vanilla|pineapple|red velvet|butterscotch|strawberry)\b/)) scores.baker += 2;

    var maxScore = 0;
    var domain = 'tailor'; // default
    for (var d in scores) {
      if (scores[d] > maxScore) { maxScore = scores[d]; domain = d; }
    }
    return domain;
  }

  // ─── ATTRIBUTE EXTRACTION ───
  function _extractAttributes(text, domain) {
    var t = text.toLowerCase();
    var attrs = {};
    var vocab = DataStore.ATTRIBUTE_VOCAB[domain] || [];

    if (domain === 'tailor') {
      // Color
      var colors = ['white', 'black', 'blue', 'navy', 'red', 'green', 'maroon', 'ivory', 'cream', 'grey', 'gray', 'pink', 'yellow', 'purple', 'beige', 'brown', 'golden', 'silver'];
      colors.forEach(function (c) { if (t.includes(c)) attrs.color = c.charAt(0).toUpperCase() + c.slice(1); });

      // Fabric
      var fabrics = ['cotton', 'silk', 'linen', 'polyester', 'wool', 'satin', 'chiffon', 'georgette', 'brocade', 'chanderi', 'khadi', 'denim'];
      fabrics.forEach(function (f) { if (t.includes(f)) attrs.fabric = f.charAt(0).toUpperCase() + f.slice(1); });

      // Measurements
      var chestMatch = t.match(/chest\s*[:=]?\s*(\d+)/); if (chestMatch) attrs.chest = parseInt(chestMatch[1]);
      var waistMatch = t.match(/waist\s*[:=]?\s*(\d+)/); if (waistMatch) attrs.waist = parseInt(waistMatch[1]);
      var lengthMatch = t.match(/length\s*[:=]?\s*(\d+)/); if (lengthMatch) attrs.length = parseInt(lengthMatch[1]);

      // Sleeve
      if (t.includes('half sleeve') || t.includes('half-sleeve')) attrs.sleeve = 'Half';
      else if (t.includes('full sleeve') || t.includes('full-sleeve')) attrs.sleeve = 'Full';
      else if (t.includes('sleeveless')) attrs.sleeve = 'Sleeveless';

      // Fit
      if (t.includes('slim fit') || t.includes('slim')) attrs.fit = 'Slim';
      else if (t.includes('regular fit') || t.includes('regular')) attrs.fit = 'Regular';
      else if (t.includes('loose') || t.includes('relaxed')) attrs.fit = 'Relaxed';

      // Size
      var sizes = ['xs', 's', 'm', 'l', 'xl', 'xxl'];
      sizes.forEach(function(s) { if (t.match(new RegExp('\\b' + s + '\\b', 'i'))) attrs.size = s.toUpperCase(); });

    } else if (domain === 'tiffin') {
      if (t.match(/\b(1|one|single|ek)\s*person/)) attrs.portion = '1 Person';
      else if (t.match(/\b(2|two|do)\s*person/)) attrs.portion = '2 Person';
      else if (t.match(/\b(4|four|char)\s*person/)) attrs.portion = '4 Person';

      if (t.includes('no spice') || t.includes('bland')) attrs.spice_level = 'No Spice';
      else if (t.includes('mild') || t.includes('kam mirchi') || t.includes('halka')) attrs.spice_level = 'Mild';
      else if (t.includes('medium')) attrs.spice_level = 'Medium';
      else if (t.includes('spicy') || t.includes('teekha')) attrs.spice_level = 'Spicy';

      if (t.includes('lunch') && t.includes('dinner')) attrs.meal = 'Lunch + Dinner';
      else if (t.includes('lunch')) attrs.meal = 'Lunch';
      else if (t.includes('dinner')) attrs.meal = 'Dinner';
      else if (t.includes('breakfast') || t.includes('nashta')) attrs.meal = 'Breakfast';

      var rotiMatch = t.match(/(\d+)\s*(?:roti|chapati|phulka)/); if (rotiMatch) attrs.roti_count = parseInt(rotiMatch[1]);
      if (t.includes('jain')) attrs.jain = true;

      var daysMatch = t.match(/(\d+)\s*(?:din|days?|day)/); if (daysMatch) attrs.days = parseInt(daysMatch[1]);

    } else if (domain === 'electrician') {
      var appliances = { 'fan': 'Fan', 'ceiling fan': 'Ceiling Fan', 'ac': 'AC', 'air conditioner': 'AC', 'inverter': 'Inverter', 'geyser': 'Geyser', 'switch': 'Switch', 'wiring': 'Wiring', 'light': 'Light', 'bulb': 'Bulb', 'mcb': 'MCB' };
      for (var a in appliances) { if (t.includes(a)) { attrs.appliance = appliances[a]; break; } }

      var issues = { 'not working': 'Not working', 'not spinning': 'Not spinning', 'not cooling': 'Not cooling', 'tripping': 'Tripping', 'spark': 'Sparking', 'noise': 'Making noise', 'repair': 'Needs repair', 'install': 'New installation', 'new': 'New installation' };
      for (var iss in issues) { if (t.includes(iss)) { attrs.issue = issues[iss]; break; } }

      var rooms = ['bedroom', 'living room', 'kitchen', 'bathroom', 'hall', 'balcony', 'entire house', 'office'];
      rooms.forEach(function(r) { if (t.includes(r)) attrs.room = r.charAt(0).toUpperCase() + r.slice(1); });

      var brands = ['havells', 'polycab', 'daikin', 'voltas', 'lg', 'samsung', 'crompton', 'orient', 'bajaj', 'usha', 'anchor', 'philips'];
      brands.forEach(function(b) { if (t.includes(b)) attrs.brand = b.charAt(0).toUpperCase() + b.slice(1); });

      var wattMatch = t.match(/(\d+)\s*(?:watt|w)\b/); if (wattMatch) attrs.wattage = parseInt(wattMatch[1]);

    } else if (domain === 'baker') {
      var flavours = ['chocolate', 'vanilla', 'strawberry', 'pineapple', 'red velvet', 'butterscotch', 'mango', 'blueberry', 'black forest', 'fruit', 'coffee', 'caramel', 'lemon', 'orange', 'almond'];
      flavours.forEach(function(f) { if (t.includes(f)) attrs.flavour = f.split(' ').map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); });

      var weightMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo)/); if (weightMatch) attrs.weight_kg = parseFloat(weightMatch[1]);
      if (!attrs.weight_kg) {
        var poundMatch = t.match(/(\d+)\s*(?:pound|lb)/); if (poundMatch) attrs.weight_kg = Math.round(parseInt(poundMatch[1]) * 0.45 * 10) / 10;
      }

      if (t.includes('eggless') || t.includes('egg-free') || t.includes('egg free') || t.includes('bina anda') || t.includes('no egg')) attrs.egg_free = true;
      else if (t.includes('with egg') || t.includes('anda')) attrs.egg_free = false;

      var tierMatch = t.match(/(\d)\s*(?:tier|layer|manzil)/); if (tierMatch) attrs.tier = parseInt(tierMatch[1]);

      if (t.includes('message') || t.includes('likho') || t.includes('likhna')) {
        var msgMatch = t.match(/(?:message|likho?|likhna)\s*[:=]?\s*["']?([^"'\n,;]+)/i);
        if (msgMatch) attrs.message_on_cake = msgMatch[1].trim();
      }

      var shapes = ['round', 'square', 'heart', 'rectangle', 'star'];
      shapes.forEach(function(s) { if (t.includes(s)) attrs.shape = s.charAt(0).toUpperCase() + s.slice(1); });
    }

    return attrs;
  }

  // ─── CUSTOMER DETECTION ───
  function _detectCustomer(text) {
    var customers = DataStore.getCustomers();
    var lower = text.toLowerCase();

    for (var i = 0; i < customers.length; i++) {
      var nameLower = customers[i].name.toLowerCase();
      var parts = nameLower.split(' ');
      // Check full name or first name
      if (lower.includes(nameLower) || lower.includes(parts[0])) {
        return customers[i].name;
      }
    }

    // Try to find a name-like pattern
    var nameMatch = text.match(/(?:customer|client|for|from|naam|name)\s*[:=]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (nameMatch) return nameMatch[1];

    return null;
  }

  // ─── AMOUNT DETECTION ───
  function _detectAmount(text) {
    // ₹5000, Rs 5000, Rs.5000, 5000 rupees, etc.
    var patterns = [
      /₹\s*(\d+[\d,]*)/,
      /(?:rs\.?|rupees?|inr)\s*(\d+[\d,]*)/i,
      /(\d+[\d,]*)\s*(?:rupees?|rs\.?|inr|₹)/i,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) {
        return parseInt(m[1].replace(/,/g, ''), 10);
      }
    }
    return null;
  }

  // ─── PRIOR ORDER REFERENCE ───
  function _detectPriorOrderRef(text) {
    var lower = text.toLowerCase();
    var patterns = [
      'same as before', 'same as last time', 'wahi', 'pehle wala', 'pehle jaisa',
      'repeat', 'same order', 'like last time', 'last order', 'previous order',
      'fir se', 'phir se', 'dobara', 'waise hi', 'same measurement', 'purana order',
    ];
    for (var i = 0; i < patterns.length; i++) {
      if (lower.includes(patterns[i])) return true;
    }
    return false;
  }

  // ─── DATE PHRASE EXTRACTION ───
  function _extractDatePhrase(text) {
    var lower = text.toLowerCase();

    // Check for unresolvable first
    for (var i = 0; i < UNRESOLVABLE.length; i++) {
      if (lower.includes(UNRESOLVABLE[i])) return UNRESOLVABLE[i];
    }

    // Check for known date phrases
    var phrases = [
      /\b(aaj|today)\b/i, /\b(kal|tomorrow)\b/i, /\b(parso|parson)\b/i,
      /\b(narsu)\b/i, /\b(tarsu)\b/i,
      /\b(agle?\s+\w+)\b/i, /\b(next\s+\w+)\b/i,
      /\b(is\s+weekend|this\s+weekend)\b/i,
      /\b(\d{1,2}\s*tarikh)\b/i, /\b(\d{1,2}\s*tareekh)\b/i,
      /\b(agle?\s+hafte?|next\s+week)\b/i,
      /\b(\d+\s*din\s*(?:me|mein)?)\b/i, /\b(?:in\s+)?(\d+\s*days?)\b/i,
      /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
      /\b(\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)\b/i,
    ];

    for (var j = 0; j < phrases.length; j++) {
      var m = lower.match(phrases[j]);
      if (m) return m[0];
    }

    return null;
  }

  // ─── CONFIDENCE CALCULATION ───
  function _calcConfidence(result) {
    var score = 0.70;
    if (result.customer) score += 0.08;
    if (result.items.length > 0) score += 0.06;
    if (result.due_date) score += 0.06;
    if (result.amount) score += 0.05;
    if (result.items.length > 0 && Object.keys(result.items[0].attributes).length > 0) score += 0.03;
    if (!result.needs_clarification) score += 0.02;
    return Math.min(0.99, Math.round(score * 100) / 100);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN PARSE FUNCTION
  // ═══════════════════════════════════════════════════════════════
  function parseMessage(text, receivedAt) {
    if (!text || !text.trim()) {
      return {
        customer: null,
        items: [],
        due_date: null,
        amount: null,
        references_prior_order: false,
        confidence: 0,
        needs_clarification: true,
        _clarification_notes: ['No message provided'],
        _date_source: null,
        _domain: 'tailor',
      };
    }

    var clarificationNotes = [];
    var needsClarification = false;

    // 1. Detect customer
    var customer = _detectCustomer(text);

    // 2. Extract items & domain
    var extracted = _extractItems(text);
    var items = extracted.items;
    var domain = extracted.domain;

    // 3. Check quantity conflicts
    var qConflict = _detectQuantityConflict(text);
    if (qConflict.conflict && items.length > 0) {
      items[0].quantity = qConflict.first;
      needsClarification = true;
      clarificationNotes.push(
        'Quantity unclear — using first stated value (' + qConflict.first +
        '), please confirm (also mentioned: ' + qConflict.second + ')'
      );
    }

    // 4. Resolve date
    var datePhrase = _extractDatePhrase(text);
    var dateResult = resolveDate(datePhrase, receivedAt);
    var dueDate = dateResult.date;

    if (dateResult.unresolvable) {
      needsClarification = true;
      clarificationNotes.push(
        'Due date unclear — "' + datePhrase + '" cannot be resolved to a specific date. Please provide an exact date.'
      );
    }

    // 5. Detect amount
    var amount = _detectAmount(text);

    // 6. Detect prior order reference
    var referencesPriorOrder = _detectPriorOrderRef(text);

    // 7. Build result
    var result = {
      customer: customer,
      items: items,
      due_date: dueDate,
      amount: amount,
      references_prior_order: referencesPriorOrder,
      confidence: 0,
      needs_clarification: needsClarification,
      _clarification_notes: clarificationNotes,
      _date_source: datePhrase,
      _date_resolved: dateResult.resolved,
      _domain: domain,
    };

    // 8. Calculate confidence
    result.confidence = _calcConfidence(result);

    return result;
  }

  // ─── EXPORT ───
  window.Parser = {
    parseMessage:  parseMessage,
    resolveDate:   resolveDate,
  };
})();
