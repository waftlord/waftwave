// DigiPRO UI split: core utilities + shared state
// This file (and the other ui-*.js files) replaces the old monolithic ui.js.
// The original ui.js is kept as a legacy reference.



/**
 * mmdt-digipro-panel-merged.js — DigiPRO Waveform panel (stable + new features, import fixed)
 * Renders into: [data-panel-id="digipro"] .panel-content
 *
 * Depends on:
 *   - mmdt-digipro-sysex.js  (MMDT_DigiPRO)
 *   - mmdt-midi.js           (selectedMidiIn/Out, sendBytes, requestDumpAsync)
 *   - Tone.js (already in your bundle) for audio preview (fallback to WebAudio if missing)
 *
 * What’s new vs your last stable build:
 *   ✓ Robust .wav/.syx/.json import: sorted, unique 4‑char names, thumbnails update immediately
 *   ✓ Extra editor effects: Reverse · Morph · Normalize · Invert · Rectify · Randomize · Pulseify · Fold · Crush · Jitter · Tilt · Downsample · Mirror · Phase+90° · Scramble
 *   ✓ Safer MIDI “Capture ALL” listener (guards if isWaveDump helper not present)
 *   ✓ Simplified header: “Slot # + Name”
 *   ✓ Keeps prior bugfix: I/O row is actually appended to the DOM (no redeclarations)\n *   ✓ Export: slot→.wav, selected→ZIP of .wav, bank→.json + ZIP of .wav (removed .syx export)
 *
 * Notes:
 *  - WAV import expects mono single‑cycle content; if stereo/long, it's mixed+resampled to 96 samples.
 *  - This file replaces mmdt-digipro-panel.js. No other app files changed.
 */

'use strict';

