/* ═══════════════════════════════════════════════════════════════
   KaamFlow — Multi-Device Sync Simulation (js/sync.js)
   Simulates "2 devices at once" entirely in the browser.
   Implements 3 conflict scenarios from conflict_scenarios.md.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var PREFIX = 'kaamflow_';
  var MERGE_POLICY = 'Policy: Last-write-wins on scalars, tie-broken by device ID (deviceA < deviceB); deletions are tombstoned and surfaced in the activity log.';

  // ─── SCENARIO DEFINITIONS ───
  // Pre-built conflict scenarios for demo
  var SCENARIOS = {
    // Scenario 1: Disjoint field edits → auto-merge
    disjoint: {
      id: 'scenario-1',
      title: 'Disjoint Field Edits',
      description: 'Device A edits due_date, Device B edits amount. Should merge cleanly with no conflict.',
      orderId: 'ord-001',
      deviceA: {
        field: 'due_date',
        oldValue: '2026-08-29',
        newValue: '2026-09-01',
        editedAgo: '5 min ago',
      },
      deviceB: {
        field: 'amount',
        oldValue: 4500,
        newValue: 5000,
        editedAgo: '3 min ago',
      },
      autoMerge: true,
      conflictType: 'none',
    },

    // Scenario 2: Same-field concurrent edit → conflict!
    sameField: {
      id: 'scenario-2',
      title: 'Same-Field Concurrent Edit',
      description: 'Both devices edit items[0].quantity at the same time. Requires conflict resolution.',
      orderId: 'ord-001',
      deviceA: {
        field: 'items[0].quantity',
        displayField: 'Quantity (Kurta Pajama)',
        oldValue: 2,
        newValue: 3,
        editedAgo: '4 min ago',
      },
      deviceB: {
        field: 'items[0].quantity',
        displayField: 'Quantity (Kurta Pajama)',
        oldValue: 2,
        newValue: 5,
        editedAgo: '4 min ago',
      },
      autoMerge: false,
      conflictType: 'same_field',
      tieBreakWinner: 'deviceA', // lower device ID wins
      tieBreakPolicy: 'Device ID tiebreak (deviceA < deviceB)',
    },

    // Scenario 3: Delete vs. Update → conflict!
    deleteVsUpdate: {
      id: 'scenario-3',
      title: 'Delete vs. Update Conflict',
      description: 'Device A deletes an item, Device B edits attributes on the same item.',
      orderId: 'ord-007',
      deviceA: {
        action: 'delete',
        field: 'items[1]',
        displayField: 'Chocolate Brownies',
        description: 'Item deleted',
        editedAgo: '6 min ago',
      },
      deviceB: {
        action: 'update',
        field: 'items[1].attributes.flavour',
        displayField: 'Chocolate Brownies → flavour',
        oldValue: 'Dark Chocolate',
        newValue: 'Belgian Dark Chocolate',
        editedAgo: '2 min ago',
      },
      autoMerge: false,
      conflictType: 'delete_vs_update',
      tieBreakWinner: 'deviceB', // updates win over deletes by default
      tieBreakPolicy: 'Updates preserved over deletions; deleted items are tombstoned in activity log',
    },
  };

  // ─── STATE MANAGEMENT ───
  var _activeConflicts = [];
  var _mergedState = null;
  var _reconnectionOrder = null;
  var _scenarioResults = {};

  function _readSync(key) {
    try { var d = localStorage.getItem(key); return d ? JSON.parse(d) : null; }
    catch (e) { return null; }
  }
  function _writeSync(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.warn('Sync LS write fail', e); }
  }

  // ─── INITIALIZATION ───
  function initSyncDemo() {
    // Setup the scenarios in localStorage
    _writeSync(PREFIX + 'syncScenarios', SCENARIOS);
    _writeSync(PREFIX + 'activeConflicts', []);
    _writeSync(PREFIX + 'scenarioResults', {});

    // Apply scenario edits to device-specific data
    _applyScenarioEdits();
  }

  function _applyScenarioEdits() {
    // For Scenario 1 (disjoint): Apply different edits on each device
    var orderA = _readSync(PREFIX + 'deviceA_orders');
    var orderB = _readSync(PREFIX + 'deviceB_orders');

    if (orderA && orderB) {
      // Scenario 1: deviceA changed due_date, deviceB changed amount
      var idxA1 = orderA.findIndex(function(o) { return o.id === 'ord-001'; });
      var idxB1 = orderB.findIndex(function(o) { return o.id === 'ord-001'; });
      if (idxA1 >= 0) orderA[idxA1]._pendingEdit = { due_date: '2026-09-01', _editedAt: new Date(Date.now() - 300000).toISOString() };
      if (idxB1 >= 0) orderB[idxB1]._pendingEdit = { amount: 5000, _editedAt: new Date(Date.now() - 180000).toISOString() };

      _writeSync(PREFIX + 'deviceA_orders', orderA);
      _writeSync(PREFIX + 'deviceB_orders', orderB);
    }
  }

  // ─── CONFLICT DETECTION ───
  function detectConflict(deviceAEdits, deviceBEdits) {
    if (!deviceAEdits || !deviceBEdits) return { hasConflict: false };

    // Check if same fields were edited
    var aFields = Object.keys(deviceAEdits).filter(function(k) { return !k.startsWith('_'); });
    var bFields = Object.keys(deviceBEdits).filter(function(k) { return !k.startsWith('_'); });

    var overlapping = aFields.filter(function(f) { return bFields.indexOf(f) >= 0; });

    if (overlapping.length === 0) {
      // Disjoint → auto-merge
      return {
        hasConflict: false,
        mergedResult: Object.assign({}, deviceAEdits, deviceBEdits),
        type: 'disjoint',
      };
    }

    // Same fields edited → conflict
    var conflicts = overlapping.map(function(field) {
      return {
        field: field,
        deviceAValue: deviceAEdits[field],
        deviceBValue: deviceBEdits[field],
      };
    });

    return {
      hasConflict: true,
      conflicts: conflicts,
      type: 'same_field',
    };
  }

  // ─── SCENARIO RUNNERS ───
  function runScenario(scenarioKey, reconnectFirst) {
    var scenario = SCENARIOS[scenarioKey];
    if (!scenario) return null;

    var result = {
      scenario: scenario,
      reconnectFirst: reconnectFirst,
      timestamp: new Date().toISOString(),
      steps: [],
      finalState: null,
      conflictDetected: !scenario.autoMerge,
    };

    // Step 1: Reconnect first device
    result.steps.push({
      step: 1,
      action: 'Reconnecting ' + DataStore.DEVICE_INFO[reconnectFirst].name,
      device: reconnectFirst,
      status: 'synced',
    });

    // Step 2: Reconnect second device
    var secondDevice = reconnectFirst === 'deviceA' ? 'deviceB' : 'deviceA';
    result.steps.push({
      step: 2,
      action: 'Reconnecting ' + DataStore.DEVICE_INFO[secondDevice].name,
      device: secondDevice,
      status: 'synced',
    });

    // Step 3: Detect & resolve conflicts
    if (scenario.autoMerge) {
      // Disjoint: merge both
      result.steps.push({
        step: 3,
        action: 'Auto-merged: No conflicting fields',
        status: 'merged',
      });
      result.finalState = _computeMergedState(scenario, 'auto');
    } else {
      // Conflict: apply tie-break
      result.steps.push({
        step: 3,
        action: 'Conflict detected: ' + scenario.description,
        status: 'conflict',
      });
      result.steps.push({
        step: 4,
        action: 'Resolved via ' + scenario.tieBreakPolicy,
        winner: scenario.tieBreakWinner,
        loser: scenario.tieBreakWinner === 'deviceA' ? 'deviceB' : 'deviceA',
        status: 'resolved',
      });
      result.finalState = _computeMergedState(scenario, scenario.tieBreakWinner);

      // Add losing edit to activity log
      var loser = scenario.tieBreakWinner === 'deviceA' ? scenario.deviceB : scenario.deviceA;
      DataStore.addToActivityLog({
        type: 'conflict_resolution',
        scenario: scenarioKey,
        orderId: scenario.orderId,
        description: 'Conflict resolved: ' + (scenario.tieBreakPolicy),
        winningDevice: DataStore.DEVICE_INFO[scenario.tieBreakWinner].name,
        losingEdit: {
          device: DataStore.DEVICE_INFO[scenario.tieBreakWinner === 'deviceA' ? 'deviceB' : 'deviceA'].name,
          field: loser.displayField || loser.field,
          value: loser.newValue || loser.description,
          action: loser.action || 'update',
        },
      });
    }

    // Store result
    var results = _readSync(PREFIX + 'scenarioResults') || {};
    results[scenarioKey] = result;
    _writeSync(PREFIX + 'scenarioResults', results);
    _scenarioResults[scenarioKey] = result;

    return result;
  }

  function _computeMergedState(scenario, winner) {
    var base = DataStore.getOrder(scenario.orderId) || {};
    var merged = JSON.parse(JSON.stringify(base));

    if (scenario.autoMerge || winner === 'auto') {
      // Apply both device changes
      if (scenario.deviceA.field && !scenario.deviceA.action) {
        _setNestedField(merged, scenario.deviceA.field, scenario.deviceA.newValue);
      }
      if (scenario.deviceB.field && !scenario.deviceB.action) {
        _setNestedField(merged, scenario.deviceB.field, scenario.deviceB.newValue);
      }
    } else if (scenario.conflictType === 'same_field') {
      // Apply winner's value
      var winnerData = winner === 'deviceA' ? scenario.deviceA : scenario.deviceB;
      _setNestedField(merged, winnerData.field, winnerData.newValue);
    } else if (scenario.conflictType === 'delete_vs_update') {
      if (winner === 'deviceA') {
        // Delete wins
        if (merged.items && merged.items.length > 1) {
          merged._tombstoned = merged.items[1];
          merged.items.splice(1, 1);
        }
      } else {
        // Update wins, item kept with new attributes
        if (merged.items && merged.items.length > 1) {
          _setNestedField(merged, scenario.deviceB.field, scenario.deviceB.newValue);
        }
      }
    }

    merged._lastMerged = new Date().toISOString();
    merged._mergePolicy = winner === 'auto' ? 'Auto-merged (disjoint)' : MERGE_POLICY;

    return merged;
  }

  function _setNestedField(obj, path, value) {
    var parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      if (!isNaN(key)) key = parseInt(key);
      if (current[key] === undefined) return;
      current = current[key];
    }
    var lastKey = parts[parts.length - 1];
    if (!isNaN(lastKey)) lastKey = parseInt(lastKey);
    current[lastKey] = value;
  }

  // ─── GETTERS ───
  function getScenarios() { return SCENARIOS; }
  function getScenario(key) { return SCENARIOS[key] || null; }
  function getScenarioResult(key) {
    return _scenarioResults[key] || (_readSync(PREFIX + 'scenarioResults') || {})[key] || null;
  }
  function getAllScenarioResults() {
    return _scenarioResults || _readSync(PREFIX + 'scenarioResults') || {};
  }
  function getMergePolicy() { return MERGE_POLICY; }

  function getActiveConflicts() {
    // Return scenarios that haven't been resolved yet
    var results = _readSync(PREFIX + 'scenarioResults') || {};
    return Object.keys(SCENARIOS).filter(function(key) {
      return !SCENARIOS[key].autoMerge && !results[key];
    }).map(function(key) {
      return SCENARIOS[key];
    });
  }

  function resetScenarios() {
    _scenarioResults = {};
    _writeSync(PREFIX + 'scenarioResults', {});
    // Re-apply scenario edits
    _applyScenarioEdits();
  }

  // ─── EXPORT ───
  window.SyncManager = {
    init:               initSyncDemo,
    detectConflict:     detectConflict,
    runScenario:        runScenario,
    getScenarios:       getScenarios,
    getScenario:        getScenario,
    getScenarioResult:  getScenarioResult,
    getAllScenarioResults: getAllScenarioResults,
    getActiveConflicts: getActiveConflicts,
    getMergePolicy:     getMergePolicy,
    resetScenarios:     resetScenarios,
    SCENARIOS:          SCENARIOS,
    MERGE_POLICY:       MERGE_POLICY,
  };

  // Auto-init
  initSyncDemo();
})();
