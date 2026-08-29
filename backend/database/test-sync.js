/**
 * test-sync.js
 * ------------
 * Determinism tests for sync-service.js, implementing all three scenarios
 * from conflict_scenarios.md. For each scenario:
 *   1. Simulate Device A's edits and Device B's edits from the shared base
 *   2. Run reconcileOrder(A, B, base) and reconcileOrder(B, A, base)
 *   3. Assert the two results are deeply equal (determinism)
 *   4. Assert no edits were silently lost (check conflict_log where applicable)
 *
 * Usage: node test-sync.js
 */
import { reconcileOrder } from './sync-service.js';

// ---------------------------------------------------------------------------
// Initial state (shared across all three scenarios, from conflict_scenarios.md)
// ---------------------------------------------------------------------------
const BASE_ORDER = {
  order_id: 'ORD-1042',
  customer: 'Meena aunty',
  items: [
    {
      item_id: 'it-1',
      description: 'kurta',
      quantity: 2,
      attributes: { color: 'navy blue', chest: 40 },
    },
    {
      item_id: 'it-2',
      description: 'pajama',
      quantity: 1,
      attributes: { color: 'cream', waist: 34 },
    },
  ],
  due_date: '2026-09-05',
  amount: 1200,
  references_prior_order: false,
  confidence: 1.0,
  needs_clarification: false,
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Deep equality check (JSON-based, sufficient for plain objects). */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ===========================================================================
// Scenario 1 — Disjoint field edits
// ===========================================================================
console.log('\n═══ Scenario 1 — Disjoint field edits ═══');
{
  // Device A edits due_date at 10:12
  const stateA = deepClone(BASE_ORDER);
  stateA.due_date = '2026-09-08';
  stateA.last_modified = '2026-09-01T10:12:00+05:30';
  stateA.device_id = 'device-A';

  // Device B edits amount at 10:15
  const stateB = deepClone(BASE_ORDER);
  stateB.amount = 1500;
  stateB.last_modified = '2026-09-01T10:15:00+05:30';
  stateB.device_id = 'device-B';

  // Reconnect A first, then B
  const mergedAB = reconcileOrder(stateA, stateB, deepClone(BASE_ORDER));
  // Reconnect B first, then A
  const mergedBA = reconcileOrder(stateB, stateA, deepClone(BASE_ORDER));

  // Strip resolved_at from conflict_log for determinism comparison
  // (resolved_at uses Date.now() which differs between calls)
  const stripTimestamps = (order) => {
    const o = deepClone(order);
    if (o.conflict_log) {
      o.conflict_log = o.conflict_log.map(({ resolved_at, ...rest }) => rest);
    }
    return o;
  };

  const abClean = stripTimestamps(mergedAB);
  const baClean = stripTimestamps(mergedBA);

  // Determinism check
  assert(deepEqual(abClean, baClean),
    'Scenario 1: A→B and B→A produce different results');

  // Both edits survive
  assert(mergedAB.due_date === '2026-09-08',
    `Scenario 1: due_date should be 2026-09-08, got ${mergedAB.due_date}`);
  assert(mergedAB.amount === 1500,
    `Scenario 1: amount should be 1500, got ${mergedAB.amount}`);

  // No conflicts (edits were disjoint)
  assert(mergedAB.conflict_log.length === 0,
    `Scenario 1: expected no conflicts, got ${mergedAB.conflict_log.length}`);

  console.log(`  due_date = ${mergedAB.due_date}, amount = ${mergedAB.amount}`);
  console.log(`  conflicts: ${mergedAB.conflict_log.length} (expected 0)`);
  console.log('  ✓ Scenario 1 — disjoint edits both survive, deterministic');
}

// ===========================================================================
// Scenario 2 — Concurrent edit to the same field, identical timestamp
// ===========================================================================
console.log('\n═══ Scenario 2 — Same field, identical timestamp ═══');
{
  // Device A sets items[it-1].quantity to 3 at 11:03
  const stateA = deepClone(BASE_ORDER);
  stateA.items[0].quantity = 3;  // it-1
  stateA.last_modified = '2026-09-01T11:03:00+05:30';
  stateA.device_id = 'device-A';

  // Device B sets items[it-1].quantity to 5 at 11:03 (SAME timestamp)
  const stateB = deepClone(BASE_ORDER);
  stateB.items[0].quantity = 5;  // it-1
  stateB.last_modified = '2026-09-01T11:03:00+05:30';
  stateB.device_id = 'device-B';

  const mergedAB = reconcileOrder(stateA, stateB, deepClone(BASE_ORDER));
  const mergedBA = reconcileOrder(stateB, stateA, deepClone(BASE_ORDER));

  const stripTimestamps = (order) => {
    const o = deepClone(order);
    if (o.conflict_log) {
      o.conflict_log = o.conflict_log.map(({ resolved_at, ...rest }) => rest);
    }
    return o;
  };

  const abClean = stripTimestamps(mergedAB);
  const baClean = stripTimestamps(mergedBA);

  // Determinism check
  assert(deepEqual(abClean, baClean),
    'Scenario 2: A→B and B→A produce different results');

  // The winner should be device-B (lexicographically higher device_id)
  const winnerQty = mergedAB.items.find((it) => it.item_id === 'it-1').quantity;
  assert(winnerQty === 5,
    `Scenario 2: quantity should be 5 (device-B wins tiebreak), got ${winnerQty}`);

  // The losing edit must be surfaced in conflict_log
  assert(mergedAB.conflict_log.length > 0,
    'Scenario 2: expected conflict_log entries, got none');
  const conflict = mergedAB.conflict_log.find(
    (c) => c.type === 'field_conflict' && c.field === 'quantity',
  );
  assert(conflict !== undefined,
    'Scenario 2: no quantity conflict in conflict_log');
  assert(conflict && conflict.loser_value === 3,
    `Scenario 2: loser_value should be 3, got ${conflict?.loser_value}`);
  assert(conflict && conflict.resolution === 'device_id_tiebreak',
    `Scenario 2: resolution should be device_id_tiebreak, got ${conflict?.resolution}`);

  console.log(`  quantity = ${winnerQty} (device-B wins by device_id tiebreak)`);
  console.log(`  conflict_log: ${mergedAB.conflict_log.length} entry(ies)`);
  console.log(`  loser_value = ${conflict?.loser_value}, resolution = ${conflict?.resolution}`);
  console.log('  ✓ Scenario 2 — tiebreak deterministic, losing edit surfaced');
}

// ===========================================================================
// Scenario 3 — Delete vs. update
// ===========================================================================
console.log('\n═══ Scenario 3 — Delete vs. update ═══');
{
  // Device A deletes items[it-2] at 14:20
  const stateA = deepClone(BASE_ORDER);
  stateA.items = stateA.items.filter((it) => it.item_id !== 'it-2');
  stateA.last_modified = '2026-09-01T14:20:00+05:30';
  stateA.device_id = 'device-A';

  // Device B edits items[it-2] at 14:22 and 14:23
  const stateB = deepClone(BASE_ORDER);
  const it2 = stateB.items.find((it) => it.item_id === 'it-2');
  it2.attributes.color = 'black';  // 14:22 edit
  it2.quantity = 4;                  // 14:23 edit
  stateB.last_modified = '2026-09-01T14:23:00+05:30';
  stateB.device_id = 'device-B';

  const mergedAB = reconcileOrder(stateA, stateB, deepClone(BASE_ORDER));
  const mergedBA = reconcileOrder(stateB, stateA, deepClone(BASE_ORDER));

  const stripTimestamps = (order) => {
    const o = deepClone(order);
    if (o.conflict_log) {
      o.conflict_log = o.conflict_log.map(({ resolved_at, ...rest }) => rest);
    }
    return o;
  };

  const abClean = stripTimestamps(mergedAB);
  const baClean = stripTimestamps(mergedBA);

  // Determinism check
  assert(deepEqual(abClean, baClean),
    'Scenario 3: A→B and B→A produce different results');

  // Item it-2 should NOT be in the merged items (delete wins)
  const hasIt2 = mergedAB.items.some((it) => it.item_id === 'it-2');
  assert(!hasIt2,
    'Scenario 3: item it-2 should be deleted (tombstoned), but it survived');

  // Item it-1 should still be there (untouched)
  const hasIt1 = mergedAB.items.some((it) => it.item_id === 'it-1');
  assert(hasIt1,
    'Scenario 3: item it-1 should still exist');

  // The discarded edits must be surfaced in conflict_log
  const deleteConflict = mergedAB.conflict_log.find(
    (c) => c.type === 'delete_vs_update' && c.item_id === 'it-2',
  );
  assert(deleteConflict !== undefined,
    'Scenario 3: no delete_vs_update conflict in conflict_log');
  assert(deleteConflict && deleteConflict.resolution === 'delete_wins_tombstoned',
    `Scenario 3: resolution should be delete_wins_tombstoned, got ${deleteConflict?.resolution}`);
  assert(deleteConflict && deleteConflict.discarded_edits !== undefined,
    'Scenario 3: discarded_edits should be present in conflict_log');

  // Verify the discarded edits contain B's changes
  if (deleteConflict?.discarded_edits) {
    assert(deleteConflict.discarded_edits.attributes.color === 'black',
      `Scenario 3: discarded color should be 'black', got ${deleteConflict.discarded_edits.attributes.color}`);
    assert(deleteConflict.discarded_edits.quantity === 4,
      `Scenario 3: discarded quantity should be 4, got ${deleteConflict.discarded_edits.quantity}`);
  }

  console.log(`  item it-2 in merged items: ${hasIt2} (expected false — delete wins)`);
  console.log(`  conflict_log: ${mergedAB.conflict_log.length} entry(ies)`);
  console.log(`  discarded edits: color=${deleteConflict?.discarded_edits?.attributes?.color}, qty=${deleteConflict?.discarded_edits?.quantity}`);
  console.log('  ✓ Scenario 3 — delete tombstoned, discarded edits surfaced, deterministic');
}

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n═══════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('  ✅ ALL SCENARIOS PASS — sync layer is deterministic');
} else {
  console.log('  ❌ SOME SCENARIOS FAILED — review output above');
  process.exit(1);
}
console.log('═══════════════════════════════════════════\n');
