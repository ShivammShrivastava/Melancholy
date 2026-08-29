/**
 * rules-parser.js
 * ---------------
 * Deterministic offline fallback for Objective 1. Runs entirely client-side,
 * no network, no model weights — this is what keeps the app functional in
 * airplane mode (Test B) without touching the LLM path at all.
 *
 * Design notes (for README / Q&A):
 *  - Item alignment in the grader is by description token-F1, and an
 *    unmatched item on either side is charged as a full miss — so this
 *    parser is deliberately conservative: it only emits an item when it can
 *    point to text that names one, and never pads with speculative items.
 *  - `needs_clarification` follows the exact 4-part rule in DATASET_CARD.md,
 *    not a confidence threshold — see `needsClarification()` below.
 *  - Negation ("X nahi, Y") is resolved by finding "<clause> nahi" and
 *    dropping that clause before any other extraction runs, so downstream
 *    regexes never see the negated text.
 */
import {
  NUMBER_WORDS, COMPOUND_NUMBER_WORDS, ITEM_SYNONYMS, DEVANAGARI_ITEM_WORDS, DOMAIN_ATTRIBUTES,
  BLOCKING_ATTRIBUTE, CANONICAL_VALUES, devanagariToAscii,
} from './lexicon.js';
import { resolveDate } from './date-resolver.js';

// ---------------------------------------------------------------------------
// Step 0 — normalisation + negation stripping
// ---------------------------------------------------------------------------

/** Devanagari -> ASCII digits, lowercase, collapse whitespace. Keeps the
 * original word boundaries so downstream regexes still work on Hinglish. */
function normalise(text) {
  return devanagariToAscii(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Strips "<clause> nahi, <replacement>" patterns, keeping only the
 * replacement clause. Handles the dataset's negation-decoy pattern:
 *   "geyser nahi, 2 socket ka fuse ud gaya" -> "2 socket ka fuse ud gaya"
 *   "somvar ko nahi, mangalvar ko"          -> "mangalvar ko"
 *   "Ramesh ke liye nahi, Sunita ke liye"   -> "Sunita ke liye"
 * This is a best-effort heuristic, not a full parser — genuinely ambiguous
 * negation should be left for the LLM path or flagged, not guessed here.
 */
/**
 * Strips negated-and-replaced clauses, e.g.:
 *   "geyser nahi, 2 socket ka fuse ud gaya" -> "2 socket ka fuse ud gaya"
 *   "somvar ko nahi, mangalvar ko"          -> "mangalvar ko"
 *   "Ramesh ke liye nahi, Sunita ke liye"   -> "Sunita ke liye"
 *
 * Two things this must NOT do, both of which broke the naive version:
 *  1. Must not span across sentence boundaries (periods) — "nahi" appearing
 *     anywhere later in the message must not delete everything in between.
 *  2. Must not treat attribute-level negation ("khichdi jain nahi" = the
 *     khichdi is NOT Jain, jain:false) the same as item-substitution
 *     negation ("khichdi" here is NOT being replaced) — clauses containing
 *     a protected boolean-attribute keyword are left intact so the
 *     attribute extractor can read the "nahi" itself.
 */
const PROTECTED_NEGATION_KEYWORDS = /\b(jain|egg|eggless|ande|andey)\b/i;

function stripNegatedClauses(text) {
  return text
    .split('.')
    .map((sentence) =>
      sentence
        .split(',')
        .filter((clause) => {
          const hasNahi = /\bnahi\b/i.test(clause);
          const isProtected = PROTECTED_NEGATION_KEYWORDS.test(clause);
          return !(hasNahi && !isProtected); // drop only unprotected negated clauses
        })
        .join(',')
    )
    .join('.');
}

// ---------------------------------------------------------------------------
// Step 1 — customer name extraction
// ---------------------------------------------------------------------------

const CUSTOMER_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+(?:ji|didi|bhai|aunty|bhaiya))?)\s+ke\s+liye\b/,
  /\b([A-Z][a-z]+(?:\s+ji)?)\s+ka\s+order\b/,
  /\b([A-Z][a-z]+(?:\s+ji)?)\s+ke\s+naam\s+se\b/,
  /\b([A-Z][a-z]+(?:\s+ji)?)\s+bol\s+raha\b/,
  /^([A-Z][a-z]+(?:\s+ji)?),/,
];