const root = (typeof window !== 'undefined') ? window : globalThis;
root.DP_UI = root.DP_UI || {};
root.DP_UI.state = root.DP_UI.state || {};
root.DP_UI.utils = root.DP_UI.utils || {};
root.rebindDigiproCaptureHandler = root.rebindDigiproCaptureHandler || function(){};


  // ------------------------------------------------------------
  // Shared tiny utils (robust globals)
  // ------------------------------------------------------------
  // NOTE:
  // In some merged builds these helpers existed only inside other IIFEs
  // (e.g. inside mmdt-midi.js), which makes them unavailable here.
  // The DigiPRO panel uses them directly, so we provide safe fallbacks
  // and also export them onto `window` for other scripts to reuse.
  const _clamp01  = root._clamp01  || function _clamp01(n){
    n = Number(n);
    return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  };
  const _clampInt = root._clampInt || function _clampInt(n, lo, hi){
    n = Number(n);
    if (!isFinite(n)) n = lo;
    n = Math.round(n);
    return Math.max(lo, Math.min(hi, n));
  };
  root._clamp01  = _clamp01;
  root._clampInt = _clampInt;

  // -------------- shorthands --------------


  // (decode shim removed) — DigiPRO SysEx handling now lives solely in mmdt-digipro-sysex.js

  const bySel = (s, p) => (p||document).querySelector(s);
  const bySelAll = (s, p) => Array.from((p||document).querySelectorAll(s));
  const el = (t,c) => { const e=document.createElement(t); if(c) e.className=c; return e; };

  // --------- UX guards (text selection + TX badge clearing) ---------
  function mmIsTextEntryTarget(t){
    const el = (t && t.nodeType === 1) ? t : (t && t.parentElement ? t.parentElement : null);
    if (!el) return false;
    try{
      if (el.closest && el.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),.mm-allow-select')) return true;
    }catch(_){}
    const tag = (el.tagName||'').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // Prevent selecting random UI text (except in entry fields)
  (function installNoTextSelectGuard(){
    document.addEventListener('selectstart', (e)=>{
      if (mmIsTextEntryTarget(e.target)) return;
      e.preventDefault();
    }, true);
  })();

  // Transfer highlight clearing (Upload + Download)
  // Goal: keep the “sending/processing” feedback during I/O, but clear the post‑I/O
  // result badges automatically so slot selection + active outlines stay readable.
  const DP_BADGE_AUTOCLEAR_MS = 1400; // how long to leave result highlights visible
  let DP_TX_BADGES_ARMED = false;
  let DP_RX_BADGES_ARMED = false;
  let DP_BADGE_CLEAR_TIMER = null;

  function dpArmAutoClearBadges(){
    const hasTx = !!bySel('.mm-digi-slot.sent-slot, .mm-digi-slot.send-failed-slot, .mm-digi-slot.sending-slot');
    const hasRx = !!bySel('.mm-digi-slot.processed-slot, .mm-digi-slot.failed-slot, .mm-digi-slot.processing-slot');

    if (hasTx) DP_TX_BADGES_ARMED = true;
    if (hasRx) DP_RX_BADGES_ARMED = true;
    if (!hasTx && !hasRx) return;

    // Auto-clear shortly after completion. If another transfer starts immediately,
    // defer until the grid has no “in progress” badges.
    try{ if (DP_BADGE_CLEAR_TIMER) clearTimeout(DP_BADGE_CLEAR_TIMER); }catch(_){}
    DP_BADGE_CLEAR_TIMER = setTimeout(function tick(){
      if (bySel('.mm-digi-slot.sending-slot, .mm-digi-slot.processing-slot')){
        DP_BADGE_CLEAR_TIMER = setTimeout(tick, 400);
        return;
      }
      dpClearTxBadges();
      dpClearRxBadges();
      DP_BADGE_CLEAR_TIMER = null;
    }, DP_BADGE_AUTOCLEAR_MS);
  }

  // Backwards-compatible entrypoint (uploads already call this)
  function dpArmClearTxBadges(){ dpArmAutoClearBadges(); }
  // New: download/import side uses this too
  function dpArmClearRxBadges(){ dpArmAutoClearBadges(); }

  function dpClearTxBadges(){
    bySelAll('.mm-digi-slot.sent-slot, .mm-digi-slot.send-failed-slot, .mm-digi-slot.sending-slot')
      .forEach(c=>c.classList.remove('sending-slot','sent-slot','send-failed-slot'));
    DP_TX_BADGES_ARMED = false;
  }
  function dpClearRxBadges(){
    bySelAll('.mm-digi-slot.processing-slot, .mm-digi-slot.processed-slot, .mm-digi-slot.failed-slot')
      .forEach(c=>c.classList.remove('processing-slot','processed-slot','failed-slot'));
    DP_RX_BADGES_ARMED = false;
  }

  (function installTransferBadgeClearOnClick(){
    document.addEventListener('pointerdown', ()=>{
      if (!DP_TX_BADGES_ARMED && !DP_RX_BADGES_ARMED) return;
      try{ if (DP_BADGE_CLEAR_TIMER) clearTimeout(DP_BADGE_CLEAR_TIMER); }catch(_){}
      DP_BADGE_CLEAR_TIMER = null;
      dpClearTxBadges();
      dpClearRxBadges();
    }, true);
  })();



  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n|0));

  // --- Global display anchor helpers (device-parity drawing) ---
  // Shared by thumbnails and by attachDisplayRot(). Keeping the implementation here avoids
  // subtle drift between editor/grid/import/export previews.
  function findDisplayAnchor(u8){
    const N = (u8 && u8.length) || 0; if (!N) return 0;
    // Prefer rising zero-crossing (<=128 then >128)
    for (let i=0;i<N;i++){
      const a = u8[i]|0, b = u8[(i+1)%N]|0;
      if (a <= 128 && b > 128) return (i+1)%N;
    }
    // Fallback: strongest positive edge
    let bestI = 0, bestD = -1e9;
    for (let i=0;i<N;i++){
      const d = (u8[(i+1)%N]|0) - (u8[i]|0);
      if (d > bestD){ bestD = d; bestI = (i+1)%N; }
    }
    return bestI;
  }
  function rotateForDisplay(u8, s){
    if (!u8 || !u8.length) return u8;
    const N = u8.length, out = new Uint8Array(N);
    for (let i=0;i<N;i++) out[i] = u8[(i + (s|0)) % N];
    return out;
  }
  function ensureDisplayRot(u8){
    if (!u8) return 0;
    if (typeof u8.displayRot === 'number') return u8.displayRot|0;
    // compute and cache
    try { u8.displayRot = findDisplayAnchor(u8)|0; } catch(_){ u8.displayRot = 0; }
    return u8.displayRot|0;
  }

  const DIGIPRO_PREVIEW_MIDI = 60;

