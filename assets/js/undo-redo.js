// undo-redo.js — DigiPRO undo/redo system (UI-agnostic; no DOM references except optional callbacks)
// This module provides:
//  - Editor (per-wave) undo/redo via snapshots
//  - Bank (slot library) undo/redo via action diffs {before, after}
//
// Notes:
//  * Bank history entries are expected to be pushed as { label, before, after } where
//    before/after are produced by captureBankState(targetSlots, opts).
//  * captureBankState snapshots the true bank (LIB.waves) and separately snapshots the
//    editor buffer + dirty set so bank undo/redo never "bakes in" unsaved edits.
(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  // Optional host wiring (ui.js) can provide state + repaint callbacks via DP_Undo.init(getState, opts, onChange).
  // If not provided, this module falls back to globals like window.digiWaveLibrary / window.__digipro_EDIT.
  let _getState = null;
  let _onChange = null;

  function getState(){
    try{ return (_getState && _getState()) || null; }catch(_){ return null; }
  }

  function notifyChange(info){
    // Call wired callback first
    try{ if (typeof _onChange === 'function') _onChange(info); }catch(_){ }
    // Then any legacy/global listener
    try{ if (typeof root.__digiproUndoOnChange === 'function') root.__digiproUndoOnChange(info); }catch(_){ }
  }

  function dpUndoInit(getStateFn, _opts, onChangeFn){
    _getState = (typeof getStateFn === 'function') ? getStateFn : null;
    _onChange = (typeof onChangeFn === 'function') ? onChangeFn : null;
    // Prime legacy globals for callers that still look for them
    try{
      const st = getState();
      if (st){
        if (st.LIB) root.digiWaveLibrary = st.LIB;
        if (st.EDIT) root.__digipro_EDIT = st.EDIT;
        if (st.SELECTED) root.__digipro_SELECTED = st.SELECTED;
      }
    }catch(_){ }
    return true;
  }


  // ----------------------------- helpers -----------------------------

  function sanitizeName4(s){
    return String(s || 'WAVE')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g,'')
      .padEnd(4,'X')
      .slice(0,4);
  }

  function deepCloneAny(x){
    if (x === null || x === undefined) return x;
    if (typeof x !== 'object') return x;

    // Typed arrays / ArrayBuffer views (Uint8Array, Int16Array, Float32Array, etc.)
    if (ArrayBuffer.isView(x) && !(x instanceof DataView)){
      try{
        // eslint-disable-next-line new-cap
        const y = new x.constructor(x);

        // Preserve known custom props used around the app.
        try{ if (x && x.displayRot !== undefined) y.displayRot = x.displayRot|0; }catch(_){ }
        try{ if (x && x._sr !== undefined) y._sr = x._sr; }catch(_){ }

        // For small arrays, copy any additional custom enumerable props without
        // accidentally enumerating huge index-key lists (perf/memory guard).
        const n = (typeof x.length === 'number') ? (x.length|0) : 0;
        if (n > 0 && n <= 2048){
          try{
            for (const k of Object.keys(x)){
              if (k === 'displayRot' || k === '_sr') continue;
              // Skip numeric indices (typed arrays can expose them as enumerable keys).
              if (/^(?:0|[1-9]\d*)$/.test(k)) continue;
              try{ y[k] = deepCloneAny(x[k]); }catch(_){ }
            }
          }catch(_){ }
        }
        return y;
      }catch(_){}
    }
    if (x instanceof ArrayBuffer){
      try{ return x.slice(0); }catch(_){ return x; }
    }

    if (Array.isArray(x)) return x.map(deepCloneAny);

    if (x instanceof Set){
      const y = new Set();
      for (const v of x) y.add(deepCloneAny(v));
      return y;
    }
    if (x instanceof Map){
      const y = new Map();
      for (const [k,v] of x) y.set(deepCloneAny(k), deepCloneAny(v));
      return y;
    }

    const y = {};
    for (const k of Object.keys(x)) y[k] = deepCloneAny(x[k]);
    return y;
  }

  function getCurrentLibrary(){
    const st = getState();
    if (st && st.LIB) return st.LIB;
    return root.digiWaveLibrary || (root.digiWaveLibrary = {
      waves: Array.from({length:64}, ()=>null),
      dirty: new Set()
    });
  }
  function getCurrentEditor(){
    const st = getState();
    return (st && st.EDIT) ? st.EDIT : (root.__digipro_EDIT || null);
  }
  function getCurrentSelection(){
    const st = getState();
    return (st && st.SELECTED) ? st.SELECTED : (root.__digipro_SELECTED || null);
  }
  function getCurrentSelectAnchor(){
    const st = getState();
    if (st && typeof st.getSelectAnchor === 'function') return st.getSelectAnchor();
    return root.__digipro_SELECT_ANCHOR;
  }
  function setCurrentSelectAnchor(v){
    const st = getState();
    if (st && typeof st.setSelectAnchor === 'function'){ try{ st.setSelectAnchor(v); }catch(_){ } return; }
    root.__digipro_SELECT_ANCHOR = v;
  }
  function getActiveIdx(){
    const st = getState();
    if (st && typeof st.getActiveIdx === 'function'){ try{ return st.getActiveIdx()|0; }catch(_){ } }
    return (typeof root.__digiproActiveIdx === 'number') ? (root.__digiproActiveIdx|0) : 0;
  }
  function setActiveIdx(v){
    const st = getState();
    if (st && typeof st.setActiveIdx === 'function'){ try{ st.setActiveIdx(v|0); }catch(_){ } return; }
    if (typeof root.__digiproSetActiveIdx === 'function') root.__digiproSetActiveIdx(v|0);
    else root.__digiproActiveIdx = v|0;
  }

  function prepareForHistoryNavigation(info){
    try{
      if (typeof root.__digiproBeforeUndoRedo === 'function'){
        root.__digiproBeforeUndoRedo(info || null);
      }
    }catch(_){ }
  }

  // ----------------------------- editor history -----------------------------

  const UNDO = {
    stack: [],
    index: -1,
    limit: 200
  };

  // Bank history is an action list: each entry is { label, before, after }
  const BANK = {
    stack: [],
    index: -1,
    limit: 100
  };

  // For global undo/redo routing.
  let LAST_ACTION_DOMAIN = 'editor'; // 'editor' | 'bank'
  let LAST_UNDO_DOMAIN   = 'editor'; // last domain that actually undid/redid

  function truncateEditorRedoTail(){
    if (UNDO.index < UNDO.stack.length - 1){
      UNDO.stack = UNDO.stack.slice(0, UNDO.index + 1);
    }
  }

  function truncateBankRedoTail(){
    if (BANK.index < BANK.stack.length - 1){
      BANK.stack = BANK.stack.slice(0, BANK.index + 1);
    }
  }

  function initUndo(){
    UNDO.stack = [];
    UNDO.index = -1;
    snapshot('baseline', { force:true, preserveBankRedo:true });
  }

  function snapshot(label, opts){
    opts = opts || {};
    const force = !!opts.force;

    const EDIT = getCurrentEditor();
    if (!EDIT || !EDIT.dataU8) return;

    // Only record when data changes unless forced.
    const cur = EDIT.dataU8;
    const prev = (UNDO.index >= 0 && UNDO.stack[UNDO.index]) ? UNDO.stack[UNDO.index].dataU8 : null;

    if (!force && prev && prev.length === cur.length){
      let same = true;
      for (let i=0;i<cur.length;i++){
        if (cur[i] !== prev[i]){ same=false; break; }
      }
      if (same) return;
    }

    // Truncate redo tail, then push.
    truncateEditorRedoTail();
    // A new editor mutation supersedes any previously-undone bank action.
    if (!opts.preserveBankRedo) truncateBankRedoTail();

    UNDO.stack.push({
      label: String(label || ''),
      slot: EDIT.slot|0,
      name: String(EDIT.name || 'WAVE'),
	      _dpHeat: (typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1,
      dataU8: (function(){ const u = new Uint8Array(cur); try{ if (cur && cur.displayRot !== undefined) u.displayRot = cur.displayRot|0; }catch(_){ } return u; })(),
      ts: Date.now()
    });

    // Enforce limit.
    if (UNDO.stack.length > UNDO.limit){
      const drop = UNDO.stack.length - UNDO.limit;
      UNDO.stack.splice(0, drop);
      UNDO.index = Math.max(-1, UNDO.index - drop);
    }

    UNDO.index = UNDO.stack.length - 1;
    LAST_ACTION_DOMAIN = 'editor';

    notifyChange({ domain:'editor', op:'snapshot', label: String(label||''), slot: EDIT.slot|0 });
  }

  function canUndo(){ return UNDO.index > 0; }
  function canRedo(){ return UNDO.index >= 0 && UNDO.index < UNDO.stack.length - 1; }

  function restoreFromHistory(entry, op){
    const EDIT = getCurrentEditor();
    if (!EDIT) return;
    EDIT.slot = entry.slot|0;
    EDIT.name = entry.name;
	    EDIT._dpHeat = (typeof entry._dpHeat === 'number' && isFinite(entry._dpHeat) && entry._dpHeat > 0) ? entry._dpHeat : 1;

    {
      const u = new Uint8Array(entry.dataU8);
      try{ if (entry.dataU8 && entry.dataU8.displayRot !== undefined) u.displayRot = entry.dataU8.displayRot|0; }catch(_){ }
      EDIT.dataU8 = u;
    }

    // Try to sync the name input (if present).
    try{
      const nameIn = root.__digipro_nameIn;
      if (nameIn) nameIn.value = entry.name;
    }catch(_){}

    // Repaint editor + slot thumbnail (best-effort).
    try{ if (typeof root.__digipro_paintEditor === 'function') root.__digipro_paintEditor(); }catch(_){}
    try{
      if (typeof root.__digipro_paintGridCell === 'function'){
        root.__digipro_paintGridCell(entry.slot|0);
      }
    }catch(_){}

    LAST_UNDO_DOMAIN = 'editor';
    notifyChange({ domain:'editor', op: (op || 'restore'), label: entry.label, slot: entry.slot|0 });
  }

  function undo(){
    if (!canUndo()) return;
    UNDO.index--;
    const entry = UNDO.stack[UNDO.index];
    restoreFromHistory(entry, 'undo');
  }

  function redo(){
    if (!canRedo()) return;
    UNDO.index++;
    const entry = UNDO.stack[UNDO.index];
    restoreFromHistory(entry, 'redo');
  }

  // ----------------------------- bank state capture/apply -----------------------------

  function captureBankState(targetSlots, opts){
    opts = opts || {};
    const LIB = getCurrentLibrary();
    const EDIT = getCurrentEditor();
    const SELECTED = getCurrentSelection();
    const selectAnchor = getCurrentSelectAnchor();
    const activeIdx = getActiveIdx();

    const touched = Array.from(targetSlots || []).map(n=>n|0).filter(n=>n>=0 && n<64);
    const st = {
      touched,
      waves: {},              // map slot->waveRec|null
      dirty: new Set(),       // dirty slots (editor dirty flags)
      selected: new Set(Array.from(SELECTED || [])),
      selectAnchor: (selectAnchor === null || selectAnchor === undefined) ? null : (selectAnchor|0),
      activeIdx: activeIdx|0,
      editor: null,
      simpleMode: undefined
    };

    // Capture current editor buffer too (even if not one of the touched slots) so undo can be deterministic.
    if (EDIT && EDIT.dataU8 && opts.includeEditor !== false){
      const nm = sanitizeName4(
        (root.__digipro_nameIn && root.__digipro_nameIn.value) ? root.__digipro_nameIn.value : EDIT.name
      );
      st.editor = {
        slot: EDIT.slot|0,
        name: nm,
        _dpHeat: (typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1,
        dataU8: (function(){
          const u = new Uint8Array(EDIT.dataU8);
          try{
            const rot = EDIT.dataU8 && EDIT.dataU8.displayRot;
            if (rot !== undefined) u.displayRot = rot|0;
          }catch(_){ }
          return u;
        })()
      };
    }

    if (opts.includeSimpleMode){
      try{
        if (typeof root.__digiproCaptureSimpleModeState === 'function'){
          st.simpleMode = deepCloneAny(root.__digiproCaptureSimpleModeState());
        } else if (root.__digiproSimpleModeState && typeof root.__digiproSimpleModeState === 'object'){
          st.simpleMode = deepCloneAny(root.__digiproSimpleModeState);
        }
      }catch(_){ }
    }

    // Dirty set
    if (LIB && LIB.dirty && typeof LIB.dirty.forEach === 'function'){
      LIB.dirty.forEach(i => st.dirty.add(i|0));
    }

    // Bank snapshot: always reflect the true library (LIB.waves).
    // Any unsaved edits remain represented by st.editor + st.dirty, so bank undo/redo
    // does not "bake in" dirty editor state and discard semantics remain correct.
    for (const idx of touched){
      st.waves[idx] = deepCloneAny(LIB.waves[idx] || null);
    }

    return st;
  }

  function applyBankState(state, info){
    if (!state || !state.touched) return;
    const LIB = getCurrentLibrary();

    const SELECTED = getCurrentSelection();
    const oldSelected = SELECTED ? new Set(Array.from(SELECTED).map(n=>n|0)) : new Set();
    const oldActive = getActiveIdx();

    const EDIT = getCurrentEditor();
    const oldEditorSlot = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : null;

    // Restore wave records for touched slots.
    const touched = Array.from(state.touched || []).map(n=>n|0).filter(n=>n>=0 && n<64);
    for (const idx of touched){
      LIB.waves[idx] = deepCloneAny(state.waves ? (state.waves[idx] || null) : null);
    }

    // Restore dirty set.
    LIB.dirty = new Set();
    if (state.dirty && typeof state.dirty.forEach === 'function'){
      state.dirty.forEach(i => LIB.dirty.add(i|0));
    }

    // Restore selection.
    if (SELECTED){
      SELECTED.clear();
      const src = state.selected;
      if (src){
        if (src instanceof Set){
          src.forEach(i => SELECTED.add(i|0));
        } else if (Array.isArray(src)){
          src.forEach(i => SELECTED.add(i|0));
        }
      }
    }
    setCurrentSelectAnchor((state.selectAnchor === null || state.selectAnchor === undefined) ? null : (state.selectAnchor|0));

    // Restore active idx.
    setActiveIdx(state.activeIdx|0);
    const newActive = getActiveIdx();

    const newSelected = SELECTED ? new Set(Array.from(SELECTED).map(n=>n|0)) : new Set();

    // Restore editor buffer if provided.
    let newEditorSlot = oldEditorSlot;
    if (EDIT && state.editor && state.editor.dataU8){
      EDIT.slot = state.editor.slot|0;
      EDIT.name = sanitizeName4(state.editor.name || 'WAVE');
		      EDIT._dpHeat = (typeof state.editor._dpHeat === 'number' && isFinite(state.editor._dpHeat) && state.editor._dpHeat > 0) ? state.editor._dpHeat : 1;
      {
        const u = new Uint8Array(state.editor.dataU8);
        try{ if (state.editor.dataU8.displayRot !== undefined) u.displayRot = state.editor.dataU8.displayRot|0; }catch(_){ }
        EDIT.dataU8 = u;
      }

      newEditorSlot = EDIT.slot|0;

      try{
        const nameIn = root.__digipro_nameIn;
        if (nameIn) nameIn.value = EDIT.name;
      }catch(_){}

      // Reset editor undo baseline to the restored buffer.
      try{ initUndo(); }catch(_){}
    }

    if (Object.prototype.hasOwnProperty.call(state, 'simpleMode')){
      try{
        if (typeof root.__digiproApplySimpleModeState === 'function'){
          root.__digiproApplySimpleModeState(deepCloneAny(state.simpleMode), { fromHistory:true });
        } else if (state.simpleMode && typeof state.simpleMode === 'object'){
          root.__digiproSimpleModeState = deepCloneAny(state.simpleMode);
        }
      }catch(_){ }
    }

    // Repaint: touched slots + any slots whose selection/active state changed.
    try{
      const repaintSlot = root.__digipro_paintGridCell;
      const ensureActive = root.__digipro_ensureActiveHighlight;
      if (typeof repaintSlot === 'function'){
        const toPaint = new Set();
        touched.forEach(i=>toPaint.add(i|0));
        oldSelected.forEach(i=>toPaint.add(i|0));
        newSelected.forEach(i=>toPaint.add(i|0));
        toPaint.add(oldActive|0);
        toPaint.add(newActive|0);
        if (oldEditorSlot !== null) toPaint.add(oldEditorSlot|0);
        if (newEditorSlot !== null) toPaint.add(newEditorSlot|0);

        toPaint.forEach(i=>{
          if (i>=0 && i<64) repaintSlot(i|0);
        });
      }
      if (typeof ensureActive === 'function') ensureActive();
    }catch(_){}

    try{ if (typeof root.__digipro_paintEditor === 'function') root.__digipro_paintEditor(); }catch(_){}
    try{ if (typeof root.__digipro_updateButtonsState === 'function') root.__digipro_updateButtonsState(); }catch(_){}

    LAST_ACTION_DOMAIN = 'bank';
    LAST_UNDO_DOMAIN = 'bank';
    const payload = { domain:'bank', touched: touched.slice() };
    if (info){
      try{ if (info.label != null) payload.label = String(info.label); }catch(_){ }
      try{ if (info.op != null) payload.op = String(info.op); }catch(_){ }
    }
    notifyChange(payload);
  }

  // ----------------------------- bank action history -----------------------------

  function bankCanUndo(){ return BANK.index >= 0; }
  function bankCanRedo(){ return BANK.index < (BANK.stack.length - 1); }

  function bankPush(entry){
    if (!entry) return;

    let action = null;

    // Preferred shape: {label, before, after}
    if (entry.before && entry.after){
      action = {
        label: String(entry.label || ''),
        before: deepCloneAny(entry.before),
        after: deepCloneAny(entry.after),
        preserveSimpleModeSources: !!entry.preserveSimpleModeSources,
        ts: Date.now()
      };
    } else if (entry.touched){
      // Back-compat / safety: treat as a no-op action.
      action = {
        label: String(entry.label || ''),
        before: deepCloneAny(entry),
        after: deepCloneAny(entry),
        preserveSimpleModeSources: !!entry.preserveSimpleModeSources,
        ts: Date.now()
      };
    } else {
      return;
    }

    // Truncate redo tail.
    truncateBankRedoTail();
    // A new bank mutation supersedes any previously-undone editor action.
    truncateEditorRedoTail();

    BANK.stack.push(action);

    // Enforce limit.
    if (BANK.stack.length > BANK.limit){
      const drop = BANK.stack.length - BANK.limit;
      BANK.stack.splice(0, drop);
      BANK.index = Math.max(-1, BANK.index - drop);
    }

    BANK.index = BANK.stack.length - 1;
    LAST_ACTION_DOMAIN = 'bank';

    const touched = Array.from(new Set([
      ...((action.before && Array.isArray(action.before.touched)) ? action.before.touched : []),
      ...((action.after && Array.isArray(action.after.touched)) ? action.after.touched : [])
    ])).map(n => n|0).filter(n => n >= 0 && n < 64);

    notifyChange({
      domain:'bank',
      op:'push',
      label: action.label,
      touched,
      preserveSimpleModeSources: !!action.preserveSimpleModeSources
    });
  }

  function bankUndo(){
    if (!bankCanUndo()) return false;

    const entry = BANK.stack[BANK.index];
    BANK.index--;
    applyBankState(entry.before, { op:'undo', label: entry.label });
    return true;
  }

  function bankRedo(){
    if (!bankCanRedo()) return false;

    BANK.index++;
    const entry = BANK.stack[BANK.index];
    applyBankState(entry.after, { op:'redo', label: entry.label });
    return true;
  }

  // ----------------------------- global routing -----------------------------

  function canUndoAny(){ return canUndo() || bankCanUndo(); }
  function canRedoAny(){ return canRedo() || bankCanRedo(); }

  function undoAny(){
    prepareForHistoryNavigation({ dir:'undo', lastActionDomain: LAST_ACTION_DOMAIN, lastUndoDomain: LAST_UNDO_DOMAIN });
    if (LAST_ACTION_DOMAIN === 'bank'){
      if (bankCanUndo()) return bankUndo();
      if (canUndo()) return undo();
      return;
    }
    // editor last
    if (canUndo()) return undo();
    if (bankCanUndo()) return bankUndo();
  }

  function redoAny(){
    prepareForHistoryNavigation({ dir:'redo', lastActionDomain: LAST_ACTION_DOMAIN, lastUndoDomain: LAST_UNDO_DOMAIN });
    if (LAST_UNDO_DOMAIN === 'bank'){
      if (bankCanRedo()) return bankRedo();
      if (canRedo()) return redo();
      return;
    }
    if (canRedo()) return redo();
    if (bankCanRedo()) return bankRedo();
  }

  // Reset editor undo baseline to match the current editor buffer.
  function resetUndoToCurrent(keepDomain){
    const prevDomain = LAST_ACTION_DOMAIN;
    initUndo();
    snapshot('baseline', { force:true, preserveBankRedo:true });
    if (keepDomain) LAST_ACTION_DOMAIN = prevDomain;
  }

  // ----------------------------- exports -----------------------------

  root.DP_Undo = {
    init: dpUndoInit,
    initUndo, snapshot, canUndo, canRedo, undo, redo,
    bankPush, bankCanUndo, bankCanRedo, bankUndo, bankRedo,
    canUndoAny, canRedoAny, undoAny, redoAny,
    resetUndoToCurrent,
    captureBankState, applyBankState
  };

  // Convenience globals (legacy callers).
  root.initUndo = initUndo;
  root.snapshot = snapshot;
  root.canUndo = canUndo;
  root.canRedo = canRedo;
  root.undo = undo;
  root.redo = redo;

  root.bankPush = bankPush;
  root.bankCanUndo = bankCanUndo;
  root.bankCanRedo = bankCanRedo;
  root.bankUndo = bankUndo;
  root.bankRedo = bankRedo;

  root.canUndoAny = canUndoAny;
  root.canRedoAny = canRedoAny;
  root.undoAny = undoAny;
  root.redoAny = redoAny;

  root.resetUndoToCurrent = resetUndoToCurrent;
  root.captureBankState = captureBankState;
  root.applyBankState = applyBankState;

})();