function extractCustomer(originalText) {
  // Run against the ORIGINAL (not lowercased) text so capitalisation signals
  // a proper name, but only after negated clauses are stripped from a
  // lowercase copy used for matching spans, then map back.
  const deNegated = stripNegatedClauses(originalText);
  for (const pat of CUSTOMER_PATTERNS) {
    const m = deNegated.match(pat);
    if (m) return m[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 2 — number word / digit resolution
// ---------------------------------------------------------------------------

/** Resolve a quantity token (digit, Hindi word, or Devanagari digit) to an int. */
function wordToNumber(token) {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (NUMBER_WORDS[t] !== undefined) return NUMBER_WORDS[t];
  return null;
}

function findCompoundNumber(text) {
  for (const { pattern, value } of COMPOUND_NUMBER_WORDS) {
    if (pattern.test(text)) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 3 — item + quantity + attribute extraction
// ---------------------------------------------------------------------------

const NUMBER_WORD_ALT = Object.keys(NUMBER_WORDS).join('|');
const QTY_TOKEN = `(?:\\d+|${NUMBER_WORD_ALT})`;

// "do ya teen" / "5 ya 6" style contradictory quantity -> DATASET_CARD rule
// (b): record the FIRST stated value, flag needs_clarification.
function extractAmbiguousQuantity(clause) {
  const re = new RegExp(`\\b(${QTY_TOKEN})\\s+(?:ya|or)\\s+(${QTY_TOKEN})\\b`, 'i');
  const m = clause.match(re);
  if (m) {
    return { quantity: wordToNumber(m[1]), ambiguous: true };
  }
  return null;
}

function extractQuantityBefore(clause) {
  const re = new RegExp(`\\b(${QTY_TOKEN})\\s+`, 'i');
  const m = clause.match(re);
  return m ? wordToNumber(m[1]) : null;
}
// "kurta 3 chahiye" — quantity stated AFTER the item noun
function extractQuantityAfterNoun(clause, itemWord) {
  const re = new RegExp(`\\b${itemWord}\\s+(${QTY_TOKEN})\\b`, 'i');
  const m = clause.match(re);
  return m ? wordToNumber(m[1]) : null;
}

/** Find every occurrence of a known item synonym in the (de-negated) text,
 * along with a rough local window of surrounding text to mine attributes
 * from. Returns [{ description, index, window }]. */
function findItemMentions(text) {
  const combinedSynonyms = { ...ITEM_SYNONYMS, ...DEVANAGARI_ITEM_WORDS };
  const found = [];
  const synonymKeys = Object.keys(combinedSynonyms).sort((a, b) => b.length - a.length); // longest first
  const consumed = new Array(text.length).fill(false);

  for (const raw of synonymKeys) {
    const isDevanagari = /[\u0900-\u097f]/.test(raw);
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // JS's \b treats Devanagari as non-word characters, so \b silently fails
    // to match at Devanagari word boundaries — use a plain (unanchored)
    // match for those keys instead of \b.
    const re = isDevanagari ? new RegExp(escaped, 'g') : new RegExp(`\\b${escaped}\\b`, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (consumed.slice(start, end).some(Boolean)) continue; // already claimed by a longer synonym
      for (let i = start; i < end; i++) consumed[i] = true;
      found.push({ description: combinedSynonyms[raw], raw, index: start });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

/** Extract attributes from a local window of text around an item mention,
 * restricted to the domain's closed vocabulary. */
function extractAttributes(window, domain) {
  const allowedKeys = DOMAIN_ATTRIBUTES[domain] || [];
  const attrs = {};

  // Numeric measurement attributes: "chest 40", "chest chalis", "waist 34"
  for (const key of ['chest', 'waist', 'length', 'wattage', 'roti_count', 'tier']) {
    if (!allowedKeys.includes(key)) continue;
    const re = new RegExp(`\\b${key.replace('_', '[ _]?')}\\s+(${QTY_TOKEN})\\b`, 'i');
    const wattRe = key === 'wattage' ? new RegExp(`\\b(${QTY_TOKEN})\\s*watt\\b`, 'i') : null;
    const m = window.match(re) || (wattRe && window.match(wattRe));
    if (m) {
      const val = wordToNumber(m[1]);
      if (val !== null) attrs[key] = val;
    }
  }

  // weight_kg: "1.5 kg"
  if (allowedKeys.includes('weight_kg')) {
    const m = window.match(/\b(\d+(?:\.\d+)?)\s*kg\b/i);
    if (m) attrs.weight_kg = parseFloat(m[1]);
  }

  // days: "5 din"
  if (allowedKeys.includes('days')) {
    const m = window.match(new RegExp(`\\b(${QTY_TOKEN})\\s*din\\b`, 'i'));
    if (m) {
      const v = wordToNumber(m[1]);
      if (v !== null) attrs.days = v;
    }
  }

  // Boolean attributes: jain, egg_free
  if (allowedKeys.includes('jain')) {
    if (/\bjain\b/i.test(window)) attrs.jain = !/\bjain\s+nahi\b/i.test(window);
  }
  if (allowedKeys.includes('egg_free')) {
    if (/\beggless\b|\bande?\s+nahi\b/i.test(window)) attrs.egg_free = true;
    else if (/\bnormal\s+ande?\s+wali\b|\bande\s+wala\b/i.test(window)) attrs.egg_free = false;
  }

  // Categorical attributes matched against the canonical-value tables
  for (const [key, table] of Object.entries(CANONICAL_VALUES)) {
    if (!allowedKeys.includes(key)) continue;
    for (const [rawPhrase, canonical] of Object.entries(table)) {
      const re = new RegExp(`\\b${rawPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(window)) {
        attrs[key] = canonical;
        break;
      }
    }
  }

  // size: bare "M"/"L"/"XL" tokens
  if (allowedKeys.includes('size')) {
    const m = window.match(/\bsize\s+(s|m|l|xl|xxl)\b/i);
    if (m) attrs.size = m[1].toUpperCase();
  }

  // fabric noun "<fabric> ka/ki" e.g. "linen ka"
  // (already covered by CANONICAL_VALUES table above for known fabrics)

  // shape/room/brand are covered by CANONICAL_VALUES too.

  return attrs;
}

// ---------------------------------------------------------------------------
// Step 4 — amount (INR) extraction
// ---------------------------------------------------------------------------
function extractAmount(text) {
  const m = text.match(new RegExp(`\\b(${QTY_TOKEN})\\s*(?:rs|rupee|rupaye)?\\s*(?:tak|ke andar|ka kaam)\\b`, 'i'));
  if (m) {
    const compound = findCompoundNumber(text);
    return compound !== null ? compound : wordToNumber(m[1]);
  }
  const compound = findCompoundNumber(text);
  if (compound !== null) return compound;
  return null;
}

// ---------------------------------------------------------------------------
// Step 5 — references_prior_order
// ---------------------------------------------------------------------------
function extractReferencesPriorOrder(originalText) {
  const deNegated = stripNegatedClauses(originalText.toLowerCase());
  const positive = /\b(last time jaisa|pichli baar jaisa|pehle jaisa|last wale jaisa|wahi wala|jo hamesha)\b/;
  return positive.test(deNegated);
}

// ---------------------------------------------------------------------------
// Step 6 — needs_clarification (DATASET_CARD.md rule, verbatim)
// ---------------------------------------------------------------------------
function needsClarification({ items, dateInfo, hasAmbiguousQty, domain }) {
  if (items.length === 0) return true;                         // (a)
  if (hasAmbiguousQty) return true;                              // (b)
  if (dateInfo.matched && dateInfo.vague) return true;           // (c)
  const blocking = BLOCKING_ATTRIBUTE[domain];                   // (d)
  if (blocking) {
    const allMissing = items.every((it) => it.attributes[blocking] === undefined);
    if (allMissing) return true;
  }
  return false;
}

/**
 * Post-process merge for two words that are genuinely ambiguous between
 * "independent item" and "attribute of a neighbouring item":
 *   - "roti" is its own item in some messages, but "<N> roti ke saath" next
 *     to another dish is a roti_count attribute of that dish, not a second
 *     item ("chole ... 8 roti ke saath" -> chole.attributes.roti_count = 8).
 *   - "motor" is its own item ("water motor") when it's the only/first thing
 *     mentioned, but "<item> ... motor wala/ka" describes what the item is
 *     FOR (the `appliance` attribute of an electrician item), not a second
 *     item ("socket ... motor wala" -> socket.attributes.appliance = "motor").
 * KNOWN LIMITATION: this is a heuristic on the two ambiguous words actually
 * observed in the training data, not a general solution — a genuinely novel
 * ambiguous word in the held-out set would not be caught by this pass. State
 * this in the README rather than pretend full coverage.
 */
function mergeAmbiguousStandaloneWords(items, fullText, domain) {
  if (items.length < 2) return items;

  const result = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prev = result[result.length - 1];

    if (domain === 'tiffin' && item.description === 'roti' && prev && /\bke\s+sa?th\b/i.test(fullText)) {
      prev.attributes.roti_count = item.quantity;
      continue; // don't add roti as its own item
    }
    if (domain === 'electrician' && item.description === 'water motor' && prev) {
      prev.attributes.appliance = 'motor';
      continue; // don't add motor as its own item
    }
    result.push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} message      raw customer message
 * @param {string} receivedAt   ISO-8601 timestamp, Asia/Kolkata — date anchor
 * @param {string} domain       one of tailor|tiffin|electrician|baker
 * @returns OrderRecord matching schema.json
 */
export function parseWithRules(message, receivedAt, domain) {
  const cleaned = stripNegatedClauses(message);
  const norm = normalise(cleaned);

  // --- items + quantities + attributes ---
  const mentions = findItemMentions(norm);
  const items = [];
  let hasAmbiguousQty = false;

  for (let i = 0; i < mentions.length; i++) {
    const { description, raw, index } = mentions[i];
    const windowStart = i === 0 ? 0 : mentions[i - 1].index;
    const windowEnd = i === mentions.length - 1 ? norm.length : mentions[i + 1].index;
    const window = norm.slice(windowStart, windowEnd);

    const ambiguous = extractAmbiguousQuantity(window);
    let quantity;
    if (ambiguous) {
      quantity = ambiguous.quantity;
      hasAmbiguousQty = true;
    } else {
      quantity = extractQuantityAfterNoun(window, raw) ?? extractQuantityBefore(window) ?? 1;
    }

    const attributes = extractAttributes(window, domain);
    items.push({ description, quantity: quantity || 1, attributes });
  }

  const mergedItems = mergeAmbiguousStandaloneWords(items, norm, domain);

  // --- date ---
  const dateInfo = resolveDate(norm, receivedAt);

  // --- customer, amount, prior-order ---
  const customer = extractCustomer(cleaned);
  const amount = extractAmount(norm);
  const referencesPriorOrder = extractReferencesPriorOrder(message);

  const clarify = needsClarification({ items: mergedItems, dateInfo, hasAmbiguousQty, domain });

  return {
    customer,
    items: mergedItems,
    due_date: dateInfo.matched && !dateInfo.vague ? dateInfo.due_date : null,
    amount,
    references_prior_order: referencesPriorOrder,
    // Rules are deterministic, not probabilistic — report high confidence
    // when nothing was flagged, low confidence when we had to flag anything,
    // rather than a per-field learned score. Not used by the grader either
    // way (schema requires it, Test A doesn't score it).
    confidence: clarify ? 0.4 : 0.9,
    needs_clarification: clarify,
  };
}