// DigiPRO 0x5D stream size used by the codec (3 × 1022 INT16 samples)
const DP_SAMPLES_PER_TABLE =
  (window.MMDT_DigiPRO && window.MMDT_DigiPRO.SAMPLES_PER_TABLE) || 1022;
  // -------------- Turbo-aware I/O pacing (ported from MDDT bulk/turbo) --------------
  // Turbo can be 2×, 3.33×, 4× … 20×. We pace using the *actual* detected factor.
  function dpTurboFactor(){
    const f = Number(window.currentTurboFactor);
    return (isFinite(f) && f > 1.0001) ? f : 1.0;
  }

  function dpCalcDumpTimeoutMs(){
    const msgLen = (window.MMDT_DigiPRO && window.MMDT_DigiPRO.MSG_SIZE_BYTES) ? window.MMDT_DigiPRO.MSG_SIZE_BYTES : 7200;

    // Downloads (device → computer) are often dominated by device prep + USB/browser
    // jitter, and RX is not always truly "turbo" even if TX is. If we scale the
    // timeout down aggressively based on the advertised turbo factor, we can abort
    // perfectly valid dumps at high multipliers (e.g., 10×). Keep this conservative.
    const rxFactorAssumed = 1.0;
    const wireMs = (msgLen / (3125 * rxFactorAssumed)) * 1000;

    const extra = 2000;
    return Math.max(4000, Math.min(9000, Math.ceil(wireMs + extra)));
  }

  function dpCalcInterSlotDelayMs(){
    // Optional fixed override (ms).
    // Used for field debugging when a device needs extra processing time between
    // full DigiPRO dumps (e.g., to avoid partial writes that only affect some
    // note ranges / mip levels).
    if (typeof window.digiproInterSlotDelayMs === 'number' && isFinite(window.digiproInterSlotDelayMs) && window.digiproInterSlotDelayMs >= 0){
      const v = Math.round(window.digiproInterSlotDelayMs);
      return Math.max(0, Math.min(2000, v));
    }

    const f = dpTurboFactor();
    if (f <= 1.0001) return 200;

    // Scale down with factor; clamp to stay conservative.
    const d = Math.round(200 / f);
    return Math.max(10, Math.min(80, d));
  }

  async function dpWaitForUploadDrain(byteLen, signal){
    const f = dpTurboFactor();
    const extra = (f > 1.0001)
      ? (typeof window.digiproUploadTailMsTurbo === 'number' ? window.digiproUploadTailMsTurbo : 80)
      : (typeof window.digiproUploadTailMsNormal === 'number' ? window.digiproUploadTailMsNormal : 140);

    if (window.MidiWireClock && typeof window.MidiWireClock.waitForDrain === 'function'){
      await window.MidiWireClock.waitForDrain(extra, signal);
      return;
    }

    // Fallback approximation (should rarely be hit in this standalone build)
    const bytesPerSec = 3125 * f;
    const pause = Math.ceil((byteLen / bytesPerSec) * 1000 + extra);
    await sleepAbortable(pause, signal);
  }

  // Expose for other scripts (e.g., MIDI modal test button)
  window.dpCalcDumpTimeoutMs = dpCalcDumpTimeoutMs;




  // -------------- in-memory library --------------
  // Some batch tools (Normalize ALL / Batch Name / Evolve) store a parallel reference
  // array of user-modified waves. In a few merged builds that field was missing, which
  // could throw at runtime (e.g., Evolve→16 appearing to do nothing).
  const LIB = (root.digiWaveLibrary = root.digiWaveLibrary || {
    waves: Array.from({length:64}, ()=>null),      // each: { name, dataU8, user:true|false }
    userWaves: Array.from({length:64}, ()=>null),  // optional mirror of user waves
    dirty: new Set()
  });

  // Back-compat / robustness: if an older LIB object exists without these fields.
  if (!Array.isArray(LIB.waves) || LIB.waves.length !== 64){
    LIB.waves = Array.from({length:64}, ()=>null);
  }
  if (!Array.isArray(LIB.userWaves) || LIB.userWaves.length !== 64){
    LIB.userWaves = Array.from({length:64}, (_,i)=> (LIB.waves[i] && LIB.waves[i].user) ? LIB.waves[i] : null);
  }
  if (!(LIB.dirty instanceof Set)){
    try{ LIB.dirty = new Set(LIB.dirty || []); }catch(_){ LIB.dirty = new Set(); }
  }

  // selection set for batch actions
  const SELECTED = new Set();

  // Shift-click range selection anchor (like file managers).
  let SELECT_ANCHOR = null;

  // -------------- tiny styles for grid/editor & guard --------------

  // Editor: keep an internal working buffer that exactly matches the device data length
    let EDIT = { slot: 0, name: 'WAVE', dataU8: new Uint8Array(96).fill(128), _dpHeat: 1 }; // default 96 samples; replaced when real dumps arrive

  let activeIdx = 0; // visual active tile (may be same as EDIT.slot)
  let CLIP = null;       // waveform copy buffer (used by Morph/Stack/etc) { name, dataU8 }
  let SLOT_CLIP = null;  // bank slot clipboard { items:[waveRec|null], srcSlots:number[], ts:number }

  // === PATCH: Undo/Redo state ===
  let paintEditor = null; // set in renderEditorBar
  let refreshEditorBar = null; // lightweight slot/view sync without DOM rebuild
  let updateUndoButtons = null;



  // (undo/redo system moved to undo-redo.js)



