/**
 * date-resolver.js
 * ----------------
 * Resolves relative/colloquial date phrases against `received_at`
 * (Asia/Kolkata), per DATASET_CARD.md section 4. Every rule here maps
 * directly to a row in that table — see the comment above each branch.
 *
 * CRITICAL: never resolve against the system clock. `received_at` is
 * supplied per-message and is the only valid anchor.
 */
import { devanagariToAscii, WEEKDAYS_HI, VAGUE_DEADLINE_PHRASES } from './lexicon.js';

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(anchor, n) {
  const d = new Date(anchor);
  d.setDate(d.getDate() + n);
  return d;
}

// `agle <weekday>` — strictly the NEXT occurrence, never +0 even if today IS that weekday.
function nextWeekday(anchor, targetDow) {
  const d = new Date(anchor);
  const currentDow = d.getDay();
  let delta = (targetDow - currentDow + 7) % 7;
  if (delta === 0) delta = 7; // strictly next, never today
  return addDays(anchor, delta);
}

// `is weekend` -> upcoming Saturday
function upcomingSaturday(anchor) {
  return nextWeekday(anchor, 6);
}

// `<N> tarikh/tareekh/ko` — Nth of current month if N >= today's date-of-month,
// else Nth of next month.
function nthOfMonth(anchor, n) {
  const d = new Date(anchor);
  const todayDom = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth(), n);
  if (n < todayDom) {
    target.setMonth(target.getMonth() + 1);
  }
  return target;
}

/**
 * Attempt to resolve a date phrase found in `text`, anchored at `receivedAt`
 * (ISO timestamp string). Returns { due_date: 'YYYY-MM-DD'|null, matched: bool,
 * vague: bool } — `vague` distinguishes "a deadline was referenced but
 * unresolvable" (needs_clarification: true) from "no deadline mentioned at
 * all" (needs_clarification stays false for this reason).
 */
export function resolveDate(text, receivedAt) {
  const anchor = new Date(receivedAt);
  const norm = devanagariToAscii(text.toLowerCase());

  // Try every resolvable pattern FIRST. This matters because of the
  // "urgency decoy" trap in the dataset: "jaldi chahiye, parso tak" DOES
  // resolve (parso = +2 days) even though "jaldi" also appears — checking
  // vague phrases first would wrongly flag this as unresolvable.

  // aaj / kal / parso / tarso(narsu) — +0/+1/+2/+3. `kal` ALWAYS means
  // tomorrow in this dataset (stated convention, not the natural ambiguity).
  if (/\bparso\b/.test(norm)) return ok(addDays(anchor, 2));
  if (/\b(tarso|narsu)\b/.test(norm)) return ok(addDays(anchor, 3));
  if (/\bkal\b/.test(norm)) return ok(addDays(anchor, 1));
  if (/\baaj\b/.test(norm)) return ok(addDays(anchor, 0));

  // is weekend
  if (/\bis\s+weekend\b/.test(norm)) return ok(upcomingSaturday(anchor));

  // agle hafte / next week (but "next week kabhi bhi" is a vague-deadline
  // phrase, checked below only if nothing here matches)
  if (/\b(agle\s+hafte|next\s+week)\b/.test(norm) && !/\bkabhi\s+bhi\b/.test(norm)) {
    return ok(addDays(anchor, 7));
  }

  // agle <weekday> / next <weekday>
  const weekdayMatch = norm.match(/\b(?:agle|agla|next)\s+([a-z]+)\b/);
  if (weekdayMatch && WEEKDAYS_HI[weekdayMatch[1]] !== undefined) {
    return ok(nextWeekday(anchor, WEEKDAYS_HI[weekdayMatch[1]]));
  }
  // "<weekday> ko" alone, when it's the only weekday mention (negation cases
  // like "somvar ko nahi, mangalvar ko" are handled by the caller stripping
  // the negated clause before this function runs)
  const bareWeekday = norm.match(/\b([a-z]+)\s+ko\b/);
  if (bareWeekday && WEEKDAYS_HI[bareWeekday[1]] !== undefined) {
    return ok(nextWeekday(anchor, WEEKDAYS_HI[bareWeekday[1]]));
  }

  // <N> din me -> +N days
  const dinMatch = norm.match(/\b(\d+)\s*din\s*me\b/);
  if (dinMatch) return ok(addDays(anchor, parseInt(dinMatch[1], 10)));

  // <N> tarikh/tareekh/ko (day-of-month)
  const tarikhMatch = norm.match(/\b(\d{1,2})\s*(tarikh|tareekh)\b/);
  if (tarikhMatch) return ok(nthOfMonth(anchor, parseInt(tarikhMatch[1], 10)));

  // Explicit calendar date: "5 September", "5 Sep", "18 Oct", "5/9"
  const months = { jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,
    jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11 };
  const explicitMatch = norm.match(/\b(\d{1,2})\s+([a-z]+)\b/);
  if (explicitMatch && months[explicitMatch[2]] !== undefined) {
    const day = parseInt(explicitMatch[1], 10);
    let year = anchor.getFullYear();
    const target = new Date(year, months[explicitMatch[2]], day);
    if (target < stripTime(anchor)) target.setFullYear(year + 1);
    return ok(target);
  }
  const slashMatch = norm.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1;
    let year = anchor.getFullYear();
    const target = new Date(year, month, day);
    if (target < stripTime(anchor)) target.setFullYear(year + 1);
    return ok(target);
  }

  // Nothing resolvable matched — NOW check whether a deadline was referenced
  // at all via a vague phrase (referenced-but-unresolvable -> needs_clarification
  // true) vs. never mentioned (-> stays false, handled by caller).
  for (const phrase of VAGUE_DEADLINE_PHRASES) {
    if (norm.includes(phrase)) {
      return { due_date: null, matched: true, vague: true };
    }
  }

  return { due_date: null, matched: false, vague: false };
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function ok(d) {
  return { due_date: toISODate(d), matched: true, vague: false };
}