// UI elements we recreate/track
  let ioMsgEl = null;
  let btnExportBank = null;
  let btnUploadSlots = null; // Unified: Upload slot(s) (active slot if none selected)
  let btnExportSel = null;
  let btnExportBankZip = null;
  let btnImportBankJson = null;

  // New: SysEx export buttons (DigiPRO 0x5D)
  let btnExportSlotSyx = null;
  let btnExportSelSyx = null;
  let btnExportBankSyx = null;

  // Cooperative cancel for long batch ops (Download/Upload/Export/etc).
  // Instead of a dedicated Cancel button, we temporarily repurpose the button that started the job
  // (e.g., “Download ALL” / “Upload ALL”) into a “Cancel” button while the job is running.
  const JOB = {
    running: false,
    cancelled: false,
    label: '',
    lockMidi: false,  // lock MIDI I/O controls while running (transfer safety)
    ctrl: null,          // AbortController for the whole job (also aborts sleeps)
    signal: null,
    abortCurrent: null,  // function to abort the current in-flight MIDI request
    uiBtn: null,         // button repurposed as Cancel (optional)
    uiBtnPrev: null      // previous button state
  };

  function _restoreJobButton(){
    if (JOB.uiBtn && JOB.uiBtnPrev){
      try{
        JOB.uiBtn.textContent = JOB.uiBtnPrev.text;
        JOB.uiBtn.title = JOB.uiBtnPrev.title;
        JOB.uiBtn.disabled = JOB.uiBtnPrev.disabled;
        JOB.uiBtn.onclick = JOB.uiBtnPrev.onclick;
      }catch(_){}
    }
    JOB.uiBtn = null;
    JOB.uiBtnPrev = null;
  }

  function _setJobButton(btn){
    _restoreJobButton();
    if (!btn) return;
    JOB.uiBtn = btn;
    JOB.uiBtnPrev = {
      text: btn.textContent,
      title: btn.title,
      disabled: !!btn.disabled,
      onclick: btn.onclick
    };
    try{
      btn.disabled = false;
      btn.textContent = 'Cancel';
      btn.title = JOB.label ? ('Cancel: ' + JOB.label) : 'Cancel';
      btn.onclick = ()=>{
        requestCancelJob();
        announceIO('Cancel requested…');
      };
    }catch(_){}
  }

  function _emitJobState(){
    try{
      if (typeof window === 'undefined' || !window.dispatchEvent) return;
      if (typeof CustomEvent !== 'function') return;
      window.dispatchEvent(new CustomEvent('dp-job-state', {
        detail: {
          running: !!JOB.running,
          cancelled: !!JOB.cancelled,
          label: String(JOB.label||''),
          lockMidi: !!JOB.lockMidi,
        }
      }));
    }catch(_){ }
  }

  function beginJob(label, cancelBtn, opts){
    // Ensure any previous job is torn down.
    try{ if (JOB.ctrl) JOB.ctrl.abort(); }catch(_){}
    _restoreJobButton();

    JOB.running = true;
    JOB.cancelled = false;
    JOB.label = String(label || '');
    JOB.ctrl = new AbortController();
    JOB.signal = JOB.ctrl.signal;
    JOB.abortCurrent = null;
    JOB.lockMidi = !!(opts && opts.lockMidi);

    // If provided, turn the caller's button into “Cancel” during the job.
    _setJobButton(cancelBtn);

    updateButtonsState();
    _emitJobState();
  }

  function endJob(){
    JOB.running = false;
    JOB.cancelled = false;
    JOB.label = '';
    JOB.abortCurrent = null;
    JOB.lockMidi = false;

    try{ if (JOB.ctrl) JOB.ctrl.abort(); }catch(_){}
    JOB.ctrl = null;
    JOB.signal = null;

    _restoreJobButton();
    updateButtonsState();
    _emitJobState();
  }

  function requestCancelJob(){
    if (!JOB.running) return;
    JOB.cancelled = true;
    _emitJobState();
    try{ if (JOB.abortCurrent) JOB.abortCurrent(); }catch(_){}
    try{ if (JOB.ctrl) JOB.ctrl.abort(); }catch(_){}

    // Friendly UI feedback on the repurposed button.
    if (JOB.uiBtn){
      try{
        JOB.uiBtn.disabled = false;
        JOB.uiBtn.textContent = 'Cancelling…';
        JOB.uiBtn.title = JOB.label ? ('Cancelling: ' + JOB.label) : 'Cancelling…';
      }catch(_){}
    }
  }


  // Unified: Download slot(s) (active slot if none selected)
  let btnReqSlots = null;

  // Batch tools
  let btnBatchName = null;
  let btnAmpBatch = null;
  let gainAllSlider = null;
  let btnNormBatch = null;
  let normSlider = null;
  let normValEl = null;
  let NORM_PCT = 100;

  // Evolve / Blend tools + state
  const EVOLVE_STATE = root.__digiproEvolveState || (root.__digiproEvolveState = { count: 16, recipe: 'seeded', path: 'oneway', pwmDomain: 'half' });
  const EVOLVE_DUAL_STATE = root.__digiproEvolveDualState || (root.__digiproEvolveDualState = { count: 16, mode: 'specblur', placement: 'afterA' });
  // Three‑wave morph (A→B→C) state: only used when exactly 3 slots are selected.
  const EVOLVE_TRIPLE_STATE = root.__digiproEvolveTripleState || (root.__digiproEvolveTripleState = { count: 16, mode: 'specblur', placement: 'afterA' });
  // Four‑wave morph (A→B→C→D) state: only used when exactly 4 slots are selected.
  const EVOLVE_QUAD_STATE = root.__digiproEvolveQuadState || (root.__digiproEvolveQuadState = { count: 16, mode: 'specblur', placement: 'afterA' });
  const BLEND_STATE  = root.__digiproBlendState  || (root.__digiproBlendState  = { mode: 'avg' });

  // --- Paste Special state (Ctrl/Cmd+Shift+V palette) ---
  // Tracks the last-used Paste Special option so Enter can repeat the previous action.
  // Values: "evolve" | "morph" | "reverse" | "pingpong"
  const PASTE_SPECIAL_STATE = root.__digiproPasteSpecialState || (root.__digiproPasteSpecialState = { lastMode: 'evolve' });

  // --- Two-wave morph mode state (used by Paste Special: Morph Table Builder) ---
  // Reuse the existing two-wave morph UI state so Paste Special stays in sync
  // with whatever morph mode the user last chose in the Morph/Evolve dialogs.
  const MORPH_STATE = root.__digiproMorphState || (root.__digiproMorphState = EVOLVE_DUAL_STATE);
  // Ensure the expected fields exist even if this is bound to EVOLVE_DUAL_STATE.
  if (!MORPH_STATE.mode) MORPH_STATE.mode = 'specblur';
  if (!MORPH_STATE.opts) MORPH_STATE.opts = {};
  const WAVETABLE_VIEW_STATE = root.__digiproWavetableViewState || (root.__digiproWavetableViewState = {
    tuneSemitones: 0
  });
  WAVETABLE_VIEW_STATE.tuneSemitones = _clampInt(parseInt(WAVETABLE_VIEW_STATE.tuneSemitones, 10) || 0, -48, 48);

  function getWavetableTuneSemitones(){
    return _clampInt(parseInt(WAVETABLE_VIEW_STATE.tuneSemitones, 10) || 0, -48, 48);
  }

  function setWavetableTuneSemitones(n){
    const next = _clampInt(parseInt(n, 10) || 0, -48, 48);
    WAVETABLE_VIEW_STATE.tuneSemitones = next;
    return next|0;
  }

  function formatSemitoneSigned(n){
    n = _clampInt(parseInt(n, 10) || 0, -48, 48);
    return `${n >= 0 ? '+' : ''}${n}`;
  }

  function wavetablePreviewMidi(baseMidi){
    const base = parseInt(baseMidi, 10) || 60;
    return Math.max(0, Math.min(127, (base + getWavetableTuneSemitones())|0));
  }

  function refreshWavetableTuneUiState(){
    try{
      if (typeof refreshEditorBar === 'function' && refreshEditorBar()) return getWavetableTuneSemitones();
    }catch(_){ }
    try{
      if (typeof requestWavetableViewportDraw === 'function') requestWavetableViewportDraw();
    }catch(_){ }
    return getWavetableTuneSemitones();
  }

  function setWavetableAuditionTune(next, opts){
    opts = opts || {};
    const st = setWavetableTuneSemitones(next);
    refreshWavetableTuneUiState();
    if (opts.restartPreview){
      try{
        if (typeof restartCurrentWavetableAudition === 'function') restartCurrentWavetableAudition();
      }catch(_){ }
    }
    return st|0;
  }

  function stepWavetableAuditionTune(delta, opts){
    const st = getWavetableTuneSemitones();
    return setWavetableAuditionTune((st|0) + (delta|0), opts);
  }

  let btnEvolve = null;
  let btnBlend  = null;

  // Mutate UI (bank curation)
  let btnMutate = null;
  let btnFuse = null;    // NEW: creative multi-wave generator (next to Mutate slider)
  let btnClear = null;   // NEW: context-aware Clear (selection or all)
  let mutateSlider = null;
  let mutateValEl = null;
  let MUTATE_PCT = 15;

  let btnUploadAll = null;
  let nameIn = null;
  let editorCanvas = null;
  let wavetableCanvas = null;
  let pianoCanvas = null;
	let padsCanvas = null;
	let KB_VIEW_MODE = 'keys';
	let kbBtnKeys = null;
	let kbBtnPads = null;
	let kbMainWrap = null;
	let padsHoverIdx = null;
  let previewSlotIdx = null;

  // ---------- WAV import helpers ----------



// WAV import defaults:
  // WAV import defaults are shared via DP_IO.settings so ui.js and import-export.js stay in sync.
  // Policy: default is **no normalization** (preserve source level). Users can Normalize manually if desired.
  const DEFAULT_WAV_IMPORT_NORMALIZE = !!(root.DP_IO && root.DP_IO.settings && root.DP_IO.settings.wavImportNormalize);




  // ---- Base64 helpers (for embedding SysEx inside JSON) ----



  // ---- Float resample helpers (periodic, for single-cycle previews/exports) ----


  // Anti-aliased periodic resample of float cycles (helps avoid "noisy" thumbnails when shrinking)





  // -------------- naming utilities (4-letter, unique, sorted import) --------------




  // File-system safe 4-char token for filenames (Windows-safe).


  // Parse slot + (optional) 4-char name from common exported filenames.
  // Supports patterns like:
  //   MM-WAVE-01-ABCD.wav
  //   MM-DIGIPRO-SLOT-01-ABCD.wav
  //   SLOT01-ABCD.wav





  function collectUsedNames(){
    const used = new Set();
    LIB.waves.forEach(w => { if (w && w.name) used.add(w.name.toUpperCase()); });
    return used;
  }



  function attachDisplayRot(rec, fromDevice=false){
  try{
    // DEVICE-TRUE ROTATION: for device dumps and .syx imports we want the screen to start at sample 0.
    // For everything else (e.g., WAVs or edits) we keep the "pretty anchor" heuristic.
    const rot = fromDevice ? 0 : findDisplayAnchor(rec.dataU8);
    // Stash as a property on the Uint8Array so drawMini can read it without extra allocations
    rec.dataU8.displayRot = rot|0;
  }catch(_){}
  return rec;
}
  // --- Safeguard: if decoded page looks suspiciously flat, re-slice from raw SysEx using robust page mapping ---
  function salvageDigiPRO(decoded){
  // Legacy salvage paths (old RLE/bit-order experiments) removed.
  // The current DigiPRO codec is strict 0x5D → 6132 bytes → 3×1022 Int16 streams.
  return decoded;
}

  function announceIO(msg, isErr=false){
    if (!ioMsgEl) return;

    // Always show *something* useful in the status strip. Some flows used to
    // clear the message (announceIO('')), leaving the UI looking broken.
    // Default to a lightweight "Ready" state instead of blank.
    const s = (msg === null || msg === undefined) ? '' : String(msg);
    const out = (s && s.trim()) ? s : 'Ready';

    ioMsgEl.textContent = out;
    ioMsgEl.style.color = isErr ? '#b00020' : '';
  }

  // Expose for MIDI/turbo UI feedback
  root.announceIO = announceIO;

  function sleep(ms){ return new Promise(r => setTimeout(r, Math.max(0, ms|0))); }

  function sleepAbortable(ms, signal){
    ms = Math.max(0, ms|0);
    if (!signal) return sleep(ms);
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve)=>{
      const t = setTimeout(()=>{ cleanup(); resolve(true); }, ms);
      const onAbort = ()=>{ clearTimeout(t); cleanup(); resolve(false); };
      function cleanup(){ try{ signal.removeEventListener('abort', onAbort); }catch(_){} }
      signal.addEventListener('abort', onAbort, { once:true });
    });
  }

  function linkAbort(signal, controller){
    if (!signal || !controller) return ()=>{};
    if (signal.aborted){
      try{ controller.abort(); }catch(_){}
      return ()=>{};
    }
    const onAbort = ()=>{ try{ controller.abort(); }catch(_){} };
    signal.addEventListener('abort', onAbort, { once:true });
    return ()=>{ try{ signal.removeEventListener('abort', onAbort); }catch(_){} };
  }


// --- DP_UI namespace bindings (non-breaking) ---
(function(){
  try{
    const S = root.DP_UI.state;
    // Objects / Sets (stable references)
    S.LIB = root.digiWaveLibrary;
    S.EDIT = EDIT;
    S.SELECTED = SELECTED;
    S.JOB = JOB;

    // Frequently reassigned bindings -> accessors
    Object.defineProperties(S, {
      activeIdx: { get: ()=>activeIdx, set: v=>{ activeIdx = v; }, configurable: true },
      SELECT_ANCHOR: { get: ()=>SELECT_ANCHOR, set: v=>{ SELECT_ANCHOR = v; }, configurable: true },
      CLIP: { get: ()=>CLIP, set: v=>{ CLIP = v; }, configurable: true },
      SLOT_CLIP: { get: ()=>SLOT_CLIP, set: v=>{ SLOT_CLIP = v; }, configurable: true },
      paintEditor: { get: ()=>paintEditor, set: v=>{ paintEditor = v; }, configurable: true },
      ioMsgEl: { get: ()=>ioMsgEl, set: v=>{ ioMsgEl = v; }, configurable: true }
    });

    const U = root.DP_UI.utils;
    Object.assign(U, {
      bySel, bySelAll, el,
      clamp,
      mmIsTextEntryTarget,
      dpArmAutoClearBadges, dpArmClearTxBadges, dpArmClearRxBadges,
      dpClearTxBadges, dpClearRxBadges,
      dpTurboFactor, dpCalcDumpTimeoutMs, dpCalcInterSlotDelayMs, dpWaitForUploadDrain,
      sleepAbortable, linkAbort,
      announceIO
    });
  }catch(e){
    // Non-fatal: DP_UI is optional scaffolding for future refactors.
    console.warn('DP_UI namespace binding failed:', e);
  }
})();
