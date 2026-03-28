// DigiPRO UI split: editor UI + display helpers
// Note: renderEditorBar remains large for this low-risk split; follow-up refactors can
// progressively extract nested tool logic into ui-effects-tools.js / ui-midi.js.

'use strict';

function preview2044_from_tables(recOrTables, midi = DIGIPRO_PREVIEW_MIDI){
  // NOTE: midi is currently unused here; we always preview the 1024-sample “A level0” table.
  const T = recOrTables && (recOrTables._tables6132 || recOrTables);
  if (!T || !T.t0 || !T.t1) return null;

  const t0 = (T.t0 instanceof Int16Array) ? T.t0 : new Int16Array(T.t0||[]);
  const t1 = (T.t1 instanceof Int16Array) ? T.t1 : new Int16Array(T.t1||[]);
  if (t0.length !== DP_SAMPLES_PER_TABLE || t1.length !== DP_SAMPLES_PER_TABLE) return null;

  const N = 1024;
  // DC removal + peak normalize for display/export
  let mean = 0;
  for (let i=0;i<512;i++) mean += t0[i] + t1[i];
  mean /= N;

  let peak = 0;
  for (let i=0;i<512;i++){
    const a0 = Math.abs(t0[i] - mean);
    const a1 = Math.abs(t1[i] - mean);
    if (a0 > peak) peak = a0;
    if (a1 > peak) peak = a1;
  }
  if (peak < 1) peak = 1;

  const out = new Uint8Array(N);
  for (let i=0;i<512;i++){
    const y0 = (t0[i] - mean) / peak;
    const y1 = (t1[i] - mean) / peak;
    out[2*i]   = clamp(Math.round(y0*127 + 128), 0, 255);
    out[2*i+1] = clamp(Math.round(y1*127 + 128), 0, 255);
  }
  return out;
}

// -------------- canvas drawing helpers --------------
function drawMini(canvas, recOrU8){
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width  = Math.max(96, (canvas.clientWidth|0) || 160);
  const h = canvas.height = 48;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = '#ddd';
  ctx.strokeRect(0,0,w,h);

  // Accept legacy calls that pass a Uint8Array directly
  let u8 = null;
  if (recOrU8 && recOrU8.constructor === Uint8Array){
    u8 = recOrU8;
  } else if (recOrU8 && typeof recOrU8 === 'object'){
    // Prefer the device-style 96-point shape if present; otherwise fall back to a table-based preview
  u8 = recOrU8.dataU8 || preview2044_from_tables(recOrU8, DIGIPRO_PREVIEW_MIDI) || null;
  }

  if (!u8 || !u8.length){
    ctx.strokeStyle = '#bbb';
    const mid = (h-1)>>1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    return;
  }

  // Draw by sampling u8 across the canvas width (works for N=96 or N=1022+)
  ctx.strokeStyle = '#333';
  ctx.beginPath();
  const N = u8.length;

  // View: Normalized (display-only): remove DC and scale to full height so low-level waves are readable.
  // When disabled, show raw 8-bit amplitude (center=128, full-scale=±128) so level edits are visible.
const viewNorm = false;

  let mean = 128;
  let peak = 128;

  if (viewNorm){
    mean = 0;
    for (let i=0;i<N;i++) mean += (u8[i]|0);
    mean /= N;

    peak = 0;
    for (let i=0;i<N;i++){
      const a = Math.abs((u8[i]|0) - mean);
      if (a > peak) peak = a;
    }
    if (peak < 1) peak = 1;
  } else {
    mean = 128;
    peak = 128;
  }

  for (let x=0; x<w; x++){
    const i = Math.min(N-1, Math.round(x * (N-1)/(w-1)));
    const v = ((u8[i]|0) - mean) / peak;
    const y = h - 1 - Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * (h-1));
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

const DP_SIMPLE_MODE_STORAGE_KEY = 'mm_dp_simple_mode_v1';
const DP_SIMPLE_MODE_CONTROLS = [
  { id:'fold',  label:'Fold',  min:0,    max:100, step:1, neutral:0 },
  { id:'skew',  label:'Skew',  min:-100, max:100, step:1, neutral:0 },
  { id:'sat',   label:'Sat',   min:0,    max:100, step:1, neutral:0 },
  { id:'crush', label:'Crush', min:0,    max:100, step:1, neutral:0 },
  { id:'pwm',   label:'PWM',   min:0,    max:100, step:1, neutral:0 },
  { id:'pd',    label:'PD',    min:0,    max:100, step:1, neutral:0 },
  { id:'tone',  label:'Tone',  min:-100, max:100, step:1, neutral:0 },
  { id:'smear', label:'Smear', min:0,    max:100, step:1, neutral:0 },
];
const DP_SIMPLE_MORPH_OPTIONS = [
  ['linear', 'Linear'],
  ['spectral', 'Spectral'],
  ['phaseWarp', 'Phase Warp'],
  ['equalPower', 'Equal Power'],
  ['magnitudeOnly', 'Magnitude Only'],
  ['phaseOnly', 'Phase Only'],
  ['pingPong', 'Ping-Pong'],
  ['centerOut', 'Center-Out']
];
const DP_SIMPLE_MORPH_INFO = {
  linear: { blend:'direct', distribution:'forward' },
  spectral: { blend:'spectral', distribution:'forward' },
  phaseWarp: { blend:'phaseWarp', distribution:'forward' },
  equalPower: { blend:'equalPower', distribution:'forward' },
  magnitudeOnly: { blend:'magnitudeOnly', distribution:'forward' },
  phaseOnly: { blend:'phaseOnly', distribution:'forward' },
  pingPong: { blend:'direct', distribution:'pingPong' },
  centerOut: { blend:'direct', distribution:'centerOut' }
};
const DP_SIMPLE_CONTROL_DISTRIBUTION = {
  fold: { mode:'hybrid', floor:0.35 },
  skew: { mode:'fanout' },
  sat: { mode:'global' },
  crush: { mode:'global' },
  pwm: { mode:'fanout' },
  pd: { mode:'fanout' },
  tone: { mode:'fanout' },
  smear: { mode:'fanout' }
};
const DP_SIMPLE_CONTROL_MORPH_RULES = {
  tone: {
    disabled: {
      phaseOnly: 'Tone is unavailable in Phase Only morph because that mode ignores spectral magnitude changes.'
    },
    postBlend: {
      equalPower: 0.18,
      phaseWarp: 0.36
    }
  },
  smear: {
    disabled: {
      phaseOnly: 'Smear is unavailable in Phase Only morph because that mode ignores spectral magnitude changes.'
    },
    postBlend: {
      equalPower: 0.24,
      phaseWarp: 0.46
    }
  }
};

function dpSimpleMorphInfo(mode){
  const key = String(mode || '');
  if (Object.prototype.hasOwnProperty.call(DP_SIMPLE_MORPH_INFO, key)) return DP_SIMPLE_MORPH_INFO[key];
  return DP_SIMPLE_MORPH_INFO.linear;
}

function dpSimpleControlDisabledReason(id, morph){
  const cfg = DP_SIMPLE_CONTROL_MORPH_RULES[id];
  if (!cfg || !cfg.disabled) return '';
  const reason = cfg.disabled[String(morph || '')];
  return reason ? String(reason) : '';
}

function dpSimplePostBlendWeight(id, morph, amount){
  const cfg = DP_SIMPLE_CONTROL_MORPH_RULES[id];
  if (!cfg || !cfg.postBlend) return 0;
  const base = Number(cfg.postBlend[String(morph || '')]);
  if (!(base > 0)) return 0;
  const amt = Math.max(0, Math.min(1, Math.abs(Number(amount) || 0)));
  return Math.max(0, Math.min(1, base * amt));
}

function dpSimpleDefaultState(){
  return {
    mode: 'classic',
    morph: 'linear',
    fold: 0,
    skew: 0,
    sat: 0,
    crush: 0,
    pwm: 0,
    pd: 0,
    tone: 0,
    smear: 0,
  };
}

function dpNormSimpleModeState(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = dpSimpleDefaultState();
  out.mode = (src.mode === 'simple') ? 'simple' : 'classic';
  out.morph = Object.prototype.hasOwnProperty.call(DP_SIMPLE_MORPH_INFO, src.morph) ? src.morph : 'linear';
  for (const ctl of DP_SIMPLE_MODE_CONTROLS){
    const v = parseInt(src[ctl.id], 10);
    out[ctl.id] = Math.max(ctl.min, Math.min(ctl.max, isFinite(v) ? v : ctl.neutral));
  }
  return out;
}

function dpLoadSimpleModeState(){
  try{
    if (!root.localStorage) return dpSimpleDefaultState();
    const raw = localStorage.getItem(DP_SIMPLE_MODE_STORAGE_KEY);
    const out = raw ? dpNormSimpleModeState(JSON.parse(raw)) : dpSimpleDefaultState();
    out.mode = 'classic';
    return out;
  }catch(_){
    return dpSimpleDefaultState();
  }
}

function dpSaveSimpleModeState(state){
  try{
    if (!root.localStorage) return;
    localStorage.setItem(DP_SIMPLE_MODE_STORAGE_KEY, JSON.stringify(dpNormSimpleModeState(state)));
  }catch(_){ }
}

function dpSimpleStateAmount(state){
  const st = dpNormSimpleModeState(state);
  return Math.max(
    (st.fold|0) / 100,
    Math.abs(st.skew|0) / 100,
    (st.sat|0) / 100,
    (st.crush|0) / 100,
    (st.pwm|0) / 100,
    (st.pd|0) / 100,
    Math.abs(st.tone|0) / 100,
    (st.smear|0) / 100
  );
}

function dpSimpleValueText(id, value){
  const v = parseInt(value, 10) || 0;
  if (id === 'skew' || id === 'tone'){
    return (v > 0 ? '+' : '') + String(v);
  }
  return String(v);
}

function dpSimpleIsNeutral(state){
  const st = dpNormSimpleModeState(state);
  if (st.morph !== 'linear') return false;
  return DP_SIMPLE_MODE_CONTROLS.every((ctl)=> (st[ctl.id]|0) === (ctl.neutral|0));
}

function dpSimpleWaveMatches(a, b){
  const aa = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
  const bb = (b instanceof Uint8Array) ? b : new Uint8Array(b||[]);
  const N = aa.length|0;
  if (N !== (bb.length|0)) return false;
  for (let i=0;i<N;i++){
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function dpApplySimpleModeStateU8(baseU8, state){
  const base = (baseU8 instanceof Uint8Array) ? new Uint8Array(baseU8) : new Uint8Array(baseU8||[]);
  const st = dpNormSimpleModeState(state);
  const morphInfo = dpSimpleMorphInfo(st.morph);
  if (!base.length) return base;

  let out = new Uint8Array(base);
  if ((st.fold|0) !== 0 && typeof dpSimpleWavefoldU8 === 'function'){
    out = dpSimpleWavefoldU8(out, (st.fold|0) / 100);
  }
  if ((st.skew|0) !== 0 && typeof dpSimpleSkewU8 === 'function'){
    out = dpSimpleSkewU8(out, (st.skew|0) / 100);
  }
  if ((st.sat|0) !== 0 && typeof dpSimpleSaturateU8 === 'function'){
    out = dpSimpleSaturateU8(out, (st.sat|0) / 100);
  }
  if ((st.crush|0) !== 0 && typeof dpSimpleCrushU8 === 'function'){
    out = dpSimpleCrushU8(out, (st.crush|0) / 100);
  }
  if ((st.pwm|0) !== 0 && typeof dpEvolveGenerate === 'function'){
    out = dpEvolveGenerate(out, 0.5 + (((st.pwm|0) / 100) * 0.5), 'pwm');
  }
  if ((st.pd|0) !== 0 && typeof dpEvolveGenerate === 'function'){
    out = dpEvolveGenerate(out, (st.pd|0) / 100, 'pdwarp');
  }
  if ((st.tone|0) !== 0 && typeof dpSimpleToneU8 === 'function'){
    out = dpSimpleToneU8(out, (st.tone|0) / 100);
  }
  if ((st.smear|0) !== 0 && typeof dpEvolveGenerate === 'function'){
    out = dpEvolveGenerate(out, (st.smear|0) / 100, 'specsmear');
  }

  const target = out;
  const morphAmt = dpSimpleStateAmount(st);
  if (morphAmt > 1e-6){
    if (morphInfo.blend === 'spectral' && typeof dpSimpleSpectralMorphU8 === 'function'){
      out = dpSimpleSpectralMorphU8(base, target, morphAmt);
    } else if (morphInfo.blend === 'phaseWarp' && typeof dpSimplePhaseWarpMorphU8 === 'function'){
      out = dpSimplePhaseWarpMorphU8(base, target, morphAmt);
    } else if (morphInfo.blend === 'equalPower' && typeof dpSimpleEqualPowerMorphU8 === 'function'){
      out = dpSimpleEqualPowerMorphU8(base, target, morphAmt);
    } else if (morphInfo.blend === 'magnitudeOnly' && typeof dpSimpleMagnitudeOnlyMorphU8 === 'function'){
      out = dpSimpleMagnitudeOnlyMorphU8(base, target, morphAmt);
    } else if (morphInfo.blend === 'phaseOnly' && typeof dpSimplePhaseOnlyMorphU8 === 'function'){
      out = dpSimplePhaseOnlyMorphU8(base, target, morphAmt);
    } else {
      out = target;
    }
  }

  if (typeof dpBlendU8 === 'function'){
    const toneAmt = (st.tone|0) / 100;
    const toneTopUp = dpSimplePostBlendWeight('tone', st.morph, toneAmt);
    if (toneTopUp > 1e-6 && typeof dpSimpleToneU8 === 'function'){
      out = dpBlendU8(out, dpSimpleToneU8(out, toneAmt), toneTopUp);
    }

    const smearAmt = (st.smear|0) / 100;
    const smearTopUp = dpSimplePostBlendWeight('smear', st.morph, smearAmt);
    if (smearTopUp > 1e-6 && typeof dpEvolveGenerate === 'function'){
      out = dpBlendU8(out, dpEvolveGenerate(out, smearAmt, 'specsmear'), smearTopUp);
    }
  }

  return out;
}

function dpSimpleEase01(t){
  t = Number(t);
  if (!isFinite(t)) t = 0;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - (2 * t));
}

function dpSimplePositionalAmount(index, count, distribution){
  const total = Math.max(1, count|0);
  if (total <= 1) return 1;
  if (distribution === 'pingPong'){
    const u = ((index|0) + 0.5) / total;
    return dpSimpleEase01(1 - Math.abs((2 * u) - 1));
  }
  if (distribution === 'centerOut'){
    const u = ((index|0) + 0.5) / total;
    return dpSimpleEase01(Math.abs((2 * u) - 1));
  }
  const denom = Math.max(1, total - 1);
  return dpSimpleEase01((index|0) / denom);
}

function dpSimpleDistributedValue(ctl, rawValue, positionalAmt){
  const value = rawValue|0;
  if (value === 0) return 0;

  const cfg = DP_SIMPLE_CONTROL_DISTRIBUTION[ctl.id] || { mode:'fanout' };
  let weight = 1;
  if (cfg.mode === 'fanout'){
    weight = positionalAmt;
  } else if (cfg.mode === 'hybrid'){
    const floor = Math.max(0, Math.min(1, Number(cfg.floor)));
    weight = floor + ((1 - floor) * positionalAmt);
  }
  return Math.max(ctl.min, Math.min(ctl.max, Math.round(value * weight)));
}

function dpSimpleFanoutState(state, index, count){
  const st = dpNormSimpleModeState(state);
  if ((count|0) <= 1) return st;

  const morphInfo = dpSimpleMorphInfo(st.morph);
  const positionalAmt = dpSimplePositionalAmount(index, count, morphInfo.distribution);
  const out = Object.assign({}, st);

  for (const ctl of DP_SIMPLE_MODE_CONTROLS){
    out[ctl.id] = dpSimpleDistributedValue(ctl, st[ctl.id], positionalAmt);
  }

  return out;
}

const SIMPLE_MODE_STATE = root.__digiproSimpleModeState
  ? dpNormSimpleModeState(root.__digiproSimpleModeState)
  : dpLoadSimpleModeState();
root.__digiproSimpleModeState = SIMPLE_MODE_STATE;

const SIMPLE_MODE_RUNTIME = root.__digiproSimpleModeRuntime || {
  source: null,
  sources: Object.create(null),
  gesture: null,
  raf: 0,
  pendingPreview: false,
  pendingBase: null,
  pendingPaint: null,
  pendingTouch: null,
  pendingLabel: 'Table Mode'
};
if (!SIMPLE_MODE_RUNTIME.sources || typeof SIMPLE_MODE_RUNTIME.sources !== 'object'){
  SIMPLE_MODE_RUNTIME.sources = Object.create(null);
}
root.__digiproSimpleModeRuntime = SIMPLE_MODE_RUNTIME;

function dpPersistSimpleModeState(next, opts){
  Object.assign(SIMPLE_MODE_STATE, dpNormSimpleModeState(next || SIMPLE_MODE_STATE));
  root.__digiproSimpleModeState = SIMPLE_MODE_STATE;
  if (!(opts && opts.skipStorage)) dpSaveSimpleModeState(SIMPLE_MODE_STATE);
  return SIMPLE_MODE_STATE;
}

function dpResetSimpleModeRuntime(){
  if (SIMPLE_MODE_RUNTIME.raf){
    try{ cancelAnimationFrame(SIMPLE_MODE_RUNTIME.raf); }catch(_){ }
  }
  SIMPLE_MODE_RUNTIME.raf = 0;
  SIMPLE_MODE_RUNTIME.gesture = null;
  SIMPLE_MODE_RUNTIME.pendingPreview = false;
  SIMPLE_MODE_RUNTIME.pendingBase = null;
  SIMPLE_MODE_RUNTIME.pendingPaint = null;
  SIMPLE_MODE_RUNTIME.pendingTouch = null;
}

root.__digiproCaptureSimpleModeState = function(){
  return dpNormSimpleModeState(SIMPLE_MODE_STATE);
};

root.__digiproApplySimpleModeState = function(next){
  dpResetSimpleModeRuntime();
  return dpPersistSimpleModeState(next || dpSimpleDefaultState());
};


// -------------- editor UI --------------

  function renderEditorBar(){
    const bar = bySel('#digiproEditorBar');
    bar.innerHTML = '';
    if (SIMPLE_MODE_RUNTIME.raf){
      try{ cancelAnimationFrame(SIMPLE_MODE_RUNTIME.raf); }catch(_){ }
      SIMPLE_MODE_RUNTIME.raf = 0;
    }
    SIMPLE_MODE_RUNTIME.pendingBase = null;
    SIMPLE_MODE_RUNTIME.pendingPaint = null;
    SIMPLE_MODE_RUNTIME.pendingTouch = null;
    SIMPLE_MODE_RUNTIME.pendingPreview = false;

    const left = el('div','mm-digi-editor');
    const canv = editorCanvas = el('canvas');
    const wavetableCanv = wavetableCanvas = el('canvas');
    const toolsWrap = el('div','mm-tools-wrap');
    const statusRow = el('div','mm-tools-status');
    const historyRow = el('div','mm-history-row');
    const toolsSwap = el('div','mm-tools-swap');
    const tools = el('div','mm-fx-grid');
    const simplePanel = el('div','mm-simple-panel');
    const toolsBottom = el('div','mm-tools-bottom');

    // === PATCH: Undo/Redo UI
    let btnUndo = el('button'); btnUndo.textContent='Undo';  btnUndo.title='⌘/Ctrl‑Z';           btnUndo.onclick = ()=>undoAny();
    let btnRedo = el('button'); btnRedo.textContent='Redo';  btnRedo.title='⌘/Ctrl‑Shift‑Z / Y'; btnRedo.onclick = ()=>redoAny();
    updateUndoButtons = function(){
      if (btnUndo) btnUndo.disabled = !canUndoAny();
      if (btnRedo) btnRedo.disabled = !canRedoAny();
    }


    // Ensure canvas shows the exact sample resolution (1 logical pixel per sample), scaled via CSS
    const N = Math.max(16, EDIT.dataU8?.length || 96);
    const WAVE_MIN_H = 240; // baseline editor height; will be expanded to fill the wave+keys panel
    canv.width  = N;        // one device pixel per sample for truthful drawing
    canv.height = WAVE_MIN_H;

    // Fill available width now; height will be fitted after layout so there's no white gap above the keyboard.
    canv.style.width  = '100%';
    canv.style.height = WAVE_MIN_H + 'px'; // initial; will be overridden by the fitter

    // MnM clipping safety guide tooltip (pairs with the faint 40% marker lines in the preview).
    canv.title = '';
    canv.classList.add('mm-editor-view', 'mm-view-active');

    wavetableCanv.className = 'mm-wavetable-view';
    wavetableCanv.style.width = '100%';
    wavetableCanv.style.height = '100%';
    wavetableCanv.removeAttribute('title');

    const wavetableTuneOverlay = el('div', 'mm-wavetable-tune-overlay');
    wavetableTuneOverlay.setAttribute('role', 'group');
    wavetableTuneOverlay.setAttribute('aria-label', 'Wavetable view tune controls');

    const wavetableTuneRow = el('div', 'mm-wavetable-tune-row');
    const wavetableTuneMinus = el('button');
    wavetableTuneMinus.type = 'button';
    wavetableTuneMinus.textContent = '-';
    wavetableTuneMinus.title = 'Transpose wavetable audition down by 1 semitone. Shortcut: - (Shift for octave).';

    const wavetableTuneInput = el('input', 'mm-wavetable-tune-input');
    wavetableTuneInput.type = 'text';
    wavetableTuneInput.inputMode = 'decimal';
    wavetableTuneInput.setAttribute('aria-label', 'Wavetable view tune in semitones');
    wavetableTuneInput.title = 'Wavetable audition transpose in semitones (-48 to +48).';

    const wavetableTuneUnit = el('span', 'mm-wavetable-tune-unit');
    wavetableTuneUnit.textContent = 'ST';

    const wavetableTunePlus = el('button');
    wavetableTunePlus.type = 'button';
    wavetableTunePlus.textContent = '+';
    wavetableTunePlus.title = 'Transpose wavetable audition up by 1 semitone. Shortcut: = / + (Shift for octave).';

    const wavetableTuneReset = el('button');
    wavetableTuneReset.type = 'button';
    wavetableTuneReset.textContent = '0';
    wavetableTuneReset.title = 'Reset wavetable view transpose to 0 semitones.';

    function syncWavetableTuneUi(){
      const st = (typeof getWavetableTuneSemitones === 'function')
        ? getWavetableTuneSemitones()
        : 0;
      wavetableTuneInput.value = String(st);
      wavetableTuneMinus.disabled = st <= -48;
      wavetableTunePlus.disabled = st >= 48;
    }

    function applyWavetableTune(next){
      const st = (typeof setWavetableAuditionTune === 'function')
        ? setWavetableAuditionTune(next, { restartPreview: true })
        : ((typeof setWavetableTuneSemitones === 'function')
          ? setWavetableTuneSemitones(next)
          : Math.max(-48, Math.min(48, parseInt(next, 10) || 0)));
      syncWavetableTuneUi();
      try{
        if (typeof requestWavetableViewportDraw === 'function') requestWavetableViewportDraw();
      }catch(_){ }
      return st|0;
    }

    function stepWavetableTune(delta){
      const st = (typeof getWavetableTuneSemitones === 'function')
        ? getWavetableTuneSemitones()
        : 0;
      applyWavetableTune((st|0) + (delta|0));
    }

    function sanitizeWavetableTuneDraft(raw){
      raw = String(raw == null ? '' : raw).replace(/\s+/g, '');
      let sign = '';
      if (raw.startsWith('-') || raw.startsWith('+')){
        sign = raw.charAt(0);
        raw = raw.slice(1);
      }
      raw = raw.replace(/[^\d]/g, '');
      if (raw.length > 2) raw = raw.slice(0, 2);
      return sign + raw;
    }

    function commitWavetableTuneInput(){
      const raw = sanitizeWavetableTuneDraft(wavetableTuneInput.value);
      if (wavetableTuneInput.value !== raw) wavetableTuneInput.value = raw;
      if (!raw || raw === '-' || raw === '+'){
        syncWavetableTuneUi();
        return;
      }
      applyWavetableTune(raw);
    }

    function bindRepeatTuneButton(btn, delta){
      let holdStartTimer = 0;
      let holdRepeatTimer = 0;
      let activePointerId = null;
      let suppressNextClick = false;

      const clearHold = ()=>{
        if (holdStartTimer){
          try{ clearTimeout(holdStartTimer); }catch(_){ }
          holdStartTimer = 0;
        }
        if (holdRepeatTimer){
          try{ clearInterval(holdRepeatTimer); }catch(_){ }
          holdRepeatTimer = 0;
        }
        activePointerId = null;
      };

      const stopHold = (ev)=>{
        if (activePointerId == null) return;
        if (ev && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        clearHold();
        try{
          if (ev && ev.pointerId != null && btn.hasPointerCapture && btn.hasPointerCapture(ev.pointerId)){
            btn.releasePointerCapture(ev.pointerId);
          }
        }catch(_){ }
        setTimeout(()=>{ suppressNextClick = false; }, 0);
      };

      btn.addEventListener('pointerdown', (ev)=>{
        if (btn.disabled) return;
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        suppressNextClick = true;
        activePointerId = ev.pointerId;
        try{ btn.setPointerCapture(ev.pointerId); }catch(_){ }
        ev.preventDefault();
        stepWavetableTune(delta);
        holdStartTimer = setTimeout(()=>{
          holdStartTimer = 0;
          holdRepeatTimer = setInterval(()=>{
            if (btn.disabled){
              clearHold();
              return;
            }
            stepWavetableTune(delta);
          }, 70);
        }, 280);
      });

      btn.addEventListener('pointerup', stopHold);
      btn.addEventListener('pointercancel', stopHold);
      btn.addEventListener('lostpointercapture', stopHold);
      btn.addEventListener('click', (ev)=>{
        if (suppressNextClick){
          suppressNextClick = false;
          ev.preventDefault();
          return;
        }
        if (btn.disabled) return;
        stepWavetableTune(delta);
      });
    }

    bindRepeatTuneButton(wavetableTuneMinus, -1);
    bindRepeatTuneButton(wavetableTunePlus, 1);
    wavetableTuneReset.onclick = ()=>{ applyWavetableTune(0); };
    wavetableTuneInput.oninput = ()=>{
      const raw = sanitizeWavetableTuneDraft(wavetableTuneInput.value);
      if (wavetableTuneInput.value !== raw) wavetableTuneInput.value = raw;
      if (!raw || raw === '-' || raw === '+') return;
      applyWavetableTune(raw);
    };
    wavetableTuneInput.onchange = ()=>{ commitWavetableTuneInput(); };
    wavetableTuneInput.onblur = ()=>{ commitWavetableTuneInput(); };
    wavetableTuneInput.onkeydown = (ev)=>{
      if (ev.key === 'Enter'){
        commitWavetableTuneInput();
        try{ wavetableTuneInput.blur(); }catch(_){ }
      } else if (ev.key === 'Escape'){
        syncWavetableTuneUi();
        try{ wavetableTuneInput.blur(); }catch(_){ }
      }
    };
    syncWavetableTuneUi();
    wavetableTuneRow.append(wavetableTuneMinus, wavetableTuneInput, wavetableTuneUnit, wavetableTunePlus, wavetableTuneReset);
    wavetableTuneOverlay.append(wavetableTuneRow);

    const _nameIn = nameIn = el('input');
  _nameIn.maxLength = 4;
  // visual uppercase in the input
  _nameIn.style.textTransform = 'uppercase';
  // initialise uppercase
  _nameIn.value = (EDIT.name || 'WAVE').toUpperCase();
  // enforce uppercase as user types (and clamp to 4 chars)
  _nameIn.oninput = ()=>{
    _nameIn.value = (_nameIn.value || '').toUpperCase().slice(0,4);
    // Keep EDIT.name in sync while editing (auto-saved on slot change / upload / export).
    EDIT.name = _nameIn.value;

    // Treat rename like an edit so it participates in auto-save and batch actions.
    try{ touch(); }catch(_){ }
  };
  _nameIn.title = '4-character ASCII name (device rule). Factory waves cannot be renamed on the device.';

    // Simplified header: Slot # + Name (removed A–H × 1–8)
    const slotRow = el('div','mm-digi-editor-bar');
    const slotLbl = el('div','mm-small'); slotLbl.textContent = String((EDIT.slot|0)+1) + ':';

    // HOT indicator in the editor header (shows when _dpHeat > 1)
    const heatBadge = el('span','mm-heat-badge');
    const editHeat = dpHeatOf(EDIT);
    heatBadge.textContent = '🔥';
    heatBadge.title = `HOT gain ×${editHeat.toFixed(2)} (affects upload/export; may clip)`;
    if (!(editHeat > 1.0001)) heatBadge.style.display = 'none';

    const nameLbl = el('label'); nameLbl.appendChild(_nameIn);
    slotRow.append(slotLbl, heatBadge, nameLbl);

    function paint(){
      const ctx = canv.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      const w = (canv.width|0);
      const h = (canv.height|0);

      // Background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0,0,w,h);

      // Subtle vertical stripes like the reference UI
      const stripes = 16;
      ctx.fillStyle = '#f5f5f5';
      for (let s=0; s<stripes; s++){
        if (s % 2 === 1){
          const x0 = Math.round((s/stripes)*w);
          const x1 = Math.round(((s+1)/stripes)*w);
          ctx.fillRect(x0, 0, Math.max(0, x1 - x0), h);
        }
      }

      // Faint stripe boundaries
      ctx.strokeStyle = '#eee';
      ctx.beginPath();
      for (let s=0; s<=stripes; s++){
        const gx = Math.round((s/stripes)*w);
        ctx.moveTo(gx,0);
        ctx.lineTo(gx,h);
      }
      ctx.stroke();

      // Border + center line
      ctx.strokeStyle = '#999';
      ctx.strokeRect(0,0,w,h);

      ctx.strokeStyle = '#888';
      ctx.beginPath();
      const cy = Math.round(h/2) + 0.5;
      ctx.moveTo(0,cy);
      ctx.lineTo(w,cy);
      ctx.stroke();

      // MnM clip safety guide (~40% full-scale amplitude).
      // Visual only — does not alter waveform data.
      const mnmGuideV = 0.40;
      const yGuideTop = Math.round((h-1) * 0.5 * (1 - mnmGuideV)) + 0.5;
      const yGuideBot = Math.round((h-1) * 0.5 * (1 + mnmGuideV)) + 0.5;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, yGuideTop);
      ctx.lineTo(w, yGuideTop);
      ctx.moveTo(0, yGuideBot);
      ctx.lineTo(w, yGuideBot);
      ctx.stroke();
      ctx.restore();

      // Waveform
      if (!EDIT.dataU8) return;
      ctx.strokeStyle = '#222';
      ctx.beginPath();
      const N = (EDIT.dataU8.length|0);

      // Raw view only: treat 128 as center, full-scale as 128.
      const mean = 128;
      const peak = 128;

      for (let x=0;x<w;x++){
        const i = Math.min(N-1, Math.round(x * (N-1)/(w-1)));
        const v = ((EDIT.dataU8[i]|0) - mean) / peak;
        const y = h - 1 - Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * (h-1));
        if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    paintEditor = paint; // === PATCH: expose for Undo

    // Drawing tool: larger canvas + fine edits. Drag draws a line (interpolated across samples).
    (function attachDraw(){
      let down=false, lastI=null, lastV=null;

      function finishStroke(e){
        if (!down) return;
        down=false;
        lastI=null; lastV=null;

        // Push a post-edit snapshot so viewer edits are fully undoable/redoable.
        snapshot('draw');
        try{ if (e && e.pointerId != null) canv.releasePointerCapture(e.pointerId); }catch(_){ }
        touch();
      }

      canv.addEventListener('pointerdown', (e)=>{
        if (e && e.shiftKey){
          e.preventDefault();
          try{ if (typeof toggleKeyboardView === 'function') toggleKeyboardView(); }catch(_){ }
          return;
        }
        down=true;
        try{ canv.setPointerCapture(e.pointerId); }catch(_){ }

        const {i,v} = indexValueFromEvent(e);
        applyAt(i,v,true);
      });
      canv.addEventListener('pointerup',   (e)=>finishStroke(e));
      canv.addEventListener('pointerleave',()=>finishStroke(null));
      canv.addEventListener('pointermove', (e)=>{ if (down) { const {i,v} = indexValueFromEvent(e); applyAt(i,v,false); } });

      function indexValueFromEvent(e){
        const rect = canv.getBoundingClientRect();
        const x = e.clientX-rect.left, y=e.clientY-rect.top;
        const N = EDIT.dataU8.length;
        const w = Math.max(2, rect.width);
        const h = Math.max(2, rect.height);
        const i = clamp(Math.round((x/(w-1))*(N-1)), 0, N-1);

        const v = clamp(128 - Math.round(((y/(h-1))-0.5)*2*128), 0, 255);

        return {i,v};
      }
      function applyAt(i,v,first){
        if (first || lastI===null){
          EDIT.dataU8[i] = v;
          lastI=i; lastV=v;
          paint();
          return;
        }
        const di = i - lastI;
        const steps = Math.max(1, Math.abs(di));
        for (let s=0;s<=steps;s++){
          const t = s/steps;
          const idx = Math.max(0, Math.min(EDIT.dataU8.length-1, Math.round(lastI + di*t)));
          const val = Math.max(0, Math.min(255, Math.round(lastV + (v-lastV)*t)));
          EDIT.dataU8[idx] = val;
        }
        lastI=i; lastV=v;
        paint();
      }
    })();

    function touch(){
      // Mark dirty + update the grid preview/name (without committing to LIB.waves).
      LIB.dirty.add(EDIT.slot);

      // Prefer a full cell repaint when available (it will also respect editor-dirty display rules).
      if (typeof paintGridCell === 'function'){
        try{ paintGridCell(EDIT.slot|0); }catch(_){ }
      } else {
        const cell = bySel(`.mm-digi-slot[data-idx="${EDIT.slot}"]`);
        const mini = cell && cell.querySelector('canvas');
        if (mini) drawMini(mini, { dataU8: EDIT.dataU8 });
        const nmEl = cell && cell.querySelector('.nm');
        if (nmEl) nmEl.textContent = (EDIT.name || '').toUpperCase();
      }

      updateButtonsState();
    }

    function simpleCopyU8(src){
      const out = (src instanceof Uint8Array) ? new Uint8Array(src) : new Uint8Array(src || []);
      try{
        if (src && src.displayRot !== undefined) out.displayRot = src.displayRot|0;
      }catch(_){ }
      return out;
    }

    function simpleSlotSnapshot(slot){
      slot = slot|0;
      const editorSlot = EDIT.slot|0;
      const libRec = LIB.waves[slot] || null;
      const hasLibWave = !!(libRec && libRec.dataU8 && libRec.dataU8.length);
      const isDirtyActive = slot === editorSlot
        && !!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(slot))
        && !!(EDIT && EDIT.dataU8 && EDIT.dataU8.length);

      if (isDirtyActive){
        let hasUnsavedWave = hasLibWave;
        if (!hasUnsavedWave){
          if (typeof isSilentU8 === 'function') hasUnsavedWave = !isSilentU8(EDIT.dataU8);
          else {
            hasUnsavedWave = false;
            for (let i=0;i<(EDIT.dataU8.length|0);i++){
              if ((EDIT.dataU8[i]|0) !== 128){ hasUnsavedWave = true; break; }
            }
          }
        }
        if (!hasUnsavedWave) return null;
        return {
          slot,
          name: String(EDIT.name || 'WAVE'),
          heat: (typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1,
          dataU8: simpleCopyU8(EDIT.dataU8)
        };
      }

      if (!hasLibWave) return null;

      return {
        slot,
        name: String(libRec.name || 'WAVE'),
        heat: (typeof libRec._dpHeat === 'number' && isFinite(libRec._dpHeat) && libRec._dpHeat > 0) ? libRec._dpHeat : 1,
        dataU8: simpleCopyU8(libRec.dataU8)
      };
    }

    function resolveSimpleTargets(){
      const sel = Array.from(SELECTED || [])
        .map(n=>n|0)
        .filter(s=>s>=0 && s<64)
        .sort((a,b)=>a-b);
      const scope = sel.length ? 'selected' : 'wavetable';
      const candidates = sel.length ? sel : Array.from({length:64}, (_, idx)=>idx|0);
      const targets = [];
      const liveBySlot = Object.create(null);

      for (const slot of candidates){
        const snap = simpleSlotSnapshot(slot);
        if (!snap) continue;
        targets.push(slot|0);
        liveBySlot[slot] = snap;
      }

      return { scope, targets, liveBySlot };
    }

    function captureSimpleBase(liveRec, index, count){
      if (!liveRec || !liveRec.dataU8 || !liveRec.dataU8.length) return null;

      const slot = liveRec.slot|0;
      const cached = SIMPLE_MODE_RUNTIME.sources ? SIMPLE_MODE_RUNTIME.sources[slot] : null;
      const slotState = dpSimpleFanoutState(SIMPLE_MODE_STATE, index, count);

      if (cached && cached.dataU8 && cached.dataU8.length === liveRec.dataU8.length){
        const expected = dpApplySimpleModeStateU8(cached.dataU8, slotState);
        if (dpSimpleWaveMatches(expected, liveRec.dataU8)){
          return {
            slot,
            name: liveRec.name,
            heat: liveRec.heat,
            dataU8: simpleCopyU8(cached.dataU8)
          };
        }
      }

      const fresh = simpleCopyU8(liveRec.dataU8);
      SIMPLE_MODE_RUNTIME.sources[slot] = { dataU8: simpleCopyU8(fresh) };
      SIMPLE_MODE_RUNTIME.source = { slot, dataU8: simpleCopyU8(fresh) };
      return {
        slot,
        name: liveRec.name,
        heat: liveRec.heat,
        dataU8: fresh
      };
    }

    function applyPendingSimplePreview(){
      SIMPLE_MODE_RUNTIME.pendingPreview = false;
      SIMPLE_MODE_RUNTIME.pendingBase = null;
      SIMPLE_MODE_RUNTIME.pendingPaint = null;
      SIMPLE_MODE_RUNTIME.pendingTouch = null;

      const gesture = SIMPLE_MODE_RUNTIME.gesture;
      if (!gesture || !gesture.targets || !gesture.targets.length) return false;

      const targets = gesture.targets;
      const targetCount = targets.length|0;
      const editorSlot = EDIT.slot|0;
      let activeTouched = false;
      let changed = false;

      for (let i=0;i<targetCount;i++){
        const slot = targets[i]|0;
        const baseRec = gesture.baseBySlot[slot];
        if (!baseRec || !baseRec.dataU8 || !baseRec.dataU8.length) continue;

        const liveRec = simpleSlotSnapshot(slot);
        const slotState = dpSimpleFanoutState(SIMPLE_MODE_STATE, i, targetCount);
        const nextU8 = dpApplySimpleModeStateU8(baseRec.dataU8, slotState);
        if (!liveRec || !dpSimpleWaveMatches(nextU8, liveRec.dataU8)) changed = true;

        const rec = attachDisplayRot({ name: baseRec.name, dataU8: nextU8, user:true }, false);
        rec._dpHeat = baseRec.heat;
        LIB.waves[slot] = rec;
        LIB.userWaves[slot] = rec;

        if (slot === editorSlot){
          activeTouched = true;
          EDIT.name = baseRec.name;
          EDIT._dpHeat = baseRec.heat;
          EDIT.dataU8 = simpleCopyU8(rec.dataU8);
          if (nameIn) nameIn.value = (EDIT.name || 'WAVE').toUpperCase();
        }

        paintGridCell(slot);
      }

      if (activeTouched) paint();
      try{ if (typeof requestWavetableViewportDraw === 'function') requestWavetableViewportDraw(); }catch(_){ }
      if (changed) gesture.changed = true;
      return changed;
    }

    function flushSimplePreview(){
      if (SIMPLE_MODE_RUNTIME.raf){
        try{ cancelAnimationFrame(SIMPLE_MODE_RUNTIME.raf); }catch(_){ }
        SIMPLE_MODE_RUNTIME.raf = 0;
      }
      return applyPendingSimplePreview();
    }

    function scheduleSimplePreview(label){
      SIMPLE_MODE_RUNTIME.pendingPreview = true;
      SIMPLE_MODE_RUNTIME.pendingLabel = label || 'Table Mode';
      if (SIMPLE_MODE_RUNTIME.raf) return;
      SIMPLE_MODE_RUNTIME.raf = requestAnimationFrame(()=>{
        SIMPLE_MODE_RUNTIME.raf = 0;
        applyPendingSimplePreview();
      });
    }

    function beginSimpleGesture(label){
      if (SIMPLE_MODE_RUNTIME.gesture) return SIMPLE_MODE_RUNTIME.gesture;

      const resolved = resolveSimpleTargets();
      const targets = resolved.targets || [];
      if (!targets.length) return null;

      const baseBySlot = Object.create(null);
      for (let i=0;i<targets.length;i++){
        const slot = targets[i]|0;
        const baseRec = captureSimpleBase(resolved.liveBySlot[slot], i, targets.length);
        if (baseRec) baseBySlot[slot] = baseRec;
      }

      SIMPLE_MODE_RUNTIME.gesture = {
        scope: resolved.scope,
        targets,
        baseBySlot,
        before: captureBankState(targets, { preferEditor:true, includeSimpleMode:true }),
        label: label || 'Table Mode',
        changed: false
      };
      return SIMPLE_MODE_RUNTIME.gesture;
    }

    function commitSimpleGesture(label){
      const gesture = SIMPLE_MODE_RUNTIME.gesture;
      flushSimplePreview();
      SIMPLE_MODE_RUNTIME.gesture = null;
      if (!gesture || !gesture.changed || !gesture.targets || !gesture.targets.length) return;

      const editorSlot = EDIT.slot|0;
      const activeTouched = gesture.targets.includes(editorSlot);

      for (const slot of gesture.targets){
        LIB.dirty.delete(slot|0);
        paintGridCell(slot|0);
      }

      if (activeTouched){
        const rec = LIB.waves[editorSlot] || null;
        if (rec && rec.dataU8 && rec.dataU8.length){
          EDIT.name = String(rec.name || EDIT.name || 'WAVE');
          EDIT._dpHeat = (typeof rec._dpHeat === 'number' && isFinite(rec._dpHeat) && rec._dpHeat > 0) ? rec._dpHeat : 1;
          EDIT.dataU8 = simpleCopyU8(rec.dataU8);
          if (nameIn) nameIn.value = (EDIT.name || 'WAVE').toUpperCase();
          paint();
        }
      }

      const after = captureBankState(gesture.targets, { includeSimpleMode:true });
      if (gesture.before){
        bankPush({
          label: label || gesture.label || 'Table Mode',
          before: gesture.before,
          after
        });
      }
      if (activeTouched) resetUndoToCurrent(true);
      if (typeof announceIO === 'function' && !(JOB && JOB.running)){
        const scopeLabel = (gesture.scope === 'selected')
          ? `${gesture.targets.length} selected slot${gesture.targets.length===1 ? '' : 's'}`
          : `${gesture.targets.length} filled slot${gesture.targets.length===1 ? '' : 's'}`;
        announceIO(`${label || gesture.label || 'Table Mode'} applied to ${scopeLabel}.`);
      }
      updateButtonsState();
      try{ if (typeof requestWavetableViewportDraw === 'function') requestWavetableViewportDraw(); }catch(_){ }
    }

    const simpleTop = el('div','mm-simple-top');
    const simpleModeToggle = el('button','btn btn-small mm-simple-toggle');
    simpleModeToggle.type = 'button';
    simpleModeToggle.textContent = 'Table Mode';
    const simpleMorphWrap = el('label','mm-simple-morph');
    const simpleMorphLabel = el('span','mm-simple-morph-label');
    simpleMorphLabel.textContent = 'Morph';
    const simpleMorphSelect = el('select','mm-simple-morph-select');
    DP_SIMPLE_MORPH_OPTIONS.forEach(([value, label])=>{
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      simpleMorphSelect.appendChild(opt);
    });
    simpleMorphWrap.append(simpleMorphLabel, simpleMorphSelect);

    const simpleReset = el('button','btn btn-small mm-simple-reset');
    simpleReset.type = 'button';
    simpleReset.textContent = 'Reset';
    simpleReset.title = 'Reset Table Mode controls to their neutral defaults.';

    const simpleSliders = el('div','mm-simple-sliders');
    const simpleRefs = new Map();

    function refreshSimpleControls(){
      try{ simpleMorphSelect.value = SIMPLE_MODE_STATE.morph; }catch(_){ }
      for (const ctl of DP_SIMPLE_MODE_CONTROLS){
        const ref = simpleRefs.get(ctl.id);
        if (!ref) continue;
        const v = SIMPLE_MODE_STATE[ctl.id]|0;
        const disabledReason = dpSimpleControlDisabledReason(ctl.id, SIMPLE_MODE_STATE.morph);
        const isDisabled = !!disabledReason;
        ref.input.value = String(v);
        ref.input.disabled = isDisabled;
        ref.input.setAttribute('aria-valuetext', dpSimpleValueText(ctl.id, v));
        ref.input.title = isDisabled ? disabledReason : `${ctl.label}: ${dpSimpleValueText(ctl.id, v)}`;
        ref.value.textContent = dpSimpleValueText(ctl.id, v);
        if (ref.card){
          ref.card.classList.toggle('is-disabled', isDisabled);
          ref.card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
          ref.card.title = isDisabled ? disabledReason : '';
        }
      }
      simpleReset.disabled = dpSimpleIsNeutral(SIMPLE_MODE_STATE);
    }

    function syncSimpleModeUi(){
      const isSimple = SIMPLE_MODE_STATE.mode === 'simple';
      const toggleTitle = isSimple
        ? 'Table Mode is active. Click to return to the classic FX grid. Shortcut: Shift-click the status line.'
        : 'Classic FX grid is active. Click to open Table Mode. Shortcut: Shift-click the status line.';
      if (statusRow){
        statusRow.classList.toggle('is-simple', isSimple);
        statusRow.title = toggleTitle;
      }
      if (ioMsgEl) ioMsgEl.title = toggleTitle;
      if (simpleModeToggle){
        simpleModeToggle.setAttribute('aria-pressed', isSimple ? 'true' : 'false');
        simpleModeToggle.title = toggleTitle;
      }
      tools.hidden = false;
      simplePanel.hidden = false;
      tools.style.display = isSimple ? 'none' : 'grid';
      simplePanel.style.display = isSimple ? 'flex' : 'none';
      simplePanel.classList.toggle('is-active', isSimple);
      refreshSimpleControls();
    }

    function applySimpleImmediate(label){
      beginSimpleGesture(label);
      scheduleSimplePreview(label);
      commitSimpleGesture(label);
      syncSimpleModeUi();
    }

    function toggleSimpleMode(){
      commitSimpleGesture();
      if (SIMPLE_MODE_STATE.mode === 'simple'){
        dpPersistSimpleModeState(Object.assign({}, SIMPLE_MODE_STATE, { mode:'classic' }));
      } else {
        // Enter each Simple Mode session from a neutral control state so any
        // previously saved slider values never reshape the current wavetable implicitly.
        const next = dpSimpleDefaultState();
        next.mode = 'simple';
        dpPersistSimpleModeState(next);
      }
      syncSimpleModeUi();
    }

    statusRow.onclick = (ev)=>{
      if (ev && ev.shiftKey){
        ev.preventDefault();
        toggleSimpleMode();
      }
    };

    simpleModeToggle.addEventListener('click', (ev)=>{
      if (ev){
        ev.preventDefault();
        ev.stopPropagation();
      }
      toggleSimpleMode();
    });

    simpleMorphSelect.addEventListener('change', ()=>{
      beginSimpleGesture('Simple Morph');
      dpPersistSimpleModeState(Object.assign({}, SIMPLE_MODE_STATE, {
        morph: simpleMorphSelect.value
      }));
      applySimpleImmediate('Simple Morph');
    });

    simpleReset.onclick = ()=>{
      beginSimpleGesture('Simple Reset');
      const next = dpSimpleDefaultState();
      next.mode = SIMPLE_MODE_STATE.mode;
      dpPersistSimpleModeState(next);
      applySimpleImmediate('Simple Reset');
    };

    for (const ctl of DP_SIMPLE_MODE_CONTROLS){
      const card = el('div','mm-simple-slider');
      const labelEl = el('div','mm-simple-slider-label');
      labelEl.textContent = ctl.label;
      const track = el('div','mm-simple-slider-track');
      const input = el('input','mm-simple-range');
      input.type = 'range';
      input.min = String(ctl.min);
      input.max = String(ctl.max);
      input.step = String(ctl.step || 1);
      input.value = String(SIMPLE_MODE_STATE[ctl.id]|0);
      input.setAttribute('aria-label', `${ctl.label} amount`);
      input.setAttribute('orient', 'vertical');
      input.setAttribute('aria-valuetext', dpSimpleValueText(ctl.id, SIMPLE_MODE_STATE[ctl.id]|0));
      input.title = `${ctl.label}: ${dpSimpleValueText(ctl.id, SIMPLE_MODE_STATE[ctl.id]|0)}`;
      const valueEl = el('div','mm-simple-slider-value');
      valueEl.textContent = dpSimpleValueText(ctl.id, SIMPLE_MODE_STATE[ctl.id]|0);

      const gestureLabel = `Simple ${ctl.label}`;
      const startGesture = ()=>{
        if (!SIMPLE_MODE_RUNTIME.gesture) beginSimpleGesture(gestureLabel);
      };
      const finishGesture = ()=>{
        commitSimpleGesture(gestureLabel);
        syncSimpleModeUi();
      };

      input.addEventListener('pointerdown', ()=>{ startGesture(); });
      input.addEventListener('input', ()=>{
        startGesture();
        const nextValue = Math.max(ctl.min, Math.min(ctl.max, parseInt(input.value, 10) || 0));
        dpPersistSimpleModeState(Object.assign({}, SIMPLE_MODE_STATE, { [ctl.id]: nextValue }));
        valueEl.textContent = dpSimpleValueText(ctl.id, nextValue);
        input.setAttribute('aria-valuetext', dpSimpleValueText(ctl.id, nextValue));
        input.title = `${ctl.label}: ${dpSimpleValueText(ctl.id, nextValue)}`;
        simpleReset.disabled = dpSimpleIsNeutral(SIMPLE_MODE_STATE);
        scheduleSimplePreview(gestureLabel);
      });
      input.addEventListener('change', finishGesture);
      input.addEventListener('pointerup', finishGesture);
      input.addEventListener('pointercancel', finishGesture);
      input.addEventListener('blur', ()=>{
        if (SIMPLE_MODE_RUNTIME.gesture) finishGesture();
      });

      track.appendChild(input);
      card.append(labelEl, track, valueEl);
      simpleSliders.appendChild(card);
      simpleRefs.set(ctl.id, { card, input, value: valueEl });
    }

    root.__digiproBeforeUndoRedo = ()=>{
      if (!SIMPLE_MODE_RUNTIME.gesture && !SIMPLE_MODE_RUNTIME.raf) return;
      commitSimpleGesture();
      syncSimpleModeUi();
    };

    simpleTop.append(simpleMorphWrap, simpleReset);
    simplePanel.append(simpleTop, simpleSliders);
    toolsSwap.append(tools, simplePanel);

    // ---- editor tools ----
    const btnSmooth = el('button'); btnSmooth.textContent = 'Smooth';
const btnZero   = el('button'); btnZero.textContent   = 'Zero';

// --- Multi-apply via unified dispatcher for Smooth/Zero ---


btnSmooth.onclick = ()=>applyNamedEffect('Smooth', fxSmooth);
btnZero.onclick   = ()=>applyNamedEffect('Zero',   fxZero);

;

    // --- Extra effects under Zero ---

    // === PATCH: named effect applier with Undo
function applyNamedEffect(label, f){
      if (!EDIT.dataU8) return;
      const paint = paintEditor || function(){};

      const hasSelection = SELECTED && SELECTED.size > 0;

      // No selection → original single-slot behavior (editor only)
      if (!hasSelection){
        const next = f(EDIT.dataU8);
        if (next){
          EDIT.dataU8 = next;
          snapshot(label || (f && f.name) || 'effect');
          paint();
          touch();
        }
        return;
      }

      // Multi-select path (bank commit + bank undo)
      const sel = Array.from(SELECTED).sort((a,b)=>a-b);

      const actSlot = EDIT.slot|0;
      const actName = EDIT.name;
      const actData = EDIT.dataU8 ? new Uint8Array(EDIT.dataU8) : null;

      const __bankBefore = captureBankState(sel, { preferEditor:true });

      let applied = 0;
      let newActData = null;

      const prevSlot = EDIT.slot;
      const prevData = EDIT.dataU8;
      const prevName = EDIT.name;

      try{
	        for (const s of sel){
	          const useEditor = (s === (EDIT.slot|0)) && !!(LIB.dirty && LIB.dirty.has(s));
	          const w = useEditor
	            ? { name: EDIT.name, dataU8: EDIT.dataU8, user:true, _dpHeat: EDIT._dpHeat }
            : LIB.waves[s];
          const src = (s === actSlot) ? actData : (w && w.dataU8);
          if (!src || !src.length) continue;

          // Rebind editor context so FFT/morph FX see correct source
          EDIT.slot  = s;
          EDIT.dataU8 = src;

          let next = null;
          try{ next = f(src); }catch(_){ }
          if (!next || !next.length) continue;

          const out = new Uint8Array(next);
          const name = (s === actSlot)
            ? (actName || 'WAVE')
            : ((w && w.name) ? w.name : 'WAVE');

	          // Commit into the bank (multi-select operations follow commit rules).
	          // Preserve per-wave DigiPRO upload "heat" unless explicitly changed.
	          const rec = attachDisplayRot({ name, dataU8: out, user:true });
	          const heat = (w && typeof w._dpHeat === 'number' && isFinite(w._dpHeat) && w._dpHeat > 0) ? w._dpHeat : 1;
	          rec._dpHeat = heat;
	          LIB.waves[s] = rec;
          LIB.dirty.delete(s);
          paintGridCell(s);

          if (s === actSlot) newActData = out;
          applied++;
        }
      } finally {
        // Restore editor context
        EDIT.slot  = prevSlot;
        EDIT.dataU8 = prevData;
        EDIT.name  = prevName;
      }

      // Sync editor view if active slot was affected (commit rules: clear dirty)
      if (newActData){
        EDIT.dataU8 = newActData;
        if (paintEditor) paintEditor();
        if (nameIn) nameIn.value = EDIT.name;
        LIB.dirty.delete(actSlot);
      }

      if (__bankBefore && applied > 0){
        const __bankAfter = captureBankState(sel);
        bankPush({ label: (label||'Effect') + ' (multi)', before: __bankBefore, after: __bankAfter });
        if (newActData) resetUndoToCurrent(true);
      }

      announceIO(`${label||'Effect'} applied to ${applied}/${sel.length} selected slot${sel.length===1?'':'s'}.`);
      updateButtonsState();
    }
function applyEffect(f){ return applyNamedEffect((f && f.name) || 'effect', f); }






    function findMorphTarget(){
      // Prefer clipboard
      if (CLIP && CLIP.dataU8 && CLIP.dataU8.length===EDIT.dataU8.length) return CLIP.dataU8;
      // Else nearest filled slot (not current)
      const idx = EDIT.slot;
      let best = null, bestDist = 999;
      for (let i=0;i<64;i++){
        if (i===idx) continue;
        const w = LIB.waves[i];
        if (w && w.dataU8 && w.dataU8.length===EDIT.dataU8.length){
          const d = Math.abs(i-idx);
          if (d < bestDist){ bestDist=d; best = w.dataU8; }
        }
      }
      return best;
    }

    // Expose for special-functions.js helpers (fxMorph/fxStack/specMorph).
    // (Those functions live in a separate script/IIFE and need a global binding.)
    root.findMorphTarget = findMorphTarget;




   const btnReverse = el('button'); btnReverse.textContent = 'Reverse'; btnReverse.onclick = ()=>applyEffect(fxReverse);
    const btnMorph = el('button'); btnMorph.textContent = 'Morph'; btnMorph.onclick = ()=>applyEffect(fxMorph);
    const btnWaveShape = el('button'); btnWaveShape.textContent = 'WaveShape'; btnWaveShape.title = 'Use CLIP/nearest slot as a transfer curve to waveshape the current wave.'; btnWaveShape.onclick = ()=>applyNamedEffect('WaveShape', fxWaveShape);
    const btnStack = el('button'); btnStack.textContent = 'Stack'; btnStack.title='Layer with CLIP/nearest slot (amplitude-normalized)';
    btnStack.onclick = ()=>applyNamedEffect('Stack', fxStack);
    const btnNormalize = el('button');
    btnNormalize.textContent = 'Normalize';
    btnNormalize.title = 'Normalize waveform (edits the waveform data).';
    btnNormalize.onclick = ()=>applyEffect(fxNormalize);
    const btnInvert = el('button'); btnInvert.textContent = 'Invert'; btnInvert.onclick = ()=>applyEffect(fxInvert);
    const btnRectify = el('button'); btnRectify.textContent = 'Rectify'; btnRectify.onclick = ()=>applyEffect(fxRectify);
    // --- Extra fun / procedural effects ---










    // === PATCH: 15 new FX ===











    // NEW: Harmonic layer effects (single-cycle friendly)














// === Extra fun FX (new) ===



function fxFFTLowpass12(a){
  return spectralApply((re,im,N,H)=>{
    const keep = Math.min(H-1, 12);
    for (let k=keep+1;k<H;k++){ re[k]=0; im[k]=0; }
  });
}
function fxFFTHighpass8(a){
  return spectralApply((re,im,N,H)=>{
    const cut = Math.min(H-1, 8);
    for (let k=1;k<cut;k++){ re[k]=0; im[k]=0; }
  });
}




    const btnRandom = el('button'); btnRandom.textContent='Randomize'; btnRandom.title='Fill with random values';
    btnRandom.onclick = ()=>applyEffect(fxRandomize);
    const btnPulse = el('button'); btnPulse.textContent='Pulseify'; btnPulse.title='Force to hard pulse based on median threshold';
    btnPulse.onclick = ()=>applyEffect(fxPulseify);
    const btnFold = el('button'); btnFold.textContent='Fold'; btnFold.title='Wavefold at 0.5';
    btnFold.onclick = ()=>applyEffect(fxFold);
    const btnCrush = el('button'); btnCrush.textContent='Crush'; btnCrush.title='3-bit amplitude quantize';
    btnCrush.onclick = ()=>applyEffect(fxCrush);
    const btnJitter = el('button'); btnJitter.textContent='Jitter'; btnJitter.title='Add small random noise';
    btnJitter.onclick = ()=>applyEffect(fxJitter);
    const btnTilt = el('button'); btnTilt.textContent='Tilt'; btnTilt.title='Add linear tilt across cycle';
    btnTilt.onclick = ()=>applyEffect(fxTilt);
    const btnDown = el('button'); btnDown.textContent='Downsample'; btnDown.title='Sample & hold (×2)';
    btnDown.onclick = ()=>applyEffect(fxDownsample);
    const btnMirror = el('button'); btnMirror.textContent='Mirror'; btnMirror.title='Second half mirrors first';
    btnMirror.onclick = ()=>applyEffect(fxMirror);
    const btnPhase = el('button'); btnPhase.textContent='Phase +90°'; btnPhase.title='Rotate by quarter cycle';
    btnPhase.onclick = ()=>applyEffect(fxPhaseShift);
    const btnScramble = el('button'); btnScramble.textContent='Scramble'; btnScramble.title='Shuffle 8 segments';
    btnScramble.onclick = ()=>applyEffect(fxScramble);
    // === PATCH: Buttons for the 15 FX
    const btnHP   = el('button'); btnHP.textContent='HPass';       btnHP.title='3‑tap high‑pass';         btnHP.onclick = ()=>applyNamedEffect('HPass', fxHighpass);
    const btnSharp= el('button'); btnSharp.textContent='Sharpen';  btnSharp.title='Unsharp mask';         btnSharp.onclick = ()=>applyNamedEffect('Sharpen', fxSharpen);
    const btnHC   = el('button'); btnHC.textContent='HardClip';    btnHC.title='Symmetric hard clip';     btnHC.onclick = ()=>applyNamedEffect('HardClip', fxHardClip);
    const btnSC   = el('button'); btnSC.textContent='SoftClip';    btnSC.title='Tanh soft clip';          btnSC.onclick = ()=>applyNamedEffect('SoftClip', fxSoftClip);
    const btnAC   = el('button'); btnAC.textContent='AsymClip';    btnAC.title='Asymmetric clip';         btnAC.onclick = ()=>applyNamedEffect('AsymClip', fxAsymClip);
    const btnG    = el('button'); btnG.textContent='Gamma 0.5';    btnG.title='Amplitude expansion';      btnG.onclick  = ()=>applyNamedEffect('Gamma 0.5', fxGamma05);
    const btnMed  = el('button'); btnMed.textContent='Median';     btnMed.title='3‑point median';         btnMed.onclick= ()=>applyNamedEffect('Median', fxMedian);
    const btnSeg  = el('button'); btnSeg.textContent='Segmentize'; btnSeg.title='8 segment average';      btnSeg.onclick= ()=>applyNamedEffect('Segmentize', fxSegmentize);
    const btnX2   = el('button'); btnX2.textContent='×2 Freq';     btnX2.title='Double frequency';        btnX2.onclick = ()=>applyNamedEffect('×2 Freq', fxDoubleFreq);
    const btnD2   = el('button'); btnD2.textContent='÷2 Freq';     btnD2.title='Half frequency';          btnD2.onclick = ()=>applyNamedEffect('÷2 Freq', fxHalfFreq);
    const btnOctLayer = el('button'); btnOctLayer.textContent='Oct+'; btnOctLayer.title='Octave Layer (adds an octave-up layer, then normalizes)'; btnOctLayer.onclick=()=>applyNamedEffect('Octave Layer', fxOctaveLayer);
    const btnSubLayer = el('button'); btnSubLayer.textContent='Sub+'; btnSubLayer.title='Sub Layer (adds an octave-down layer, then normalizes)'; btnSubLayer.onclick=()=>applyNamedEffect('Sub Layer', fxSubLayer);
    const btnH3Layer  = el('button'); btnH3Layer.textContent='H3';   btnH3Layer.title='3rd Harmonic Layer (adds harmonic 3, then normalizes)'; btnH3Layer.onclick=()=>applyNamedEffect('3rd Harmonic Layer', fxThirdHarmonicLayer);
    const btnHBed     = el('button'); btnHBed.textContent='Bed';  btnHBed.title='Harmonic Bed (adds a harmonic series 2–7, then normalizes)'; btnHBed.onclick=()=>applyNamedEffect('Harmonic Bed', fxHarmonicBed);

    const btnDiff = el('button'); btnDiff.textContent='Differentiate'; btnDiff.title='Edge emphasis';     btnDiff.onclick= ()=>applyNamedEffect('Differentiate', fxDifferentiate);
    const btnInt  = el('button'); btnInt.textContent='Integrate';  btnInt.title='Leaky integrator';       btnInt.onclick = ()=>applyNamedEffect('Integrate', fxIntegrate);
    const btnRing = el('button'); btnRing.textContent='RingMod';   btnRing.title='× with +90° phase';     btnRing.onclick= ()=>applyNamedEffect('RingMod', fxRingMod);
    const btnBF5  = el('button'); btnBF5.textContent='BitFlip5';   btnBF5.title='XOR bit 5';              btnBF5.onclick = ()=>applyNamedEffect('BitFlip5', fxBitFlip5);
    const btnM90  = el('button'); btnM90.textContent='Phase −90°'; btnM90.title='Rotate by −90°';         btnM90.onclick = ()=>applyNamedEffect('Phase −90°', fxPhaseMinus90);

    // === FFT helpers & spectral FX (one-click) ===



function spectralApply(mutator){
  const { re, im } = dftRealU8(EDIT.dataU8);
  const N = re.length, H=N>>1;
  mutator(re, im, N, H);
  enforceConjugateSym(re, im);
  return idftToU8(re, im);
}










// ---- FFT-backed FX (return Uint8Array; use with applyNamedEffect) ----
function fxFFTBright(a){ return spectralApply((re,im,N,H)=>specTilt(re,im,N,H, +0.35)); }
function fxFFTWarm(a){   return spectralApply((re,im,N,H)=>specTilt(re,im,N,H, -0.40)); }
function fxFFTOdd(a){    return spectralApply((re,im,N,H)=>specZeroParity(re,im,N,H,true)); }
function fxFFTEven(a){   return spectralApply((re,im,N,H)=>specZeroParity(re,im,N,H,false)); }
function fxFFTFormant(a){return spectralApply((re,im,N,H)=>specFormant(re,im,N,H)); }
function fxFFTRandPh(a){ return spectralApply((re,im,N,H)=>specRandPhase(re,im,N,H)); }
function fxFFTShift(a){  const s = (Math.random()<0.5?-1:1) * (1 + (Math.random()*2|0)); return spectralApply((re,im,N,H)=>specShift(re,im,N,H,s)); }
function fxFFTCrush(a){  const keep = 6 + (Math.random()*10|0); return spectralApply((re,im,N,H)=>specCrush(re,im,N,H, keep)); }
function fxFFTMorph(a){  return spectralApply((re,im,N,H)=>specMorph(re,im,N,H)); }

function fxFFTMagic(a){
  // Random chain: [tilt] + one of [formant, shift, crush, randphase] + optional odd/even gate
  const steps = [];
  if (Math.random()<0.6) steps.push((re,im,N,H)=>specTilt(re,im,N,H, (Math.random()<0.5?+0.35:-0.40)));
  const pool = [
    (re,im,N,H)=>specFormant(re,im,N,H),
    (re,im,N,H)=>specShift(re,im,N,H, (Math.random()<0.5?-1:1)*(1+(Math.random()*2|0))),
    (re,im,N,H)=>specCrush(re,im,N,H, 6 + (Math.random()*10|0)),
    (re,im,N,H)=>specRandPhase(re,im,N,H),   // ✅ fixed
  ];
  steps.push(pool[(Math.random()*pool.length)|0]);
  if (Math.random()<0.35) steps.push((re,im,N,H)=>specZeroParity(re,im,N,H, Math.random()<0.5));
  return spectralApply((re,im,N,H)=>{ for (const s of steps) s(re,im,N,H); });
}

// ---- Buttons for the spectral FX ----
const btnFFT_Bright = el('button'); btnFFT_Bright.textContent='Bright (FFT)';
btnFFT_Bright.onclick = ()=>applyNamedEffect('Bright (FFT)', fxFFTBright);

const btnFFT_Warm   = el('button'); btnFFT_Warm.textContent='Warm (FFT)';
btnFFT_Warm.onclick = ()=>applyNamedEffect('Warm (FFT)', fxFFTWarm);

const btnFFT_Odd    = el('button'); btnFFT_Odd.textContent='Oddify (FFT)';
btnFFT_Odd.onclick  = ()=>applyNamedEffect('Oddify (FFT)', fxFFTOdd);

const btnFFT_Even   = el('button'); btnFFT_Even.textContent='Evenify (FFT)';
btnFFT_Even.onclick = ()=>applyNamedEffect('Evenify (FFT)', fxFFTEven);

const btnFFT_Form   = el('button'); btnFFT_Form.textContent='Formant (FFT)';
btnFFT_Form.title   = 'Random vowel-like bump';
btnFFT_Form.onclick = ()=>applyNamedEffect('Formant (FFT)', fxFFTFormant);

const btnFFT_Ph     = el('button'); btnFFT_Ph.textContent='PhaseRand (FFT)';
btnFFT_Ph.onclick   = ()=>applyNamedEffect('PhaseRand (FFT)', fxFFTRandPh);

const btnFFT_Shift  = el('button'); btnFFT_Shift.textContent='HarmShift (FFT)';
btnFFT_Shift.onclick= ()=>applyNamedEffect('HarmShift (FFT)', fxFFTShift);

const btnFFT_Crush  = el('button'); btnFFT_Crush.textContent='SpecCrush (FFT)';
btnFFT_Crush.onclick= ()=>applyNamedEffect('SpecCrush (FFT)', fxFFTCrush);

const btnFFT_Morph = el('button');
btnFFT_Morph.textContent = 'SpecMorph (FFT)';
btnFFT_Morph.title = 'Morph magnitudes with CLIP/nearest slot';
btnFFT_Morph.onclick = () => applyNamedEffect('SpecMorph (FFT)', fxFFTMorph);

const btnFFT_Magic  = el('button'); btnFFT_Magic.textContent='FFT Magic ✨';
btnFFT_Magic.title  = 'One-click: tilt + (formant/shift/crush/phase) + optional odd/even';
btnFFT_Magic.onclick= ()=>applyNamedEffect('FFT Magic', fxFFTMagic);


    const btnRandAll = el('button'); btnRandAll.textContent = 'Randomize slots';
    btnRandAll.title = 'Randomize selected slots (if any are selected), otherwise randomize all 64. Each press picks a different random recipe (subtle / FFT-heavy / lo-fi / etc).';
    btnRandAll.onclick = ()=>{
      const sel = Array.from(SELECTED).sort((a,b)=>a-b);
      const targets = sel.length ? sel : Array.from({length:64},(_,i)=>i);
      const label = sel.length ? `${sel.length} selected slot(s)` : 'ALL 64 slots';

      const overlay = el('div','mm-digi-guard');
      const dlg = el('div','dlg');
      const h = el('h4'); h.textContent = `Randomize ${label}?`;
      const p = el('div','mm-small');
      p.textContent = sel.length
        ? 'Only the highlighted tiles will be replaced (in memory). Nothing is sent to the device until you Upload.'
        : 'This replaces every slot in the current bank (in memory). It will NOT send anything to the device until you Upload.';
      const btns = el('div','btns');
      const bGo = el('button'); bGo.textContent = 'Randomize';
      const bCancel = el('button'); bCancel.textContent = 'Cancel';
      bGo.onclick = ()=>{ overlay.remove(); doRandomizeSlots(targets); };
      bCancel.onclick = ()=> overlay.remove();
      btns.append(bGo, bCancel); dlg.append(h,p,btns); overlay.append(dlg); document.body.appendChild(overlay);
    };

    // Correlated "subtle" noise: random walk + a few smoothing passes
function makeSubtleNoise(N){
  const out = new Uint8Array(N);
  let v = 128;                        // start near mid
  for (let i=0;i<N;i++){
    v += (Math.random()*18 - 9);      // small step ±9
    v = Math.max(0, Math.min(255, v));
    out[i] = v;
  }
  // smooth 3–5 times to reduce peaks
  const passes = 2 + (Math.random()*3|0);
  for (let p=0;p<passes;p++){
    const a = out.slice();
    for (let i=0;i<N;i++){
      const m = (a[(i-1+N)%N] + a[i] + a[(i+1)%N]) / 3;
      out[i] = Math.max(0, Math.min(255, Math.round(m)));
    }
  }
  return out;
}

// White noise as before
function makeWhiteNoise(N){
  const out = new Uint8Array(N);
  for (let i=0;i<N;i++) out[i] = (Math.random()*256)|0;
  return out;
}

function floatToU8Normalized(f){
  const N = f.length|0;
  if (!N) return new Uint8Array(0);
  let mean=0;
  for (let i=0;i<N;i++) mean += f[i];
  mean /= N;
  let peak=0;
  for (let i=0;i<N;i++){
    const v = f[i]-mean;
    const a = Math.abs(v);
    if (a>peak) peak=a;
  }
  if (!peak) peak = 1;
  const out = new Uint8Array(N);
  for (let i=0;i<N;i++){
    const v = (f[i]-mean)/peak;
    out[i] = clamp(128 + Math.round(v*127), 0, 255);
  }
  return out;
}

function makeHarmonicBlend(N){
  const H = 1 + ((Math.random()*18)|0); // 1..18 harmonics
  const exp = 0.6 + Math.random()*1.8;
  const f = new Float32Array(N);
  const phases = new Float64Array(H+1);
  for (let k=1;k<=H;k++) phases[k] = Math.random()*Math.PI*2;
  for (let i=0;i<N;i++){
    const t = (2*Math.PI*i)/N;
    let y=0;
    for (let k=1;k<=H;k++){
      y += (1/Math.pow(k,exp)) * Math.sin(k*t + phases[k]);
    }
    f[i] = y;
  }
  return floatToU8Normalized(f);
}

function makePulseWave(N){
  const duty = 0.08 + Math.random()*0.84;
  const thr = Math.floor(duty*N);
  const out = new Uint8Array(N);
  for (let i=0;i<N;i++){
    out[i] = (i < thr) ? 255 : 0;
  }
  try{ return fxNormalize(out) || out; }catch(_){ return out; }
}

function makeFMWave(N){
  const mod = 1 + ((Math.random()*7)|0);
  const idx = 0.5 + Math.random()*6;
  const f = new Float32Array(N);
  for (let i=0;i<N;i++){
    const t = (2*Math.PI*i)/N;
    f[i] = Math.sin(t + idx * Math.sin(mod*t));
  }
  return floatToU8Normalized(f);
}

function randomName4(used){
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const VOWELS  = "AEIOU";
  const CONS    = "BCDFGHJKLMNPQRSTVWXYZ";
  const DIGITS  = "0123456789";
  const SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`";
  const ALL     = LETTERS + DIGITS + SYMBOLS;

  // simple templates
  function cvcv(){ return CONS[rand(CONS)]+VOWELS[rand(VOWELS)]+CONS[rand(CONS)]+VOWELS[rand(VOWELS)]; }
  function cvcc(){ return CONS[rand(CONS)]+VOWELS[rand(VOWELS)]+CONS[rand(CONS)]+CONS[rand(CONS)]; }
  function vccv(){ return VOWELS[rand(VOWELS)]+CONS[rand(CONS)]+CONS[rand(CONS)]+VOWELS[rand(VOWELS)]; }
  function abcd(){ return Array.from({length:4},()=>LETTERS[rand(LETTERS)]).join(''); }
  function leet(){ return Array.from({length:4},()=> (Math.random()<0.7?LETTERS:DIGITS)[rand(Math.random()<0.7?LETTERS:DIGITS)] ).join(''); }
  function spicy(){ return Array.from({length:4},()=> (Math.random()<0.25?SYMBOLS:ALL)[rand(Math.random()<0.25?SYMBOLS:ALL)] ).join(''); }

  const styles = [cvcv, cvcc, vccv, abcd, leet, spicy, spicy];
  for (let i=0;i<16;i++){
    const cand = styles[rand(styles)]();
    if (!used.has(cand)){
      used.add(cand);          // keep symbols as-is
  return cand;
    }
  }
  return ensureUnique4("RNDM", used);

  function rand(pool){ return (Math.random()*pool.length)|0; }
}
    function dpSpecFeature16(u8){
      const N = u8.length|0;
      const H = 16;
      const mags = new Float64Array(H);
      if (!N) return mags;

      // remove DC
      let mean = 0;
      for (let i=0;i<N;i++) mean += ((u8[i]-128)/127);
      mean /= N;

      for (let k=1;k<=H;k++){
        let re=0, im=0;
        for (let n=0;n<N;n++){
          const x = ((u8[n]-128)/127) - mean;
          const ang = (2*Math.PI*k*n)/N;
          re += x * Math.cos(ang);
          im -= x * Math.sin(ang);
        }
        mags[k-1] = Math.sqrt(re*re + im*im);
      }

      // normalize (cosine space)
      let norm=0;
      for (let i=0;i<H;i++) norm += mags[i]*mags[i];
      norm = Math.sqrt(norm) || 1;
      for (let i=0;i<H;i++) mags[i] /= norm;
      return mags;
    }




    function doRandomizeSlots(indices){
      const used = collectUsedNames();

      // ---- Effect pools (sample-domain + FFT) ----
      // NOTE: Many FFT helpers use spectralApply() which reads EDIT.dataU8.
      // During batch randomization we temporarily point EDIT.dataU8 at the
      // candidate buffer so FFT ops correctly operate on *that* slot's wave.
      const TIME_MILD = [
        fxSmooth, fxMedian, fxTilt, fxJitter, fxHighpass, fxSharpen, fxSoftClipParam, fxGamma05,
        fxMirror, fxPhaseShift, fxSkewLeft, fxSkewRight, fxSymOdd,
        fxOctaveLayerParam, fxSubLayerParam
      ];

      const TIME_WILD = [
        fxReverse, fxInvert, fxRectify, fxPulseify, fxFold, fxScrambleParam,
        fxHardClipParam, fxSoftClipParam, fxAsymClipParam,
        fxDifferentiate, fxIntegrate, fxRingMod, fxPhaseMinus90,
        fxDoubleFreqParam, fxHalfFreqParam,
        fxThirdHarmonicLayerParam, fxHarmonicBedParam, fxChebyParam,
        fxChaos
      ];

      const LOFI = [
        fxCrushParam, fxDownsampleParam, fxSegmentizeParam, fxBitFlip5, fxHardClipParam, fxAsymClipParam
      ];

      const FFT_MILD = [
        fxFFTLowpass12, fxFFTHighpass8, fxFFTWarm, fxFFTFormantParam
      ];

      const FFT_WILD = [
        fxFFTBright, fxFFTOdd, fxFFTEven, fxFFTRandPh, fxFFTShiftParam, fxFFTCrushParam, fxSpecSmearParam, fxFFTMagic
      ];

      function randInt(min, max){
        return min + ((Math.random() * ((max - min) + 1)) | 0);
      }
      function pickWeighted(list){
        let sum = 0;
        for (const it of list) sum += it.w;
        let r = Math.random() * sum;
        for (const it of list){
          r -= it.w;
          if (r <= 0) return it.v;
        }
        return list[list.length - 1].v;
      }

      function applyFXSafe(f, a){
        const prev = EDIT.dataU8;
        try{
          EDIT.dataU8 = a;
          const next = dpApplyFxWithOneShotRandomParams(f, a, {
            randomizeParamFx: true,
            waveLen: (a && a.length) ? (a.length|0) : 0,
          });
          return (next && next.length) ? next : a;
        } catch(_){
          return a;
        } finally {
          EDIT.dataU8 = prev;
        }
      }

      // Each press picks a different "recipe" (FFT-heavy, time-heavy, lo-fi, etc.)
      // This makes Randomize feel wide-ranging and less samey between presses.
      const RECIPES = [
        {
          name: 'V5 Classic',
          stepsMin: 1, stepsMax: 3,
          bases: [{w:0.55,v:makeSubtleNoise},{w:0.45,v:makeWhiteNoise}],
          groups: [
            {w:0.80, v: TIME_WILD},
            {w:0.20, v: LOFI}
          ],
          normalizeChance: 0.00,
          diversity: false,
          simLimit: 0.985
        },
        {
          name: 'Hybrid Wide',
          stepsMin: 2, stepsMax: 10,
          bases: [
            {w:0.30,v:makeSubtleNoise},
            {w:0.25,v:makeWhiteNoise},
            {w:0.20,v:makeHarmonicBlend},
            {w:0.15,v:makePulseWave},
            {w:0.10,v:makeFMWave}
          ],
          groups: [
            {w:0.42, v: TIME_WILD},
            {w:0.22, v: LOFI},
            {w:0.36, v: FFT_WILD}
          ],
          normalizeChance: 0.55,
          diversity: true,
          simLimit: 0.975
        },
        {
          name: 'FFT Sculpt',
          stepsMin: 3, stepsMax: 8,
          bases: [
            {w:0.15,v:makeSubtleNoise},
            {w:0.20,v:makeHarmonicBlend},
            {w:0.25,v:makePulseWave},
            {w:0.40,v:makeFMWave}
          ],
          groups: [
            {w:0.20, v: TIME_MILD},
            {w:0.10, v: LOFI},
            {w:0.70, v: FFT_WILD}
          ],
          normalizeChance: 0.65,
          diversity: true,
          simLimit: 0.970
        },
        {
          name: 'Time Chaos',
          stepsMin: 4, stepsMax: 12,
          bases: [
            {w:0.40,v:makeSubtleNoise},
            {w:0.35,v:makeWhiteNoise},
            {w:0.15,v:makeHarmonicBlend},
            {w:0.10,v:makeFMWave}
          ],
          groups: [
            {w:0.75, v: TIME_WILD},
            {w:0.20, v: LOFI},
            {w:0.05, v: FFT_MILD}
          ],
          normalizeChance: 0.35,
          diversity: true,
          simLimit: 0.975
        },
        {
          name: 'LoFi Crunch',
          stepsMin: 2, stepsMax: 8,
          bases: [
            {w:0.20,v:makeWhiteNoise},
            {w:0.25,v:makePulseWave},
            {w:0.35,v:makeHarmonicBlend},
            {w:0.20,v:makeSubtleNoise}
          ],
          groups: [
            {w:0.62, v: LOFI},
            {w:0.33, v: TIME_WILD},
            {w:0.05, v: FFT_MILD}
          ],
          normalizeChance: 0.25,
          diversity: true,
          simLimit: 0.980
        },
        {
          name: 'Pulse & Harmonics',
          stepsMin: 1, stepsMax: 7,
          bases: [
            {w:0.15,v:makeSubtleNoise},
            {w:0.25,v:makeHarmonicBlend},
            {w:0.40,v:makePulseWave},
            {w:0.20,v:makeFMWave}
          ],
          groups: [
            {w:0.40, v: TIME_MILD},
            {w:0.35, v: TIME_WILD},
            {w:0.10, v: LOFI},
            {w:0.15, v: FFT_MILD}
          ],
          normalizeChance: 0.55,
          diversity: true,
          simLimit: 0.972
        }
      ];

      const recipe = RECIPES[(Math.random()*RECIPES.length)|0];

      // Diversity tracking (optional): cosine similarity over 16 harmonic magnitudes
      const feats = [];
      const targetsRaw = (indices && indices.length) ? Array.from(indices) : Array.from({length:64},(_,i)=>i);
      const targets = Array.from(new Set(
        targetsRaw
          .map(n=>n|0)
          .filter(n=>n>=0 && n<64)
      )).sort((a,b)=>a-b);
      if (!targets.length){
        announceIO('No target slots to randomize.', true);
        return;
      }

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      // Snapshot editor state (don't accidentally disturb it when randomizing a selection that excludes the active slot)
      const editorWasSlot = EDIT.slot|0;
      const editorWasName = EDIT.name;
      const editorWasData = EDIT.dataU8;

      for (const s of targets){
        const N = (LIB.waves[s]?.dataU8?.length) || 96;

        let best = null;
        let bestFeat = null;

        const MAX_TRIES = 14;

        for (let attempt=0; attempt<MAX_TRIES; attempt++){
          // base
          const baseFn = pickWeighted(recipe.bases);
          let a;
          try{ a = baseFn(N); }catch(_){ a = makeSubtleNoise(N); }

          // chain length per-slot within recipe range
          const steps = randInt(recipe.stepsMin, recipe.stepsMax);

          for (let k=0;k<steps;k++){
            const pool = pickWeighted(recipe.groups);
            const f = pool[(Math.random()*pool.length)|0];
            a = applyFXSafe(f, a);

            // small chance of mid-chain normalize to keep things lively (prevents occasional "collapse")
            if (Math.random() < 0.08){
              try{ a = fxNormalize(a) || a; }catch(_){}
            }
          }

          // optional final normalize (depends on recipe)
          if (Math.random() < recipe.normalizeChance){
            try{ a = fxNormalize(a) || a; }catch(_){}
          }

          if (isSilentU8(a)) continue;

          if (recipe.diversity){
            const feat = dpSpecFeature16(a);
            const tooSimilar = feats.some(prev => dpCosSim(prev, feat) > recipe.simLimit);
            best = a; bestFeat = feat;
            if (!tooSimilar) break;
          } else {
            best = a; bestFeat = null;
            break;
          }
        }

        let a = best || makeSubtleNoise(N);
        if (recipe.diversity && bestFeat) feats.push(bestFeat);

        // Level: keep a wider range of amplitudes (avoid "everything normalized").
        // This scales around DC=128 so the waveform stays centered.
        const lvl = 0.15 + Math.random() * 0.85; // 0.15..1.00
        a = scaleU8Around128(a, lvl);


        const nm = randomName4(used);
        LIB.waves[s] = attachDisplayRot({ name:nm, dataU8:a, user:true });
        LIB.dirty.delete(s);
        paintGridCell(s);

        if (s === editorWasSlot){
          EDIT.name = nm;
          if (nameIn) nameIn.value = EDIT.name;
          EDIT.dataU8 = new Uint8Array(a);
          if (typeof paintEditor === 'function') paintEditor();
        }
      }

      // Restore editor if we didn't touch the active slot
      if (!targets.includes(editorWasSlot)){
        EDIT.name = editorWasName;
        EDIT.dataU8 = editorWasData;
      }

      const __bankAfter = captureBankState(targets);
      bankPush({
        label: (targets.length === 64)
          ? `Randomize ALL (recipe: ${recipe.name})`
          : `Randomize ${targets.length} slot(s) (recipe: ${recipe.name})`,
        before: __bankBefore,
        after: __bankAfter
      });

      if (targets.includes(editorWasSlot)){
        // Bank-level change touched the current editor slot — reset editor undo baseline
        resetUndoToCurrent(true);
      }

      announceIO(targets.length === 64
        ? `All slots randomized — recipe: ${recipe.name}. Upload when ready to send to device.`
        : `Randomized ${targets.length} slot(s) — recipe: ${recipe.name}. Upload when ready to send to device.`);

      updateButtonsState();
    }

    // Backwards alias
    function doRandomizeAll(){ doRandomizeSlots(Array.from({length:64},(_,i)=>i)); }



    // Device I/O row (build ONCE, append directly — no redeclarations)
    const ioRow = el('div'); ioRow.className='mm-digi-io mm-small';

    // Unified: Download active slot OR selected slots
    btnReqSlots = el('button');
    btnReqSlots.textContent = 'Download slot(s)';
    btnReqSlots.title = 'Request wave dump(s) from the device.\n\n• If tiles are selected: downloads those slots\n• Otherwise: downloads the active slot\n\nTip: Use “Download ALL” for a full bank capture.';

    async function dpRequestOneSlotDump(s, signal){
      // Request a single 0x5D dump and only advance when we have:
      //  - a full-length SysEx (fixed size)
      //  - a successful decode
      //  - a passing checksum
      // If anything fails (timeout/truncation/checksum), retry a few times.
      const wantSlot = (s|0) & 0x3F;

      const MSG_LEN = (root.MMDT_DigiPRO && root.MMDT_DigiPRO.MSG_SIZE_BYTES)
        ? (root.MMDT_DigiPRO.MSG_SIZE_BYTES|0)
        : 7027;

      const maxAttemptsRaw = (typeof window.digiproDownloadRetries === 'number' && isFinite(window.digiproDownloadRetries))
        ? Math.round(window.digiproDownloadRetries)
        : (window.turboActive ? 3 : 2);
      const maxAttempts = Math.max(1, Math.min(8, maxAttemptsRaw));

      const retryDelayBase = (typeof window.digiproDownloadRetryDelayMs === 'number' && isFinite(window.digiproDownloadRetryDelayMs))
        ? Math.max(0, Math.round(window.digiproDownloadRetryDelayMs))
        : 120;

      root.__digiproRequestsInFlight = root.__digiproRequestsInFlight || new Set();
      root.__digiproRequestsInFlight.add(wantSlot);

      const cell = bySel(`.mm-digi-slot[data-idx="${wantSlot}"]`);
      if (cell){
        cell.classList.add('processing-slot');
        cell.classList.remove('processed-slot','failed-slot');
      }

      let lastErr = null;
      try{
        for (let attempt=1; attempt<=maxAttempts; attempt++){
          const ac = new AbortController();
          const unlink = signal ? linkAbort(signal, ac) : null;

          const timeoutMs = (typeof window.dpCalcDumpTimeoutMs === 'function')
            ? window.dpCalcDumpTimeoutMs()
            : (typeof dpCalcDumpTimeoutMs === 'function' ? dpCalcDumpTimeoutMs() : 3500);
          const to = setTimeout(()=>ac.abort(), timeoutMs);

          try{
            const msg = await (root.requestDigiPRODumpAsync
              ? root.requestDigiPRODumpAsync(wantSlot, ac.signal)
              : (root.requestDumpAsync
                ? root.requestDumpAsync(root.MMDT_DigiPRO.ID_DUMP, root.MMDT_DigiPRO.ID_REQ, wantSlot, 0x3F, ac.signal)
                : Promise.reject(new Error('No request helper available'))));

            const u8 = (msg instanceof Uint8Array) ? msg : new Uint8Array(msg || []);
            if (MSG_LEN && u8.length !== MSG_LEN){
              throw new Error(`Bad DigiPRO dump length (${u8.length} bytes, expected ${MSG_LEN}).`);
            }

            const dec = root.MMDT_DigiPRO.decode(u8);
            if (!dec) throw new Error('Decode failed.');
            if (((dec.slot|0) & 0x3F) !== wantSlot){
              throw new Error(`Slot mismatch (got ${dec.slot}, expected ${wantSlot}).`);
            }
            if (dec.checksumOk === false){
              throw new Error('Checksum failed (corrupt dump).');
            }

            const { slot, name, dataU8 } = dec;
            try{ if (dataU8) dataU8.displayRot = 0; }catch(_){ }

            const rec = { name, dataU8, user:true };
            if (dec && dec.kind === 'slot6132' && dec.tables){
              rec._tables6132 = {
                t0: new Int16Array(dec.tables.t0),
                t1: new Int16Array(dec.tables.t1),
                t2: new Int16Array(dec.tables.t2)
              };
            }

            LIB.waves[slot] = attachDisplayRot(rec, true);
            paintGridCell(slot);
            if (cell) cell.classList.add('processed-slot');
            return { ok:true, slot, name, len: (dataU8 && dataU8.length) ? dataU8.length : 0 };
          }catch(err){
            lastErr = err;

            // Retry on transport-ish failures (timeout/truncation/checksum). If cancelled, bail.
            if (signal && signal.aborted) break;
            if (attempt < maxAttempts){
              const backoff = retryDelayBase * attempt;
              await sleepAbortable(backoff, signal);
              continue;
            }
          }finally{
            clearTimeout(to);
            try{ if (unlink) unlink(); }catch(_){ }
          }

          // If we reached here, it means: last attempt failed and we are not continuing.
          break;
        }

        if (cell) cell.classList.add('failed-slot');
        return { ok:false, slot:wantSlot, err:lastErr || new Error('Download failed.') };
      }finally{
        if (root.__digiproRequestsInFlight) root.__digiproRequestsInFlight.delete(wantSlot);
        if (cell) cell.classList.remove('processing-slot');
      }
    }

    btnReqSlots.onclick = async ()=>{
      if (JOB.running){ announceIO('A batch job is already running — cancel/finish it before downloading.', true); return; }

      const targets = (SELECTED && SELECTED.size)
        ? Array.from(SELECTED).map(n=>n|0).filter(s=>s>=0 && s<64).sort((a,b)=>a-b)
        : [EDIT.slot|0];

      if (!targets.length){ announceIO('No target slots to download.', true); return; }
      // Single slot = job (transfer safety + cancellable), multi slot = cancellable job
      if (targets.length === 1){
        const s = targets[0]|0;
        const __bankBefore = captureBankState([s], { preferEditor:true });

        beginJob(`Download slot ${s+1}`, btnReqSlots, { lockMidi:true });

        let r = null;
        try {
          r = await dpRequestOneSlotDump(s, JOB.signal);
        } catch (err){
          r = r || { ok:false, slot:s, err: err || new Error('Download failed') };
        } finally {
          const _cancelled = !!JOB.cancelled;
          endJob();
          r = r || { ok:false, slot:s, err: new Error(_cancelled ? 'Cancelled' : 'Download failed') };
          r._cancelled = _cancelled;
        }

        if (r && r.ok){
          // Keep editor view deterministic if we overwrote the currently-edited slot.
          if (s === (EDIT.slot|0)){
            const prevA = activeIdx;
            openInEditor(s);
            activeIdx = prevA;
            ensureActiveHighlight();
          }

          const __bankAfter = captureBankState([s]);
          bankPush({ label: `Download slot ${s+1}`, before: __bankBefore, after: __bankAfter });

          announceIO(`Downloaded slot ${r.slot+1} “${r.name}” (${r.len} samples).`);
          ensureActiveHighlight();
        } else {
          const msg = (r && r._cancelled)
            ? 'Download cancelled.'
            : `Download failed: ${r && r.err && r.err.message ? r.err.message : 'Device not ready?'}`;
          announceIO(msg, true);
        }

        dpArmClearRxBadges();

        updateButtonsState();
        return;
      }

      let ok=0, fail=0;
      const __bankBefore = captureBankState(targets, { preferEditor:true });
      const downloaded = new Set();

      beginJob(`Download ${targets.length} slot(s)`, btnReqSlots, { lockMidi:true });
      try{
        for (let i=0;i<targets.length;i++){
          if (JOB.cancelled) break;

          const s = targets[i]|0;
          activeIdx = s;
          ensureActiveHighlight();

          announceIO(`Requesting ${i+1}/${targets.length} — slot ${s+1}…`);

          const r = await dpRequestOneSlotDump(s, JOB.signal);
          if (r && r.ok){ ok++; downloaded.add(s); } else fail++;

          await sleepAbortable(dpCalcInterSlotDelayMs(), JOB.signal);
        }
      }catch(err){
        // Cancellation uses AbortController; swallow abort errors.
        if (!JOB.cancelled && !(err && err.name === 'AbortError')) throw err;
      }finally{
        const cancelled = JOB.cancelled;

        // If we overwrote the currently edited slot, refresh the editor buffer (without changing the active tile).
        if (downloaded.has(EDIT.slot|0)){
          const prevA = activeIdx;
          openInEditor(EDIT.slot|0);
          activeIdx = prevA;
          ensureActiveHighlight();
        }

        if (ok>0){
          const __bankAfter = captureBankState(targets);
          bankPush({
            label: cancelled ? `Download ${ok}/${targets.length} slot(s) (partial)` : `Download ${ok}/${targets.length} slot(s)`,
            before: __bankBefore,
            after: __bankAfter
          });
        }

        endJob();

        dpArmClearRxBadges();

        announceIO(cancelled
          ? `Download cancelled. Completed ${ok}/${targets.length} slot(s).`
          : `Download done. Ok: ${ok}, Fail: ${fail}.`);
        updateButtonsState();
      }
      updateButtonsState();
    };
    const btnReqAll = el('button'); btnReqAll.textContent='Download ALL';
    btnReqAll.title = 'Iterate slots 1..64 with device requests.';
    btnReqAll.onclick = async ()=>{
      if (JOB.running){ announceIO('A batch job is already running — cancel/finish it before downloading.', true); return; }

      const prev = activeIdx;
      const allSlots = Array.from({length:64}, (_,i)=>i);
      const __bankBefore = captureBankState(allSlots, { preferEditor:true });
      const downloaded = new Set();

      let ok=0, fail=0;
      beginJob('Download ALL', btnReqAll, { lockMidi:true });

      try{
	          for (let s=0;s<64;s++){
          if (JOB.cancelled) break;

          activeIdx = s;
          ensureActiveHighlight();

          announceIO(`Requesting ${s+1}/64 — slot ${s+1}…`);

          const r = await dpRequestOneSlotDump(s, JOB.signal);
          if (r && r.ok){ ok++; downloaded.add(s); } else fail++;

          // Let the device breathe; also make this pause cancelable.
          await sleepAbortable(dpCalcInterSlotDelayMs(), JOB.signal);
        }
      }catch(err){
        // Cancellation uses AbortController; swallow abort errors.
        if (!JOB.cancelled && !(err && err.name === 'AbortError')) throw err;
      }finally{
        const cancelled = JOB.cancelled;

        // Restore active tile for a deterministic post-job UI state.
        activeIdx = prev;
        ensureActiveHighlight();

        // If we overwrote the currently edited slot, refresh the editor buffer (without changing the active tile).
        if (downloaded.has(EDIT.slot|0)){
          const prevA = activeIdx;
          openInEditor(EDIT.slot|0);
          activeIdx = prevA;
          ensureActiveHighlight();
        }

        if (ok>0){
          const __bankAfter = captureBankState(allSlots);
          bankPush({
            label: cancelled ? `Download ALL (partial ${ok}/64)` : `Download ALL (${ok}/64)`,
            before: __bankBefore,
            after: __bankAfter
          });
        }

        endJob();
        dpArmClearRxBadges();

        announceIO(cancelled
          ? `Bank download cancelled. Received ${ok} slot(s); ${fail} missed.`
          : `Bank download finished. Received ${ok} slot(s); ${fail} missed.`);
        updateButtonsState();
      }
    };

    // Unified: Upload active slot OR selected slots
    btnUploadSlots = el('button');
    btnUploadSlots.textContent='Upload slot(s)';
    btnUploadSlots.title = 'Upload to the device.\n\n• If tiles are selected: uploads those filled slots\n• Otherwise: uploads the active slot\n\nNormal click uses the last saved upload mode (DigiPRO or Machinedrum UW). Shift+Click: change upload mode (and settings).\n\nDevice: DIGIPRO MGR → RECEIVE → ORG is recommended for exact slot placement.\nPOS mode stores sequentially starting at the currently selected position.';
    btnUploadSlots.onclick = async (ev)=>{
      if (JOB.running){ announceIO('A batch job is already running — cancel/finish it before uploading.', true); return; }

      // Upload mode:
      // - normal click: uses the last saved choice from the Shift+Upload modal (defaults to DigiPRO / C6 parity)
      // - shift-click: opens the modal to change the choice
      let gainMode = 'c6';
      let mdChoice = null;

      if (ev && ev.shiftKey){
        if (typeof window.mmPromptShiftUpload === 'function'){
          mdChoice = await window.mmPromptShiftUpload('Upload', {
            selectedCount: (SELECTED && SELECTED.size) ? SELECTED.size : 0,
            allowPack: true
          });
          if (!mdChoice){ announceIO('Upload cancelled.'); return; }
          if (mdChoice && mdChoice.target === 'digipro'){
            gainMode = (mdChoice.gainMode === 'clip') ? 'clip' : 'c6';
            mdChoice = null;
          }
        } else {
          gainMode = await dpPromptGainMode('Upload', 'clip');
          if (!gainMode){ announceIO('Upload cancelled.'); return; }
        }
      } else {
        // Pull the saved default (if present).
        try{
          if (typeof window.mmGetShiftUploadChoice === 'function'){
            const pref = window.mmGetShiftUploadChoice();
            if (pref && pref.target === 'machinedrum') mdChoice = pref;
            else if (pref && pref.target === 'digipro') gainMode = (pref.gainMode === 'clip') ? 'clip' : 'c6';
          }
        }catch(_){}
      }

      // Machinedrum UW SDS path
      if (mdChoice && mdChoice.target === 'machinedrum'){
        if (typeof window.mmSendWavesToMachinedrumUW !== 'function'){
          alert('Machinedrum UW mode is not available: mmSendWavesToMachinedrumUW() is missing.');
          return;
        }

        // Determine source slots: selected tiles (if any) or the active slot.
        const srcSlots = (SELECTED && SELECTED.size)
          ? Array.from(SELECTED).map(n=>n|0).filter(s=>s>=0 && s<64).sort((a,b)=>a-b)
          : [EDIT.slot|0];

        // Only send slots that actually have wave data (including the active dirty editor slot).
        const slots = srcSlots.filter(s=>{
          if (s === (EDIT.slot|0) && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length) return true;
          return !!(LIB.waves[s] && LIB.waves[s].dataU8 && LIB.waves[s].dataU8.length);
        });

        if (!slots.length){
          announceIO('No wave data found to send.', true);
          return;
        }

        const waves = [];
        for (const s of slots){
          const isActive = (s === (EDIT.slot|0));
          const dirtyData = isActive && !!(LIB.dirty && LIB.dirty.has(s));
          const libRec = LIB.waves[s] || null;

          let w = null;
          if (isActive){
            if (dirtyData || !libRec){
              w = { name: (EDIT.name||'WAVE'), dataU8: new Uint8Array(EDIT.dataU8), user:true };
            } else {
              // Preserve higher-res source if available, but take current meta from editor.
              w = Object.assign({}, libRec, { name: (EDIT.name||libRec.name||'WAVE') });
            }
          } else {
            w = libRec;
          }
          if (!w || !w.dataU8 || !w.dataU8.length) continue;

          // Clone u8 so UI edits can’t change mid-send (and preserve displayRot if present).
          const u8 = (w.dataU8 instanceof Uint8Array) ? new Uint8Array(w.dataU8) : new Uint8Array(w.dataU8||[]);
          try{ if (w.dataU8 && typeof w.dataU8.displayRot === 'number') u8.displayRot = w.dataU8.displayRot|0; }catch(_){}

          waves.push({ dpSlot: s, name: (w.name||`S${s+1}`), dataU8: u8, _srcFloat: (w._srcFloat||null) });
        }

        if (!waves.length){
          announceIO('No wave data found to send.', true);
          return;
        }

        announceIO('Machinedrum UW mode: on the MD go to SAMPLE MGR → RECV → ALL, then leave it in receive while sending.', true);

        // Visual state: mark slots as “sending”
        for (const w of waves){
          const cell = bySel(`.mm-digi-slot[data-idx="${w.dpSlot}"]`);
          if (cell){
            cell.classList.remove('sent-slot','send-failed-slot');
            cell.classList.add('sending-slot');
          }
        }

        beginJob('MD UW SDS Upload', btnUploadSlots, { lockMidi:true });
        try{
          await window.mmSendWavesToMachinedrumUW(waves, mdChoice, {
            signal: JOB.signal,
            onStatus: (msg, warn)=>announceIO(msg, !!warn),
            onWaveState: (dpSlot, state)=>{
              const cell = bySel(`.mm-digi-slot[data-idx="${dpSlot}"]`);
              if (!cell) return;
              if (state === 'sending'){
                cell.classList.add('sending-slot');
                cell.classList.remove('sent-slot','send-failed-slot');
                return;
              }
              cell.classList.remove('sending-slot');
              if (state === 'sent') cell.classList.add('sent-slot');
              else if (state === 'failed') cell.classList.add('send-failed-slot');
            }
          });
          announceIO('Machinedrum UW upload complete.');
        }catch(err){
          if (err && err.name === 'AbortError'){
            announceIO('Machinedrum UW upload cancelled.');
          } else {
            console.warn('MD UW upload failed:', err);
            announceIO('Machinedrum UW upload failed: ' + (err && err.message ? err.message : err), true);
          }
        }finally{
          endJob();
          dpArmClearTxBadges();
        }
        return;
      }

      const gain = dpGainForMode(gainMode);

      // If a selection exists, behave like “Upload selected”; otherwise upload the active slot.
      if (SELECTED && SELECTED.size){
        const sel = Array.from(SELECTED).map(n=>n|0).filter(s=>s>=0 && s<64).sort((a,b)=>a-b);

        // Only upload slots that actually have wave data (including the active dirty editor slot)
        const slots = sel.filter(s => {
          if (s === (EDIT.slot|0) && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length) return true;
          return !!(LIB.waves[s] && LIB.waves[s].dataU8 && LIB.waves[s].dataU8.length);
        });

        if (!slots.length){ announceIO('No waves in the selected tiles to upload.', true); return; }

        // Clear previous TX badges for these slots
        for (const s of slots){
          const cell = bySel(`.mm-digi-slot[data-idx="${s}"]`);
          if (cell) cell.classList.remove('sending-slot','sent-slot','send-failed-slot');
        }

        let sent = 0, fail = 0;
        beginJob('Upload SLOT(S)', btnUploadSlots, { lockMidi:true });

        for (let i=0;i<slots.length;i++){
          if (JOB.cancelled) break;

	          const s = slots[i];
	          const isActive = (s === (EDIT.slot|0));
	          const dirtyData = isActive && !!(LIB.dirty && LIB.dirty.has(s));
	          let w = null;
	          if (isActive){
	            const libRec = LIB.waves[s] || null;
	            if (dirtyData || !libRec){
	              w = { name: (EDIT.name||'WAVE'), dataU8: new Uint8Array(EDIT.dataU8), user:true };
	            } else {
	              // Preserve higher-res source if available, but take current meta from editor.
	              w = Object.assign({}, libRec, { name: (EDIT.name||libRec.name||'WAVE') });
	            }
	          } else {
	            w = LIB.waves[s] || null;
	          }
          if (!w) continue;

          const cell = bySel(`.mm-digi-slot[data-idx="${s}"]`);
          if (cell){ cell.classList.add('sending-slot'); cell.classList.remove('sent-slot','send-failed-slot'); }

          const nm = (w.name || 'WAVE').toUpperCase().slice(0,4);
          announceIO(`Sending ${i+1}/${slots.length} — slot ${s+1} “${nm}”… Ensure device shows “WAITING…”.`);

	          	try{
        const T = (typeof dpTables6132ForUpload === 'function')
          ? dpTables6132ForUpload(w, gainMode)
          : ensureTables6132(w, gainMode);
            if (!T) throw new Error('Could not render DigiPRO tables');
	            const Tsend = dpApplyHeatToTables(T, gain) || T;

	            const bytes = root.MMDT_DigiPRO.encodeSlot6132({ slot:s, name:nm, tables:Tsend, deviceId: (root.mmGetSysexDeviceId ? root.mmGetSysexDeviceId() : 0) });
	            // Sanity: ensure the encoded packet still targets the slot the user selected.
	            if (((bytes[9]||0) & 0x3F) !== (s & 0x3F)){
	              throw new Error(`Internal error: encoded slot mismatch (wanted ${s+1}, got ${(bytes[9]&0x3F)+1})`);
	            }
            root.sendBytes(bytes);

            sent++;
            if (cell){ cell.classList.remove('sending-slot'); cell.classList.add('sent-slot'); }

            await dpWaitForUploadDrain(bytes.length, JOB.signal);
            // Extra safety gap between full DigiPRO dumps to reduce the chance of device-side buffer overruns.
            await sleepAbortable(dpCalcInterSlotDelayMs(), JOB.signal);
          }catch(err){
            fail++;
            if (cell){ cell.classList.remove('sending-slot'); cell.classList.add('send-failed-slot'); }
            announceIO(`Slot ${s+1}: upload failed (${err && err.message ? err.message : 'unknown'}).`, true);
            await sleepAbortable(140, JOB.signal);
          }
        }

        const cancelled = JOB.cancelled;
        endJob();
        dpArmClearTxBadges();

        announceIO(cancelled
          ? `Upload cancelled. Sent ${sent}/${slots.length} slot(s) in strict 0x5D format${fail?` (${fail} failed)`:''}.`
          : `Upload complete. Sent ${sent}/${slots.length} slot(s) in strict 0x5D format${fail?` (${fail} failed)`:''}.`);

        updateButtonsState();
        return;
      }

      // --- Single slot upload (active slot) ---
      const nm = (_nameIn.value||'').toUpperCase().slice(0,4); EDIT.name=nm;
      const s = EDIT.slot|0;

      // Build strict 0x5D tables for device uploads (C6 block packing: t0/t1/t2 streams).
      // IMPORTANT: if the editor is dirty, prefer EDIT.dataU8 (unsaved edits) for the upload.
      // If not dirty, prefer the library record (so we can use higher-res _srcFloat when present).
      const libRec = LIB.waves[s] || null;
      const dataChanged = !!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(s));

      let rec;
      if (dataChanged || !libRec){
        rec = { name:nm, dataU8: new Uint8Array(EDIT.dataU8), user:true };
      }else{
        // Shallow-clone so we don't mutate LIB on upload, but keep _srcFloat etc.
        rec = Object.assign({}, libRec, { name:nm });
      }
      if (!rec.dataU8 && EDIT.dataU8) rec.dataU8 = new Uint8Array(EDIT.dataU8);

      const T = (typeof dpTables6132ForUpload === 'function')
        ? dpTables6132ForUpload(rec, gainMode)
        : ensureTables6132(rec, gainMode);
      if (!T){ announceIO('Could not render DigiPRO tables for this wave.', true); return; }
      const Tsend = dpApplyHeatToTables(T, gain) || T;

      const bytes = root.MMDT_DigiPRO.encodeSlot6132({ slot:s, name:nm, tables:Tsend, deviceId: (root.mmGetSysexDeviceId ? root.mmGetSysexDeviceId() : 0) });
      // Sanity: ensure the encoded packet still targets the active slot.
      if (((bytes[9]||0) & 0x3F) !== (s & 0x3F)){
        announceIO(`Internal error: encoded slot mismatch (wanted ${s+1}, got ${(bytes[9]&0x3F)+1})`, true);
        return;
      }
      root.sendBytes(bytes);
      announceIO('Sent in strict 0x5D slot format (1022×6 block packing). Device should display “WAITING…”.');
      updateButtonsState();
    };

    btnUploadAll = el('button'); btnUploadAll.textContent='Upload ALL';
    btnUploadAll.title='Upload every filled slot. Normal click uses the last saved upload mode (DigiPRO or Machinedrum UW). Shift+Click: change upload mode (and settings).\n\nDevice: DIGIPRO MGR → RECEIVE → ORG is recommended for exact slot placement. POS mode stores sequentially from the selected position.';
    btnUploadAll.onclick = async (ev)=>{
      // Upload mode:
      // - normal click: uses the last saved choice from the Shift+Upload modal (defaults to DigiPRO / C6 parity)
      // - shift-click: opens the modal to change the choice
      let gainMode = 'c6';
      let mdChoice = null;

      if (ev && ev.shiftKey){
        if (typeof window.mmPromptShiftUpload === 'function'){
          mdChoice = await window.mmPromptShiftUpload('Upload ALL', {
            selectedCount: null,
            allowPack: true
          });
          if (!mdChoice){ announceIO('Upload ALL cancelled.'); return; }
          if (mdChoice && mdChoice.target === 'digipro'){
            gainMode = (mdChoice.gainMode === 'clip') ? 'clip' : 'c6';
            mdChoice = null;
          }
        } else {
          gainMode = await dpPromptGainMode('Upload ALL', 'clip');
          if (!gainMode){ announceIO('Upload ALL cancelled.'); return; }
        }
      } else {
        // Pull the saved default (if present).
        try{
          if (typeof window.mmGetShiftUploadChoice === 'function'){
            const pref = window.mmGetShiftUploadChoice();
            if (pref && pref.target === 'machinedrum') mdChoice = pref;
            else if (pref && pref.target === 'digipro') gainMode = (pref.gainMode === 'clip') ? 'clip' : 'c6';
          }
        }catch(_){}
      }

      // Machinedrum UW SDS path
      if (mdChoice && mdChoice.target === 'machinedrum'){
        if (typeof window.mmSendWavesToMachinedrumUW !== 'function'){
          alert('Machinedrum UW mode is not available: mmSendWavesToMachinedrumUW() is missing.');
          return;
        }

        // Build a stable list of filled slots (including the unsaved active slot if dirty).
        const slots = [];
        for (let s=0;s<64;s++){ if (LIB.waves[s]) slots.push(s); }

        const actSlot = EDIT.slot|0;
        const actDirty = !!(LIB.dirty && LIB.dirty.has(actSlot) && EDIT.dataU8 && EDIT.dataU8.length);
        if (actDirty && slots.indexOf(actSlot) < 0) slots.push(actSlot);

        slots.sort((a,b)=>a-b);

        if (!slots.length){
          announceIO('No slots contain waves to upload.', true);
          return;
        }

        const waves = [];
        for (const s of slots){
          const isActive = (s === (EDIT.slot|0));
          const dirtyData = isActive && !!(LIB.dirty && LIB.dirty.has(s));
          const libRec = LIB.waves[s] || null;

          let w = null;
          if (isActive){
            if (dirtyData || !libRec){
              w = { name: (EDIT.name||'WAVE'), dataU8: new Uint8Array(EDIT.dataU8), user:true };
            } else {
              w = Object.assign({}, libRec, { name: (EDIT.name||libRec.name||'WAVE') });
            }
          } else {
            w = libRec;
          }
          if (!w || !w.dataU8 || !w.dataU8.length) continue;

          const u8 = (w.dataU8 instanceof Uint8Array) ? new Uint8Array(w.dataU8) : new Uint8Array(w.dataU8||[]);
          try{ if (w.dataU8 && typeof w.dataU8.displayRot === 'number') u8.displayRot = w.dataU8.displayRot|0; }catch(_){}

          waves.push({ dpSlot: s, name: (w.name||`S${s+1}`), dataU8: u8, _srcFloat: (w._srcFloat||null) });
        }

        if (!waves.length){
          announceIO('No slots contain waves to upload.', true);
          return;
        }

        announceIO('Machinedrum UW mode: on the MD go to SAMPLE MGR → RECV → ALL, then leave it in receive while sending.', true);

        // Visual state: mark ALL waves as “sending”
        for (const w of waves){
          const cell = bySel(`.mm-digi-slot[data-idx="${w.dpSlot}"]`);
          if (cell){
            cell.classList.remove('sent-slot','send-failed-slot');
            cell.classList.add('sending-slot');
          }
        }

        beginJob('MD UW SDS Upload ALL', btnUploadAll, { lockMidi:true });
        try{
          await window.mmSendWavesToMachinedrumUW(waves, mdChoice, {
            signal: JOB.signal,
            onStatus: (msg, warn)=>announceIO(msg, !!warn),
            onWaveState: (dpSlot, state)=>{
              const cell = bySel(`.mm-digi-slot[data-idx="${dpSlot}"]`);
              if (!cell) return;
              if (state === 'sending'){
                cell.classList.add('sending-slot');
                cell.classList.remove('sent-slot','send-failed-slot');
                return;
              }
              cell.classList.remove('sending-slot');
              if (state === 'sent') cell.classList.add('sent-slot');
              else if (state === 'failed') cell.classList.add('send-failed-slot');
            }
          });
          announceIO('Machinedrum UW upload complete.');
        }catch(err){
          if (err && err.name === 'AbortError'){
            announceIO('Machinedrum UW upload cancelled.');
          } else {
            console.warn('MD UW upload failed:', err);
            announceIO('Machinedrum UW upload failed: ' + (err && err.message ? err.message : err), true);
          }
        }finally{
          endJob();
          dpArmClearTxBadges();
        }
        return;
      }

      const gain = dpGainForMode(gainMode);

      // Build a stable list of filled slots so we can show an accurate X/Y progress counter
      const slots = [];
      for (let s=0;s<64;s++){ if (LIB.waves[s]) slots.push(s); }

      // If the active editor slot is dirty (unsaved), include it in Upload ALL so the user
      // doesn't accidentally transmit an old version.
      const actSlot = EDIT.slot|0;
      const actDirty = !!(LIB.dirty && LIB.dirty.has(actSlot) && EDIT.dataU8 && EDIT.dataU8.length);
      if (actDirty && slots.indexOf(actSlot) < 0) slots.push(actSlot);

      slots.sort((a,b)=>a-b);

      if (!slots.length){ announceIO('No waves loaded to upload.', true); return; }

      // Clear previous TX badges for all filled slots
      for (const s of slots){
        const cell = bySel(`.mm-digi-slot[data-idx="${s}"]`);
        if (cell) cell.classList.remove('sending-slot','sent-slot','send-failed-slot');
      }

      let sent = 0, fail = 0;
      beginJob('Upload ALL', btnUploadAll, { lockMidi:true });

      for (let i=0;i<slots.length;i++){
        if (JOB.cancelled) break;

        const s = slots[i];
        const isActive = (s === (EDIT.slot|0));
        const dirtyData = isActive && !!(LIB.dirty && LIB.dirty.has(s));
        let w = null;
        if (isActive){
          const libRec = LIB.waves[s] || null;
          if (dirtyData || !libRec){
            w = { name: (EDIT.name||'WAVE'), dataU8: new Uint8Array(EDIT.dataU8), user:true, _dpHeat: EDIT._dpHeat };
          } else {
            // Preserve higher-res source if available, but take current meta from editor.
            w = Object.assign({}, libRec, { name: (EDIT.name||libRec.name||'WAVE') });
          }
        } else {
          w = LIB.waves[s] || null;
        }
        if (!w) continue;

        const cell = bySel(`.mm-digi-slot[data-idx="${s}"]`);
        if (cell){ cell.classList.add('sending-slot'); cell.classList.remove('sent-slot','send-failed-slot'); }

        const nm = (w.name || 'WAVE').toUpperCase().slice(0,4);
        announceIO(`Sending ${i+1}/${slots.length} — slot ${s+1} “${nm}”… Ensure device shows “WAITING…”.`);

	        	try{
        const T = (typeof dpTables6132ForUpload === 'function')
          ? dpTables6132ForUpload(w, gainMode)
          : ensureTables6132(w, gainMode);
          if (!T) throw new Error('Could not render DigiPRO tables');
	      const Tsend = dpApplyHeatToTables(T, gain) || T;

	      const bytes = root.MMDT_DigiPRO.encodeSlot6132({ slot:s, name:nm, tables:Tsend, deviceId: (root.mmGetSysexDeviceId ? root.mmGetSysexDeviceId() : 0) });
	      // Sanity: ensure the encoded packet still targets the intended slot.
	      if (((bytes[9]||0) & 0x3F) !== (s & 0x3F)){
	        throw new Error(`Internal error: encoded slot mismatch (wanted ${s+1}, got ${(bytes[9]&0x3F)+1})`);
	      }
          root.sendBytes(bytes);

          sent++;
          if (cell){ cell.classList.remove('sending-slot'); cell.classList.add('sent-slot'); }

          await dpWaitForUploadDrain(bytes.length, JOB.signal);
          // Extra safety gap between full DigiPRO dumps to reduce the chance of device-side buffer overruns.
          await sleepAbortable(dpCalcInterSlotDelayMs(), JOB.signal);
}catch(err){
          fail++;
          if (cell){ cell.classList.remove('sending-slot'); cell.classList.add('send-failed-slot'); }
          announceIO(`Slot ${s+1}: upload failed (${err && err.message ? err.message : 'unknown'}).`, true);
          await sleepAbortable(140, JOB.signal);
        }
      }

      const cancelledAll = JOB.cancelled;
      endJob();
      dpArmClearTxBadges();

      announceIO(cancelledAll
        ? `Upload ALL cancelled. Sent ${sent}/${slots.length} slot(s) in strict 0x5D format${fail?` (${fail} failed)`:''}.`
        : `Upload ALL complete. Sent ${sent}/${slots.length} slot(s) in strict 0x5D format${fail?` (${fail} failed)`:''}.`);

      updateButtonsState();
    };

    // File import/export
    const fIn = el('input'); fIn.type='file'; fIn.multiple=true; fIn.accept='.syx,.SYX,.wav,.WAV,.json,.JSON,application/json';
    const FILE_IMPORT_STATE = root.__digiproFileImportState || (root.__digiproFileImportState = { mode:'smart', fixedSlot:null });
    fIn.onchange = async ()=>{
      const files = Array.from(fIn.files||[]);
      // Allow selecting the same file(s) again (some browsers don't fire change if value is unchanged)
      try{ fIn.value = ''; }catch(_){ }

      // Import policy is set by the Load Audio button click:
      //   default: "smart" (WAV-only selections import sequentially from active slot)
      //   Shift-click: "auto" (respect SysEx slot / filename-restored slots / next-free)
      //   Alt-click: "sequential" (force sequential from active slot)
      const mode = (FILE_IMPORT_STATE && FILE_IMPORT_STATE.mode) ? String(FILE_IMPORT_STATE.mode) : 'smart';
      const fixedSlot = (FILE_IMPORT_STATE && typeof FILE_IMPORT_STATE.fixedSlot === 'number') ? (FILE_IMPORT_STATE.fixedSlot|0) : null;

      // Reset to defaults so the next import isn't sticky
      if (FILE_IMPORT_STATE){
        FILE_IMPORT_STATE.mode = 'smart';
        FILE_IMPORT_STATE.fixedSlot = null;
      }

      const allWav = files.length && files.every(f=>/\.wav$/i.test(f.name));

      if (mode === 'auto'){
        await importFilesIntoLibrary(files);
      } else if (mode === 'sequential'){
        await importFilesIntoLibrary(files, (typeof fixedSlot === 'number') ? fixedSlot : (activeIdx|0));
      } else {
        // smart default: sequential from active slot for WAV-only batches; otherwise auto
        if (allWav){
          await importFilesIntoLibrary(files, (typeof fixedSlot === 'number') ? fixedSlot : (activeIdx|0));
        } else {
          await importFilesIntoLibrary(files);
        }
      }
      updateButtonsState();
    };



    // Loop → 64 slices import (normal click uses last mode; Shift‑click the button to choose)
    const LOOP_IMPORT_STATE = root.__digiproLoopImportState || (root.__digiproLoopImportState = {
      mode:'raw',
      count:64,
      seam:'none',    // raw-only: 'none' | 'detrend' | 'rotateZC' | 'zcCut'
      zcWin:32,       // zero-cross search window (samples)
      dc:'keep',      // raw-only: 'keep' | 'global' | 'perSlice'
      reverse:'none', // 'none' | 'odd' | 'even' | 'all' | 'ramp'
      invert:'none',  // 'none' | 'odd' | 'even' | 'all' | 'ramp'
      gain:'none',    // 'none' | 'rampUp' | 'rampDown' | 'triangle' | 'oddevenGate'
      warpSt:0,       // semitone warp (-24..+24). 0 = off
      warpCt:0,       // cents warp (-200..+200). applied in addition to warpSt
      warpRamp:false, // if true, scale warp across slot range

      // wavetable mode
      slicer:'equal', // 'equal' | 'overlap4' | 'overlap8'

      // raw-only extras
      rawSeamFade:0,  // 0..128 samples fade at edges (raw)
      rawOverlap:0,   // 0|25|50|75  (raw)
      rawWindow:'none', // 'none' | 'hann' | 'hamming' (raw)

      // table-level creative transforms
      order:'normal', // 'normal' | 'pingpong' | 'evenodd' | 'oddeven' | 'scramble'
      orderSeed:1,
      alignAdj:false, // rotate slices to align adjacent slot boundaries
      alignWin:64,    // window length (samples) for alignment correlation
      tilt:'none',    // 'none' | 'dark2bright' | 'bright2dark'
      tiltAmt:0       // 0..12 smoothing passes
    });
    // sanitize persisted state
    try{
      const c = parseInt(LOOP_IMPORT_STATE.count,10);
      LOOP_IMPORT_STATE.count = ([8,16,32,48,64].includes(c)) ? c : 64;
      // Mode is now a single field:
      //   raw | equal | overlap4 | overlap8
      // Older saved states used: mode=wavetable + slicer=<...>
      {
        const m = String(LOOP_IMPORT_STATE.mode||'raw');
        const slicer = String(LOOP_IMPORT_STATE.slicer||'equal');
        const allowed = ['raw','equal','overlap4','overlap8'];
        if (m === 'wavetable'){
          LOOP_IMPORT_STATE.mode = (allowed.includes(slicer)) ? slicer : 'equal';
        } else {
          LOOP_IMPORT_STATE.mode = allowed.includes(m) ? m : 'raw';
        }
      }

      const seam = String(LOOP_IMPORT_STATE.seam||'none');
      LOOP_IMPORT_STATE.seam = ([ 'none','detrend','rotateZC','zcCut' ].includes(seam)) ? seam : 'none';

      let zcw = parseInt(LOOP_IMPORT_STATE.zcWin,10);
      if (!isFinite(zcw)) zcw = 32;
      zcw = Math.max(0, Math.min(512, zcw|0));
      LOOP_IMPORT_STATE.zcWin = zcw;

      const dc = String(LOOP_IMPORT_STATE.dc||'keep');
      LOOP_IMPORT_STATE.dc = ([ 'keep','global','perSlice' ].includes(dc)) ? dc : 'keep';

      const rev = String(LOOP_IMPORT_STATE.reverse||'none');
      LOOP_IMPORT_STATE.reverse = ([ 'none','odd','even','all','ramp' ].includes(rev)) ? rev : 'none';

      const inv = String(LOOP_IMPORT_STATE.invert||'none');
      LOOP_IMPORT_STATE.invert = ([ 'none','odd','even','all','ramp' ].includes(inv)) ? inv : 'none';

      const gain = String(LOOP_IMPORT_STATE.gain||'none');
      LOOP_IMPORT_STATE.gain = ([ 'none','rampUp','rampDown','triangle','oddevenGate' ].includes(gain)) ? gain : 'none';

      let ws = parseInt(LOOP_IMPORT_STATE.warpSt,10);
      if (!isFinite(ws)) ws = 0;
      ws = Math.max(-24, Math.min(24, ws|0));
      LOOP_IMPORT_STATE.warpSt = ws;

      let wc = parseInt(LOOP_IMPORT_STATE.warpCt,10);
      if (!isFinite(wc)) wc = 0;
      wc = Math.max(-200, Math.min(200, wc|0));
      LOOP_IMPORT_STATE.warpCt = wc;

      LOOP_IMPORT_STATE.warpRamp = !!LOOP_IMPORT_STATE.warpRamp;

      const slicer = String(LOOP_IMPORT_STATE.slicer||'equal');
      LOOP_IMPORT_STATE.slicer = ([ 'equal','overlap4','overlap8' ].includes(slicer)) ? slicer : 'equal';

      let rsf = parseInt(LOOP_IMPORT_STATE.rawSeamFade,10);
      if (!isFinite(rsf)) rsf = 0;
      LOOP_IMPORT_STATE.rawSeamFade = Math.max(0, Math.min(128, rsf|0));

      // overlap/window only used in raw mode, but we sanitize here anyway
      {
        let ro = parseInt(LOOP_IMPORT_STATE.rawOverlap,10);
        if (!isFinite(ro)) ro = 0;
        const allowed = [0,25,50,75];
        LOOP_IMPORT_STATE.rawOverlap = allowed.includes(ro|0) ? (ro|0) : 0;
      }
      {
        const rw = String(LOOP_IMPORT_STATE.rawWindow||'none');
        LOOP_IMPORT_STATE.rawWindow = ([ 'none','hann','hamming' ].includes(rw)) ? rw : 'none';
      }

      {
        const ord = String(LOOP_IMPORT_STATE.order||'normal');
        LOOP_IMPORT_STATE.order = ([ 'normal','pingpong','evenodd','oddeven','scramble' ].includes(ord)) ? ord : 'normal';
      }
      {
        let seed = parseInt(LOOP_IMPORT_STATE.orderSeed,10);
        if (!isFinite(seed)) seed = 1;
        LOOP_IMPORT_STATE.orderSeed = Math.max(0, Math.min(999999, seed|0));
      }

      LOOP_IMPORT_STATE.alignAdj = !!LOOP_IMPORT_STATE.alignAdj;
      {
        let aw = parseInt(LOOP_IMPORT_STATE.alignWin,10);
        if (!isFinite(aw)) aw = 64;
        LOOP_IMPORT_STATE.alignWin = Math.max(16, Math.min(256, aw|0));
      }

      {
        const t = String(LOOP_IMPORT_STATE.tilt||'none');
        LOOP_IMPORT_STATE.tilt = ([ 'none','dark2bright','bright2dark' ].includes(t)) ? t : 'none';
      }
      {
        let ta = parseInt(LOOP_IMPORT_STATE.tiltAmt,10);
        if (!isFinite(ta)) ta = 0;
        LOOP_IMPORT_STATE.tiltAmt = Math.max(0, Math.min(12, ta|0));
      }
    }catch(_){
      LOOP_IMPORT_STATE.count = 64;
      LOOP_IMPORT_STATE.mode = 'raw';
      LOOP_IMPORT_STATE.seam = 'none';
      LOOP_IMPORT_STATE.zcWin = 32;
      LOOP_IMPORT_STATE.dc = 'keep';
      LOOP_IMPORT_STATE.reverse = 'none';
      LOOP_IMPORT_STATE.invert = 'none';
      LOOP_IMPORT_STATE.gain = 'none';
      LOOP_IMPORT_STATE.warpSt = 0;
      LOOP_IMPORT_STATE.warpCt = 0;
      LOOP_IMPORT_STATE.warpRamp = false;
      LOOP_IMPORT_STATE.slicer = 'equal';
      LOOP_IMPORT_STATE.rawSeamFade = 0;
      LOOP_IMPORT_STATE.rawOverlap = 0;
      LOOP_IMPORT_STATE.rawWindow = 'none';
      LOOP_IMPORT_STATE.order = 'normal';
      LOOP_IMPORT_STATE.orderSeed = 1;
      LOOP_IMPORT_STATE.alignAdj = false;
      LOOP_IMPORT_STATE.alignWin = 64;
      LOOP_IMPORT_STATE.tilt = 'none';
      LOOP_IMPORT_STATE.tiltAmt = 0;
    }

    const fLoopIn = el('input'); fLoopIn.type='file'; fLoopIn.accept='.wav,.WAV';
    fLoopIn.onchange = async ()=>{
      const file = (fLoopIn.files||[])[0];
      fLoopIn.value = '';
      if (!file) return;
      try{
        const mode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.mode) ? String(LOOP_IMPORT_STATE.mode) : 'raw';

        // Extra loop-import creative options (persisted in LOOP_IMPORT_STATE)
        const seam = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.seam) ? String(LOOP_IMPORT_STATE.seam) : 'none';
        const zcWin = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.zcWin,10))) ? (parseInt(LOOP_IMPORT_STATE.zcWin,10)|0) : 32;
        const dcMode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.dc) ? String(LOOP_IMPORT_STATE.dc) : 'keep';
        const reverseMode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.reverse) ? String(LOOP_IMPORT_STATE.reverse) : 'none';
        const invertMode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.invert) ? String(LOOP_IMPORT_STATE.invert) : 'none';
        const gainMode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.gain) ? String(LOOP_IMPORT_STATE.gain) : 'none';
        const warpSt = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.warpSt,10))) ? (parseInt(LOOP_IMPORT_STATE.warpSt,10)|0) : 0;
        const warpCt = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.warpCt,10))) ? (parseInt(LOOP_IMPORT_STATE.warpCt,10)|0) : 0;
        const warpRamp = !!(LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.warpRamp);

        // Table-level creative options
        const orderMode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.order) ? String(LOOP_IMPORT_STATE.order) : 'normal';
        const orderSeed = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.orderSeed,10))) ? (parseInt(LOOP_IMPORT_STATE.orderSeed,10)|0) : 1;
        const alignAdj = !!(LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.alignAdj);
        const alignWin = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.alignWin,10))) ? (parseInt(LOOP_IMPORT_STATE.alignWin,10)|0) : 64;
        const tiltMode = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.tilt) ? String(LOOP_IMPORT_STATE.tilt) : 'none';
        const tiltAmt = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.tiltAmt,10))) ? (parseInt(LOOP_IMPORT_STATE.tiltAmt,10)|0) : 0;

        // Mode-specific options
        const slicer = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.slicer) ? String(LOOP_IMPORT_STATE.slicer) : 'equal';
        const rawFade = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.rawSeamFade,10))) ? (parseInt(LOOP_IMPORT_STATE.rawSeamFade,10)|0) : 0;
        const rawOverlap = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.rawOverlap,10))) ? (parseInt(LOOP_IMPORT_STATE.rawOverlap,10)|0) : 0;
        const rawWindow = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.rawWindow) ? String(LOOP_IMPORT_STATE.rawWindow) : 'none';

        const modeLabelBase =
          (mode === 'raw') ? 'Raw contiguous (playback)'
          : (mode === 'equal') ? 'Wavetable: Equal slices'
          : (mode === 'overlap8') ? 'Wavetable: Overlap ×8'
          : 'Wavetable: Overlap ×4';

        // Compact label summary (used for confirm + history)
        const seamLabel = (mode==='raw' && seam && seam!=='none')
          ? (' + ' + (seam==='detrend' ? 'detrend' : seam==='rotateZC' ? 'rotate→ZC' : seam==='zcCut' ? 'ZC cut' : seam))
          : '';
        const fxParts = [];
        if (mode==='raw' && dcMode && dcMode!=='keep') fxParts.push(`DC:${dcMode}`);
        if (mode==='raw' && seam==='zcCut' && zcWin) fxParts.push(`zcWin:${zcWin}`);
        if (mode==='raw' && rawFade) fxParts.push(`fade:${rawFade}`);
        if (mode==='raw' && rawOverlap) fxParts.push(`ov:${rawOverlap}%${(rawWindow && rawWindow!=='none')?`/${rawWindow}`:''}`);

        // Table-level transforms
        if (orderMode && orderMode!=='normal') fxParts.push(`ord:${orderMode}${(orderMode==='scramble')?`@${orderSeed}`:''}`);
        if (alignAdj) fxParts.push(`align:${alignWin}`);
        if (tiltMode && tiltMode!=='none' && tiltAmt>0) fxParts.push(`tilt:${tiltMode}@${tiltAmt}`);

        if (reverseMode && reverseMode!=='none') fxParts.push(`rev:${reverseMode}`);
        if (invertMode && invertMode!=='none') fxParts.push(`inv:${invertMode}`);
        if (gainMode && gainMode!=='none') fxParts.push(`gain:${gainMode}`);

        // Pitch warp (coarse semitones + fine cents)
        if (warpSt || warpCt){
          const centsStr = warpCt ? `${warpCt>=0?'+':''}${warpCt}c` : '';
          fxParts.push(`warp:${warpSt}st${centsStr}${warpRamp?'r':''}`);
        }

        const modeLabel = modeLabelBase + seamLabel + (fxParts.length ? ` (${fxParts.join(',')})` : '');

        // Import starts at the active slot (so you can build loop "banks" across the grid).
        const startSlot = clamp(
          (typeof activeIdx === 'number') ? (activeIdx|0)
            : ((EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : 0),
          0, 63
        );

        const requestedCount = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.count) ? (LOOP_IMPORT_STATE.count|0) : 64;
        const maxFit = 64 - startSlot;
        let slotCount = Math.min(requestedCount, maxFit);

        if (slotCount <= 0){
          announceIO('No available slots to import the loop.', true);
          return;
        }

        // If the requested slice count doesn't fit, offer a safe truncate (no wrap-around).
        if (slotCount !== requestedCount){
          const ok = confirm(
            `Not enough contiguous slots from the active slot.\n\n`
            + `Active slot: ${startSlot+1}\n`
            + `Requested: ${requestedCount} slice(s)\n`
            + `Available until slot 64: ${maxFit} slot(s)\n\n`
            + `Import will truncate to ${slotCount} slice(s) (slots ${startSlot+1}..${startSlot+slotCount}). Continue?`
          );
          if (!ok) return;
        } else {
          const ok = confirm(
            `Importing a loop (${modeLabel}) will overwrite ${slotCount} slot(s) (slots ${startSlot+1}..${startSlot+slotCount}) in the current bank (in memory only). `
            + ((startSlot === 0 && slotCount === 64) ? '' : 'Other slots remain unchanged. ')
            + 'Continue?'
          );
          if (!ok) return;
        }

        const buf = await file.arrayBuffer();

        // RAW mode: contiguous chunks intended for “play the loop by stepping slot index”
        // Strategy:
        //   1) Decode WAV to mono float (no per-slice normalizing / detrending)
        //   2) Resample the *whole* loop to exactly 64 × 1024 samples (DigiPRO render base)
        //   3) Split into 64 contiguous 1024-sample frames (no overlap, no makeSeamless)
        // This keeps the relative dynamics and time continuity across slots as much as possible.
        const useRaw = (mode === 'raw');

        const full = useRaw
          ? parseWavToCycleFloat(buf, { removeDC:(dcMode==='global'), normalize:false })
          : parseWavToCycleFloat(buf, { removeDC:true, normalize: DEFAULT_WAV_IMPORT_NORMALIZE });

        if (!full || !full.length) throw new Error('Empty audio buffer');

        // RAW mode: global clip-protection.
        // If a float WAV contains overs, we scale the *entire* buffer down instead of hard-clipping.
        let clipScaled = false;
        if (useRaw){
          let peak = 0;
          for (let i=0;i<full.length;i++){
            const v = full[i];
            if (!isFinite(v)) continue;
            const a = Math.abs(v);
            if (a > peak) peak = a;
          }
          if (isFinite(peak) && peak > 1){
            const g = 1 / peak;
            for (let i=0;i<full.length;i++){
              const v = full[i];
              full[i] = isFinite(v) ? (v * g) : 0;
            }
            clipScaled = true;
          } else {
            // Still sanitize NaNs/Infs so later math is stable.
            for (let i=0;i<full.length;i++) if (!isFinite(full[i])) full[i] = 0;
          }
        } else {
          // Legacy behavior kept: clamp for safety.
          for (let i=0;i<full.length;i++){
            const v = full[i];
            if (v > 1) full[i] = 1;
            else if (v < -1) full[i] = -1;
          }
        }

        const base4 = derive4FromFilename(file.name);
        const prefix2 = base4.slice(0,2);

        function downsampleFloatLinear(src, targetLen){
          const S = src.length|0;
          const T = targetLen|0;
          if (!S || !T) return new Float32Array(0);
          if (S === T) return new Float32Array(src);
          const out = new Float32Array(T);
          const step = (S - 1) / Math.max(1, (T - 1));
          for (let i=0;i<T;i++){
            const x = i * step;
            const i0 = Math.floor(x);
            const i1 = Math.min(S - 1, i0 + 1);
            const t = x - i0;
            out[i] = src[i0] * (1 - t) + src[i1] * t;
          }
          return out;
        }

        // Better whole-loop resampling for RAW contiguous mode:
        // box-integrated sampling with taps that increase when downsampling more,
        // so longer loops alias less than plain linear.
        function resampleFloatWholeBoxAA(src, targetLen){
          const a = (src instanceof Float32Array || src instanceof Float64Array) ? src : new Float32Array(src||[]);
          const N = a.length|0;
          const M = targetLen|0;
          if (!N || !M) return new Float32Array(0);
          if (N === M) return new Float32Array(a);

          const out = new Float32Array(M);

          // Upsampling: plain linear is fine.
          if (N < M){
            const step = (N - 1) / Math.max(1, (M - 1));
            for (let i=0;i<M;i++){
              const x = i * step;
              const i0 = Math.floor(x);
              const i1 = Math.min(N - 1, i0 + 1);
              const t = x - i0;
              out[i] = a[i0] * (1 - t) + a[i1] * t;
            }
            return out;
          }

          // Downsampling: average multiple samples per output step.
          const step = N / M;
          // More taps as downsampling ratio increases; cap to avoid pathological cost.
          const taps = clamp(Math.round(16 * Math.sqrt(step)), 16, 512);
          for (let i=0;i<M;i++){
            let acc = 0;
            for (let t=0;t<taps;t++){
              const x = (i + (t + 0.5) / taps) * step;
              const xi = Math.floor(x);
              const i0 = clamp(xi, 0, N - 1);
              const i1 = Math.min(N - 1, i0 + 1);
              const frac = x - xi;
              acc += a[i0] * (1 - frac) + a[i1] * frac;
            }
            out[i] = acc / taps;
          }
          return out;
        }



        // --- Loop import FX helpers (applied after slicing) ---
        function dpSanitizeFloatInPlace(a){
          for (let i=0;i<a.length;i++){
            const v = a[i];
            if (!isFinite(v)) a[i] = 0;
          }
        }

        function dpMeanRemoveInPlace(a){
          const N = a.length|0;
          if (!N) return;
          let m = 0;
          for (let i=0;i<N;i++) m += a[i];
          m /= N;
          for (let i=0;i<N;i++) a[i] -= m;
        }

        // Like makeSeamless() used in wavetable slicing, but for raw slices too:
        // subtract a line so the cycle starts/ends at zero (reduces clicks).
        function dpDetrendSeamInPlace(a){
          const N = a.length|0;
          if (N < 2) return;
          const a0 = a[0];
          const a1 = a[N-1];
          const d = (a1 - a0) / (N - 1);
          for (let i=0;i<N;i++){
            a[i] -= (a0 + d * i);
          }
        }

        function dpRotateCopy(a, startIdx){
          const N = a.length|0;
          if (!N) return new Float32Array(0);
          let s = startIdx|0;
          s = ((s % N) + N) % N;
          if (s === 0) return new Float32Array(a);
          const out = new Float32Array(N);
          out.set(a.subarray(s));
          out.set(a.subarray(0, s), N - s);
          return out;
        }

        function dpReverseCopy(a){
          const N = a.length|0;
          const out = new Float32Array(N);
          for (let i=0;i<N;i++) out[i] = a[N - 1 - i];
          return out;
        }

        // Find a good phase start for a cyclic buffer: rising zero-crossing nearest to zero.
        function dpFindBestRisingZCIndex(a){
          const N = a.length|0;
          if (N < 2) return 0;
          let best = 0;
          let bestScore = 1e9;

          for (let i=0;i<N;i++){
            const prev = a[(i - 1 + N) % N];
            const cur  = a[i];
            if (!isFinite(prev) || !isFinite(cur)) continue;
            if (prev <= 0 && cur > 0){
              const score = Math.max(Math.abs(prev), Math.abs(cur));
              if (score < bestScore){
                bestScore = score;
                best = i;
              }
            }
          }

          if (bestScore < 1e8) return best;

          // Fallback: smallest absolute sample
          best = 0;
          bestScore = 1e9;
          for (let i=0;i<N;i++){
            const v = a[i];
            if (!isFinite(v)) continue;
            const score = Math.abs(v);
            if (score < bestScore){
              bestScore = score;
              best = i;
            }
          }
          return best;
        }

        // Choose a cut point near centerIdx where the waveform crosses zero (sign change)
        // or is closest to zero if no crossing exists in the window.
        function dpFindBestZCCutIndex(bufF, centerIdx, win, minI, maxI){
          const N = bufF.length|0;
          if (N < 2) return 0;
          let lo = Math.max(1, (centerIdx - win)|0);
          let hi = Math.min(N - 1, (centerIdx + win)|0);
          if (typeof minI === 'number' && isFinite(minI)) lo = Math.max(lo, minI|0);
          if (typeof maxI === 'number' && isFinite(maxI)) hi = Math.min(hi, maxI|0);
          if (hi < lo){ const t = lo; lo = hi; hi = t; }

          let best = null;
          let bestScore = 1e9;

          for (let i=lo;i<=hi;i++){
            const a = bufF[i-1];
            const b = bufF[i];
            if (!isFinite(a) || !isFinite(b)) continue;

            const crosses = (a === 0) || (b === 0) || (a < 0 && b > 0) || (a > 0 && b < 0);
            if (!crosses) continue;

            const rising = (a <= 0 && b > 0);
            let score = Math.max(Math.abs(a), Math.abs(b));
            // Tiny bias toward rising crossings (keeps phase more consistent across slices)
            score += rising ? 0 : 1e-6;

            if (score < bestScore){
              bestScore = score;
              best = i;
            }
          }

          if (best != null) return best|0;

          // Fallback: closest-to-zero sample near center
          let bestJ = clamp(centerIdx|0, lo, hi);
          bestScore = 1e9;
          for (let j=lo;j<=hi;j++){
            const v = bufF[j];
            if (!isFinite(v)) continue;
            const score = Math.abs(v);
            if (score < bestScore){
              bestScore = score;
              bestJ = j;
            }
          }
          return bestJ|0;
        }

        // Simple cyclic "pitch warp": resample the cycle at a different phase rate.
        // (Useful as a creative timbre bend when scanning slices.)
        function dpWarpPitchCyclic(a, semitones){
          const N = a.length|0;
          if (!N) return new Float32Array(0);
          const st = Number(semitones) || 0;
          if (!isFinite(st) || Math.abs(st) < 1e-4) return new Float32Array(a);
          const ratio = Math.pow(2, st / 12);
          const out = new Float32Array(N);
          for (let i=0;i<N;i++){
            const x = i * ratio;
            const xi = Math.floor(x);
            const frac = x - xi;
            const i0 = ((xi % N) + N) % N;
            const i1 = (i0 + 1) % N;
            out[i] = a[i0] * (1 - frac) + a[i1] * frac;
          }
          return out;
        }

        // Post-slice creative transforms (reverse/invert/gain/warp), optionally scaled across slot range.
        function dpApplyLoopImportFx(segF, sliceIdx, sliceCount){
          let out = segF;
          const t = (sliceCount > 1) ? (sliceIdx / (sliceCount - 1)) : 0;

          // Warp first (coarse semitones + fine cents)
          const warpTotal = (warpSt || warpCt) ? (warpSt + (warpCt / 100)) : 0;
          if (warpTotal){
            const st = warpRamp ? (warpTotal * t) : warpTotal;
            if (st) out = dpWarpPitchCyclic(out, st);
          }

          // Reverse
          if (reverseMode && reverseMode !== 'none'){
            if (reverseMode === 'all'){
              out = dpReverseCopy(out);
            } else if (reverseMode === 'odd'){
              if (sliceIdx % 2) out = dpReverseCopy(out);
            } else if (reverseMode === 'even'){
              if ((sliceIdx % 2) === 0) out = dpReverseCopy(out);
            } else if (reverseMode === 'ramp'){
              const a = t;
              if (a > 1e-6){
                const rev = dpReverseCopy(out);
                const N = out.length|0;
                const blended = new Float32Array(N);
                const ia = 1 - a;
                for (let i=0;i<N;i++) blended[i] = (out[i] * ia) + (rev[i] * a);
                out = blended;
              }
            }
          }

          // Invert
          if (invertMode && invertMode !== 'none'){
            if (invertMode === 'all'){
              for (let i=0;i<out.length;i++) out[i] = -out[i];
            } else if (invertMode === 'odd'){
              if (sliceIdx % 2){
                for (let i=0;i<out.length;i++) out[i] = -out[i];
              }
            } else if (invertMode === 'even'){
              if ((sliceIdx % 2) === 0){
                for (let i=0;i<out.length;i++) out[i] = -out[i];
              }
            } else if (invertMode === 'ramp'){
              const g = 1 - 2 * t; // +1 → -1
              for (let i=0;i<out.length;i++) out[i] *= g;
            }
          }

          // Gain shaping
          if (gainMode && gainMode !== 'none'){
            let g = 1;
            if (gainMode === 'rampUp'){
              g = 0.2 + 0.8 * t;
            } else if (gainMode === 'rampDown'){
              g = 1 - 0.8 * t;
            } else if (gainMode === 'triangle'){
              g = 0.2 + 0.8 * (1 - Math.abs(2 * t - 1));
            } else if (gainMode === 'oddevenGate'){
              g = (sliceIdx % 2) ? 0 : 1;
            }
            if (g !== 1){
              for (let i=0;i<out.length;i++) out[i] *= g;
            }
          }

          dpSanitizeFloatInPlace(out);
          return out;
        }

        // ------------------------------------------------------------
        // Multi-slice transforms for creative loop import
        // ------------------------------------------------------------
        function dpMakeSeededRng(seed){
          // xorshift32
          let x = (seed|0) || 1;
          return function(){
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
            // Convert to [0,1)
            return ((x >>> 0) / 4294967296);
          };
        }

        function dpOrderMap(n, mode, seed){
          const N = n|0;
          if (N <= 0) return [];
          const m = String(mode||'normal');
          if (m === 'pingpong'){
            if (N === 1) return [0];
            const map = new Array(N);
            for (let i=0;i<N;i++){
              const t = i / (N - 1);
              const tri = (t <= 0.5) ? (t * 2) : ((1 - t) * 2);
              map[i] = Math.round(tri * (N - 1));
            }
            return map;
          }
          if (m === 'evenodd'){
            const map = [];
            for (let i=0;i<N;i+=2) map.push(i);
            for (let i=1;i<N;i+=2) map.push(i);
            return map;
          }
          if (m === 'oddeven'){
            const map = [];
            for (let i=1;i<N;i+=2) map.push(i);
            for (let i=0;i<N;i+=2) map.push(i);
            return map;
          }
          if (m === 'scramble'){
            const map = Array.from({length:N}, (_,i)=>i);
            const rnd = dpMakeSeededRng(seed|0);
            // Fisher–Yates
            for (let i=N-1;i>0;i--){
              const j = Math.floor(rnd() * (i + 1));
              const tmp = map[i]; map[i] = map[j]; map[j] = tmp;
            }
            return map;
          }
          // normal
          return Array.from({length:N}, (_,i)=>i);
        }

        function dpApplyOrderTransform(segments, mode, seed){
          const N = segments.length|0;
          const map = dpOrderMap(N, mode, seed);
          const out = new Array(N);
          for (let i=0;i<N;i++){
            const srcIdx = map[i] ?? i;
            const srcSeg = segments[srcIdx] || segments[0];
            out[i] = new Float32Array(srcSeg); // copy to allow per-slot differences later
          }
          return out;
        }

        // Backwards-compatible name (older call-sites used this identifier).
        // Keep as a wrapper so any future changes can stay centralized.
        function dpApplySlotOrderTransform(segments, mode, seed){
          return dpApplyOrderTransform(segments, mode, seed);
        }

        function dpSmooth3Cyclic(src){
          const N = src.length|0;
          const out = new Float32Array(N);
          if (N <= 1){
            if (N === 1) out[0] = src[0];
            return out;
          }
          const last = N - 1;
          out[0] = (src[last] + src[0] + src[1]) / 3;
          for (let i=1;i<last;i++){
            out[i] = (src[i-1] + src[i] + src[i+1]) / 3;
          }
          out[last] = (src[last-1] + src[last] + src[0]) / 3;
          return out;
        }

        function dpApplySmoothPasses(src, passes){
          let out = src;
          for (let p=0;p<(passes|0);p++) out = dpSmooth3Cyclic(out);
          return out;
        }

        function dpApplySpectralTiltRampInPlace(segments, tiltMode, tiltAmt){
          const mode = String(tiltMode||'none');
          const amt = tiltAmt|0;
          const N = segments.length|0;
          if (mode === 'none' || amt <= 0 || N <= 0) return;
          for (let i=0;i<N;i++){
            const t = (N<=1) ? 0 : (i/(N-1));
            let passes = 0;
            if (mode === 'dark2bright'){
              passes = Math.round(amt * (1 - t));
            } else if (mode === 'bright2dark'){
              passes = Math.round(amt * t);
            }
            if (passes > 0){
              segments[i] = dpApplySmoothPasses(segments[i], passes);
            }
          }
        }

        function dpBestRotationForBoundary(prevSeg, seg, winLen, step){
          const N = seg.length|0;
          if (N <= 1) return 0;
          const w = Math.max(16, Math.min(winLen|0, N));
          const tailStart = N - w;
          let prevEnergy = 0;
          for (let i=0;i<w;i++){
            const a = prevSeg[tailStart+i] || 0;
            prevEnergy += a*a;
          }
          if (prevEnergy < 1e-12) return 0;

          let bestShift = 0;
          let bestScore = -1e9;
          let score0 = null;
          const st = Math.max(1, step|0);
          for (let shift=0; shift < N; shift += st){
            let dot = 0;
            let curEnergy = 0;
            for (let i=0;i<w;i++){
              const a = prevSeg[tailStart+i] || 0;
              const b = seg[(shift + i) % N] || 0;
              dot += a*b;
              curEnergy += b*b;
            }
            if (curEnergy < 1e-12) continue;
            const score = dot / (Math.sqrt(prevEnergy * curEnergy) + 1e-12);
            if (shift === 0) score0 = score;
            if (score > bestScore){
              bestScore = score;
              bestShift = shift;
            }
          }
          if (score0 === null) score0 = bestScore;
          // Only apply if it clearly improves continuity.
          if (bestShift !== 0 && bestScore < (score0 + 0.01)) return 0;
          return bestShift|0;
        }

        function dpAlignAdjacentSegmentsInPlace(segments, winLen){
          const N = segments.length|0;
          if (N <= 1) return;
          const w = Math.max(16, Math.min(winLen|0, 256));
          const step = 2;
          for (let i=1;i<N;i++){
            const prev = segments[i-1];
            const seg = segments[i];
            if (!prev || !seg) continue;
            const shift = dpBestRotationForBoundary(prev, seg, w, step);
            if (shift){
              segments[i] = dpRotateCopy(seg, shift);
            }
          }
        }

        function dpMakeWindow(n, kind){
          const N = n|0;
          const k = String(kind||'none');
          const w = new Float32Array(N);
          if (k === 'hann'){
            for (let i=0;i<N;i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
            return w;
          }
          if (k === 'hamming'){
            for (let i=0;i<N;i++) w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1));
            return w;
          }
          // none
          w.fill(1);
          return w;
        }

        function dpApplyWindowInPlace(seg, win){
          const N = Math.min(seg.length|0, win.length|0);
          for (let i=0;i<N;i++) seg[i] *= win[i];
        }

        // Capture bank state for undo (only the target range)
        const __loopTargets = Array.from({length:slotCount}, (_,i)=>startSlot + i);
        const __bankBefore = captureBankState(__loopTargets, { preferEditor:true });

        if (useRaw){
          const PER_SLOT = DP_BASE_N;                 // 1024
          const TARGET_TOTAL = PER_SLOT * slotCount;  // count × 1024
          const whole = resampleFloatWholeBoxAA(full, TARGET_TOTAL);

          // Optional: auto seam fade if the loop boundary is a big jump.
          // We only touch the tail, fading it toward the start (no per-slice seam forcing).
          let seamFaded = false;
          try{
            const endStartJump = Math.abs((whole[TARGET_TOTAL-1]||0) - (whole[0]||0));
            if (isFinite(endStartJump) && endStartJump > 0.25){
              const fadeLen = clamp(Math.round(TARGET_TOTAL * 0.002), 64, 512); // ~0.2% of buffer, bounded
              const L = Math.min(fadeLen|0, TARGET_TOTAL|0);
              for (let i=0;i<L;i++){
                const t = (i + 1) / L;
                const idx = (TARGET_TOTAL - L) + i;
                whole[idx] = whole[idx] * (1 - t) + whole[i] * t;
              }
              seamFaded = true;
            }
          }catch(_){ }

          // Raw slice seam/cut mode:
          //   • none      : legacy contiguous 1024 frames
          //   • detrend   : force each frame to start/end at 0 (linear detrend)
          //   • rotateZC  : rotate each frame to a rising zero-cross
          //   • zcCut     : snap frame boundaries to zero-crosses (±window), then resample each frame to 1024
          const rawSeamMode = (seam && seam !== 'none') ? String(seam) : 'none';
          const zcWindow = clamp((zcWin|0), 0, 512);

          const segments = new Array(slotCount);
          let zcCutUsed = false;
          let overlapUsed = false;

          // Raw overlap windowing: extract a longer window per slot and resample
          // to 1024. This makes adjacent slots more correlated (smoother scanning).
          const ovPct = clamp((rawOverlap|0), 0, 75);
          const overlapWinLen = (ovPct > 0)
            ? clamp(Math.round(PER_SLOT / Math.max(0.01, 1 - (ovPct/100))), PER_SLOT, PER_SLOT*4)
            : PER_SLOT;
          const ovWinKind = String(rawWindow||'none');
          const ovWin = (ovPct > 0 && overlapWinLen > PER_SLOT && (ovWinKind === 'hann' || ovWinKind === 'hamming'))
            ? dpMakeWindow(overlapWinLen, ovWinKind)
            : null;

          if (ovPct > 0 && overlapWinLen > PER_SLOT){
            overlapUsed = true;
            for (let s=0;s<slotCount;s++){
              const start = (s * PER_SLOT) % TARGET_TOTAL;
              const slice = new Float32Array(overlapWinLen);
              for (let i=0;i<overlapWinLen;i++){
                slice[i] = whole[(start + i) % TARGET_TOTAL];
              }
              if (ovWin){
                for (let i=0;i<overlapWinLen;i++) slice[i] *= ovWin[i];
              }
              segments[s] = resampleFloatWholeBoxAA(slice, PER_SLOT, 16);
            }
          } else if (rawSeamMode === 'zcCut' && zcWindow > 0){
            zcCutUsed = true;
            const B = new Int32Array(slotCount + 1);
            B[0] = 0;
            B[slotCount] = TARGET_TOTAL;

            let prev = 0;
            const minSeg = 64; // safety: prevent degenerate slices when windows overlap

            for (let k=1;k<slotCount;k++){
              const ideal = k * PER_SLOT;
              const lo = Math.max(prev + minSeg, ideal - zcWindow);
              const hi = Math.min(TARGET_TOTAL - ((slotCount - k) * minSeg), ideal + zcWindow);
              const idx = dpFindBestZCCutIndex(whole, ideal, zcWindow, lo, hi);
              B[k] = idx;
              prev = idx;
            }

            for (let s=0;s<slotCount;s++){
              const a = B[s]|0;
              const b = B[s+1]|0;
              const slice = new Float32Array(Math.max(0, b - a));
              if (slice.length) slice.set(whole.subarray(a, b));

              // Resample each slice back to 1024 so the DigiPRO render path stays stable.
              segments[s] = (slice.length === PER_SLOT) ? slice : resampleFloatWholeBoxAA(slice, PER_SLOT);
            }
          } else {
            for (let s=0;s<slotCount;s++){
              segments[s] = new Float32Array(whole.subarray(s*PER_SLOT, (s+1)*PER_SLOT));
            }
          }

          // Apply seam conditioning / DC on base segments (original time order)
          for (let s=0;s<slotCount;s++){
            let seg = segments[s];

            // Optional per-slice DC removal (keeps overall dynamics but centers each frame)
            if (dcMode === 'perSlice'){
              dpMeanRemoveInPlace(seg);
            }

            // Optional raw seam conditioning
            if (rawSeamMode === 'detrend'){
              dpDetrendSeamInPlace(seg);
            } else if (rawSeamMode === 'rotateZC'){
              const start = dpFindBestRisingZCIndex(seg);
              seg = dpRotateCopy(seg, start);
            }

            segments[s] = seg;
          }

          // Slot order transforms (copies segments so later ops don't share refs)
          let finalSegs = dpApplySlotOrderTransform(segments, orderMode, orderSeed);

          // Post-slice FX (reverse/invert/gain/warp) in final slot order
          for (let s=0;s<slotCount;s++){
            finalSegs[s] = dpApplyLoopImportFx(finalSegs[s], s, slotCount);
          }

          // Spectral tilt ramp (dark↔bright)
          dpApplySpectralTiltRampInPlace(finalSegs, tiltMode, tiltAmt);

          // Adjacent-slot continuity alignment
          if (alignAdj){
            dpAlignAdjacentSegmentsInPlace(finalSegs, alignWin);
          }

          // Track peak for safety scaling
          let postPeak = 0;
          for (let s=0;s<slotCount;s++){
            const seg = finalSegs[s];
            for (let i=0;i<seg.length;i++){
              const v = seg[i];
              if (!isFinite(v)) continue;
              const a = Math.abs(v);
              if (a > postPeak) postPeak = a;
            }
          }

          // Clip protection after FX/tilt/align ops
          let postFxScaled = false;
          if (isFinite(postPeak) && postPeak > 1){
            const g = 1 / postPeak;
            for (let s=0;s<slotCount;s++){
              const seg = finalSegs[s];
              for (let i=0;i<seg.length;i++) seg[i] *= g;
            }
            postFxScaled = true;
          }

          // Write to slots
          for (let s=0;s<slotCount;s++){
            const target = startSlot + s;
            const seg = finalSegs[s];

            // Display preview is still 96-sample for the UI
            const preview = resampleFloatToU8_AA(seg, 96, 16);

            const suffix2 = (target).toString(36).toUpperCase().padStart(2,'0').slice(-2);
            const name = _alnum4(prefix2 + suffix2);

            // Store the full-resolution float segment so DigiPRO table render has best source data.
            LIB.waves[target] = attachDisplayRot({ name, dataU8: preview, user:true, _srcFloat: seg }, false);
            LIB.dirty.delete(target);
            paintGridCell(target);
          }

          // --- Import hint: time/pitch math for “playback” use ---
          // Source duration is derived from the WAV sample rate. Packed length is referenced to 48k
          // because the DigiPRO/WAV export path in this tool is built around 48,000 Hz.
          const srcSr = (full && full._sr && isFinite(full._sr) && full._sr > 0) ? (full._sr|0) : 0;
          const srcDur = (srcSr > 0) ? (full.length / srcSr) : 0;
          const packedDur48 = TARGET_TOTAL / 48000;
          let st = 0, effSr = 0;
          if (srcDur > 0){
            st = 12 * (Math.log(packedDur48 / srcDur) / Math.log(2));
            effSr = TARGET_TOTAL / srcDur;
          }
          const fmtSecs = (x)=> (isFinite(x) ? x.toFixed(3) : '?.???');
          const fmtHz = (x)=> (isFinite(x) ? Math.round(x).toString() : '?');
          const fmtSt = (x)=>{
            if (!isFinite(x)) return '?';
            const s = (x>=0?'+':'') + x.toFixed(2);
            return s;
          };
          const hintParts = [];
          if (srcSr > 0 && srcDur > 0){
            hintParts.push(`Source ${fmtSecs(srcDur)}s @ ${fmtHz(srcSr)}Hz`);
          }
          hintParts.push(`Packed ${fmtSecs(packedDur48)}s @ 48k ref`);
          if (srcDur > 0){
            hintParts.push(`Suggested transpose ${fmtSt(st)} st`);
            hintParts.push(`Effective SR ${fmtHz(effSr)}Hz (Nyq ${fmtHz(effSr/2)}Hz)`);
          }
          if (clipScaled) hintParts.push('Clip-protected');
          if (postFxScaled) hintParts.push('PostFX scale');
          if (seamFaded) hintParts.push('Seam-fade');

          if (overlapUsed){
            const w = (rawWindow && rawWindow !== 'none') ? String(rawWindow) : 'none';
	            // `ovPct` is the raw overlap percentage used to build the longer window per slot.
	            // Keep this string render resilient even if older state names were used.
	            hintParts.push(`Overlap ${ovPct}%${(w !== 'none') ? (' ' + w) : ''}`);
          }

          if (orderMode && orderMode !== 'normal'){
            if (orderMode === 'scramble'){
              hintParts.push(`Order scramble (seed ${orderSeed})`);
            } else {
              hintParts.push(`Order ${orderMode}`);
            }
          }

          if (tiltMode && tiltMode !== 'none' && (tiltAmt|0) > 0){
            hintParts.push(`Tilt ${tiltMode} ${tiltAmt}`);
          }

          if (alignAdj){
            hintParts.push(`Align ${alignWin}`);
          }

          if (dcMode === 'global') hintParts.push('DC global');
          if (dcMode === 'perSlice') hintParts.push('DC per-slice');

          if (rawSeamMode === 'detrend') hintParts.push('Detrend');
          else if (rawSeamMode === 'rotateZC') hintParts.push('Rotate→ZC');
          else if (zcCutUsed) hintParts.push(`ZC cut ±${zcWindow}`);

          const fxHint = [];
          if (reverseMode && reverseMode !== 'none') fxHint.push(`rev:${reverseMode}`);
          if (invertMode && invertMode !== 'none') fxHint.push(`inv:${invertMode}`);
          if (gainMode && gainMode !== 'none') fxHint.push(`gain:${gainMode}`);
          if (warpSt || warpCt){
            const c = (warpCt|0);
            const ct = c ? `${c>=0?'+':''}${c}c` : '';
            fxHint.push(`warp:${warpSt}st${ct}${warpRamp?' ramp':''}`.trim());
          }
          if (fxHint.length) hintParts.push('FX ' + fxHint.join(','));

          const hint = hintParts.length ? (' ' + hintParts.join(' • ')) : '';
          // If the editor is showing a slot we just overwrote, refresh it so UI/state stay consistent.
          try{
            const es = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : -1;
            if (es >= startSlot && es < (startSlot + slotCount)){
              openInEditor(es);
            }
          }catch(_){}
          const __bankAfter = captureBankState(__loopTargets);
          bankPush({ label:`Import loop → ${slotCount} (${modeLabel}) @ ${startSlot+1}`, before: __bankBefore, after: __bankAfter });

          announceIO(`Imported loop → ${slotCount} slice(s) into slots ${startSlot+1}..${startSlot+slotCount} (${modeLabel}) from ${file.name}. Nothing is sent to the device until you Upload.${hint}`);
          return;
        }

        // --- Legacy wavetable slicing modes (spectral “frames”) ---
        const hop = full.length / slotCount;
        const factor = (mode === 'overlap8') ? 8 : (mode === 'overlap4') ? 4 : 1;
        let win = Math.round(hop * factor);
        // Keep a sensible minimum so short loops don't turn into micro-snippets.
        win = Math.max(64, win|0);
        win = Math.min(full.length, win);

        const Nfull = full.length|0;
        function wrapAt(i){ return full[((i % Nfull) + Nfull) % Nfull]; }
        function extractWrap(start, len){
          const out = new Float32Array(len);
          for (let i=0;i<len;i++) out[i] = wrapAt(start + i);
          return out;
        }
        function makeSeamless(seg){
          const N = seg.length|0;
          if (N < 2) return seg;
          const a = seg[0];
          const b = seg[N-1];
          const d = (b - a) / (N - 1);
          for (let i=0;i<N;i++) seg[i] -= (a + d * i);
          return seg;
        }

        const SRC_MAX = 16384;

	        // Build base frames in original time order
	        const baseSegs = new Array(slotCount);
	        for (let s=0;s<slotCount;s++){
	          let seg;
	          if (mode === 'equal'){
	            // strict non-overlapping slices
	            const a = Math.floor((s * full.length) / slotCount);
	            const b = Math.floor(((s+1) * full.length) / slotCount);
	            seg = full.slice(a, Math.max(a+1, b));
	          } else {
	            // overlapping windows, with wrap-around
	            const center = (s + 0.5) * hop;
	            const start = Math.round(center - win / 2);
	            seg = extractWrap(start, win);
	          }

	          // Original behavior: force each frame to loop nicely and normalize per-frame.
	          makeSeamless(seg);
	          baseSegs[s] = normalizeFloatArray(seg);
	        }

	        // Slot order transforms (copy frames so later ops don't share references)
	        let finalSegs = dpApplySlotOrderTransform(baseSegs, orderMode, orderSeed);

	        // Optional post-slice creative FX (reverse/invert/gain/warp) in final slot order
	        for (let s=0;s<slotCount;s++){
	          finalSegs[s] = dpApplyLoopImportFx(finalSegs[s], s, slotCount);
	        }

	        // Spectral tilt ramp + adjacent-slot alignment
	        dpApplySpectralTiltRampInPlace(finalSegs, tiltMode, tiltAmt);
	        if (alignAdj){
	          dpAlignAdjacentSegmentsInPlace(finalSegs, alignWin);
	        }

	        // Safety peak scaling (avoids clipping after FX/tilt/alignment)
	        let postPeak = 0;
	        for (let s=0;s<slotCount;s++){
	          const seg = finalSegs[s];
	          for (let i=0;i<seg.length;i++){
	            const a = Math.abs(seg[i]);
	            if (a > postPeak) postPeak = a;
	          }
	        }
	        if (isFinite(postPeak) && postPeak > 1){
	          const g = 1 / postPeak;
	          for (let s=0;s<slotCount;s++){
	            const seg = finalSegs[s];
	            for (let i=0;i<seg.length;i++) seg[i] *= g;
	          }
	        }

	        // Write to slots
	        for (let s=0;s<slotCount;s++){
	          const target = startSlot + s;
	          const segNorm = finalSegs[s];

	          // Display preview + device export are always 96-sample single-cycle
	          const preview = resampleFloatToU8_AA(segNorm, 96, 16);

	          // Keep a bounded source buffer for .wav export (avoids huge memory if someone imports a long file)
	          const srcKeep = (segNorm.length > SRC_MAX) ? downsampleFloatLinear(segNorm, SRC_MAX) : segNorm;

	          const suffix2 = (target).toString(36).toUpperCase().padStart(2,'0').slice(-2);
	          const name = _alnum4(prefix2 + suffix2);
	          LIB.waves[target] = attachDisplayRot({ name, dataU8: preview, user:true, _srcFloat: srcKeep }, false);
	          LIB.dirty.delete(target);
	          paintGridCell(target);
	        }

        // If the editor is showing a slot we just overwrote, refresh it so UI/state stay consistent.
        try{
          const es = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : -1;
          if (es >= startSlot && es < (startSlot + slotCount)){
            openInEditor(es);
          }
        }catch(_){}
        const __bankAfter = captureBankState(__loopTargets);
        bankPush({ label:`Import loop → ${slotCount} (${modeLabel}) @ ${startSlot+1}`, before: __bankBefore, after: __bankAfter });

        announceIO(`Imported loop → ${slotCount} slice(s) into slots ${startSlot+1}..${startSlot+slotCount} (${modeLabel}) from ${file.name}. Nothing is sent to the device until you Upload.`);
      }catch(err){
        console.error(err);
        announceIO(`Loop import failed: ${err && err.message || err}`, true);
      }finally{
        updateButtonsState();
      }
    };
    // --------------------------------------------------------------
    // WAV export presets: SAFE (default) + Advanced pitch (optional)
    //
    // SAFE preset (set-and-forget):
    //   - WAV, PCM 16-bit, mono
    //   - Sample rate: 44,100 Hz (fixed)
    //   - Points-per-cycle: LOCKED to the slot buffer length
    //   - No processing (no DC removal, no phase tricks, no smoothing)
    //   - Loop points embedded via standard RIFF 'smpl' chunk:
    //       start = 0, end = N-1
    //
    // Advanced pitch (optional):
    //   - Octave steps only (0 / -1 / -2)
    //   - Either:
    //       (A) Metadata-only sample rate change (no resampling)
    //       (B) Periodic Fourier resample (FFT-style) keeping sample rate fixed
    // --------------------------------------------------------------

    const EXPORT_WAV_PREF_KEY = 'mm_export_wav_prefs_v6';
    // Contextual preference for *bank* WAV exports only.
    // Kept separate from EXPORT_WAV_PREF_KEY so non-bank export dialogs don't overwrite it.
    const EXPORT_WAV_BANK_SCOPE_KEY = 'mm_export_wav_bank_scope_v1';
    const TONVERK_WAVE_SIZE = 2048;

    // Tuned-note export guard: very high notes can collapse to a tiny
    // samples-per-cycle (e.g. ~6–12 at 44.1k/48k), which sounds rough/steppy
    // even when the cycle is perfectly closed.
    // Limit the UI to a more realistic range.
    const MAX_TUNE_OCTAVE = 6; // 0..6

    function dpNormExportWavPrefs(p){
      p = p && typeof p === 'object' ? p : {};

      // Minimal, friendly tuning model:
      // - Natural notes only (A..G) + octave.
      // - A4 fixed at 440 Hz.
      // - Uses FFT periodic resampling to keep sample rate standard (44.1/48k) and loops clean.
      function normTuneNote(n){
        n = String(n == null ? 'C' : n).trim().toUpperCase();
        const c = n[0] || 'C';
        return (c === 'A' || c === 'B' || c === 'C' || c === 'D' || c === 'E' || c === 'F' || c === 'G') ? c : 'C';
      }

      const out = {
        v: 6,
        adv: !!p.adv,
        baseSampleRate: _clampInt(p.baseSampleRate == null ? 44100 : p.baseSampleRate, 4000, 96000),
        pitchOctaves: (p.pitchOctaves|0), // 0, -1, -2
        pitchMethod: (p.pitchMethod === 'fft') ? 'fft' : 'sr',
        tonverkMode: !!p.tonverkMode,

        // Tuned note export (Advanced only)
        tuneEnabled: !!p.tuneEnabled,
        tuneNote: normTuneNote(p.tuneNote),
        tuneOctave: _clampInt(p.tuneOctave == null ? 3 : p.tuneOctave, 0, MAX_TUNE_OCTAVE),

        // Packed-chain ordering (bank WAV ZIP only)
        // palindromeChain: ping-pong order
        // loopChain: when palindrome is enabled, export a loop-friendly classic
        //            sequence (0..N-1 then N-2..1) and write a WAV 'smpl' loop chunk.
        palindromeChain: !!p.palindromeChain,
        loopChain: !!p.loopChain,

        // Bank export contents (bank WAV ZIP only)
        exportSingles: (p.exportSingles == null) ? true : !!p.exportSingles,
        exportChain: (p.exportChain == null) ? true : !!p.exportChain,
      };
      if (out.pitchOctaves !== 0 && out.pitchOctaves !== -1 && out.pitchOctaves !== -2){
        out.pitchOctaves = 0;
      }
      // loopChain only applies when palindromeChain is enabled.
      if (!out.palindromeChain) out.loopChain = false;
      // In SAFE mode we ignore all advanced knobs and lock to the safe defaults.
      if (!out.adv){
        out.baseSampleRate = 44100;
        out.pitchOctaves = 0;
        out.pitchMethod = 'sr';
        out.tuneEnabled = false;
      }
      if (out.tonverkMode){
        // Tonverk needs a packed/chain-style wavetable with a power-of-two frame size.
        // Keep this mode "one switch" simple and make the export backend do the rest.
        out.baseSampleRate = 44100;
        out.pitchOctaves = 0;
        out.pitchMethod = 'fft';
        out.tuneEnabled = false;
        out.exportSingles = false;
        out.exportChain = true;
        out.palindromeChain = false;
        out.loopChain = false;
      }
      return out;
    }

    function dpLoadExportWavPrefs(){
      try{
        // v3 introduced tuned note export + palindrome chain options.
        // v4 added bank export “what to include” toggles.
        // v6 adds Tonverk wavetable export mode.
        // Fall back to older preference keys so existing users don't lose their export defaults.
        const raw = localStorage.getItem(EXPORT_WAV_PREF_KEY)
          || localStorage.getItem('mm_export_wav_prefs_v5')
          || localStorage.getItem('mm_export_wav_prefs_v4')
          || localStorage.getItem('mm_export_wav_prefs_v3')
          || localStorage.getItem('mm_export_wav_prefs_v2');
        if (!raw) return dpNormExportWavPrefs(null);
        return dpNormExportWavPrefs(JSON.parse(raw));
      }catch(_){
        return dpNormExportWavPrefs(null);
      }
    }

    function dpSaveExportWavPrefs(prefs){
      try{
        localStorage.setItem(EXPORT_WAV_PREF_KEY, JSON.stringify(dpNormExportWavPrefs(prefs)));
      }catch(_){ }
    }

    function dpLoadExportWavBankScope(fallback){
      fallback = fallback == null ? 'all' : String(fallback);
      try{
        const raw = localStorage.getItem(EXPORT_WAV_BANK_SCOPE_KEY);
        const s = String(raw || '').trim().toLowerCase();
        if (s === 'all' || s === 'filled' || s === 'selected') return s;
      }catch(_){ }
      return (fallback === 'filled' || fallback === 'selected') ? fallback : 'all';
    }

    function dpSaveExportWavBankScope(scope){
      try{
        const s = String(scope || '').trim().toLowerCase();
        if (s === 'all' || s === 'filled' || s === 'selected'){
          localStorage.setItem(EXPORT_WAV_BANK_SCOPE_KEY, s);
        }
      }catch(_){ }
    }

    function dpSafeStem(s){
      return String(s || 'export')
        .trim()
        .replace(/\s+/g,'_')
        .replace(/[^A-Za-z0-9._-]/g,'-')
        .replace(/-+/g,'-')
        .slice(0, 64) || 'export';
    }

    function dpPow2(n){
      n = n|0;
      if (n === 0) return 1;
      if (n === -1) return 0.5;
      if (n === -2) return 0.25;
      if (n === 1) return 2;
      if (n === 2) return 4;
      return Math.pow(2, n);
    }

    function dpTonverkFilenameSuffix(prefs){
      const p = dpNormExportWavPrefs(prefs);
      return p.tonverkMode ? `_wt${TONVERK_WAVE_SIZE}` : '';
    }

    function dpFinalizeExportWavFilename(baseName, extraSuffix, prefs){
      const stem = String(baseName || 'export.wav');
      const add = `${String(extraSuffix || '')}${dpTonverkFilenameSuffix(prefs)}`;
      if (/\.wav$/i.test(stem)) return stem.replace(/\.wav$/i, `${add}.wav`);
      return `${stem}${add}.wav`;
    }

    function dpTonverkChainBaseName(infos, fallback){
      const list = Array.isArray(infos) ? infos : [];
      for (const inf of list){
        if (!inf) continue;
        const raw = String((inf.nameStem != null) ? inf.nameStem : (inf.nm4 || '')).trim();
        if (!raw) continue;
        if (raw.toUpperCase() === 'EMPT') continue;
        return dpSafeStem(raw);
      }
      return dpSafeStem(fallback || 'wavetable');
    }

    function dpResampleFloatCycleAA(srcF, targetLen, taps=16){
      const src = (srcF instanceof Float32Array || srcF instanceof Float64Array) ? srcF : new Float32Array(srcF||[]);
      const N = src.length|0;
      const M = targetLen|0;
      const out = new Float32Array(M > 0 ? M : 0);
      if (!N || !M) return out;
      taps = Math.max(1, taps|0);
      const step = N / M;
      for (let i=0;i<M;i++){
        let acc = 0;
        for (let t=0;t<taps;t++){
          const x = (i + (t + 0.5)/taps) * step;
          const xi = Math.floor(x);
          const i0 = ((xi % N) + N) % N;
          const i1 = (i0 + 1) % N;
          const frac = x - xi;
          acc += src[i0]*(1-frac) + src[i1]*frac;
        }
        out[i] = acc / taps;
      }
      return out;
    }

    function dpBestTonverkExportSourceFloat(info, targetLen){
      const fallback = u8ToCycleFloat((info && info.dataU8) ? info.dataU8 : new Uint8Array(96).fill(128));
      const target = Math.max(64, targetLen|0);
      let src = null;

      try{
        if (info && info.srcFloat && info.srcFloat.length){
          src = (info.srcFloat instanceof Float32Array) ? info.srcFloat : new Float32Array(info.srcFloat);
        }
      }catch(_){ src = null; }

      try{
        if (!src && info && info.tables6132 && typeof dpBaseWaveInt16FromTables === 'function'){
          const baseI16 = dpBaseWaveInt16FromTables(info.tables6132);
          if (baseI16 && baseI16.length){
            src = new Float32Array(baseI16.length);
            for (let i=0;i<baseI16.length;i++){
              let v = (baseI16[i] || 0) / 32767;
              if (!isFinite(v)) v = 0;
              if (v < -1) v = -1;
              else if (v > 1) v = 1;
              src[i] = v;
            }
          }
        }
      }catch(_){ src = null; }

      if (!src || !src.length) return fallback;
      if ((src.length|0) > target){
        return dpResampleFloatCycleAA(src, target, 16);
      }
      return (src instanceof Float32Array) ? new Float32Array(src) : new Float32Array(src);
    }

    // --- Tuning helpers (simple + predictable) ---
    // Natural notes only (A..G), octave 0..6, A4=440 Hz.
    function dpSemitoneForNaturalNote(note){
      note = String(note || 'C').trim().toUpperCase();
      switch(note[0]){
        case 'C': return 0;
        case 'D': return 2;
        case 'E': return 4;
        case 'F': return 5;
        case 'G': return 7;
        case 'A': return 9;
        case 'B': return 11;
        default: return 0;
      }
    }
    function dpMidiFromNoteOctave(note, octave){
      const semi = dpSemitoneForNaturalNote(note);
      const oct = _clampInt(octave == null ? 3 : octave, 0, MAX_TUNE_OCTAVE);
      // MIDI: C4=60 => (4+1)*12 + 0
      return (oct + 1) * 12 + semi;
    }
    function dpFreqFromMidi(midi){
      const m = (midi|0);
      return 440 * Math.pow(2, (m - 69) / 12);
    }
    function dpCentsError(actualHz, targetHz){
      const a = +actualHz, t = +targetHz;
      if (!isFinite(a) || !isFinite(t) || a <= 0 || t <= 0) return 0;
      return 1200 * Math.log2(a / t);
    }

    function dpComputePitchParams(basePPC, prefs){
      basePPC = _clampInt(basePPC == null ? 96 : basePPC, 1, 1<<20);
      const p = dpNormExportWavPrefs(prefs);

      if (p.tonverkMode){
        return {
          adv: !!p.adv,
          tonverkMode: true,
          pitchMethod: 'fft',
          pitchOctaves: 0,
          sampleRate: 44100,
          pointsPerCycle: TONVERK_WAVE_SIZE,
          baseSampleRate: 44100,
          basePointsPerCycle: basePPC,

          tuneEnabled: false,
          tuneNote: null,
          tuneOctave: null,
          tuneMidi: null,
          tuneHz: null,
          tuneCents: 0,
          tuneLabel: '',
        };
      }

      // SAFE defaults
      let srOut = 44100;
      let ppcOut = basePPC;
      let method = 'sr';

      // Optional tuned note export.
      // This is intentionally opinionated:
      // - Keeps SR standard (44.1k/48k)
      // - Uses FFT periodic resampling to hit the desired f0 as closely as possible
      let tuneEnabled = false;
      let tuneNote = null;
      let tuneOctave = null;
      let tuneMidi = null;
      let tuneHz = null;
      let tuneCents = 0;

      if (p.adv){
        const baseSR = _clampInt(p.baseSampleRate, 4000, 96000);
        const oct = (p.pitchOctaves|0);
        method = p.pitchMethod;

        if (p.tuneEnabled){
          tuneEnabled = true;
          tuneNote = String(p.tuneNote || 'C').trim().toUpperCase();
          tuneOctave = _clampInt(p.tuneOctave == null ? 3 : p.tuneOctave, 0, MAX_TUNE_OCTAVE);
          tuneMidi = dpMidiFromNoteOctave(tuneNote, tuneOctave);
          tuneHz = dpFreqFromMidi(tuneMidi);

          srOut = baseSR;
          // Choose the nearest integer samples-per-cycle.
          ppcOut = _clampInt(Math.round(srOut / tuneHz), 1, 1<<20);
          method = 'fft';

          const actualHz = srOut / ppcOut;
          tuneCents = dpCentsError(actualHz, tuneHz);
        } else if (method === 'fft' && oct < 0){
          srOut = baseSR;
          ppcOut = _clampInt(Math.round(basePPC * dpPow2(-oct)), 1, 1<<20);
        } else {
          // Metadata-only: change sample-rate header (no resampling)
          srOut = _clampInt(Math.round(baseSR * dpPow2(oct)), 1000, 192000);
          ppcOut = basePPC;
          method = 'sr';
        }
      }

      return {
        adv: !!p.adv,
        pitchMethod: method,
        pitchOctaves: (p.pitchOctaves|0),
        sampleRate: srOut,
        pointsPerCycle: ppcOut,
        baseSampleRate: p.adv ? _clampInt(p.baseSampleRate,4000,96000) : 44100,
        basePointsPerCycle: basePPC,

        // Tuning info (optional)
        tuneEnabled: tuneEnabled,
        tuneNote: tuneNote,
        tuneOctave: tuneOctave,
        tuneMidi: tuneMidi,
        tuneHz: tuneHz,
        tuneCents: tuneCents,
        tuneLabel: tuneEnabled ? `${tuneNote}${tuneOctave}` : '',
      };
    }

    async function dpPromptExportWavShiftOptions(actionLabel, ctx){
      // NOTE: We keep this function name for backward compatibility with the older
      // “shift-export” workflow, but it now only controls SAFE vs Advanced pitch.
      actionLabel = String(actionLabel || 'Export WAV');
      ctx = ctx || {};
      const waveCount = _clampInt(ctx.waveCount == null ? 0 : ctx.waveCount, 0, 9999);
      const targetLabel = String(ctx.targetLabel || (waveCount === 1 ? '1 slot' : `${waveCount} slots`));
      const basePPC = _clampInt(ctx.basePPC == null ? 96 : ctx.basePPC, 1, 1<<20);
      const forceAdv = !!ctx.forceAdv;

      const prefs = dpLoadExportWavPrefs();
      const basePref = { ...prefs };

      // Optional per-call defaults.
      // (Used when reusing this dialog for “selected slots” export so the default
      // remains “single WAVs only” rather than inheriting the bank-export setting.)
      if (ctx.defaultExportSingles != null) basePref.exportSingles = !!ctx.defaultExportSingles;
      if (ctx.defaultExportChain != null) basePref.exportChain = !!ctx.defaultExportChain;
      if (ctx.defaultPalindromeChain != null) basePref.palindromeChain = !!ctx.defaultPalindromeChain;
      if (ctx.defaultLoopChain != null) basePref.loopChain = !!ctx.defaultLoopChain;

      const initial = dpNormExportWavPrefs({
        ...basePref,
        adv: forceAdv ? true : basePref.adv,
      });

      return new Promise((resolve)=>{
        const overlay = el('div', 'mm-digi-guard');
        const dlg = el('div', 'dlg');
        const h = el('h4'); h.textContent = actionLabel;

        const p = el('p', 'mm-small');
        p.textContent = `Targets: ${targetLabel}.`;

        // --- Bank/selection export: choose outputs + (optionally) which slots to include ---
        const allowPalindromeChain = !!ctx.allowPalindromeChain;

        // Optional slot-scope selector (used by bank export to choose All/Filled/Selected).
        const allowSlotScope = !!ctx.allowSlotScope;
        const scopeCounts = (ctx && ctx.slotScopeCounts && typeof ctx.slotScopeCounts === 'object') ? ctx.slotScopeCounts : {};
        const scopeAllCount = _clampInt((scopeCounts.all != null) ? scopeCounts.all : waveCount, 0, 9999);
        const scopeFilledCount = _clampInt((scopeCounts.filled != null) ? scopeCounts.filled : 0, 0, 9999);
        const scopeSelectedCount = _clampInt((scopeCounts.selected != null) ? scopeCounts.selected : 0, 0, 9999);
        let scopeDefault = 'all';
        if (allowSlotScope){
          const requested = (ctx && (ctx.slotScopeDefault === 'filled' || ctx.slotScopeDefault === 'selected')) ? ctx.slotScopeDefault : 'all';
          // Remember the last bank export scope the user picked.
          scopeDefault = dpLoadExportWavBankScope(requested);
        }

        let rScopeAll = null;
        let rScopeFilled = null;
        let rScopeSel = null;

        function getSlotScope(){
          if (!allowSlotScope) return 'all';
          if (rScopeSel && rScopeSel.checked) return 'selected';
          if (rScopeFilled && rScopeFilled.checked) return 'filled';
          return 'all';
        }
        function getScopeCount(){
          const s = getSlotScope();
          if (s === 'selected') return scopeSelectedCount;
          if (s === 'filled') return scopeFilledCount;
          return scopeAllCount;
        }

        const scopeBox = el('div');
        if (allowSlotScope){
          scopeBox.style.marginTop = '8px';
          scopeBox.style.paddingTop = '8px';
          scopeBox.style.borderTop = '1px solid rgba(255,255,255,0.15)';

          const title = el('div', 'mm-small');
          title.style.marginBottom = '6px';
          title.style.opacity = '0.9';
          title.textContent = 'Slots to include:';

          function mkScopeRow(input, labelText){
            const row = el('label');
            row.className = 'mm-small';
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.append(input, document.createTextNode(labelText));
            return row;
          }

          rScopeAll = el('input'); rScopeAll.type = 'radio'; rScopeAll.name = 'dp_wav_scope'; rScopeAll.value = 'all';
          rScopeFilled = el('input'); rScopeFilled.type = 'radio'; rScopeFilled.name = 'dp_wav_scope'; rScopeFilled.value = 'filled';
          rScopeSel = el('input'); rScopeSel.type = 'radio'; rScopeSel.name = 'dp_wav_scope'; rScopeSel.value = 'selected';

          rScopeAll.checked = (scopeDefault === 'all');
          rScopeFilled.checked = (scopeDefault === 'filled');
          rScopeSel.checked = (scopeDefault === 'selected');

          // Disable unavailable scopes
          if (scopeFilledCount <= 0){
            rScopeFilled.disabled = true;
            if (rScopeFilled.checked) rScopeAll.checked = true;
          }
          if (scopeSelectedCount <= 0){
            rScopeSel.disabled = true;
            if (rScopeSel.checked) rScopeAll.checked = true;
          }

          const rowAll = mkScopeRow(rScopeAll, `All slots (${scopeAllCount}) — include empty as silence`);
          const rowFilled = mkScopeRow(rScopeFilled, `Filled slots only (${scopeFilledCount})`);
          const rowSel = mkScopeRow(rScopeSel, `Selected slots only (${scopeSelectedCount})`);

          scopeBox.append(title, rowAll, rowFilled, rowSel);
        }

        let chkSingles = null;
        let chkChain = null;
        let chkPal = null;
        let chkLoop = null;
        let chkTonverk = null;
        let txtSingles = null;
        let txtPal = null;
        let txtLoop = null;

        const dlBox = el('div');
        if (allowPalindromeChain){
          dlBox.style.marginTop = allowSlotScope ? '10px' : '8px';
          dlBox.style.paddingTop = '8px';
          dlBox.style.borderTop = '1px solid rgba(255,255,255,0.15)';

          chkSingles = el('input');
          chkSingles.type = 'checkbox';
          chkSingles.checked = (initial.exportSingles == null) ? true : !!initial.exportSingles;

          chkChain = el('input');
          chkChain.type = 'checkbox';
          chkChain.checked = (initial.exportChain == null) ? true : !!initial.exportChain;

          txtSingles = el('span');
          txtSingles.textContent = `Single-cycle WAVs (${getScopeCount()} files)`;

          const rowSingles = el('label');
          rowSingles.className = 'mm-small';
          rowSingles.style.display = 'flex';
          rowSingles.style.alignItems = 'center';
          rowSingles.style.gap = '8px';
          rowSingles.append(chkSingles, txtSingles);

          const rowChain = el('label');
          rowChain.className = 'mm-small';
          rowChain.style.display = 'flex';
          rowChain.style.alignItems = 'center';
          rowChain.style.gap = '8px';
          rowChain.style.marginTop = '6px';
          rowChain.append(chkChain, document.createTextNode('Packed chain WAV'));

          // Nested option: palindrome order for the packed chain
          chkPal = el('input');
          chkPal.type = 'checkbox';
          chkPal.checked = !!initial.palindromeChain;

          txtPal = el('span');
          const palSliceCount = (()=>{
            const n = getScopeCount()|0;
            if (n <= 1) return n;
            return (initial && initial.loopChain) ? (2*n - 2) : (2*n - 1);
          })();
          txtPal.textContent = `Palindromic ping-pong order (${palSliceCount} slices)`;

          const rowPal = el('label');
          rowPal.className = 'mm-small';
          rowPal.style.display = 'flex';
          rowPal.style.alignItems = 'center';
          rowPal.style.gap = '8px';
          rowPal.style.margin = '6px 0 0 20px';
          rowPal.title = 'Ping-pong chain order.'
            + '\n\nWhen Loop is OFF: 0..N-1 then N-2..0 (ends on slot 0 for a frame-identical wrap, but repeats slot 0 at the loop boundary).'
            + '\nWhen Loop is ON: classic 0..N-1 then N-2..1 (no endpoint repeats; smoothest ping-pong scan) and a WAV smpl loop chunk is written.';
          rowPal.append(chkPal, txtPal);

          // Nested option: loop-ready chain (classic ping-pong sequence + smpl chunk)
          chkLoop = el('input');
          chkLoop.type = 'checkbox';
          chkLoop.checked = !!initial.loopChain;

          txtLoop = el('span');
          txtLoop.textContent = 'Loop packed chain (classic, embed loop markers)';

          const rowLoop = el('label');
          rowLoop.className = 'mm-small';
          rowLoop.style.display = 'flex';
          rowLoop.style.alignItems = 'center';
          rowLoop.style.gap = '8px';
          rowLoop.style.margin = '6px 0 0 40px';
          rowLoop.title = 'When enabled: uses the classic ping-pong order 0..N-1 then N-2..1 (avoids a “double slot 0” stall) and writes a standard WAV smpl loop chunk so many samplers auto-loop.';
          rowLoop.append(chkLoop, txtLoop);

          dlBox.append(rowSingles, rowChain, rowPal, rowLoop);
        }

        const tonverkBox = el('div');
        tonverkBox.style.marginTop = allowPalindromeChain ? '10px' : '8px';
        tonverkBox.style.paddingTop = '8px';
        tonverkBox.style.borderTop = '1px solid rgba(255,255,255,0.15)';

        chkTonverk = el('input');
        chkTonverk.type = 'checkbox';
        chkTonverk.checked = !!initial.tonverkMode;

        const rowTonverk = el('label');
        rowTonverk.className = 'mm-small';
        rowTonverk.style.display = 'flex';
        rowTonverk.style.alignItems = 'center';
        rowTonverk.style.gap = '8px';
        rowTonverk.title = 'Writes a Tonverk-friendly packed-chain WAV automatically: 2048 samples per wave, a filename ending in _wt2048.wav, and no separate single-cycle exports.';
        rowTonverk.append(chkTonverk, document.createTextNode('Tonverk wavetable mode'));

        tonverkBox.append(rowTonverk);

        // Advanced toggle
        const chkAdv = el('input');
        chkAdv.type = 'checkbox';
        chkAdv.checked = !!initial.adv;

        const rowAdv = el('div');
        rowAdv.style.display = 'flex';
        rowAdv.style.alignItems = 'center';
        rowAdv.style.gap = '8px';
        rowAdv.style.margin = '10px 0 6px 0';
        const labAdv = el('label');
        labAdv.className = 'mm-small';
        labAdv.style.display = 'flex';
        labAdv.style.alignItems = 'center';
        labAdv.style.gap = '8px';
        labAdv.append(chkAdv, document.createTextNode('Pitch/tuning options'));
        rowAdv.appendChild(labAdv);

        // Advanced options box
        const advBox = el('div');
        advBox.style.marginTop = '6px';
        advBox.style.paddingTop = '8px';
        advBox.style.borderTop = '1px solid rgba(255,255,255,0.15)';

        function mkLabeled(labelTxt, node){
          const wrap = el('label');
          wrap.className = 'mm-small';
          wrap.style.display = 'flex';
          wrap.style.alignItems = 'center';
          wrap.style.gap = '6px';
          wrap.appendChild(document.createTextNode(labelTxt));
          wrap.appendChild(node);
          return wrap;
        }

        const selSR = el('select');
        for (const sr of [44100, 48000]){
          const o = el('option');
          o.value = String(sr);
          o.textContent = sr.toLocaleString();
          selSR.appendChild(o);
        }
        selSR.value = String(_clampInt(initial.baseSampleRate, 4000, 96000));

        const selOct = el('select');
        const OCT_OPTS = [
          { v: 0,  t: '0 (no pitch shift)' },
          { v: -1, t: '-1 octave' },
          { v: -2, t: '-2 octaves' },
        ];
        for (const it of OCT_OPTS){
          const o = el('option');
          o.value = String(it.v);
          o.textContent = it.t;
          selOct.appendChild(o);
        }
        selOct.value = String(initial.pitchOctaves|0);

        const rSr = el('input'); rSr.type='radio'; rSr.name='dp_wav_pitch_method'; rSr.value='sr';
        const rFft = el('input'); rFft.type='radio'; rFft.name='dp_wav_pitch_method'; rFft.value='fft';
        if (initial.pitchMethod === 'fft') rFft.checked = true; else rSr.checked = true;

        const row1 = el('div');
        row1.style.display = 'flex';
        row1.style.gap = '12px';
        row1.style.flexWrap = 'wrap';
        row1.appendChild(mkLabeled('Base sample rate:', selSR));
        row1.appendChild(mkLabeled('Pitch shift:', selOct));

        const methodBox = el('div');
        methodBox.style.marginTop = '8px';

        const m1 = el('label');
        m1.className = 'mm-small';
        m1.style.display = 'flex';
        m1.style.alignItems = 'flex-start';
        m1.style.gap = '8px';
        m1.append(rSr, document.createTextNode('Change WAV sample rate (no resample)'));

        const m2 = el('label');
        m2.className = 'mm-small';
        m2.style.display = 'flex';
        m2.style.alignItems = 'flex-start';
        m2.style.gap = '8px';
        m2.style.marginTop = '6px';
        m2.append(rFft, document.createTextNode('FFT periodic resample (keeps sample rate)'));

        methodBox.append(m1, m2);

        // --- Tuned note export (simple UI: note + octave) ---
        const chkTune = el('input');
        chkTune.type = 'checkbox';
        chkTune.checked = !!initial.tuneEnabled;

        const selTuneNote = el('select');
        for (const n of ['C','D','E','F','G','A','B']){
          const o = el('option');
          o.value = n;
          o.textContent = n;
          selTuneNote.appendChild(o);
        }
        selTuneNote.value = String(initial.tuneNote || 'C').toUpperCase();

        const selTuneOct = el('select');
        for (let oct=0; oct<=MAX_TUNE_OCTAVE; oct++){
          const o = el('option');
          o.value = String(oct);
          o.textContent = String(oct);
          selTuneOct.appendChild(o);
        }
        selTuneOct.value = String(_clampInt(initial.tuneOctave, 0, MAX_TUNE_OCTAVE));

        const tuneRow = el('label');
        tuneRow.className = 'mm-small';
        tuneRow.style.display = 'flex';
        tuneRow.style.alignItems = 'center';
        tuneRow.style.gap = '8px';
        tuneRow.style.flexWrap = 'wrap';
        tuneRow.style.marginTop = '10px';
        tuneRow.title = 'Tuned export uses samples-per-cycle. Very high notes can collapse to very few samples/cycle and sound steppy; the octave range is capped for practicality.';
        tuneRow.append(
          chkTune,
          document.createTextNode('Tune to note:'),
          selTuneNote,
          selTuneOct
        );

        const preview = el('div', 'mm-small');
        preview.style.marginTop = '10px';
        preview.style.opacity = '0.85';

        advBox.append(row1, methodBox, tuneRow, preview);

        function updateEnabled(){
          const on = !!chkAdv.checked;
          const tonverkOn = !!(chkTonverk && chkTonverk.checked);
          // Hide the full pitch UI unless enabled (less overwhelming for most users).
          advBox.style.display = on ? '' : 'none';
          for (const node of advBox.querySelectorAll('input,select')) node.disabled = !on || tonverkOn;
          // But keep the radio checked states readable when disabled.
          // If tuning is enabled, force FFT mode and disable octave/method controls to avoid confusion.
          const tuneOn = on && !tonverkOn && !!chkTune.checked;
          selSR.disabled = !on || tonverkOn;
          chkTune.disabled = !on || tonverkOn;
          selTuneNote.disabled = !on || tonverkOn || !chkTune.checked;
          selTuneOct.disabled = !on || tonverkOn || !chkTune.checked;
          selOct.disabled = !on || tonverkOn || tuneOn;
          rSr.disabled = !on || tonverkOn || tuneOn;
          rFft.disabled = !on || tonverkOn || tuneOn;
          if (tuneOn){
            rFft.checked = true;
          }

          // Bank export selections (optional)
          let expSingles = chkSingles ? !!chkSingles.checked : true;
          let expChain = chkChain ? !!chkChain.checked : true;
          if (chkSingles){
            if (tonverkOn) chkSingles.checked = false;
            chkSingles.disabled = tonverkOn;
            expSingles = !!chkSingles.checked;
          }
          if (chkChain){
            if (tonverkOn) chkChain.checked = true;
            chkChain.disabled = tonverkOn;
            expChain = !!chkChain.checked;
          }

          // If slot-scope is enabled, update the visible counts so users can
          // see how many WAVs/slices will be produced.
          const scopeN = getScopeCount()|0;
          if (txtSingles){
            txtSingles.textContent = `Single-cycle WAVs (${scopeN} file${scopeN===1?'':'s'})`;
          }
          let palOn = chkPal ? !!chkPal.checked : false;
          if (chkPal){
            if (tonverkOn) chkPal.checked = false;
            chkPal.disabled = tonverkOn || !expChain;
            palOn = !!chkPal.checked;
          }
          let loopOn = (chkLoop && palOn) ? !!chkLoop.checked : false;
          if (txtPal){
            const palN = (scopeN > 1) ? (loopOn ? (2*scopeN - 2) : (2*scopeN - 1)) : scopeN;
            txtPal.textContent = `Palindromic ping-pong order (${palN} slices)`;
          }
          if (chkLoop){
            if (tonverkOn) chkLoop.checked = false;
            chkLoop.disabled = tonverkOn || !expChain || !palOn;
            if (!expChain || !palOn) chkLoop.checked = false;
            loopOn = (chkLoop && palOn) ? !!chkLoop.checked : false;
          }
          const prefsNow = dpNormExportWavPrefs({
            adv: on,
            baseSampleRate: parseInt(selSR.value,10),
            pitchOctaves: parseInt(selOct.value,10),
            pitchMethod: rFft.checked ? 'fft' : 'sr',
            tonverkMode: tonverkOn,
            tuneEnabled: !!chkTune.checked,
            tuneNote: selTuneNote.value,
            tuneOctave: parseInt(selTuneOct.value,10),
            palindromeChain: chkPal ? !!chkPal.checked : !!initial.palindromeChain,
            loopChain: chkLoop ? !!chkLoop.checked : !!initial.loopChain,
            exportSingles: expSingles,
            exportChain: expChain,
          });
          const pp = dpComputePitchParams(basePPC, prefsNow);

          // Minimal, useful summary line
          if (pp.tonverkMode){
            preview.textContent = `Tonverk: ${pp.pointsPerCycle} samples/wave • filename _wt${pp.pointsPerCycle}.wav`;
          } else if (pp.tuneEnabled){
            const cents = (typeof pp.tuneCents === 'number' && isFinite(pp.tuneCents)) ? pp.tuneCents : 0;
            preview.textContent = `Output: ${pp.sampleRate.toLocaleString()} Hz • ${pp.pointsPerCycle} samples/cycle • ${pp.tuneLabel} (${(cents>=0?'+':'') + cents.toFixed(2)}¢)`;
          } else {
            preview.textContent = `Output: ${pp.sampleRate.toLocaleString()} Hz • ${pp.pointsPerCycle} samples/cycle`;
          }

          // Disable Export if nothing is selected
          if (allowPalindromeChain){
            btnOK.disabled = !(expSingles || expChain) || (allowSlotScope && (scopeN <= 0));
          }

          // Preview button state (optional)
          if (btnPreview){
            btnPreview.disabled = (allowSlotScope && (scopeN <= 0));
            const running = !!(root.isWavetablePreviewRunning && root.isWavetablePreviewRunning());
            btnPreview.textContent = running ? 'Stop preview' : 'Preview scan';
          }
        }

        chkAdv.oninput = updateEnabled;
        selSR.oninput = updateEnabled;
        selOct.oninput = updateEnabled;
        rSr.oninput = updateEnabled;
        rFft.oninput = updateEnabled;
        if (chkTonverk) chkTonverk.oninput = updateEnabled;
        chkTune.oninput = updateEnabled;
        selTuneNote.oninput = updateEnabled;
        selTuneOct.oninput = updateEnabled;
        if (chkSingles) chkSingles.oninput = updateEnabled;
        if (chkChain) chkChain.oninput = updateEnabled;
        if (chkPal) chkPal.oninput = updateEnabled;
        if (chkLoop) chkLoop.oninput = updateEnabled;
        if (rScopeAll) rScopeAll.oninput = updateEnabled;
        if (rScopeFilled) rScopeFilled.oninput = updateEnabled;
        if (rScopeSel) rScopeSel.oninput = updateEnabled;

        // Buttons
        const btnRow = el('div');
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '8px';
        btnRow.style.marginTop = '12px';

        // Optional: wavetable scan preview (stepping through the chosen scope).
        const previewProvider = (ctx && typeof ctx.previewProvider === 'function') ? ctx.previewProvider : null;
        const canPreview = !!(previewProvider && typeof root.startWavetablePreview === 'function' && typeof root.stopWavetablePreview === 'function');
        const btnPreview = canPreview ? el('button') : null;
        if (btnPreview){
          btnPreview.textContent = 'Preview scan';
          btnPreview.title = 'Play the chosen slot scope as a wavetable scan (steps through slots in order). Click again to stop.';
          btnPreview.onclick = ()=>{
            try{
              const running = !!(root.isWavetablePreviewRunning && root.isWavetablePreviewRunning());
              if (running){
                try{ root.stopWavetablePreview && root.stopWavetablePreview(); }catch(_){ }
                updateEnabled();
                return;
              }

              const scope = getSlotScope();
              let items = previewProvider ? previewProvider(scope) : null;
              if (!Array.isArray(items)) items = [];

              // Accept either raw Uint8Array cycles or objects { dataU8 }.
              const u8s = items
                .map(it => (it && it.dataU8) ? it.dataU8 : it)
                .filter(u8 => u8 && u8.length);

              if (!u8s.length){
                announceIO('Nothing to preview.', true);
                return;
              }

              // If the user enabled a palindromic chain order, preview that scan too.
              // (Only when chain export is enabled — keeps the mental model simple.)
              let seq = u8s;
              const palOn = !!(allowPalindromeChain && chkChain && chkPal && chkChain.checked && chkPal.checked);
              const loopOn = !!(palOn && chkLoop && chkLoop.checked);
              if (palOn && (u8s.length|0) > 1){
                seq = u8s.slice();
                const stop = loopOn ? 1 : 0;
                for (let j=(u8s.length|0)-2; j>=stop; j--) seq.push(u8s[j]);
              }

              // Preview should match the *exported* packed/chain WAV pitch.
              // So we emulate the chosen export sample-rate + (optional) FFT/tune resample length.
              const advOn = !!chkAdv.checked;
              const expSinglesNow = chkSingles ? !!chkSingles.checked : true;
              const expChainNow = chkChain ? !!chkChain.checked : true;

              const prefsNow = dpNormExportWavPrefs({
                adv: advOn,
                baseSampleRate: parseInt(selSR.value,10),
                pitchOctaves: parseInt(selOct.value,10),
                pitchMethod: rFft.checked ? 'fft' : 'sr',
                tonverkMode: chkTonverk ? !!chkTonverk.checked : false,
                tuneEnabled: !!chkTune.checked,
                tuneNote: selTuneNote.value,
                tuneOctave: parseInt(selTuneOct.value,10),
                palindromeChain: chkPal ? !!chkPal.checked : !!initial.palindromeChain,
                loopChain: chkLoop ? !!chkLoop.checked : !!initial.loopChain,
                exportSingles: expSinglesNow,
                exportChain: expChainNow,
              });

              const pp = dpComputePitchParams(basePPC, prefsNow);
              const loop = (ctx && ctx.previewLoop != null) ? !!ctx.previewLoop : true;

              // Preview normally mirrors the exported chain WAV pitch exactly.
              // Tonverk mode is an exception: we keep the frame size match, but audition it
              // musically via MIDI so the scan remains useful to listen to.
              if (pp.tonverkMode){
                root.startWavetablePreview && root.startWavetablePreview(seq, {
                  loop,
                  midi: (ctx && ctx.previewMidi != null) ? ctx.previewMidi : 60,
                  pointsPerCycle: pp.pointsPerCycle,
                  pitchMethod: pp.pitchMethod,
                });
              } else {
                root.startWavetablePreview && root.startWavetablePreview(seq, {
                  loop,
                  sampleRate: pp.sampleRate,
                  pointsPerCycle: pp.pointsPerCycle,
                  pitchMethod: pp.pitchMethod,
                  pitchParams: pp,
                });
              }
            }catch(err){
              console.error(err);
              announceIO('Preview failed (see Console).', true);
            }finally{
              updateEnabled();
            }
          };
        }

        const btnCancel = el('button');
        btnCancel.textContent = 'Cancel';
        const btnOK = el('button');
        btnOK.textContent = 'Export';
        // Keyboard: Enter should trigger the primary action.
        btnOK.dataset.default = '1';

        btnCancel.onclick = ()=>{
          try{ root.stopWavetablePreview && root.stopWavetablePreview(); }catch(_){ }
          try{ overlay.remove(); }catch(_){}
          resolve(null);
        };
        btnOK.onclick = ()=>{
          try{ root.stopWavetablePreview && root.stopWavetablePreview(); }catch(_){ }
          const advOn = !!chkAdv.checked;
          const outPrefs = dpNormExportWavPrefs({
            adv: advOn,
            baseSampleRate: parseInt(selSR.value,10),
            pitchOctaves: parseInt(selOct.value,10),
            pitchMethod: rFft.checked ? 'fft' : 'sr',
            tonverkMode: chkTonverk ? !!chkTonverk.checked : false,
            tuneEnabled: !!chkTune.checked,
            tuneNote: selTuneNote.value,
            tuneOctave: parseInt(selTuneOct.value,10),
            palindromeChain: chkPal ? !!chkPal.checked : !!initial.palindromeChain,
            loopChain: chkLoop ? !!chkLoop.checked : !!initial.loopChain,
            exportSingles: chkSingles ? !!chkSingles.checked : !!initial.exportSingles,
            exportChain: chkChain ? !!chkChain.checked : !!initial.exportChain,
          });
          // Bank/selection export: which slots to include.
          // Persist separately so other export dialogs don't overwrite it.
          if (allowSlotScope){
            outPrefs.slotScope = getSlotScope();
            dpSaveExportWavBankScope(outPrefs.slotScope);
          }
          dpSaveExportWavPrefs(outPrefs);
          try{ overlay.remove(); }catch(_){}
          resolve(outPrefs);
        };

        if (btnPreview) btnRow.append(btnPreview);
        btnRow.append(btnCancel, btnOK);

        if (allowPalindromeChain){
          if (allowSlotScope) dlg.append(h, p, scopeBox, dlBox, tonverkBox, rowAdv, advBox, btnRow);
          else dlg.append(h, p, dlBox, tonverkBox, rowAdv, advBox, btnRow);
        } else {
          if (allowSlotScope) dlg.append(h, p, scopeBox, tonverkBox, rowAdv, advBox, btnRow);
          else dlg.append(h, p, tonverkBox, rowAdv, advBox, btnRow);
        }
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);
        updateEnabled();

        // Escape closes
        overlay.tabIndex = -1;
        overlay.focus();
        overlay.addEventListener('keydown', (ev)=>{
          if (ev.key === 'Escape') btnCancel.click();
        });
      });
    }

    const btnExportSlot = el('button'); btnExportSlot.textContent='Export slot WAV';
    btnExportSlot.title = 'Export the current slot as a single-cycle WAV (PCM 16-bit, mono) with embedded loop points.'
      + '\n\nDefault (SAFE): 44,100 Hz, points-per-cycle locked to the slot buffer (no resampling, no processing).'
      + '\n\nIf slots are selected: exports selected slot(s) as WAV(s). For 1–5 slots this downloads WAV file(s) directly; for 6+ slots it downloads a ZIP. (Shift+Click can also include a packed chain WAV.)'
      + '\n\nShift+Click: Advanced pitch/tuning export (octave steps or tuned note) using either WAV sample-rate metadata (no resampling) or FFT-style periodic resampling.'
      + '\n\nThe advanced dialog also includes a Tonverk wavetable mode toggle that auto-writes _wt2048 WAVs.';
    btnExportSlot.onclick = async (ev)=>{
      const shift = !!(ev && ev.shiftKey);
      const alt = !!(ev && ev.altKey);

      // If there is a selection, export the selected slot(s). Small exports download WAV(s) directly; 6+ slots download as a ZIP.
      const selAll = Array.from(SELECTED||[])
        .map(x=>x|0)
        .filter(i=>i>=0 && i<64)
        .sort((a,b)=>a-b);
      const useSelection = !!(selAll.length && !alt);

      const editorSlot = (EDIT.slot|0);
      const dataDirty = (s)=>!!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(s));

      const targets = useSelection ? selAll : [editorSlot];

      // Gather per-slot export info (use editor buffer for the active dirty slot).
      const infos = [];
      for (const s of targets){
        const useEditor = (s === editorSlot) && dataDirty(s);
        const w = useEditor
          ? { name: EDIT.name, dataU8: EDIT.dataU8 }
          : (LIB.waves[s] || null);
        if (!w || !w.dataU8) continue;

        const exportName = (s === editorSlot) ? (EDIT.name || w.name || 'WAVE') : (w.name || 'WAVE');
        const nm4 = _alnum4(exportName);
        infos.push({
          slot:s,
          nm4,
          nameStem: exportName,
          dataU8: new Uint8Array(w.dataU8),
          srcFloat: (!useEditor && w._srcFloat && w._srcFloat.length) ? w._srcFloat : null,
          tables6132: (!useEditor && w._tables6132) ? w._tables6132 : null,
        });
      }

      if (!infos.length){
        announceIO(useSelection ? 'No selected waves to export.' : 'Nothing to export in this slot.', true);
        return;
      }

      // SAFE by default; Shift+Click opens Advanced pitch options.
      let prefs = dpNormExportWavPrefs({ adv:false });
      if (shift){
        const basePPC = infos[0].dataU8.length|0;
        prefs = await dpPromptExportWavShiftOptions(
          useSelection ? 'Export selected WAV (Advanced)' : 'Export WAV (Advanced)',
          {
            waveCount: infos.length,
            targetLabel: useSelection ? `${infos.length} selected slot(s)` : `slot ${editorSlot+1}`,
            basePPC,
            forceAdv: true,
            // When exporting selected slots, allow optionally generating a packed
            // chain WAV — similar to the bank export.
            allowPalindromeChain: !!useSelection,
            // Keep the historical behaviour for selected-slot export: singles only.
            defaultExportSingles: true,
            defaultExportChain: useSelection ? false : undefined,
            defaultPalindromeChain: false,

            // Optional: wavetable scan preview button inside the shift-export dialog.
            // Only useful when exporting 2+ selected slots.
            previewProvider: (useSelection && (infos.length|0) > 1) ? (()=>infos) : null,
            previewStepMs: 160,
            previewMidi: 60,
            previewLoop: true,
          }
        );
        if (!prefs){ announceIO('Export cancelled.'); return; }
      }

      function wavSuffix(pp){
        // Only add suffix when the output differs from SAFE defaults.
        const safeSR = 44100;
        const safePPC = pp.basePointsPerCycle|0;
        if (pp.tonverkMode || !pp.adv) return '';

        const parts = [];
        if (pp.tuneEnabled && pp.tuneLabel) parts.push(pp.tuneLabel);
        if ((pp.sampleRate|0) !== safeSR) parts.push(`SR${pp.sampleRate}`);
        if ((pp.pointsPerCycle|0) !== safePPC) parts.push(`${pp.pointsPerCycle}PPC`);
        return parts.length ? ('-' + parts.join('-')) : '';
      }

      function buildWavBytes(info){
        const basePPC = info.dataU8.length|0;
        const pp = dpComputePitchParams(basePPC, prefs);

        // FFT-style periodic resample (keeps sample rate fixed):
        // - Used for octave-down shifts
        // - Used for tuned-note export
        if (pp.pitchMethod === 'fft' && (((pp.pointsPerCycle|0) !== basePPC) || !!pp.tuneEnabled)){
          if (typeof periodicResampleFloatFFT !== 'function' || typeof pcm16WavFromInt16 !== 'function'){
            throw new Error('FFT resampler or WAV writer is not available.');
          }
          const srcF = pp.tonverkMode
            ? dpBestTonverkExportSourceFloat(info, pp.pointsPerCycle|0)
            : u8ToCycleFloat(info.dataU8);
          const dstF = periodicResampleFloatFFT(srcF, pp.pointsPerCycle|0);
          const pcm = new Int16Array(dstF.length);
          for (let i=0;i<dstF.length;i++){
            let v = dstF[i];
            if (!isFinite(v)) v = 0;
            if (v > 1) v = 1;
            else if (v < -1) v = -1;
            pcm[i] = Math.round(v * 32767);
          }
          // Many samplers (and some wavetable engines) effectively include the loop-end
          // sample when wrapping. The DigiPRO tables are typically "closed" cycles, so
          // when we resample we explicitly re-close the cycle to avoid a loop click.
          if (pcm.length >= 2) pcm[pcm.length - 1] = pcm[0];
          // For tuned-note exports, some samplers interpret WAV loop markers slightly
          // differently (inclusive vs exclusive end). To avoid exporting a "nearly-right"
          // loop point, we still embed the unity note but omit loop markers.
          const smplOpts = (pp.tuneEnabled && pp.tuneMidi != null)
            ? { midiUnityNote: pp.tuneMidi|0, noLoop: true }
            : null;
          const extras = (typeof buildSmplLoopChunk === 'function')
            ? [{ id:'smpl', bytes: buildSmplLoopChunk(0, pcm.length, pp.sampleRate|0, smplOpts) }]
            : null;
          return { wavBytes: pcm16WavFromInt16(pcm, pp.sampleRate|0, extras), pp, pcm };
        }

        // SAFE / metadata-only sample-rate method (no resampling).
        const wavBytes = dpPlainWavBytesFromU8(info.dataU8, pp.sampleRate|0);
        return { wavBytes, pp, u8: info.dataU8 };
      }

      if (useSelection){
        if (JOB.running){ announceIO('A batch job is already running — cancel it first.', true); return; }
        beginJob('Export selected WAVs');
        try{
          // Selected-slot export defaults to single WAVs only (for backward compatibility).
          // Shift+Click allows optionally adding a packed chain WAV.
          const exportSingles = shift ? ((prefs && prefs.exportSingles != null) ? !!prefs.exportSingles : true) : true;
          const exportChain = shift ? ((prefs && prefs.exportChain != null) ? !!prefs.exportChain : false) : false;
          const palChain = shift ? !!(prefs && prefs.palindromeChain) : false;
          const loopChain = (shift && palChain) ? !!(prefs && prefs.loopChain) : false;

          if (!exportSingles && !exportChain){
            announceIO('Nothing selected to export.', true);
            return;
          }

          const basePPC = infos[0].dataU8.length|0;
          if (exportChain){
            for (const inf of infos){
              if ((inf.dataU8.length|0) !== basePPC){
                announceIO('Cannot export packed chain: slot cycle lengths differ.', true);
                return;
              }
            }
          }

          const files = [];
          const rendered = [];
          let lastPP = null;

          for (const info of infos){
            if (JOB.cancelled) break;
            const r = buildWavBytes(info);
            lastPP = r.pp;
            rendered.push({ pcm: r.pcm || null, u8: r.u8 || null, pp: r.pp });

            if (exportSingles){
              if (!r.wavBytes) continue;
              const baseName = dpWavFilenameForSlotMode(info.slot, info.nm4, false);
              const outName = dpFinalizeExportWavFilename(baseName, wavSuffix(r.pp), prefs);
              files.push({ name: outName, bytes: r.wavBytes });
            }

            await sleepAbortable(0, JOB.signal);
          }

          if (JOB.cancelled){ announceIO('Export cancelled.'); return; }

          if (!lastPP){
            announceIO('No selected waves to export.', true);
            return;
          }

          const suffix = wavSuffix(lastPP);
          const chainTag = (exportChain && palChain && ((infos.length|0) > 1))
            ? ('-PAL' + (loopChain ? '-LOOP' : ''))
            : '';

          // Only ZIP when exporting many *slot* WAVs. For 1–5 slots (or chain-only), download WAV(s) directly.
          const ZIP_THRESHOLD_SLOTS = 6;
          const shouldZip = !!(exportSingles && ((infos.length|0) >= ZIP_THRESHOLD_SLOTS));

          // Folder structure is only useful inside ZIPs.
          const folderSingles = (shouldZip && exportSingles && exportChain) ? 'single_cycles/' : '';
          const folderChain = (shouldZip && exportSingles && exportChain) ? 'chain/' : '';

          // If exporting both singles and chain, tuck singles into a folder for neatness.
          if (folderSingles){
            for (const f of files){
              if (f && typeof f.name === 'string' && !f.name.includes('/')) f.name = folderSingles + f.name;
            }
          }

          if (exportChain){
            const Nslots = infos.length|0;
            const order = [];
            for (let i=0; i<Nslots; i++) order.push(i);
            if (palChain && Nslots > 1){
              const stop = loopChain ? 1 : 0;
              for (let i=Nslots-2; i>=stop; i--) order.push(i);
            }
            const chainCount = order.length|0;

            // Build the packed chain WAV.
            let chainWavBytes = null;
            if (lastPP.pitchMethod === 'fft' && (((lastPP.pointsPerCycle|0) !== basePPC) || !!lastPP.tuneEnabled)){
              const outPPC = lastPP.pointsPerCycle|0;
              const outSR = lastPP.sampleRate|0;
              const chainPCM = new Int16Array(chainCount * outPPC);
              for (let j=0; j<chainCount; j++){
                const idx = order[j]|0;
                const rec = rendered[idx];
                const pcm = rec && rec.pcm;
                if (!pcm || (pcm.length|0) !== outPPC){
                  throw new Error('Internal error: missing resampled PCM for packed chain.');
                }
                chainPCM.set(pcm, j*outPPC);
              }
              // For tuned exports we omit WAV loop markers (see smplOpts above).
              const chainExtras = (loopChain && !lastPP.tuneEnabled && typeof buildSmplLoopChunk === 'function')
                ? [{ id:'smpl', bytes: buildSmplLoopChunk(0, chainPCM.length, outSR) }]
                : null;
              chainWavBytes = pcm16WavFromInt16(chainPCM, outSR, chainExtras);
            } else {
              const outSR = (lastPP.sampleRate|0) || 44100;
              const chainU8 = new Uint8Array(chainCount * basePPC);
              for (let j=0; j<chainCount; j++){
                const idx = order[j]|0;
                const rec = rendered[idx];
                const u8 = (rec && rec.u8) ? rec.u8 : (infos[idx] && infos[idx].dataU8);
                if (!u8 || (u8.length|0) !== basePPC){
                  throw new Error('Internal error: missing cycle bytes for packed chain.');
                }
                chainU8.set(u8, j*basePPC);
              }
              // For tuned exports we omit WAV loop markers (see smplOpts above).
              const chainExtras = (loopChain && !lastPP.tuneEnabled && typeof buildSmplLoopChunk === 'function')
                ? [{ id:'smpl', bytes: buildSmplLoopChunk(0, chainU8.length, outSR) }]
                : null;
              chainWavBytes = pcm16WavFromU8(chainU8, outSR, chainExtras);
            }

            if (!chainWavBytes){
              announceIO('Could not render packed chain WAV.', true);
              return;
            }

            const chainBase = (prefs && prefs.tonverkMode)
              ? dpTonverkChainBaseName(infos, 'wavetable')
              : `MM-DIGIPRO-SELECTED-PACKED-CHAIN${chainTag}${suffix}`;
            const chainName = dpFinalizeExportWavFilename(
              `${folderChain}${chainBase}.wav`,
              '',
              prefs
            );
            files.push({ name: chainName, bytes: chainWavBytes });
          }

          if (!files.length){
            announceIO('No selected waves to export.', true);
            return;
          }

          const __flatName = (n)=>{
            n = String(n||'');
            const parts = n.split('/');
            return parts[parts.length-1] || 'download';
          };

          if (shouldZip){
            const zip = zipFiles(files);
            let zipName = `MM-DIGIPRO-SELECTED-WAVS${chainTag}${suffix}.zip`;
            if (!exportSingles && exportChain) zipName = `MM-DIGIPRO-SELECTED-PACKED-CHAIN${chainTag}${suffix}.zip`;
            else if (exportSingles && !exportChain) zipName = `MM-DIGIPRO-SELECTED-WAVS${suffix}.zip`;
            downloadBlob(new Blob([zip], {type:'application/zip'}), zipName);
            announceIO(`Exported ${files.length} file(s) as ZIP.`);

          } else {
            // Direct WAV download(s) for small exports (1–5 slots) and for chain-only.
            // Note: browsers may prompt the user to allow multiple downloads when exporting several files.
            for (const f of files){
              if (!f || !f.bytes) continue;
              const fn = __flatName(f.name);
              const mime = (/\.wav$/i.test(fn)) ? 'audio/wav' : 'application/octet-stream';
              downloadBlob(new Blob([f.bytes], {type: mime}), fn);
            }
            if (files.length === 1){
              announceIO('Exported WAV.');
            } else {
              announceIO(`Exported ${files.length} WAV file(s).`);
            }
          }
        } finally {
          endJob();
        }
        return;
      }

      // Single slot export
      try{
        const info = infos[0];
        const { wavBytes, pp } = buildWavBytes(info);
        if (!wavBytes){ announceIO('Could not render WAV for this slot.', true); return; }
        const baseName = dpWavFilenameForSlotMode(info.slot, info.nm4, false);
        const outName = dpFinalizeExportWavFilename(baseName, wavSuffix(pp), prefs);
        downloadBlob(new Blob([wavBytes], {type:'audio/wav'}), outName);
      }catch(err){
        console.error(err);
        announceIO(`Export failed: ${err && err.message || err}`, true);
      }
    };
    btnExportBank = el('button'); btnExportBank.textContent='Export bank (.json)';
    btnExportBank.onclick = async ()=>{
      // JSON export is a pure bank snapshot (no C6 parity normalization).
      // It preserves the exact 96-sample data (and HOT gain metadata) as currently stored.
      const waves = [];
      const editorSlot = (EDIT.slot|0);
      for (let s=0;s<64;s++){
        const useEditor = (s === editorSlot) && !!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length);
        const w = useEditor
          ? { name: (EDIT.name||'WAVE'), dataU8: new Uint8Array(EDIT.dataU8), user:true, _dpHeat: EDIT._dpHeat }
          : (LIB.waves[s] || null);
        if (!w || !w.dataU8) continue;

        const heat = (typeof w._dpHeat === 'number' && isFinite(w._dpHeat) && w._dpHeat > 0) ? w._dpHeat : 1;
        const rec = { slot:s, name:String(w.name||'WAVE'), data: Array.from(w.dataU8), _dpHeat: heat };
        waves.push(rec);
      }

      if (!waves.length){ announceIO('No waves to export.', true); return; }

      const json = JSON.stringify({ format:'mmdt-digipro-bank', version:2, count:waves.length, waves }, null, 2);
      downloadBlob(new Blob([json], {type:'application/json'}), `MM-DIGIPRO-BANK.json`);
    };
    btnExportBankZip = el('button'); btnExportBankZip.textContent='Export bank WAVs';
    btnExportBankZip.title = 'Export bank WAVs.'
      + '\n\nRule: 1–5 slots download WAV file(s) directly; 6+ slots download a ZIP.'
      + '\n\nWhen a ZIP is used it may contain:'
      + '\n  • single-cycle WAVs (PCM 16-bit, mono) with embedded loop points'
      + '\n  • optionally, 1 packed/sample-chain WAV (concatenation; optional loop markers)'


      + '\n\nDefault : 44,100 Hz, points-per-cycle locked to the slot buffer (no resampling, no processing).'
      + '\n\nShift+Click: Advanced pitch/tuning export (octave steps or tuned note) using either:'
      + '\n  • WAV sample-rate metadata (no resampling), or'
      + '\n  • FFT-style periodic resampling (keeps the base sample rate).'
      + '\n  • Tonverk wavetable mode (auto 2048 samples/wave + _wt2048 filename).'
      + '\n\nAdvanced (Shift+Click) also lets you choose a slot scope:'
      + '\n  • All 64 slots (include empty as silence),'
      + '\n  • Filled slots only, or'
      + '\n  • Selected slots only.'
      + '\n\nNote: The packed chain may click at slot boundaries when played straight through — that is expected.';
btnExportBankZip.onclick = async (ev)=>{
      if (JOB.running){
        announceIO('Please wait for the current job to finish. (Try Escape to cancel it.)', true);
        return;
      }

      const shift = !!(ev && ev.shiftKey);
      const editorSlot = (EDIT.slot|0);
      const dataDirty = (s)=>!!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(s));
      const silentU8 = new Uint8Array(96); silentU8.fill(128);

      // Selection (used for optional “Selected slots” scope in the advanced export dialog)
      const selAll = Array.from(SELECTED||[])
        .map(x=>x|0)
        .filter(i=>i>=0 && i<64)
        .sort((a,b)=>a-b);

      function makeSlotInfo(s, includeEmpty){
        const useEditor = (s === editorSlot) && dataDirty(s);
        const w = useEditor ? { name: (EDIT.name||''), dataU8: EDIT.dataU8 } : (LIB.waves[s] || null);
        if (w && w.dataU8){
          const dataU8 = new Uint8Array(w.dataU8);
          const nm4 = _alnum4(useEditor ? (EDIT.name||w.name||'WAVE') : (w.name||'WAVE'));
          return {
            slot:s,
            nm4,
            nameStem: useEditor ? (EDIT.name||w.name||'WAVE') : (w.name||'WAVE'),
            dataU8,
            srcFloat: (!useEditor && w._srcFloat && w._srcFloat.length) ? w._srcFloat : null,
            tables6132: (!useEditor && w._tables6132) ? w._tables6132 : null,
          };
        }
        if (!includeEmpty) return null;
        return { slot:s, nm4:'EMPT', dataU8: new Uint8Array(silentU8) };
      }

      // Build candidate export lists:
      // - infosAll: 64 slots, empty slots rendered as silence (bank-compatible)
      // - infosFilled: only slots with actual data
      // - infosSelected: filled slots within the current UI selection
      const infosAll = [];
      const infosFilled = [];
      for (let s=0; s<64; s++){
        const infAll = makeSlotInfo(s, true);
        if (infAll) infosAll.push(infAll);
        const infFilled = makeSlotInfo(s, false);
        if (infFilled) infosFilled.push(infFilled);
      }
      const infosSelected = [];
      for (const s of selAll){
        const infSel = makeSlotInfo(s, false);
        if (infSel) infosSelected.push(infSel);
      }

      const basePPCAll = (infosAll[0] && infosAll[0].dataU8) ? (infosAll[0].dataU8.length|0) : 0;
      if (!basePPCAll){
        announceIO('Nothing to export.', true);
        return;
      }

      // Default scope: full 64-slot bank (includes empty slots as silence).
      let infos = infosAll;
      let scopeLabel = 'BANK';

      // Default: reuse the last settings the user chose in the shift-click dialog.
      // (Shift-click still opens the dialog for editing.)
      let prefs = dpLoadExportWavPrefs();
      // Bank scope is persisted separately so other export dialogs don't overwrite it.
      try{
        prefs = prefs && typeof prefs === 'object' ? prefs : {};
        prefs.slotScope = dpLoadExportWavBankScope('all');
      }catch(_){ }
      if (shift){
        prefs = await dpPromptExportWavShiftOptions('Export bank WAVs (Advanced)', {
          waveCount: 64,
          targetLabel: 'Bank (64 slots)',
          basePPC: basePPCAll,
          forceAdv: true,
          allowPalindromeChain: true,
          // Allow choosing “All / Filled / Selected” scope for the WAV export.
          allowSlotScope: true,
          slotScopeCounts: { all: 64, filled: (infosFilled.length|0), selected: (infosSelected.length|0) },
          slotScopeDefault: dpLoadExportWavBankScope('all'),

          // Optional: wavetable scan preview button inside the shift-export dialog.
          previewProvider: (scope)=>{
            if (scope === 'filled') return infosFilled;
            if (scope === 'selected') return infosSelected;
            return infosAll;
          },
          previewStepMs: 160,
          previewMidi: 60,
          previewLoop: true,
        });
        if (!prefs){
          announceIO('Export cancelled.');
          return;
        }
      }

      // What to include in the download
      const exportSingles = (prefs && prefs.exportSingles != null) ? !!prefs.exportSingles : true;
      const exportChain = (prefs && prefs.exportChain != null) ? !!prefs.exportChain : true;
      if (!exportSingles && !exportChain){
        announceIO('Nothing selected to export.', true);
        return;
      }

      // Slot scope (advanced dialog): All (64), Filled only, or Selected only.
      let slotScope = (prefs && typeof prefs.slotScope === 'string') ? String(prefs.slotScope) : 'all';
      // Robust fallback: if the remembered scope isn't currently available, degrade gracefully.
      if (slotScope === 'selected' && (infosSelected.length|0) <= 0){
        slotScope = (infosFilled.length|0) > 0 ? 'filled' : 'all';
      }
      if (slotScope === 'filled' && (infosFilled.length|0) <= 0){
        slotScope = 'all';
      }

      if (slotScope === 'filled'){
        infos = infosFilled;
        scopeLabel = 'FILLED';
      } else if (slotScope === 'selected'){
        infos = infosSelected;
        scopeLabel = 'SELECTED';
      } else {
        infos = infosAll;
        scopeLabel = 'BANK';
      }

      if (!infos.length){
        const msg = (slotScope === 'filled')
          ? 'No filled waves to export.'
          : (slotScope === 'selected')
            ? 'No selected waves to export.'
            : 'Nothing to export.';
        announceIO(msg, true);
        return;
      }

      const basePPC = (infos[0] && infos[0].dataU8) ? (infos[0].dataU8.length|0) : 0;
      if (!basePPC){
        announceIO('Nothing to export.', true);
        return;
      }

      // Validate consistent cycle lengths (only required for the packed chain format).
      if (exportChain){
        for (const inf of infos){
          if ((inf.dataU8.length|0) !== basePPC){
            announceIO('Cannot export packed chain: slot cycle lengths differ.', true);
            return;
          }
        }
      }

      const pitchParams = dpComputePitchParams(basePPC, prefs);
      const outSR = (pitchParams.sampleRate|0) || 44100;
      const outPPC = (pitchParams.pointsPerCycle|0) || basePPC;
      const outMethod = pitchParams.pitchMethod || 'sr';

      // Packed chain order (only if exporting a chain)
      const palChain = exportChain && !!(prefs && prefs.palindromeChain);
      const loopChain = exportChain && palChain && !!(prefs && prefs.loopChain);
      const chainTag = (exportChain && palChain) ? ('-PAL' + (loopChain ? '-LOOP' : '')) : '';
      const Nslots = infos.length|0;
      const chainOrder = [];
      let chainCount = 0;
      if (exportChain){
        for (let i=0;i<Nslots;i++) chainOrder.push(i);

        if (palChain && Nslots > 1){
          // Ping-pong pack order.
          //
          // Two variants:
          // - Loop OFF: 0..N-1 then N-2..0   (2N-1 frames; ends on slot 0 for a frame-identical wrap)
          // - Loop ON : 0..N-1 then N-2..1   (2N-2 frames; classic ping-pong scan with no duplicate endpoints)
          const stop = loopChain ? 1 : 0;
          for (let i=Nslots-2;i>=stop;i--) chainOrder.push(i);
        }

        chainCount = chainOrder.length|0;
      }

      // Used for file naming.
      const wavSuffixParts = [];
      if (pitchParams && !pitchParams.tonverkMode && pitchParams.tuneEnabled && pitchParams.tuneLabel){
        wavSuffixParts.push(pitchParams.tuneLabel);
      }
      if (!(pitchParams && pitchParams.tonverkMode) && outPPC !== basePPC){ wavSuffixParts.push(outPPC + 'ppc'); }
      if (!(pitchParams && pitchParams.tonverkMode) && outSR !== 44100){ wavSuffixParts.push(outSR + 'Hz'); }
      const wavSuffix = wavSuffixParts.length ? ('-' + wavSuffixParts.join('-')) : '';

      beginJob('Export bank WAVs');
      try {
        JOB.detail = 'Building WAVs...';

        const files = [];
        let chainBytes;

        // ZIP only when exporting 6+ *slot* single-cycle WAVs. For 1–5 slots (and for chain-only),
        // download WAV file(s) directly (no ZIP).
        const ZIP_THRESHOLD_SLOTS = 6;
        const shouldZip = !!(exportSingles && ((Nslots|0) >= ZIP_THRESHOLD_SLOTS));

        // Folder structure is only useful inside ZIPs.
        const folderSingles = (shouldZip && exportSingles && exportChain) ? 'single_cycles/' : '';
        const folderChain = (shouldZip && exportSingles && exportChain) ? 'chain/' : '';

        if (outMethod === 'fft' && (outPPC !== basePPC || !!pitchParams.tuneEnabled)){
          // FFT periodic resampling (keeps outSR fixed; changes samples-per-cycle).
          // Also used for tuned-note export (even if outPPC happens to equal basePPC).
          if (typeof periodicResampleFloatFFT !== 'function' || typeof pcm16WavFromInt16 !== 'function'){
            throw new Error('FFT resampler or WAV writer is not available.');
          }

          const slotPCM = exportChain ? new Array(Nslots) : null;
          // For tuned-note exports, some samplers disagree on whether the loop end point is
          // inclusive or exclusive. To avoid exporting a "nearly-right" loop marker, we keep
          // the unity note but omit loop points.
          const smplOpts = (pitchParams && pitchParams.tuneEnabled && pitchParams.tuneMidi != null)
            ? { midiUnityNote: pitchParams.tuneMidi|0, noLoop: true }
            : null;

          for (let idx=0; idx<Nslots; idx++){
            if (JOB.cancelled) break;
            const inf = infos[idx];

            const srcF = (pitchParams && pitchParams.tonverkMode)
              ? dpBestTonverkExportSourceFloat(inf, outPPC)
              : u8ToCycleFloat(inf.dataU8);
            const resF = periodicResampleFloatFFT(srcF, outPPC);

            const pcm = new Int16Array(outPPC);
            for (let i=0; i<outPPC; i++){
              let v = resF[i];
              if (!isFinite(v)) v = 0;
              if (v > 1) v = 1;
              else if (v < -1) v = -1;
              pcm[i] = Math.round(v * 32767);
            }

            // Like the single-slot export path, explicitly close the resampled cycle.
            // This prevents an audible click on loop wrap in samplers that include the loop-end sample.
            if (pcm.length >= 2) pcm[pcm.length - 1] = pcm[0];

            if (exportSingles){
              const extras = (typeof buildSmplLoopChunk === 'function')
                ? [{ id: 'smpl', bytes: buildSmplLoopChunk(0, outPPC, outSR, smplOpts) }]
                : null;
              const wavBytes = pcm16WavFromInt16(pcm, outSR, extras);
              const wavName = folderSingles + dpFinalizeExportWavFilename(dpWavFilenameForSlotMode(inf.slot, inf.nm4, false), wavSuffix, prefs);
              files.push({ name: wavName, bytes: wavBytes });
            }
            if (exportChain && slotPCM) slotPCM[idx] = pcm;
            await sleepAbortable(0, JOB.signal);
          }

          if (JOB.cancelled){
            announceIO('Export cancelled.');
            return;
          }

          if (exportChain){
            // Build the packed chain in the requested order (sequential or palindrome).
            const chainPCM = new Int16Array(chainCount * outPPC);
            for (let j=0; j<chainCount; j++){
              const si = chainOrder[j]|0;
              const pcm = slotPCM ? slotPCM[si] : null;
              if (pcm) chainPCM.set(pcm, j * outPPC);
            }
            // For tuned exports we omit WAV loop markers (see smplOpts above).
            const chainExtras = (loopChain && !(pitchParams && pitchParams.tuneEnabled) && typeof buildSmplLoopChunk === 'function')
              ? [{ id: 'smpl', bytes: buildSmplLoopChunk(0, chainPCM.length, outSR) }]
              : null;
            chainBytes = pcm16WavFromInt16(chainPCM, outSR, chainExtras);
          }
        } else {
          // Metadata-only pitch shift (or no pitch shift): keep raw slot samples, just change SR if needed.
          const chainU8 = exportChain ? new Uint8Array(chainCount * basePPC) : null;

          if (exportSingles){
            for (let idx=0; idx<Nslots; idx++){
              if (JOB.cancelled) break;
              const inf = infos[idx];

              const wavBytes = dpPlainWavBytesFromU8(inf.dataU8, outSR);
              const wavName = folderSingles + dpFinalizeExportWavFilename(dpWavFilenameForSlotMode(inf.slot, inf.nm4, false), wavSuffix, prefs);
              files.push({ name: wavName, bytes: wavBytes });
              await sleepAbortable(0, JOB.signal);
            }
          }

          if (JOB.cancelled){
            announceIO('Export cancelled.');
            return;
          }

          if (exportChain && chainU8){
            // Build the packed chain in the requested order (sequential or palindrome).
            for (let j=0; j<chainCount; j++){
              const si = chainOrder[j]|0;
              const inf = infos[si];
              if (inf && inf.dataU8) chainU8.set(inf.dataU8, j * basePPC);
            }
            const chainExtras = (loopChain && typeof buildSmplLoopChunk === 'function')
              ? [{ id: 'smpl', bytes: buildSmplLoopChunk(0, chainU8.length, outSR) }]
              : null;
            chainBytes = pcm16WavFromU8(chainU8, outSR, chainExtras);
          }
        }

        if (exportChain){
          const chainBaseName = (prefs && prefs.tonverkMode)
            ? dpTonverkChainBaseName(infos, scopeLabel === 'BANK' ? 'wavetable' : scopeLabel)
            : ((scopeLabel === 'BANK')
              ? 'MM-DIGIPRO-PACKED-CHAIN'
              : `MM-DIGIPRO-${scopeLabel}-PACKED-CHAIN`);

          // Packed chain (loop markers optional)
          files.push({
            name: dpFinalizeExportWavFilename(`${folderChain}${chainBaseName}${chainTag}${wavSuffix}.wav`, '', prefs),
            bytes: chainBytes
          });
        }

        // Validate chain render.
        if (exportChain && !chainBytes){
          throw new Error('Could not render packed chain WAV.');
        }

        const __flatName = (n)=>{
          n = String(n||'');
          const parts = n.split('/');
          return parts[parts.length-1] || 'download';
        };

        if (shouldZip){
          JOB.detail = 'Zipping...';
          const zipBytes = zipFiles(files);
          let zipName;
          if (exportSingles && exportChain){
            zipName = (scopeLabel === 'BANK')
              ? `MM-DIGIPRO-BANK-WAVS${chainTag}${wavSuffix}.zip`
              : `MM-DIGIPRO-${scopeLabel}-WAVS${chainTag}${wavSuffix}.zip`;
          } else if (exportSingles){
            zipName = (scopeLabel === 'BANK')
              ? `MM-DIGIPRO-BANK-SINGLE-CYCLES${wavSuffix}.zip`
              : `MM-DIGIPRO-${scopeLabel}-SINGLE-CYCLES${wavSuffix}.zip`;
          } else {
            zipName = (scopeLabel === 'BANK')
              ? `MM-DIGIPRO-PACKED-CHAIN${chainTag}${wavSuffix}.zip`
              : `MM-DIGIPRO-${scopeLabel}-PACKED-CHAIN${chainTag}${wavSuffix}.zip`;
          }
          downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), zipName);
          announceIO(`Exported ${files.length} file(s) as ZIP.`);

        } else {
          // Direct WAV download(s) for small exports (1–5 slots) and for chain-only exports.
          // Note: browsers may prompt the user to allow multiple downloads when exporting several files.
          JOB.detail = 'Downloading...';
          for (const f of files){
            if (!f || !f.bytes) continue;
            const fn = __flatName(f.name);
            const mime = (/\.wav$/i.test(fn)) ? 'audio/wav' : 'application/octet-stream';
            downloadBlob(new Blob([f.bytes], { type: mime }), fn);
          }
          if (files.length === 1) announceIO('Exported WAV.');
          else announceIO(`Exported ${files.length} WAV file(s).`);
        }

      } catch (err){
        console.error(err);
        announceIO(`Export failed: ${(err && err.message) ? err.message : err}`, true);

      } finally {
        endJob();
      }
    };

    btnExportBankSyx = el('button'); btnExportBankSyx.textContent='Export bank SYX (.zip)';
    btnExportBankSyx.title = 'Export all non-empty slots as a ZIP of separate DigiPRO 0x5D .syx files. Shift-click to export a single bank .syx (all slots concatenated).';
    btnExportBankSyx.onclick = async (ev)=>{
      if (!root.MMDT_DigiPRO || !root.MMDT_DigiPRO.encodeSlot6132){ announceIO('DigiPRO SysEx codec not loaded.', true); return; }

      const legacyConcat = !!(ev && ev.shiftKey);

      if (JOB.running){ announceIO('A batch job is already running — cancel it first.', true); return; }
      beginJob(legacyConcat ? 'Export bank SYX (concat)' : 'Export bank SYX ZIP');
      try{
        if (legacyConcat){
          // Old behavior: one concatenated .syx file (handy for C6 “send all at once”).
          const chunks = [];
          let total = 0;

          for (let s=0;s<64;s++){
            if (JOB.cancelled) break;

	            const useEditor = (s === (EDIT.slot|0)) && !!(LIB.dirty && LIB.dirty.has(s));
	            const w = useEditor
	              ? { name: EDIT.name, dataU8: EDIT.dataU8, user:true, _dpHeat: EDIT._dpHeat }
	              : LIB.waves[s];
            if (!w || !w.dataU8 || isSilentU8(w.dataU8)) continue;
	            const baseTables = ensureTables6132(w);
	            if (!baseTables) continue;
	            const heat = dpHeatOf(w);
	            const tables = dpApplyHeatToTables(baseTables, heat) || baseTables;
	            const nm = _alnum4(w.name||'WAVE');
	            const syx = root.MMDT_DigiPRO.encodeSlot6132({ slot:s, name:nm, tables, deviceId: 0 });
            chunks.push(syx);
            total += syx.length;

            await sleepAbortable(0, JOB.signal);
          }

          if (JOB.cancelled){ announceIO('Export cancelled.'); return; }
          if (!chunks.length){ announceIO('No waves to export.', true); return; }

          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks){ out.set(c, off); off += c.length; }

          downloadBlob(new Blob([out], {type:'application/octet-stream'}), 'MM-DIGIPRO-BANK.syx');
          return;
        }

        // New behavior: ZIP of separate .syx per slot (like the bank WAV ZIP).
        const files = [];

        for (let s=0;s<64;s++){
          if (JOB.cancelled) break;

          const useEditor = (s === (EDIT.slot|0)) && !!(LIB.dirty && LIB.dirty.has(s));
	          const w = useEditor
	            ? { name: EDIT.name, dataU8: EDIT.dataU8, user:true, _dpHeat: EDIT._dpHeat }
            : LIB.waves[s];
          if (!w || !w.dataU8 || isSilentU8(w.dataU8)) continue;
	          const baseTables = ensureTables6132(w);
	          if (!baseTables) continue;
	          const heat = dpHeatOf(w);
	          const tables = dpApplyHeatToTables(baseTables, heat) || baseTables;
	          const nm = _alnum4(w.name||'WAVE');
	          const syx = root.MMDT_DigiPRO.encodeSlot6132({ slot:s, name:nm, tables, deviceId: 0 });
          files.push({ name: syxFilenameForSlot(s, nm), bytes: syx });

          await sleepAbortable(0, JOB.signal);
        }

        if (JOB.cancelled){ announceIO('Export cancelled.'); return; }
        if (!files.length){ announceIO('No waves to export.', true); return; }

        const zip = zipFiles(files);
        downloadBlob(new Blob([zip], {type:'application/zip'}), 'MM-DIGIPRO-BANK-SYX.zip');
      } finally {
        endJob();
      }
    };

// Inline IO / reminder message
ioMsgEl = el('div','mm-io-msg');
ioMsgEl.textContent = 'Ready';
ioMsgEl.setAttribute('role', 'status');
ioMsgEl.setAttribute('aria-live', 'polite');

    // No dedicated Cancel button — the job-start button becomes “Cancel” while running.

    // Tools + FX grid (square buttons)
    historyRow.append(btnUndo, btnRedo);

    // --- Extra FX buttons (added after the first merged build; keep them, but in the grid) ---
    const btnSkL   = el('button');
    const btnSkR   = el('button');
    const btnOddSy = el('button');
    const btnLP12  = el('button');
    const btnHP8   = el('button');
    const btnChaos = el('button');

    // --- New FX buttons (fill grid; keep generator row aligned) ---
    const btnPM     = el('button');   // PhaseMod (uses CLIP/nearest slot)
    const btnPWM    = el('button');   // PWM Warp
    const btnPD     = el('button');   // Phase Distort
    const btnCheby  = el('button');   // Chebyshev waveshaper
    const btnSmear  = el('button');   // Spectral diffusion (FFT)


    // --- Random chain (5–10 FX) ---
    const btnFxChain = el('button');

    // --- Waveform generators (write to active slot(s)) ---
    const btnGenSine  = el('button');
    const btnGenTri   = el('button');
    const btnGenSquare= el('button');
    const btnGenSaw   = el('button');
    const btnGenExp   = el('button');
    const btnGenNoise = el('button');
    const btnGenPulse = el('button');
    const btnGenFM    = el('button');
    const btnGenHarm  = el('button');
    const btnGenStep  = el('button');



    // Apply a chain of effects as ONE undo entry (editor) or ONE bank entry (selection)
    function applyFxChain(label, chain){
      if (!EDIT.dataU8) return;
      const hasSelection = SELECTED && SELECTED.size > 0;

      function applyFXSafe(step, a){
        const f = (typeof step === 'function') ? step : (step && step.fn);
        const randomizeParamFx = !!(step && step.randomizeParams);
        const prev = EDIT.dataU8;
        try{
          EDIT.dataU8 = a; // so FFT FX read the right source
          const next = dpApplyFxWithOneShotRandomParams(f, a, {
            randomizeParamFx,
            waveLen: (a && a.length) ? (a.length|0) : 0,
          });
          return (next && next.length) ? next : a;
        } catch(_){
          return a;
        } finally {
          EDIT.dataU8 = prev;
        }
      }

      const chainLabels = (chain||[]).map(d=>d && d.label).filter(Boolean).join(' → ') || '…';

      // No selection → editor only (single undo entry)
      if (!hasSelection){
        let cur = new Uint8Array(EDIT.dataU8);
        for (const step of (chain||[])){
          if (!step || typeof step.fn !== 'function') continue;
          cur = applyFXSafe(step, cur);
        }
        EDIT.dataU8 = cur;
        snapshot(label || 'FX chain');
        if (paintEditor) paintEditor();
        touch();
        announceIO(`${label}: ${chainLabels}`);
        return;
      }

      // Selection → commit into bank + one bank undo entry
      const sel = Array.from(SELECTED).sort((a,b)=>a-b);

      const actSlot = EDIT.slot|0;
      const actName = EDIT.name;
      const actData = EDIT.dataU8 ? new Uint8Array(EDIT.dataU8) : null;

      const __bankBefore = captureBankState(sel, { preferEditor:true });

      let applied = 0;
      let newActData = null;

      const prevSlot = EDIT.slot;
      const prevData = EDIT.dataU8;
      const prevName = EDIT.name;

      try{
        for (const s of sel){
          const useEditor = (s === (EDIT.slot|0)) && !!(LIB.dirty && LIB.dirty.has(s));
          const w = useEditor
            ? { name: EDIT.name, dataU8: EDIT.dataU8, user:true }
            : LIB.waves[s];
          const src = (s === actSlot) ? actData : (w && w.dataU8);
          if (!src || !src.length) continue;

          let cur = new Uint8Array(src);

          // Rebind editor context so FFT/morph FX see correct source
          EDIT.slot  = s;
          EDIT.dataU8 = cur;

          for (const step of (chain||[])){
            if (!step || typeof step.fn !== 'function') continue;
            cur = applyFXSafe(step, cur);
          }

          const out = new Uint8Array(cur);
          const name = (s === actSlot)
            ? (actName || 'WAVE')
            : ((w && w.name) ? w.name : 'WAVE');

          LIB.waves[s] = attachDisplayRot({ name, dataU8: out, user:true });
          LIB.dirty.delete(s);
          paintGridCell(s);

          if (s === actSlot) newActData = out;
          applied++;
        }
      } finally {
        // Restore editor context
        EDIT.slot  = prevSlot;
        EDIT.dataU8 = prevData;
        EDIT.name  = prevName;
      }

      // Sync editor view if active slot was affected (commit rules: clear dirty)
      if (newActData){
        EDIT.dataU8 = newActData;
        if (paintEditor) paintEditor();
        if (nameIn) nameIn.value = EDIT.name;
        LIB.dirty.delete(actSlot);
      }

      if (__bankBefore && applied > 0){
        const __bankAfter = captureBankState(sel);
        bankPush({ label: `${label} (multi)`, before: __bankBefore, after: __bankAfter });
        if (newActData) resetUndoToCurrent(true);
      }

      announceIO(`${label} applied to ${applied}/${sel.length} selected slot${sel.length===1?'':'s'}.`);
      updateButtonsState();
    }

    // -----------------------------------------------------------------------
    // FX parameter presets + modal-driven Shift-click actions
    // -----------------------------------------------------------------------
    const FX_PARAM_PREF_KEY = 'mm_dp_fx_param_prefs_v1';
    const FX_PARAM_DEFAULTS = {
      freqMul:      { ratio:2, mode:'replace', mix:35, phaseDeg:0, interp:'nearest', dc:false, normalize:false, soft:false },
      freqDiv:      { ratio:2, mode:'replace', mix:35, phaseDeg:0, interp:'nearest', dc:false, normalize:false, soft:false },
      octaveLayer:  { ratio:2, mix:35, phaseDeg:0, interp:'nearest', normalize:true },
      subLayer:     { ratio:2, mix:35, phaseDeg:0, interp:'nearest', normalize:true },
      h3Layer:      { harmonic:3, mix:35, phaseDeg:0, normalize:true },
      hBed:         { low:2, high:7, slope:1.0, mix:55, phaseMode:'random', phaseDeg:0, normalize:true },
      crush:        { bits:3, mix:100 },
      downsample:   { factor:2, mode:'hold' },
      hardClip:     { thr:65 },
      softClip:     { drive:1.5 },
      asymClip:     { posDrive:2.0, negDrive:0.9, posGain:0.7, negGain:1.0 },
      cheby:        { amount:60 },
      scramble:     { segs:8, seed:'' },
      segmentize:   { segs:8, mode:'avg' },
      fftShift:     { bins:2, direction:'up' },
      fftCrush:     { keep:12 },
      fftFormant:   { centerPct:22, widthPct:25, amount:120 },
      specSmear:    { amount:55 },
    };

    function _fxN(v, d){
      const n = Number(v);
      return isFinite(n) ? n : d;
    }
    function _fxI(v, d){ return Math.round(_fxN(v, d)); }
    function _fxC(v, lo, hi, d){
      v = _fxN(v, d);
      if (v < lo) v = lo;
      if (v > hi) v = hi;
      return v;
    }
    function _fxCI(v, lo, hi, d){
      v = _fxI(v, d);
      if (v < lo) v = lo;
      if (v > hi) v = hi;
      return v|0;
    }
    function _fxClone(v){
      try{ return JSON.parse(JSON.stringify(v)); }catch(_){ return v; }
    }
    function _fxObj(v){ return (v && typeof v === 'object') ? v : {}; }

    function dpNormFxParamState(raw){
      const src = _fxObj(raw);
      const out = _fxClone(FX_PARAM_DEFAULTS);
      let s;

      s = _fxObj(src.freqMul);
      out.freqMul.ratio = _fxCI(s.ratio, 1, 64, out.freqMul.ratio);
      out.freqMul.mode = (s.mode === 'layer') ? 'layer' : 'replace';
      out.freqMul.mix = _fxC(s.mix, 0, 100, out.freqMul.mix);
      out.freqMul.phaseDeg = _fxC(s.phaseDeg, -360, 360, out.freqMul.phaseDeg);
      out.freqMul.interp = (s.interp === 'linear') ? 'linear' : 'nearest';
      out.freqMul.dc = !!s.dc;
      out.freqMul.normalize = !!s.normalize;
      out.freqMul.soft = !!s.soft;

      s = _fxObj(src.freqDiv);
      out.freqDiv.ratio = _fxCI(s.ratio, 1, 64, out.freqDiv.ratio);
      out.freqDiv.mode = (s.mode === 'layer') ? 'layer' : 'replace';
      out.freqDiv.mix = _fxC(s.mix, 0, 100, out.freqDiv.mix);
      out.freqDiv.phaseDeg = _fxC(s.phaseDeg, -360, 360, out.freqDiv.phaseDeg);
      out.freqDiv.interp = (s.interp === 'linear') ? 'linear' : 'nearest';
      out.freqDiv.dc = !!s.dc;
      out.freqDiv.normalize = !!s.normalize;
      out.freqDiv.soft = !!s.soft;

      s = _fxObj(src.octaveLayer);
      out.octaveLayer.ratio = _fxCI(s.ratio, 1, 32, out.octaveLayer.ratio);
      out.octaveLayer.mix = _fxC(s.mix, 0, 100, out.octaveLayer.mix);
      out.octaveLayer.phaseDeg = _fxC(s.phaseDeg, -360, 360, out.octaveLayer.phaseDeg);
      out.octaveLayer.interp = (s.interp === 'linear') ? 'linear' : 'nearest';
      out.octaveLayer.normalize = (typeof s.normalize === 'boolean') ? s.normalize : !!out.octaveLayer.normalize;

      s = _fxObj(src.subLayer);
      out.subLayer.ratio = _fxCI(s.ratio, 1, 32, out.subLayer.ratio);
      out.subLayer.mix = _fxC(s.mix, 0, 100, out.subLayer.mix);
      out.subLayer.phaseDeg = _fxC(s.phaseDeg, -360, 360, out.subLayer.phaseDeg);
      out.subLayer.interp = (s.interp === 'linear') ? 'linear' : 'nearest';
      out.subLayer.normalize = (typeof s.normalize === 'boolean') ? s.normalize : !!out.subLayer.normalize;

      s = _fxObj(src.h3Layer);
      out.h3Layer.harmonic = _fxCI(s.harmonic, 1, 32, out.h3Layer.harmonic);
      out.h3Layer.mix = _fxC(s.mix, 0, 100, out.h3Layer.mix);
      out.h3Layer.phaseDeg = _fxC(s.phaseDeg, -360, 360, out.h3Layer.phaseDeg);
      out.h3Layer.normalize = (typeof s.normalize === 'boolean') ? s.normalize : !!out.h3Layer.normalize;

      s = _fxObj(src.hBed);
      out.hBed.low = _fxCI(s.low, 1, 32, out.hBed.low);
      out.hBed.high = _fxCI(s.high, 1, 32, out.hBed.high);
      if (out.hBed.high < out.hBed.low){
        const t = out.hBed.low; out.hBed.low = out.hBed.high; out.hBed.high = t;
      }
      out.hBed.slope = _fxC(s.slope, 0, 3, out.hBed.slope);
      out.hBed.mix = _fxC(s.mix, 0, 100, out.hBed.mix);
      out.hBed.phaseMode = (s.phaseMode === 'zero' || s.phaseMode === 'offset') ? s.phaseMode : 'random';
      out.hBed.phaseDeg = _fxC(s.phaseDeg, -360, 360, out.hBed.phaseDeg);
      out.hBed.normalize = (typeof s.normalize === 'boolean') ? s.normalize : !!out.hBed.normalize;

      s = _fxObj(src.crush);
      out.crush.bits = _fxCI(s.bits, 1, 8, out.crush.bits);
      out.crush.mix = _fxC(s.mix, 0, 100, out.crush.mix);

      s = _fxObj(src.downsample);
      out.downsample.factor = _fxCI(s.factor, 2, 64, out.downsample.factor);
      out.downsample.mode = (s.mode === 'avg') ? 'avg' : 'hold';

      s = _fxObj(src.hardClip);
      out.hardClip.thr = _fxC(s.thr, 1, 100, out.hardClip.thr);

      s = _fxObj(src.softClip);
      out.softClip.drive = _fxC(s.drive, 0.1, 12, out.softClip.drive);

      s = _fxObj(src.asymClip);
      out.asymClip.posDrive = _fxC(s.posDrive, 0.1, 12, out.asymClip.posDrive);
      out.asymClip.negDrive = _fxC(s.negDrive, 0.1, 12, out.asymClip.negDrive);
      out.asymClip.posGain = _fxC(s.posGain, 0, 2, out.asymClip.posGain);
      out.asymClip.negGain = _fxC(s.negGain, 0, 2, out.asymClip.negGain);

      s = _fxObj(src.cheby);
      out.cheby.amount = _fxC(s.amount, 0, 100, out.cheby.amount);

      s = _fxObj(src.scramble);
      out.scramble.segs = _fxCI(s.segs, 2, 64, out.scramble.segs);
      out.scramble.seed = (s.seed == null) ? '' : String(s.seed).slice(0, 32);

      s = _fxObj(src.segmentize);
      out.segmentize.segs = _fxCI(s.segs, 2, 64, out.segmentize.segs);
      out.segmentize.mode = (s.mode === 'median') ? 'median' : 'avg';

      s = _fxObj(src.fftShift);
      out.fftShift.bins = _fxCI(s.bins, 1, 64, out.fftShift.bins);
      out.fftShift.direction = (s.direction === 'down') ? 'down' : 'up';

      s = _fxObj(src.fftCrush);
      out.fftCrush.keep = _fxCI(s.keep, 1, 128, out.fftCrush.keep);

      s = _fxObj(src.fftFormant);
      out.fftFormant.centerPct = _fxC(s.centerPct, 0, 100, out.fftFormant.centerPct);
      out.fftFormant.widthPct = _fxC(s.widthPct, 1, 100, out.fftFormant.widthPct);
      out.fftFormant.amount = _fxC(s.amount, 0, 300, out.fftFormant.amount);

      s = _fxObj(src.specSmear);
      out.specSmear.amount = _fxC(s.amount, 0, 100, out.specSmear.amount);

      return out;
    }

    function dpLoadFxParamState(){
      try{
        const raw = (root.localStorage && localStorage.getItem(FX_PARAM_PREF_KEY))
          ? localStorage.getItem(FX_PARAM_PREF_KEY)
          : null;
        if (!raw) return dpNormFxParamState({});
        return dpNormFxParamState(JSON.parse(raw));
      }catch(_){
        return dpNormFxParamState({});
      }
    }

    function dpSaveFxParamState(){
      try{
        if (root.localStorage){
          localStorage.setItem(FX_PARAM_PREF_KEY, JSON.stringify(dpNormFxParamState(FX_PARAM_STATE)));
        }
      }catch(_){ }
    }

    const FX_PARAM_STATE = root.__digiproFxParamState
      ? dpNormFxParamState(root.__digiproFxParamState)
      : dpLoadFxParamState();
    root.__digiproFxParamState = FX_PARAM_STATE;

    // Optional one-shot overrides used by random recipes/chains.
    // These are runtime-only and never persisted to user prefs.
    let FX_PARAM_OVERRIDES = null;

    function dpGetFxParamBase(kind){
      const all = dpNormFxParamState(FX_PARAM_STATE);
      Object.assign(FX_PARAM_STATE, all);
      return _fxClone(all[kind] || {});
    }
    function dpGetFxParam(kind){
      const base = dpGetFxParamBase(kind);
      if (!FX_PARAM_OVERRIDES || !Object.prototype.hasOwnProperty.call(FX_PARAM_OVERRIDES, kind)){
        return base;
      }
      const ov = _fxObj(FX_PARAM_OVERRIDES[kind]);
      const merged = dpNormFxParamState({ [kind]: Object.assign({}, base, ov) });
      return _fxClone(merged[kind] || base);
    }
    function dpSetFxParam(kind, value){
      const merged = dpNormFxParamState(Object.assign({}, FX_PARAM_STATE, { [kind]: value }));
      Object.assign(FX_PARAM_STATE, merged);
      root.__digiproFxParamState = FX_PARAM_STATE;
      dpSaveFxParamState();
    }

    function dpWithFxParamOverrides(overrides, fn){
      if (typeof fn !== 'function') return;
      const prev = FX_PARAM_OVERRIDES;
      const next = Object.assign({}, prev || {});
      const o = _fxObj(overrides);
      for (const k of Object.keys(o)) next[k] = _fxObj(o[k]);
      FX_PARAM_OVERRIDES = next;
      try{
        return fn();
      } finally {
        FX_PARAM_OVERRIDES = prev;
      }
    }

    function _fxRnd(min, max){
      return min + (Math.random() * (max - min));
    }
    function _fxRndI(min, max){
      return Math.round(_fxRnd(min, max));
    }
    function _fxPick(list, fallback){
      const arr = Array.isArray(list) ? list : [];
      if (!arr.length) return fallback;
      return arr[(Math.random() * arr.length) | 0];
    }

    function dpBuildOneShotRandomFxParam(kind, waveLen){
      const N = Math.max(2, (waveLen|0) || 96);
      const segMax = Math.max(2, Math.min(64, N));
      switch (String(kind || '')){
        case 'freqMul': {
          const mode = (Math.random() < 0.35) ? 'layer' : 'replace';
          return {
            ratio: _fxPick([2,2,3,3,4,5,6,8], 2),
            mode,
            mix: _fxRndI(mode === 'layer' ? 15 : 5, mode === 'layer' ? 85 : 45),
            phaseDeg: _fxRndI(-180, 180),
            interp: _fxPick(['nearest', 'linear'], 'nearest'),
            dc: Math.random() < 0.35,
            normalize: Math.random() < 0.30,
            soft: Math.random() < 0.30,
          };
        }
        case 'freqDiv': {
          const mode = (Math.random() < 0.30) ? 'layer' : 'replace';
          return {
            ratio: _fxPick([2,2,3,3,4,5,6,8], 2),
            mode,
            mix: _fxRndI(mode === 'layer' ? 15 : 5, mode === 'layer' ? 85 : 45),
            phaseDeg: _fxRndI(-180, 180),
            interp: _fxPick(['nearest', 'linear'], 'nearest'),
            dc: Math.random() < 0.35,
            normalize: Math.random() < 0.30,
            soft: Math.random() < 0.30,
          };
        }
        case 'octaveLayer':
          return {
            ratio: _fxPick([2,2,3,3,4,5,6], 2),
            mix: _fxRndI(10, 80),
            phaseDeg: _fxRndI(-180, 180),
            interp: _fxPick(['nearest', 'linear'], 'nearest'),
            normalize: Math.random() < 0.65,
          };
        case 'subLayer':
          return {
            ratio: _fxPick([2,2,3,3,4,5,6], 2),
            mix: _fxRndI(10, 80),
            phaseDeg: _fxRndI(-180, 180),
            interp: _fxPick(['nearest', 'linear'], 'nearest'),
            normalize: Math.random() < 0.65,
          };
        case 'h3Layer':
          return {
            harmonic: _fxRndI(2, 16),
            mix: _fxRndI(10, 80),
            phaseDeg: _fxRndI(-180, 180),
            normalize: Math.random() < 0.65,
          };
        case 'hBed': {
          const low = _fxRndI(1, 10);
          const high = _fxRndI(low, Math.min(24, low + _fxRndI(1, 10)));
          return {
            low,
            high,
            slope: _fxRnd(0.25, 2.2),
            mix: _fxRndI(20, 85),
            phaseMode: _fxPick(['random', 'offset', 'zero'], 'random'),
            phaseDeg: _fxRndI(-180, 180),
            normalize: Math.random() < 0.70,
          };
        }
        case 'crush':
          return {
            bits: _fxRndI(1, 8),
            mix: _fxRndI(35, 100),
          };
        case 'downsample':
          return {
            factor: _fxRndI(2, Math.min(32, segMax)),
            mode: _fxPick(['hold', 'avg'], 'hold'),
          };
        case 'hardClip':
          return {
            thr: _fxRndI(18, 92),
          };
        case 'softClip':
          return {
            drive: _fxRnd(0.6, 7.0),
          };
        case 'asymClip':
          return {
            posDrive: _fxRnd(0.6, 8.0),
            negDrive: _fxRnd(0.4, 6.0),
            posGain: _fxRnd(0.4, 1.4),
            negGain: _fxRnd(0.4, 1.4),
          };
        case 'cheby':
          return {
            amount: _fxRndI(15, 95),
          };
        case 'scramble': {
          const seeded = Math.random() < 0.45;
          return {
            segs: _fxRndI(2, Math.min(24, segMax)),
            seed: seeded ? String(_fxRndI(1, 999999)) : '',
          };
        }
        case 'segmentize':
          return {
            segs: _fxRndI(2, Math.min(24, segMax)),
            mode: _fxPick(['avg', 'median'], 'avg'),
          };
        case 'fftShift':
          return {
            bins: _fxRndI(1, 12),
            direction: _fxPick(['up', 'down'], 'up'),
          };
        case 'fftCrush':
          return {
            keep: _fxRndI(3, 48),
          };
        case 'fftFormant':
          return {
            centerPct: _fxRndI(6, 82),
            widthPct: _fxRndI(8, 55),
            amount: _fxRndI(70, 240),
          };
        case 'specSmear':
          return {
            amount: _fxRndI(15, 95),
          };
        default:
          return null;
      }
    }

    const FX_PARAM_KIND_BY_FN = new Map([
      [fxDoubleFreqParam, 'freqMul'],
      [fxHalfFreqParam, 'freqDiv'],
      [fxOctaveLayerParam, 'octaveLayer'],
      [fxSubLayerParam, 'subLayer'],
      [fxThirdHarmonicLayerParam, 'h3Layer'],
      [fxHarmonicBedParam, 'hBed'],
      [fxCrushParam, 'crush'],
      [fxDownsampleParam, 'downsample'],
      [fxHardClipParam, 'hardClip'],
      [fxSoftClipParam, 'softClip'],
      [fxAsymClipParam, 'asymClip'],
      [fxChebyParam, 'cheby'],
      [fxScrambleParam, 'scramble'],
      [fxSegmentizeParam, 'segmentize'],
      [fxFFTShiftParam, 'fftShift'],
      [fxFFTCrushParam, 'fftCrush'],
      [fxFFTFormantParam, 'fftFormant'],
      [fxSpecSmearParam, 'specSmear'],
    ]);

    function dpFxParamKindForFn(fn){
      if (typeof fn !== 'function') return null;
      return FX_PARAM_KIND_BY_FN.get(fn) || null;
    }

    function dpApplyFxWithOneShotRandomParams(fn, input, opts){
      if (typeof fn !== 'function') return input;
      const useRandom = !!(opts && opts.randomizeParamFx);
      if (!useRandom) return fn(input);
      const kind = dpFxParamKindForFn(fn);
      if (!kind) return fn(input);
      const oneShot = dpBuildOneShotRandomFxParam(kind, (opts && opts.waveLen) ? (opts.waveLen|0) : 0);
      if (!oneShot) return fn(input);
      return dpWithFxParamOverrides({ [kind]: oneShot }, ()=>fn(input));
    }

    function dpSamplePeriodicU8(src, pos, interp){
      const N = src.length|0;
      if (!N) return 128;
      let p = Number(pos) || 0;
      p = p % N;
      if (p < 0) p += N;
      if (interp === 'linear'){
        const i0 = Math.floor(p);
        const t = p - i0;
        const i1 = (i0 + 1) % N;
        return (src[i0] * (1 - t)) + (src[i1] * t);
      }
      return src[Math.floor(p) % N];
    }

    function dpResampleFreqU8(src, rate, phaseDeg, interp){
      const N = src.length|0;
      const out = new Uint8Array(N);
      if (!N) return out;
      const r = Math.max(1e-9, Number(rate) || 1);
      const phase = (N * (Number(phaseDeg) || 0)) / 360;
      for (let i=0;i<N;i++){
        const s = dpSamplePeriodicU8(src, i * r + phase, interp);
        out[i] = clamp(Math.round(s), 0, 255);
      }
      return out;
    }

    function dpLayerMixU8(dry, wet, mixPct){
      const N = dry.length|0;
      const out = new Uint8Array(N);
      const mix = _fxC(mixPct, 0, 100, 0) / 100;
      for (let i=0;i<N;i++){
        const s = (dry[i] - 128) / 127;
        const t = (wet[i] - 128) / 127;
        const y = s + mix * t;
        out[i] = clamp(Math.round(y * 127 + 128), 0, 255);
      }
      return out;
    }

    function dpRemoveDCU8(src){
      const N = src.length|0;
      if (!N) return new Uint8Array(0);
      const out = new Uint8Array(N);
      let mean = 0;
      for (let i=0;i<N;i++) mean += src[i];
      mean /= N;
      for (let i=0;i<N;i++){
        out[i] = clamp(Math.round((src[i] - mean) + 128), 0, 255);
      }
      return out;
    }

    function dpSoftLimitU8(src, drive){
      const N = src.length|0;
      const out = new Uint8Array(N);
      const k = _fxC(drive, 0.1, 12, 1.2);
      const norm = Math.tanh(k) || 1;
      for (let i=0;i<N;i++){
        const s = (src[i] - 128) / 127;
        const y = Math.tanh(s * k) / norm;
        out[i] = clamp(Math.round(y * 127 + 128), 0, 255);
      }
      return out;
    }

    function dpApplyPostOpsU8(src, cfg){
      let out = new Uint8Array(src);
      if (cfg && cfg.dc) out = dpRemoveDCU8(out);
      if (cfg && cfg.soft) out = dpSoftLimitU8(out, 1.2);
      if (cfg && cfg.normalize) out = fxNormalize(out);
      return out;
    }

    function dpSeededRandom(seed){
      let a = ((seed|0) || 1) >>> 0;
      return function(){
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function fxDoubleFreqParam(a){
      const p = dpGetFxParam('freqMul');
      let out = dpResampleFreqU8(a, Math.max(1, p.ratio|0), p.phaseDeg, p.interp);
      if (p.mode === 'layer') out = dpLayerMixU8(a, out, p.mix);
      return dpApplyPostOpsU8(out, p);
    }

    function fxHalfFreqParam(a){
      const p = dpGetFxParam('freqDiv');
      const ratio = Math.max(1, p.ratio|0);
      let out = dpResampleFreqU8(a, 1 / ratio, p.phaseDeg, p.interp);
      if (p.mode === 'layer') out = dpLayerMixU8(a, out, p.mix);
      return dpApplyPostOpsU8(out, p);
    }

    function fxOctaveLayerParam(a){
      const p = dpGetFxParam('octaveLayer');
      const ratio = Math.max(1, p.ratio|0);
      const layer = dpResampleFreqU8(a, ratio, p.phaseDeg, p.interp);
      let out = dpLayerMixU8(a, layer, p.mix);
      if (p.normalize) out = fxNormalize(out);
      return out;
    }

    function fxSubLayerParam(a){
      const p = dpGetFxParam('subLayer');
      const ratio = Math.max(1, p.ratio|0);
      const layer = dpResampleFreqU8(a, 1 / ratio, p.phaseDeg, p.interp);
      let out = dpLayerMixU8(a, layer, p.mix);
      if (p.normalize) out = fxNormalize(out);
      return out;
    }

    function fxThirdHarmonicLayerParam(a){
      const p = dpGetFxParam('h3Layer');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const h = Math.max(1, p.harmonic|0);
      const mix = _fxC(p.mix, 0, 100, 35) / 100;
      const ph = (Number(p.phaseDeg) || 0) * (Math.PI / 180);
      for (let i=0;i<N;i++){
        const s = (a[i] - 128) / 127;
        const hsig = Math.sin((i / N) * Math.PI * 2 * h + ph);
        out[i] = clamp(Math.round((s + mix * hsig) * 127 + 128), 0, 255);
      }
      return p.normalize ? fxNormalize(out) : out;
    }

    function fxHarmonicBedParam(a){
      const p = dpGetFxParam('hBed');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const low = Math.max(1, p.low|0);
      const high = Math.max(low, p.high|0);
      const slope = _fxC(p.slope, 0, 3, 1);
      const mix = _fxC(p.mix, 0, 100, 55) / 100;
      const phaseOffset = (Number(p.phaseDeg) || 0) * (Math.PI / 180);
      const harmonics = [];
      for (let h=low; h<=high; h++) harmonics.push(h);
      const phases = harmonics.map((_, i)=>{
        if (p.phaseMode === 'zero') return 0;
        if (p.phaseMode === 'offset') return phaseOffset * (i + 1);
        return Math.random() * Math.PI * 2;
      });
      const weights = harmonics.map((h)=>1 / Math.pow(h, slope || 1));
      const wSum = weights.reduce((s,v)=>s+v, 0) || 1;
      for (let i=0;i<N;i++){
        const s = (a[i] - 128) / 127;
        const ph = (i / N) * Math.PI * 2;
        let bed = 0;
        for (let k=0;k<harmonics.length;k++){
          bed += weights[k] * Math.sin(ph * harmonics[k] + phases[k]);
        }
        bed /= wSum;
        const y = Math.tanh((s + mix * bed) * 1.2);
        out[i] = clamp(Math.round(y * 127 + 128), 0, 255);
      }
      return p.normalize ? fxNormalize(out) : out;
    }

    function fxCrushParam(a){
      const p = dpGetFxParam('crush');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const bits = _fxCI(p.bits, 1, 8, 3);
      const levels = 1 << bits;
      const mix = _fxC(p.mix, 0, 100, 100) / 100;
      for (let i=0;i<N;i++){
        const s = a[i] / 255;
        const q = Math.round(s * (levels - 1)) / (levels - 1);
        const wet = q * 255;
        const dry = a[i];
        out[i] = clamp(Math.round(dry * (1 - mix) + wet * mix), 0, 255);
      }
      return out;
    }

    function fxDownsampleParam(a){
      const p = dpGetFxParam('downsample');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const factor = _fxCI(p.factor, 2, Math.max(2, N), 2);
      const mode = (p.mode === 'avg') ? 'avg' : 'hold';
      for (let i=0;i<N;i++){
        const j = Math.floor(i / factor) * factor;
        if (mode === 'hold'){
          out[i] = a[Math.min(j, N - 1)];
        } else {
          let sum = 0, cnt = 0;
          for (let k=0;k<factor;k++){
            const idx = j + k;
            if (idx >= N) break;
            sum += a[idx];
            cnt++;
          }
          out[i] = clamp(Math.round((cnt ? (sum / cnt) : 128)), 0, 255);
        }
      }
      return out;
    }

    function fxHardClipParam(a){
      const p = dpGetFxParam('hardClip');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const thr = _fxC(p.thr, 1, 100, 65) / 100;
      for (let i=0;i<N;i++){
        let s = (a[i] - 128) / 127;
        s = Math.max(-thr, Math.min(thr, s));
        out[i] = clamp(Math.round(s * 127 + 128), 0, 255);
      }
      return out;
    }

    function fxSoftClipParam(a){
      const p = dpGetFxParam('softClip');
      return dpSoftLimitU8(a, p.drive);
    }

    function fxAsymClipParam(a){
      const p = dpGetFxParam('asymClip');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const posDrive = _fxC(p.posDrive, 0.1, 12, 2.0);
      const negDrive = _fxC(p.negDrive, 0.1, 12, 0.9);
      const posGain = _fxC(p.posGain, 0, 2, 0.7);
      const negGain = _fxC(p.negGain, 0, 2, 1.0);
      for (let i=0;i<N;i++){
        const s = (a[i] - 128) / 127;
        const y = (s >= 0)
          ? (Math.tanh(s * posDrive) * posGain)
          : (Math.tanh(s * negDrive) * negGain);
        out[i] = clamp(Math.round(y * 127 + 128), 0, 255);
      }
      return out;
    }

    function fxChebyParam(a){
      const p = dpGetFxParam('cheby');
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      if (!src.length) return new Uint8Array(0);
      return dpEvolveGenerate(src, _fxC(p.amount, 0, 100, 60) / 100, 'cheby');
    }

    function fxScrambleParam(a){
      const p = dpGetFxParam('scramble');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const segs = _fxCI(p.segs, 2, Math.max(2, N), 8);
      const segLen = Math.max(1, Math.floor(N / segs));
      const order = Array.from({length:segs}, (_,i)=>i);
      const seedText = String(p.seed || '').trim();
      const seed = parseInt(seedText, 10);
      const rng = isFinite(seed) ? dpSeededRandom(seed) : Math.random;
      for (let i=order.length-1;i>0;i--){
        const j = Math.floor(rng() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      for (let s=0;s<segs;s++){
        const srcSeg = order[s];
        for (let i=0;i<segLen;i++){
          const di = s * segLen + i;
          const si = srcSeg * segLen + i;
          if (di < N && si < N) out[di] = a[si];
        }
      }
      for (let i=segs * segLen; i<N; i++) out[i] = a[i];
      return out;
    }

    function fxSegmentizeParam(a){
      const p = dpGetFxParam('segmentize');
      const N = a.length|0;
      const out = new Uint8Array(N);
      const segs = _fxCI(p.segs, 2, Math.max(2, N), 8);
      const mode = (p.mode === 'median') ? 'median' : 'avg';
      const len = Math.max(1, Math.floor(N / segs));
      for (let s=0;s<segs;s++){
        const vals = [];
        for (let i=0;i<len;i++){
          const idx = s * len + i;
          if (idx < N) vals.push(a[idx]);
        }
        if (!vals.length) continue;
        let v = 128;
        if (mode === 'median'){
          vals.sort((x,y)=>x-y);
          v = vals[(vals.length / 2)|0];
        } else {
          let sum = 0;
          for (let i=0;i<vals.length;i++) sum += vals[i];
          v = Math.round(sum / vals.length);
        }
        for (let i=0;i<len;i++){
          const idx = s * len + i;
          if (idx < N) out[idx] = clamp(v, 0, 255);
        }
      }
      for (let i=segs * len; i<N; i++) out[i] = a[i];
      return out;
    }

    function fxFFTShiftParam(a){
      const p = dpGetFxParam('fftShift');
      const bins = _fxCI(p.bins, 1, 64, 2);
      const s = (p.direction === 'down') ? -bins : bins;
      return spectralApply((re,im,N,H)=>specShift(re,im,N,H,s));
    }

    function fxFFTCrushParam(a){
      const p = dpGetFxParam('fftCrush');
      const keepReq = _fxCI(p.keep, 1, 128, 12);
      return spectralApply((re,im,N,H)=>{
        const keep = _fxCI(keepReq, 1, Math.max(1, H - 1), Math.min(12, Math.max(1, H - 1)));
        specCrush(re, im, N, H, keep);
      });
    }

    function fxFFTFormantParam(a){
      const p = dpGetFxParam('fftFormant');
      return spectralApply((re, im, N, H)=>{
        if (H <= 1) return;
        const center = _fxCI(1 + (H - 2) * (_fxC(p.centerPct, 0, 100, 22) / 100), 1, H - 1, 3);
        const sigma = Math.max(1, (H - 1) * (_fxC(p.widthPct, 1, 100, 25) / 100));
        const peak = _fxC(p.amount, 0, 300, 120) / 100;
        for (let k=1;k<H;k++){
          const g = 0.25 + peak * Math.exp(-0.5 * Math.pow((k - center) / sigma, 2));
          re[k] *= g;
          im[k] *= g;
        }
      });
    }

    function fxSpecSmearParam(a){
      const p = dpGetFxParam('specSmear');
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      if (!src.length) return new Uint8Array(0);
      return dpEvolveGenerate(src, _fxC(p.amount, 0, 100, 55) / 100, 'specsmear');
    }

    function dpPromptFxParams(kind, title){
      return new Promise((resolve)=>{
        const cur = dpGetFxParam(kind);
        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        const h = el('h4'); h.textContent = title || 'FX parameters';
        const p = el('div','mm-small');
        p.textContent = 'Adjust parameters for this effect. Apply stores these settings and runs the effect.';
        const body = el('div');
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '8px';

        function addRow(lbl, control){
          const row = el('label','mm-digi-io mm-small');
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          const t = el('span'); t.textContent = lbl;
          row.append(t, control);
          body.append(row);
          return control;
        }
        function addNumber(lbl, key, min, max, step){
          const input = el('input');
          input.type = 'number';
          input.style.width = '8em';
          if (min != null) input.min = String(min);
          if (max != null) input.max = String(max);
          if (step != null) input.step = String(step);
          input.value = String(cur[key]);
          input.oninput = ()=>{ cur[key] = _fxN(input.value, cur[key]); };
          addRow(lbl, input);
          return input;
        }
        function addSelect(lbl, key, list){
          const sel = el('select');
          sel.style.width = '11em';
          for (const it of (list||[])){
            const o = el('option');
            o.value = String(it.value);
            o.textContent = String(it.label);
            if (String(cur[key]) === String(it.value)) o.selected = true;
            sel.append(o);
          }
          sel.onchange = ()=>{ cur[key] = sel.value; };
          addRow(lbl, sel);
          return sel;
        }
        function addCheckbox(lbl, key){
          const cb = el('input');
          cb.type = 'checkbox';
          cb.checked = !!cur[key];
          cb.onchange = ()=>{ cur[key] = !!cb.checked; };
          addRow(lbl, cb);
          return cb;
        }
        function addText(lbl, key){
          const input = el('input');
          input.type = 'text';
          input.style.width = '11em';
          input.value = String(cur[key] || '');
          input.oninput = ()=>{ cur[key] = input.value; };
          addRow(lbl, input);
          return input;
        }

        switch(kind){
          case 'freqMul':
          case 'freqDiv':
            addNumber(kind==='freqMul' ? 'Multiplier' : 'Divisor', 'ratio', 1, 64, 1);
            addSelect('Mode', 'mode', [{value:'replace',label:'Replace'}, {value:'layer',label:'Layer'}]);
            addNumber('Layer mix (%)', 'mix', 0, 100, 1);
            addNumber('Phase (deg)', 'phaseDeg', -360, 360, 1);
            addSelect('Interpolation', 'interp', [{value:'nearest',label:'Nearest'}, {value:'linear',label:'Linear'}]);
            addCheckbox('Post: remove DC', 'dc');
            addCheckbox('Post: normalize', 'normalize');
            addCheckbox('Post: soft-limit', 'soft');
            break;
          case 'octaveLayer':
          case 'subLayer':
            addNumber(kind==='octaveLayer' ? 'Multiplier' : 'Divisor', 'ratio', 1, 32, 1);
            addNumber('Layer mix (%)', 'mix', 0, 100, 1);
            addNumber('Phase (deg)', 'phaseDeg', -360, 360, 1);
            addSelect('Interpolation', 'interp', [{value:'nearest',label:'Nearest'}, {value:'linear',label:'Linear'}]);
            addCheckbox('Normalize output', 'normalize');
            break;
          case 'h3Layer':
            addNumber('Harmonic number', 'harmonic', 1, 32, 1);
            addNumber('Layer mix (%)', 'mix', 0, 100, 1);
            addNumber('Phase (deg)', 'phaseDeg', -360, 360, 1);
            addCheckbox('Normalize output', 'normalize');
            break;
          case 'hBed':
            addNumber('Lowest harmonic', 'low', 1, 32, 1);
            addNumber('Highest harmonic', 'high', 1, 32, 1);
            addNumber('Weight slope', 'slope', 0, 3, 0.1);
            addNumber('Layer mix (%)', 'mix', 0, 100, 1);
            addSelect('Phase mode', 'phaseMode', [
              {value:'random',label:'Random per apply'},
              {value:'zero',label:'All zero'},
              {value:'offset',label:'Progressive offset'},
            ]);
            addNumber('Phase offset (deg)', 'phaseDeg', -360, 360, 1);
            addCheckbox('Normalize output', 'normalize');
            break;
          case 'crush':
            addNumber('Bit depth', 'bits', 1, 8, 1);
            addNumber('Wet mix (%)', 'mix', 0, 100, 1);
            break;
          case 'downsample':
            addNumber('Hold factor', 'factor', 2, 64, 1);
            addSelect('Mode', 'mode', [{value:'hold',label:'Hold'}, {value:'avg',label:'Average'}]);
            break;
          case 'hardClip':
            addNumber('Threshold (%)', 'thr', 1, 100, 1);
            break;
          case 'softClip':
            addNumber('Drive', 'drive', 0.1, 12, 0.1);
            break;
          case 'asymClip':
            addNumber('Positive drive', 'posDrive', 0.1, 12, 0.1);
            addNumber('Negative drive', 'negDrive', 0.1, 12, 0.1);
            addNumber('Positive gain', 'posGain', 0, 2, 0.05);
            addNumber('Negative gain', 'negGain', 0, 2, 0.05);
            break;
          case 'cheby':
          case 'specSmear':
            addNumber('Amount (%)', 'amount', 0, 100, 1);
            break;
          case 'scramble':
            addNumber('Segments', 'segs', 2, 64, 1);
            addText('Seed (empty=random)', 'seed');
            break;
          case 'segmentize':
            addNumber('Segments', 'segs', 2, 64, 1);
            addSelect('Mode', 'mode', [{value:'avg',label:'Average'}, {value:'median',label:'Median'}]);
            break;
          case 'fftShift':
            addNumber('Shift bins', 'bins', 1, 64, 1);
            addSelect('Direction', 'direction', [{value:'up',label:'Up'}, {value:'down',label:'Down'}]);
            break;
          case 'fftCrush':
            addNumber('Keep harmonics', 'keep', 1, 128, 1);
            break;
          case 'fftFormant':
            addNumber('Center (%)', 'centerPct', 0, 100, 1);
            addNumber('Width (%)', 'widthPct', 1, 100, 1);
            addNumber('Peak gain (%)', 'amount', 0, 300, 1);
            break;
          default:
            break;
        }

        const rowBtns = el('div','mm-digi-io mm-small');
        const bApply = el('button'); bApply.textContent = 'Apply';
        bApply.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent = 'Cancel';
        rowBtns.append(bApply, bCancel);

        function finish(ok){
          try{ document.removeEventListener('keydown', onKey); }catch(_){ }
          try{ overlay.removeEventListener('click', onOverlayClick); }catch(_){ }
          overlay.remove();
          resolve(!!ok);
        }
        function onOverlayClick(e){
          if (e && e.target === overlay) finish(false);
        }
        function onKey(e){
          if (e && (e.key === 'Escape' || e.key === 'Esc')){
            try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
            finish(false);
            return;
          }
          if (e && e.key === 'Enter'){
            const tag = (e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : '';
            if (tag === 'textarea') return;
            try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
            bApply.click();
          }
        }

        bCancel.onclick = ()=>finish(false);
        bApply.onclick = ()=>{
          dpSetFxParam(kind, cur);
          finish(true);
        };

        dlg.append(h, p, el('hr'), body, el('hr'), rowBtns);
        overlay.append(dlg);
        document.body.append(overlay);
        overlay.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKey);
      });
    }

    function fxButtonTitle(label, hint, shiftHint){
      let t = String(label || 'FX');
      if (hint) t += ' — ' + hint;
      t += '\nClick: apply';
      if (typeof shiftHint === 'string'){
        if (shiftHint) t += '\nShift-click: ' + shiftHint;
      } else {
        t += '\nShift-click: random 5–10 FX chain';
      }
      return t;
    }

    function wireFxSquare(btn, icon, label, fn, hint, opts){
      const o = opts || {};
      const shiftAction = (typeof o.onShift === 'function') ? o.onShift : null;
      const randomShift = (typeof o.randomShift === 'boolean') ? o.randomShift : true;
      const shiftHint = shiftAction ? (o.shiftHint || 'open options') : (randomShift ? null : '');

      btn.type = 'button';
      btn.textContent = icon;
      btn.setAttribute('aria-label', label);
      btn.title = fxButtonTitle(label, hint, shiftHint);
      btn.onclick = async (ev)=>{
        if (ev && ev.shiftKey){
          if (shiftAction){
            const ok = await shiftAction();
            if (!ok) return;
          } else if (randomShift && label !== 'Normalize'){
            applyRandomFxChain();
            return;
          }
        }
        applyNamedEffect(label, fn);
      };
    }

    // Build + apply a random chain (5–10) from the FX pool
    function pickRandomFxChain(pool){
      const min = 5, max = 10;
      const count = min + ((Math.random()*((max-min)+1))|0);
      const out = [];
      if (!pool || !pool.length) return out;
      let last = null;
      for (let i=0;i<count;i++){
        let step = pool[(Math.random()*pool.length)|0];
        if (pool.length > 1){
          let guard = 8;
          while (guard-- > 0 && last && step && step.label === last.label){
            step = pool[(Math.random()*pool.length)|0];
          }
        }
        if (step) out.push(step);
        last = step;
      }
      return out;
    }
    function applyRandomFxChain(){
      const chain = pickRandomFxChain(FX_CHAIN_POOL).map(step=>Object.assign({}, step, { randomizeParams: true }));
      if (!chain.length){ announceIO('No FX available for random chain.', true); return; }
      applyFxChain('Random FX chain', chain);
    }

    // --- FX grid definitions (icons + tooltips) ---
    // NOTE: Keep the original FX fns; we only re-skin + re-wire clicks here.
    const FX_DEFS = [
      { btn: btnFxChain, label:'Random FX chain', icon:'🎲+', fn:null, hint:'Apply 5–10 random effects', chainable:false },

      // Basics
      { btn: btnSmooth,   label:'Smooth',      icon:'≈',  fn: fxSmooth,     hint:'3‑point moving average' },
      { btn: btnNormalize,label:'Normalize',   icon:'⇵',  fn: fxNormalize,  hint:'Remove DC + max out range' },
      { btn: btnInvert,   label:'Invert',      icon:'⊖',  fn: fxInvert,     hint:'Flip around center' },
      { btn: btnRectify,  label:'Rectify',     icon:'││', fn: fxRectify,    hint:'Absolute value (all positive)' },
      { btn: btnZero,     label:'Zero',        icon:'Ø',  fn: fxZero,       hint:'Set all samples to 128', chainable:false },

      // Time-domain shapers
      { btn: btnReverse,  label:'Reverse',     icon:'↔',  fn: fxReverse,    hint:'Reverse samples' },
      { btn: btnPulse,    label:'Pulseify',    icon:'▮▯', fn: fxPulseify,   hint:'Hard pulse from median threshold' },
      { btn: btnFold,     label:'Fold',        icon:'⤴',  fn: fxFold,       hint:'Wavefold at 0.5' },
      { btn: btnHC,       label:'HardClip',    icon:'▮',  fn: fxHardClipParam, hint:'Symmetric hard clip (variable threshold)', onShift: ()=>dpPromptFxParams('hardClip', 'HardClip options'), shiftHint:'edit threshold' },
      { btn: btnSC,       label:'SoftClip',    icon:'◔',  fn: fxSoftClipParam, hint:'Tanh soft clip (variable drive)', onShift: ()=>dpPromptFxParams('softClip', 'SoftClip options'), shiftHint:'edit drive' },
      { btn: btnAC,       label:'AsymClip',    icon:'◑',  fn: fxAsymClipParam, hint:'Asymmetric clip (editable curves)', onShift: ()=>dpPromptFxParams('asymClip', 'AsymClip options'), shiftHint:'edit asymmetry' },
      { btn: btnG,        label:'Gamma 0.5',   icon:'γ',  fn: fxGamma05,    hint:'Amplitude expansion' },
      { btn: btnCheby,    label:'Cheby',       icon:'CH', fn: fxChebyParam, hint:'Chebyshev waveshaper (amount)', onShift: ()=>dpPromptFxParams('cheby', 'Cheby options'), shiftHint:'edit amount' },
      { btn: btnRing,     label:'RingMod',     icon:'⊗',  fn: fxRingMod,    hint:'Multiply with +90° phase' },

      // Lo-fi / grit / disruption
      { btn: btnCrush,    label:'Crush',       icon:'▦',  fn: fxCrushParam, hint:'Bit depth + wet mix', onShift: ()=>dpPromptFxParams('crush', 'Crush options'), shiftHint:'edit bit depth/mix' },
      { btn: btnDown,     label:'Downsample',  icon:'⇣',  fn: fxDownsampleParam, hint:'Sample & hold / average', onShift: ()=>dpPromptFxParams('downsample', 'Downsample options'), shiftHint:'edit hold factor/mode' },
      { btn: btnSeg,      label:'Segmentize',  icon:'SEG',fn: fxSegmentizeParam, hint:'Segment averaging/median', onShift: ()=>dpPromptFxParams('segmentize', 'Segmentize options'), shiftHint:'edit segment count/mode' },
      { btn: btnBF5,      label:'BitFlip5',    icon:'b5', fn: fxBitFlip5,   hint:'XOR bit 5' },
      { btn: btnJitter,   label:'Jitter',      icon:'✶',  fn: fxJitter,     hint:'Add small random noise' },
      { btn: btnRandom,   label:'Randomize',   icon:'🎲', fn: fxRandomize,  hint:'Fill with random values' },

      // Phase / time warps
      { btn: btnMirror,   label:'Mirror',      icon:'⫷',  fn: fxMirror,     hint:'Second half mirrors first' },
      { btn: btnPhase,    label:'Phase +90°',  icon:'⟳',  fn: fxPhaseShift, hint:'Rotate by quarter cycle' },
      { btn: btnM90,      label:'Phase −90°',  icon:'⟲',  fn: fxPhaseMinus90,hint:'Rotate by −90°' },
      { btn: btnScramble, label:'Scramble',    icon:'⤮',  fn: fxScrambleParam, hint:'Shuffle segments (seedable)', onShift: ()=>dpPromptFxParams('scramble', 'Scramble options'), shiftHint:'edit segments/seed' },
      { btn: btnSkL,      label:'Skew ←',      icon:'↶',  fn: fxSkewLeft,   hint:'Phase‑warp left' },
      { btn: btnSkR,      label:'Skew →',      icon:'↷',  fn: fxSkewRight,  hint:'Phase‑warp right' },
      { btn: btnPWM,     label:'PWM Warp',    icon:'PWM', fn: fxPWM,       hint:'PWM-style duty warp (zero-cross pivot)' },
      { btn: btnPD,      label:'Phase Dist',  icon:'PD', fn: fxPDWarp,    hint:'Casio-ish phase distortion warp' },

      // Analysis / calculus-y
      { btn: btnHP,       label:'HPass',       icon:'HP', fn: fxHighpass,   hint:'3‑tap high‑pass' },
      { btn: btnSharp,    label:'Sharpen',     icon:'✸',  fn: fxSharpen,    hint:'Unsharp mask' },
      { btn: btnTilt,     label:'Tilt',        icon:'⟋',  fn: fxTilt,       hint:'Linear bias across cycle' },
      { btn: btnMed,      label:'Median',      icon:'MED',fn: fxMedian,     hint:'3‑point median' },
      { btn: btnDiff,     label:'Differentiate',icon:'∂', fn: fxDifferentiate, hint:'Edge emphasis' },
      { btn: btnInt,      label:'Integrate',   icon:'∫',  fn: fxIntegrate,  hint:'Leaky integrator' },
      { btn: btnX2,       label:'×2 Freq',     icon:'×2', fn: fxDoubleFreqParam, hint:'Frequency multiply (replace/layer)', onShift: ()=>dpPromptFxParams('freqMul', '×2 Freq options'), shiftHint:'edit multiplier/layer options' },
      { btn: btnD2,       label:'÷2 Freq',     icon:'÷2', fn: fxHalfFreqParam, hint:'Frequency divide (replace/layer)', onShift: ()=>dpPromptFxParams('freqDiv', '÷2 Freq options'), shiftHint:'edit divisor/layer options' },
      { btn: btnOctLayer, label:'Octave Layer', icon:'Oct', fn: fxOctaveLayerParam, hint:'Layer higher ratio with mix', onShift: ()=>dpPromptFxParams('octaveLayer', 'Octave Layer options'), shiftHint:'edit ratio/mix/phase' },
      { btn: btnSubLayer, label:'Sub Layer',    icon:'Sub', fn: fxSubLayerParam, hint:'Layer lower ratio with mix', onShift: ()=>dpPromptFxParams('subLayer', 'Sub Layer options'), shiftHint:'edit ratio/mix/phase' },
      { btn: btnH3Layer,  label:'3rd Harmonic', icon:'H3',  fn: fxThirdHarmonicLayerParam, hint:'Layer selected harmonic', onShift: ()=>dpPromptFxParams('h3Layer', 'Harmonic Layer options'), shiftHint:'edit harmonic/mix/phase' },
      { btn: btnHBed,     label:'Harmonic Bed', icon:'Bed', fn: fxHarmonicBedParam, hint:'Layer harmonic band with weighting', onShift: ()=>dpPromptFxParams('hBed', 'Harmonic Bed options'), shiftHint:'edit range/weighting/phase' },

      // Symmetry + layering
      { btn: btnOddSy,    label:'Odd Sym',     icon:'±',  fn: fxSymOdd,     hint:'Odd symmetry (inverted)' },
      { btn: btnMorph,    label:'Morph',       icon:'⇄',  fn: fxMorph,      hint:'Blend with CLIP/nearest slot' },
      { btn: btnWaveShape, label:'WaveShape',   icon:'WS', fn: fxWaveShape, hint:'Use CLIP/nearest slot as a transfer curve' },
      { btn: btnPM,       label:'PhaseMod',    icon:'PM', fn: fxPhaseMod, hint:'Use CLIP/nearest slot as a phase modulator' },
      { btn: btnStack,    label:'Stack',       icon:'⊕',  fn: fxStack,      hint:'Layer with CLIP/nearest slot' },

      // FFT-backed sculpting
      { btn: btnLP12,     label:'LP×12 (FFT)', icon:'LP12', fn: fxFFTLowpass12, hint:'Keep first 12 harmonics' },
      { btn: btnHP8,      label:'HP×8 (FFT)',  icon:'HP8',  fn: fxFFTHighpass8, hint:'Remove first 7 harmonics' },
      { btn: btnFFT_Warm, label:'Warm (FFT)',  icon:'♨',  fn: fxFFTWarm,    hint:'Tilt spectrum warmer' },
      { btn: btnFFT_Bright,label:'Bright (FFT)',icon:'☀', fn: fxFFTBright,  hint:'Tilt spectrum brighter' },
      { btn: btnFFT_Odd,  label:'Oddify (FFT)',icon:'OD', fn: fxFFTOdd,     hint:'Keep odd harmonics' },
      { btn: btnFFT_Even, label:'Evenify (FFT)',icon:'EV',fn: fxFFTEven,    hint:'Keep even harmonics' },
      { btn: btnFFT_Form, label:'Formant (FFT)',icon:'F', fn: fxFFTFormantParam, hint:'Formant center/width/amount', onShift: ()=>dpPromptFxParams('fftFormant', 'Formant (FFT) options'), shiftHint:'edit center/width/amount' },
      { btn: btnFFT_Ph,   label:'PhaseRand (FFT)',icon:'φ',fn: fxFFTRandPh, hint:'Randomize harmonic phases' },
      { btn: btnFFT_Shift,label:'HarmShift (FFT)',icon:'⇪',fn: fxFFTShiftParam, hint:'Shift harmonics by N bins', onShift: ()=>dpPromptFxParams('fftShift', 'HarmShift (FFT) options'), shiftHint:'edit bin shift/direction' },
      { btn: btnFFT_Crush,label:'SpecCrush (FFT)',icon:'▣',fn: fxFFTCrushParam, hint:'Keep first N harmonics', onShift: ()=>dpPromptFxParams('fftCrush', 'SpecCrush (FFT) options'), shiftHint:'edit keep count' },
      { btn: btnSmear,   label:'Smear (FFT)',  icon:'SMR', fn: fxSpecSmearParam, hint:'Spectral diffusion amount', onShift: ()=>dpPromptFxParams('specSmear', 'Smear (FFT) options'), shiftHint:'edit amount' },
      { btn: btnFFT_Morph,label:'SpecMorph (FFT)',icon:'≋',fn: fxFFTMorph,  hint:'Morph magnitudes with CLIP/nearest slot' },
      { btn: btnFFT_Magic,label:'FFT Magic',   icon:'✨', fn: fxFFTMagic,   hint:'Tilt + (formant/shift/crush/phase)' },

      // Macro chaos
      { btn: btnChaos,    label:'Chaos',       icon:'✦',  fn: fxChaos,      hint:'Random chain of time‑domain FX' },
    ];

    // Pool used for shift‑click random chain
    const FX_CHAIN_POOL = FX_DEFS.filter(d=>d && d.fn && d.chainable !== false);

    // Wire special random-chain button
    btnFxChain.type = 'button';
    btnFxChain.textContent = '🎲+';
    btnFxChain.title = 'Random FX chain — Apply 5–10 random effects\nClick: apply';
    btnFxChain.onclick = ()=>applyRandomFxChain();

    // Wire + append everything else into the grid
    tools.innerHTML = '';
    for (const d of FX_DEFS){
      if (!d || !d.btn) continue;
      if (d.btn === btnFxChain) { tools.appendChild(d.btn); continue; }
      if (d.fn){
        wireFxSquare(d.btn, d.icon, d.label, d.fn, d.hint, {
          onShift: d.onShift,
          shiftHint: d.shiftHint,
          randomShift: d.randomShift,
        });
      }
      tools.appendChild(d.btn);
    }

    // --------------------------------------------------------------
    // Waveform generators (write directly to active slot(s))
    // --------------------------------------------------------------

    function dpGenFloatCycle(kind, alt){
      const N = 1024;
      const out = new Float32Array(N);
      const TAU = Math.PI * 2;
      const isAlt = !!alt;

      if (kind === 'sine'){
        // Alt: cosine (phase +90°)
        const phase = isAlt ? (TAU * 0.25) : 0;
        for (let i=0;i<N;i++) out[i] = Math.sin((i/N)*TAU + phase);
        return out;
      }

      if (kind === 'tri'){
        for (let i=0;i<N;i++){
          const p = i / N;
          // Triangle in [-1..1], starting at -1
          let v = 1 - 4 * Math.abs(p - 0.5);
          if (isAlt) v = -v; // inverted
          out[i] = v;
        }
        return out;
      }

      if (kind === 'square'){
        for (let i=0;i<N;i++){
          const p = i / N;
          let v = (p < 0.5) ? 1 : -1;
          if (isAlt) v = -v;
          out[i] = v;
        }
        return out;
      }

      if (kind === 'pulse'){
        // Variable-duty pulse (bipolar). Alt: narrower duty.
        const duty = isAlt ? 0.125 : 0.25;
        for (let i=0;i<N;i++){
          const p = i / N;
          const v = (p < duty) ? 1 : -1;
          out[i] = v;
        }
        return out;
      }

      if (kind === 'saw'){
        for (let i=0;i<N;i++){
          const p = i / N;
          let v = (p * 2) - 1;
          if (isAlt) v = -v; // reverse
          out[i] = v;
        }
        return out;
      }

      if (kind === 'exp'){
        // Odd-symmetric exponential curve based on a saw: sign(x)*|x|^gamma
        // Alt: inverse curvature (log-ish)
        const gamma = isAlt ? 0.5 : 2.5;
        for (let i=0;i<N;i++){
          const p = i / N;
          const x = (p * 2) - 1;
          const ax = Math.abs(x);
          let v = Math.pow(ax, gamma);
          if (x < 0) v = -v;
          out[i] = v;
        }
        return out;
      }

      if (kind === 'fm'){
        // Simple phase-modulated sine. Integer ratios keep it perfectly periodic.
        // Alt: harsher ratio/index.
        const ratio = isAlt ? 3 : 2;
        const index = isAlt ? 3.2 : 2.0;
        for (let i=0;i<N;i++){
          const t = (i / N) * TAU;
          out[i] = Math.sin(t + index * Math.sin(t * ratio));
        }
        return out;
      }

      if (kind === 'harm'){
        // Additive harmonic series. Alt: odd harmonics only.
        const maxH = isAlt ? 15 : 10;
        let peak = 1e-9;
        for (let i=0;i<N;i++){
          const t = (i / N) * TAU;
          let y = 0;
          for (let k=1;k<=maxH;k++){
            if (isAlt && (k % 2 === 0)) continue;
            y += Math.sin(t * k) / k;
          }
          out[i] = y;
          const a = Math.abs(y);
          if (a > peak) peak = a;
        }
        // Normalize to [-1..1] so it behaves like the other generators.
        if (peak < 1e-9) peak = 1;
        for (let i=0;i<N;i++) out[i] /= peak;
        return out;
      }

      if (kind === 'step'){
        // Staircase ramp (quantized saw). Alt: more steps.
        const steps = isAlt ? 16 : 8;
        const denom = Math.max(1, steps - 1);
        for (let i=0;i<N;i++){
          const p = i / N;
          const q = Math.floor(p * steps) / denom;
          out[i] = (q * 2) - 1;
        }
        return out;
      }

      if (kind === 'noise'){
        // White noise
        for (let i=0;i<N;i++){
          let v = (Math.random() * 2) - 1;
          if (isAlt) v = -v;
          out[i] = v;
        }
        return out;
      }

      // Fallback: silence
      for (let i=0;i<N;i++) out[i] = 0;
      return out;
    }

    function dpGenPreviewU8FromFloat(floats, N){
      const n = (N|0) > 0 ? (N|0) : 96;
      try{
        return resampleFloatToU8_AA(floats, n, 16);
      }catch(_){
        const out = new Uint8Array(n);
        const M = (floats && floats.length) ? (floats.length|0) : 0;
        for (let i=0;i<n;i++){
          const j = M ? Math.min(M-1, Math.max(0, Math.round((i/n) * M))) : 0;
          const x = (floats && floats[j] !== undefined) ? floats[j] : 0;
          out[i] = clamp(Math.round(128 + x * 127), 0, 255);
        }
        return out;
      }
    }

    function dpGeneratorBaseName(kind, alt){
      if (kind === 'sine')  return alt ? 'COSN' : 'SINE';
      if (kind === 'tri')   return alt ? 'ITRI' : 'TRIA';
      if (kind === 'square')return alt ? 'ISQR' : 'SQRE';
      if (kind === 'pulse') return alt ? 'PULN' : 'PULS';
      if (kind === 'saw')   return alt ? 'DSAW' : 'SAW1';
      if (kind === 'exp')   return alt ? 'IEXP' : 'EXPN';
      if (kind === 'fm')    return alt ? 'FM3X' : 'FM2X';
      if (kind === 'harm')  return alt ? 'ODDH' : 'HARM';
      if (kind === 'step')  return alt ? 'ST16' : 'STEP';
      if (kind === 'noise') return alt ? 'INOI' : 'NOIS';
      return 'WAVE';
    }

    function dpGatherGeneratorTargets(){
      const sel = Array.from(SELECTED).sort((a,b)=>a-b);
      if (sel.length) return sel;
      return [EDIT.slot|0];
    }

    function dpGenerateWaveToTargets(kind, alt){
      if (JOB.running){
        announceIO('A batch job is running — cancel/finish it before generating waves.', true);
        return;
      }
      const targets = dpGatherGeneratorTargets().map(n=>n|0).filter(n=>n>=0 && n<64);
      if (!targets.length){ announceIO('No target slots.', true); return; }

      const used = collectUsedNames();
      const baseName = fileToken4(dpGeneratorBaseName(kind, alt));
      const editorSlot = EDIT.slot|0;

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      let applied = 0;
      let activeTouched = false;

      // Deterministic shapes reuse the same generated cycle; noise gets per-slot randomness.
      const sharedFloat = (kind === 'noise') ? null : dpGenFloatCycle(kind, alt);
      const sharedU8    = (kind === 'noise') ? null : dpGenPreviewU8FromFloat(sharedFloat, 96);

      for (const s of targets){
        const libRec = LIB.waves[s] || null;

        // Preserve existing names where possible (only auto-name empty slots)
        const hasName = !!(libRec && libRec.name && String(libRec.name).trim().length);
        const nm = hasName ? String(libRec.name) : ensureUnique4(baseName, used);

        // Preserve legacy per-wave heat if present; otherwise use editor heat for active slot.
        const heat = (s === editorSlot && typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0)
          ? EDIT._dpHeat
          : ((libRec && typeof libRec._dpHeat === 'number' && isFinite(libRec._dpHeat) && libRec._dpHeat > 0) ? libRec._dpHeat : 1);

        const f = (kind === 'noise') ? dpGenFloatCycle(kind, alt) : new Float32Array(sharedFloat);
        const u8 = (kind === 'noise') ? dpGenPreviewU8FromFloat(f, 96) : new Uint8Array(sharedU8);

        // Generators keep displayRot=0 so the visible phase matches the generator.
        const rec = attachDisplayRot({ name:nm, dataU8:u8, user:true, _srcFloat:f, _dpHeat:heat }, true);

        LIB.waves[s] = rec;
        LIB.userWaves[s] = rec;
        LIB.dirty.delete(s);
        paintGridCell(s);
        applied++;
        if (s === editorSlot) activeTouched = true;
      }

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Gen ${baseName}${alt?' (alt)':''}`, before: __bankBefore, after: __bankAfter });

      if (activeTouched) dpLoadWaveIntoEditor(editorSlot);

      announceIO(`Generated ${baseName} into ${applied}/${targets.length} slot${targets.length===1?'':'s'}.`);
      updateButtonsState();
    }

    function wireGenBtn(btn, icon, title, kind){
      btn.type = 'button';
      btn.textContent = icon;
      btn.setAttribute('aria-label', title);
      btn.title = `${title}\nClick: write into selected slot(s) (or active slot if none)\nShift+Click: alternate/inverse variant`;
      btn.onclick = (ev)=>{
        dpGenerateWaveToTargets(kind, !!(ev && ev.shiftKey));
      };
    }

    // A neat row appended at the bottom of the FX grid.
    // On wide screens the FX grid is 10 columns, so we provide 10 generators here.
    wireGenBtn(btnGenSine,   '∿',  'Generate Sine (Shift: Cosine)', 'sine');
    wireGenBtn(btnGenTri,    '△',  'Generate Triangle (Shift: Invert)', 'tri');
    wireGenBtn(btnGenSquare, '▭',  'Generate Square (Shift: Invert)', 'square');
    wireGenBtn(btnGenSaw,    '⟋',  'Generate Saw (Shift: Reverse)', 'saw');
    wireGenBtn(btnGenExp,    'exp','Generate Exp curve (Shift: Inverse curve)', 'exp');
    wireGenBtn(btnGenNoise,  '░',  'Generate White Noise (Shift: Invert)', 'noise');
    wireGenBtn(btnGenPulse,  '▮',  'Generate Pulse (Shift: Narrower duty)', 'pulse');
    wireGenBtn(btnGenFM,     'FM', 'Generate FM Sine (Shift: Harsher ratio)', 'fm');
    wireGenBtn(btnGenHarm,   'Σ',  'Generate Harmonics (Shift: Odd-only)', 'harm');
    wireGenBtn(btnGenStep,   '≡',  'Generate Steps (Shift: 16 steps)', 'step');

    tools.appendChild(btnGenSine);
    tools.appendChild(btnGenTri);
    tools.appendChild(btnGenSquare);
    tools.appendChild(btnGenSaw);
    tools.appendChild(btnGenExp);
    tools.appendChild(btnGenNoise);
    tools.appendChild(btnGenPulse);
    tools.appendChild(btnGenFM);
    tools.appendChild(btnGenHarm);
    tools.appendChild(btnGenStep);

    // --- Mutate (bank curation) ---

    function dpMixU8(a, b, amt){
      // Linear mix in u8 space (0..255), amt in [0..1]
      const A = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      const B = (b instanceof Uint8Array) ? b : new Uint8Array(b||[]);
      const N = Math.min(A.length|0, B.length|0);
      const t = _clamp01(amt);
      const out = new Uint8Array(N);
      if (!N) return out;
      if (t <= 0){ out.set(A.subarray(0,N)); return out; }
      if (t >= 1){ out.set(B.subarray(0,N)); return out; }
      for (let i=0;i<N;i++) out[i] = clamp(Math.round(A[i]*(1-t) + B[i]*t), 0, 255);
      return out;
    }

    function mutateU8(a, pct){
      const N = a.length|0;
      if (!N) return new Uint8Array(0);
      const p = Math.max(0, Math.min(1, (pct|0) / 100));
      if (p <= 0) return new Uint8Array(a);

      // Phase nudge (up to 25% cycle at 100%)
      const maxShift = Math.max(0, Math.round(N * 0.25 * p));
      const shift = maxShift ? Math.round((Math.random()*2 - 1) * maxShift) : 0;

      // Noise in u8 space (scaled)
      const noiseAmp = 90 * p;               // up to ±90 at 100%
      const smoothPasses = (p < 0.18) ? 0 : (p < 0.45) ? 1 : (p < 0.75) ? 2 : 3;

      // 1) rotate
      let cur = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const j = (i + shift + N) % N;
        cur[j] = a[i];
      }

      // 2) smooth a bit (more as pct increases)
      for (let pass=0; pass<smoothPasses; pass++){
        const tmp = cur.slice();
        for (let i=0;i<N;i++){
          const m = (tmp[(i-1+N)%N] + tmp[i] + tmp[(i+1)%N]) / 3;
          cur[i] = clamp(Math.round(m), 0, 255);
        }
      }

      // 3) optional gentle non-linear at higher pct
      if (p > 0.55 && Math.random() < p){
        try{ cur = fxSoftClip(cur) || cur; }catch(_){}
      } else if (p > 0.70 && Math.random() < (p*0.5)){
        try{ cur = fxFold(cur) || cur; }catch(_){}
      }

      // 4) blend back toward the source (pct controls how far we drift)
      const out = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const base = a[i];
        const target = cur[i];
        let v = base + (target - base) * p;
        v += (Math.random()*2 - 1) * noiseAmp;
        out[i] = clamp(Math.round(v), 0, 255);
      }

      // 5) optional tidy normalize at high pct
      if (p > 0.65 && Math.random() < 0.5){
        try{ return fxNormalize(out) || out; }catch(_){}
      }
      return out;
    }

    function mutateU8Wild(a, pct){
      // Shift‑Mutate: a more chaotic mutation chain.
      // Still linked to the slider amount so small values remain usable.
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      const N = src.length|0;
      if (!N) return new Uint8Array(0);
      const p = _clamp01((pct|0) / 100);
      if (p <= 0) return new Uint8Array(src);

      // Start from a subtle mutate so the result stays "wavetable-ish" at low pct.
      let cur = mutateU8(src, Math.round(p*60));

      // Pick a short random chain; the slider controls how long + how gnarly.
      const steps = 1 + Math.floor(p * 5) + ((Math.random() < p) ? 1 : 0); // 1..7

      const safeCall = (fn, x)=>{
        try{
          const y = fn(x);
          return (y instanceof Uint8Array && y.length) ? y : x;
        }catch(_){
          return x;
        }
      };

      const mild = [
        (x)=>safeCall(fxPhaseShift, x),
        (x)=>safeCall(fxJitter, x),
        (x)=>safeCall(fxSharpen, x),
        (x)=>safeCall(fxHighpass, x),
        (x)=>safeCall((u)=>fxHarmonicBed(u, 0.15 + 0.65*p), x),
        (x)=>safeCall(fxSoftClip, x),
      ];

      const wild = [
        (x)=>safeCall(fxFold, x),
        (x)=>safeCall(fxCrush, x),
        (x)=>safeCall(fxDownsample, x),
        (x)=>safeCall(fxScramble, x),
        (x)=>safeCall(fxMirror, x),
        (x)=>safeCall(fxRingMod, x),
        (x)=>safeCall(fxSpecSmear, x),
        (x)=>safeCall(fxCheby, x),
      ];

      for (let i=0;i<steps;i++){
        const useWild = (Math.random() < (0.20 + 0.75*p));
        const pool = useWild ? wild : mild;
        const op = pool[(Math.random()*pool.length)|0];
        cur = op(cur);
      }

      // Blend back toward the original (pct controls drift). Add a tiny correlated noise.
      let out = dpMixU8(src, cur, Math.min(1, 0.25 + 0.85*p));
      const noiseAmp = 22 * p;
      if (noiseAmp > 0){
        for (let i=0;i<N;i++) out[i] = clamp(Math.round(out[i] + (Math.random()*2-1)*noiseAmp), 0, 255);
      }

      // Always tidy normalize; "wild" operations can easily reduce level.
      out = safeCall(fxNormalize, out);
      return out;
    }

    function gatherMutateTargets(){
      const sel = Array.from(SELECTED).sort((a,b)=>a-b);
      const editorSlot = (EDIT.slot|0);

      if (sel.length){
        // mutate only selected (skip empties unless it is the active dirty editor slot)
        return sel.filter(s=>{
          if (s === editorSlot && EDIT.dataU8 && EDIT.dataU8.length) return true;
          const useEditor = (s === (EDIT.slot|0)) && !!(LIB.dirty && LIB.dirty.has(s));
          const w = useEditor
            ? { name: EDIT.name, dataU8: EDIT.dataU8, user:true }
            : LIB.waves[s];
          return !!(w && w.dataU8 && w.dataU8.length);
        });
      }

      // No selection → mutate all filled slots
      const out = [];
      for (let s=0;s<64;s++){
        const w = LIB.waves[s];
        if (w && w.dataU8 && w.dataU8.length) out.push(s);
      }
      // include active dirty editor slot even if it has no LIB entry yet
      if (!out.includes(editorSlot) && LIB.dirty && LIB.dirty.has(editorSlot) && EDIT.dataU8 && EDIT.dataU8.length){
        out.push(editorSlot);
      }
      return out;
    }

    function doMutateSlots(targets, pct, opts){
      const t = (targets && targets.length) ? Array.from(targets) : [];
      if (!t.length){ announceIO('No waves to mutate.', true); return; }

      const wild = !!(opts && opts.wild);

      const __bankBefore = captureBankState(t, { preferEditor:true });

      const editorSlot = EDIT.slot|0;
      const editorWasName = EDIT.name;
      const editorWasData = EDIT.dataU8;

      let mutated = 0;
      let newActData = null;

      for (const s of t){
        const isActive = (s === editorSlot);
        const base = (isActive && LIB.dirty && LIB.dirty.has(s))
          ? new Uint8Array(EDIT.dataU8)
          : (LIB.waves[s] && LIB.waves[s].dataU8 ? new Uint8Array(LIB.waves[s].dataU8) : null);

        if (!base || !base.length) continue;

        const out = wild ? mutateU8Wild(base, pct) : mutateU8(base, pct);

        const prevName = isActive ? (EDIT.name||'WAVE') : ((LIB.waves[s] && LIB.waves[s].name) ? LIB.waves[s].name : 'WAVE');

        LIB.waves[s] = attachDisplayRot({ name: prevName, dataU8: out, user:true });
        LIB.dirty.delete(s);
        paintGridCell(s);
        mutated++;

        if (isActive){
          newActData = out;
        }
      }

      if (newActData){
        EDIT.dataU8 = new Uint8Array(newActData);
        if (paintEditor) paintEditor();
        if (nameIn) nameIn.value = (EDIT.name||'WAVE');
        LIB.dirty.delete(editorSlot);
      } else {
        // restore editor if we didn't touch it
        EDIT.name = editorWasName;
        EDIT.dataU8 = editorWasData;
      }

      const __bankAfter = captureBankState(t);
      bankPush({ label:`${wild?'Mutate ✨':'Mutate'} (${pct|0}%)`, before: __bankBefore, after: __bankAfter });

      if (newActData) resetUndoToCurrent(true);

      announceIO(`${wild?'Wild‑mutated':'Mutated'} ${mutated}/${t.length} slot${t.length===1?'':'s'} at ${pct|0}%.`);
      updateButtonsState();
    }

    // --- FUSE (creative multi-wave generator) ---
    // Writes a new wave derived from the selection (or the active editor slot if none selected).

    function dpResampleU8ToLen(u8, N){
      const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
      const M = a.length|0;
      if (!N) return new Uint8Array(0);
      if (M === N) return a;
      if (typeof resampleU8_AA === 'function'){
        try{ return resampleU8_AA(a, N, 16); }catch(_){ }
      }
      // fallback: nearest
      const out = new Uint8Array(N);
      const denom = Math.max(1, M);
      for (let i=0;i<N;i++) out[i] = a[Math.floor(i*denom/N)] || 128;
      return out;
    }

    function dpFuseSubtle(u8List, pct){
      const list = Array.isArray(u8List) ? u8List.filter(x=>x && x.length) : [];
      if (!list.length) return new Uint8Array(0);

      // Ensure at least 2 sources (graceful for 1 selected wave).
      const p = _clamp01((pct|0)/100);
      const N = (EDIT && EDIT.dataU8 && EDIT.dataU8.length) ? (EDIT.dataU8.length|0) : (list[0].length|0) || 96;

      let src = list.map(a=>dpResampleU8ToLen(a, N));
      if (src.length === 1){
        // Companion = a gentle harmonic bed so the result still feels "from" the source.
        let comp = src[0];
        try{ comp = fxHarmonicBed(src[0], 0.12 + 0.70*p); }catch(_){ comp = src[0]; }
        src = [src[0], comp];
      }

      const dfts = src.map(a=>dftRealU8(a));
      const N2 = dfts[0].re.length|0;
      const H = N2 >> 1;
      const outRe = new Float32Array(N2);
      const outIm = new Float32Array(N2);

      // Mix between average spectrum and a "best-of" per-harmonic pick.
      // Slider controls how much we lean into the per-harmonic pick.
      const wPick = _clamp01(p * 0.85); // 0..0.85

      for (let k=0;k<N2;k++){
        let avgRe = 0, avgIm = 0;
        let bestJ = 0;
        let bestMag = -Infinity;
        for (let j=0;j<dfts.length;j++){
          const re = dfts[j].re[k];
          const im = dfts[j].im[k];
          avgRe += re;
          avgIm += im;
          const mag = (k===0 || k===H) ? Math.abs(re) : Math.hypot(re, im);
          if (mag > bestMag){ bestMag = mag; bestJ = j; }
        }
        avgRe /= dfts.length;
        avgIm /= dfts.length;
        const pickRe = dfts[bestJ].re[k];
        const pickIm = dfts[bestJ].im[k];

        outRe[k] = avgRe*(1-wPick) + pickRe*wPick;
        outIm[k] = avgIm*(1-wPick) + pickIm*wPick;
      }
      enforceConjugateSym(outRe, outIm);
      let out = idftToU8(outRe, outIm);

      // A tiny soft clip keeps it musical.
      try{ out = fxSoftClip(out) || out; }catch(_){ }
      try{ out = fxNormalize(out) || out; }catch(_){ }
      return out;
    }

    function dpFuseMental(u8List, pct){
      const list = Array.isArray(u8List) ? u8List.filter(x=>x && x.length) : [];
      if (!list.length) return new Uint8Array(0);

      const p = _clamp01((pct|0)/100);
      const N = (EDIT && EDIT.dataU8 && EDIT.dataU8.length) ? (EDIT.dataU8.length|0) : (list[0].length|0) || 96;

      // Build a pool; for single-source, add a few derived variants.
      let src = list.map(a=>dpResampleU8ToLen(a, N));
      if (src.length === 1){
        const a = src[0];
        let b = a, c = a;
        try{ b = fxReverse(a) || a; }catch(_){ b = a; }
        try{ c = fxPhaseShift(a) || a; }catch(_){ c = a; }
        src = [a, b, c];
      }

      const dfts = src.map(a=>dftRealU8(a));
      const N2 = dfts[0].re.length|0;
      const H = N2 >> 1;

      // Average spectrum as a "safe" base.
      const baseRe = new Float32Array(N2);
      const baseIm = new Float32Array(N2);
      for (let k=0;k<N2;k++){
        let ar=0, ai=0;
        for (let j=0;j<dfts.length;j++){
          ar += dfts[j].re[k];
          ai += dfts[j].im[k];
        }
        baseRe[k] = ar / dfts.length;
        baseIm[k] = ai / dfts.length;
      }

      const outRe = new Float32Array(N2);
      const outIm = new Float32Array(N2);
      outRe.set(baseRe);
      outIm.set(baseIm);

      // "Harmonic roulette": chunks of harmonics come from random sources,
      // with optional harmonic index shifts at higher slider values.
      const group = Math.max(1, Math.round(8 - 7*p)); // 8→1 as p goes 0→1
      const pSwap  = _clamp01(0.30 + 0.65*p);
      const shiftR = Math.max(0, Math.round(1 + 6*p));
      const phaseJ = (Math.PI * 0.10) * p;

      for (let k=1;k<H;k++){
        if (Math.random() > pSwap) continue;

        // Choose source(s)
        const jMag = (Math.random()*dfts.length)|0;
        const jPh  = (Math.random()*dfts.length)|0;

        // Optional harmonic shift (kept small to avoid total chaos at low p)
        let ks = k;
        if (shiftR > 0 && Math.random() < (0.15 + 0.55*p)){
          const sh = ((Math.random()*2 - 1) * shiftR) | 0;
          ks = Math.max(1, Math.min(H-1, k + sh));
        }

        const reM = dfts[jMag].re[ks];
        const imM = dfts[jMag].im[ks];
        const mag = Math.hypot(reM, imM);

        const reP = dfts[jPh].re[k];
        const imP = dfts[jPh].im[k];
        let ph = Math.atan2(imP, reP);
        if (phaseJ > 0) ph += (Math.random()*2 - 1) * phaseJ;

        // Paint a small chunk starting at k
        for (let kk=k; kk<Math.min(H, k+group); kk++){
          const w = _clamp01(0.55 + 0.45*p); // how hard we override base
          const pr = mag * Math.cos(ph);
          const pi = mag * Math.sin(ph);
          outRe[kk] = baseRe[kk]*(1-w) + pr*w;
          outIm[kk] = baseIm[kk]*(1-w) + pi*w;
        }
      }

      enforceConjugateSym(outRe, outIm);
      let out = idftToU8(outRe, outIm);

      // Post: a bit of grit + normalization makes the "mental" results land well.
      try{ if (p > 0.25) out = fxCrush(out) || out; }catch(_){ }
      try{ if (p > 0.45) out = fxFold(out) || out; }catch(_){ }
      try{ out = fxNormalize(out) || out; }catch(_){ }
      return out;
    }

    function dpFuseFromSelection(ev){
      const mental = !!(ev && ev.shiftKey);
      const pct = _clampInt(Number(MUTATE_PCT||0), 0, 100);

      const editorSlot = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : 0;

      // Sources: selection if present; otherwise the active editor slot.
      const selSlots = (SELECTED && SELECTED.size)
        ? Array.from(SELECTED).map(n=>n|0).filter(i=>i>=0 && i<64).sort((a,b)=>a-b)
        : [editorSlot];

      const srcSlots = [];
      const srcU8 = [];
      for (const s of selSlots){
        const rec = dpGetSlotWaveRecord(s);
        if (rec && rec.dataU8 && rec.dataU8.length){
          srcSlots.push(s|0);
          srcU8.push(rec.dataU8);
        }
      }

      if (!srcU8.length){
        announceIO('FUSE: no source waves found (select slot(s) with wave data).', true);
        return;
      }

      const maxSrc = Math.max.apply(null, srcSlots);
      let targetSlot = (maxSrc + 1);

      // Graceful: if there is no slot after the last source, try to find an empty slot.
      if (targetSlot < 0 || targetSlot >= 64){
        const srcSet = new Set(srcSlots);
        let found = -1;
        for (let s=0;s<64;s++){
          if (srcSet.has(s)) continue;
          const isDirtyActive = (s === editorSlot) && (LIB.dirty && LIB.dirty.has(s)) && EDIT.dataU8 && EDIT.dataU8.length;
          if (isDirtyActive) continue;
          if (!LIB.waves[s]){ found = s; break; }
        }
        targetSlot = (found >= 0) ? found : (maxSrc|0);
      }

      // Safety: warn before overwriting an existing slot (or unsaved editor buffer).
      const __tRec = LIB.waves[targetSlot] || null;
      const __tHas = !!(__tRec && __tRec.dataU8 && __tRec.dataU8.length);
      const __tDirty = (targetSlot===editorSlot) && (LIB.dirty && LIB.dirty.has && LIB.dirty.has(targetSlot)) && EDIT.dataU8 && EDIT.dataU8.length;
      const __overwritingSource = srcSlots.includes(targetSlot|0);

      if (__tHas || __tDirty || __overwritingSource){
        const __prevName = (__tDirty ? (EDIT && EDIT.name) : (__tRec && __tRec.name)) || 'WAVE';
        const __what = __overwritingSource
          ? 'one of your SOURCE slots'
          : (__tDirty ? 'UNSAVED editor changes' : 'an existing wave');
        const __mode = mental ? 'FUSE (Shift)' : 'FUSE';
        const __ok = confirm(`${__mode} will overwrite slot ${targetSlot+1} (${__prevName}), which currently contains ${__what}. Continue?`);
        if (!__ok) return;
      }

      const out = mental ? dpFuseMental(srcU8, pct) : dpFuseSubtle(srcU8, pct);
      if (!out || !out.length){
        announceIO('FUSE failed (no output).', true);
        return;
      }

      const __bankBefore = captureBankState([targetSlot], { preferEditor:true });

      const num2 = String(targetSlot+1).padStart(2,'0');
      const nm = ('FU' + num2).slice(0,4).padEnd(4,'0');
      LIB.waves[targetSlot] = attachDisplayRot({ name:nm, dataU8: out, user:true });
      LIB.userWaves[targetSlot] = LIB.waves[targetSlot];
      LIB.dirty.delete(targetSlot);
      paintGridCell(targetSlot);

      // If we overwrote the editor's slot, reload it so the waveform updates.
      if ((EDIT.slot|0) === (targetSlot|0)){
        try{ dpLoadWaveIntoEditor(targetSlot|0); }catch(_){ }
      }

      const __bankAfter = captureBankState([targetSlot]);
      bankPush({ label:`${mental?'FUSE ✨':'FUSE'} →${targetSlot+1} (${pct}%)`, before: __bankBefore, after: __bankAfter });

      announceIO(`${mental?'FUSED ✨':'FUSED'} ${srcU8.length} wave${srcU8.length===1?'':'s'} → slot ${targetSlot+1} (${pct}%).`);
      updateButtonsState();
    }

    // --------------------------------------------------------------
    // Batch tools: Normalize (fixed 100%), Gain Trim, Batch rename, Evolve, Blend
    // --------------------------------------------------------------

    function dpListFilledSlotsIncludingDirtyActive(){
      const slots = [];
      const active = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
      for (let s=0;s<64;s++){
        if (LIB.waves[s]) slots.push(s);
        else if (s===active && LIB.dirty.has(s) && EDIT.dataU8) slots.push(s);
      }
      return slots;
    }

    // AMP (gain trim) follows the app-wide batch pattern:
    // - If slots are selected, act on selected slots only (including the dirty active slot if selected).
    // - If nothing is selected, act on all filled slots (plus dirty active slot).
    function dpAmpNormTargets(){
      const selAll = Array.from(SELECTED||[])
        .map(x=>x|0)
        .filter(i=>i>=0 && i<64)
        .sort((a,b)=>a-b);

      if (selAll.length){
        const active = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
        const targets = [];
        for (const s of selAll){
          if (LIB.waves[s]) targets.push(s);
          else if (s===active && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length) targets.push(s);
        }
        return { scope: 'selected', targets };
      }

      return { scope: 'all', targets: dpListFilledSlotsIncludingDirtyActive() };
    }

    function dpResolveAmpTargets(scopeMode){
      const mode = String(scopeMode || 'auto');

      if (mode === 'selected'){
        const selAll = Array.from(SELECTED||[])
          .map(x=>x|0)
          .filter(i=>i>=0 && i<64)
          .sort((a,b)=>a-b);
        if (!selAll.length) return { scope:'selected', targets: [] };

        const active = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
        const targets = [];
        for (const s of selAll){
          if (LIB.waves[s]) targets.push(s);
          else if (s===active && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length) targets.push(s);
        }
        return { scope:'selected', targets };
      }

      if (mode === 'all'){
        return { scope:'all', targets: dpListFilledSlotsIncludingDirtyActive() };
      }

      return dpAmpNormTargets();
    }

    // Normalize (peak-match) is now intentionally *selection-only*.
    // This avoids accidental "normalize the whole bank" operations now that the
    // old target-% slider is gone and the action is always 100%.
    function doNormalizeAllSlots(targetPct){
      const pct = _clampInt(Number(targetPct||0), 0, 100);

      const selAll = Array.from(SELECTED||[])
        .map(x=>x|0)
        .filter(i=>i>=0 && i<64)
        .sort((a,b)=>a-b);

      if (!selAll.length){
        announceIO('Select 1+ slot(s) to normalize.', true);
        return;
      }

      const editorSlot = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
      const targets = [];
      for (const s of selAll){
        if (LIB.waves[s]) targets.push(s);
        else if (s===editorSlot && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length) targets.push(s);
      }

      if (!targets.length){
        announceIO('No selected slots contain wave data to normalize.', true);
        return;
      }

      const __bankBefore = captureBankState(targets, { preferEditor:true });
      let activeTouched = false;

      for (const s of targets){
        const isActive = (s === editorSlot);
        const useEditor = isActive && LIB.dirty.has(s);
        const src = useEditor ? EDIT.dataU8 : (LIB.waves[s] ? LIB.waves[s].dataU8 : null);
        if (!src) continue;

        const out = fxNormalizeTo(src, pct);
        const nm = useEditor ? (EDIT.name||'WAVE') : ((LIB.waves[s] && LIB.waves[s].name) ? LIB.waves[s].name : 'WAVE');

        LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
        LIB.userWaves[s] = LIB.waves[s];
        LIB.dirty.delete(s);
        paintGridCell(s);
        if (isActive) activeTouched = true;
      }

      if (activeTouched) dpLoadWaveIntoEditor(editorSlot);

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Normalize (${pct}%) SEL`, before: __bankBefore, after: __bankAfter });
      if (activeTouched) resetUndoToCurrent(true);

      announceIO(`Normalized ${targets.length} selected slot${targets.length===1?'':'s'} to ${pct}%.`);
      updateButtonsState();
    }

    const AMP_SHIFT_MODES = [
      { id:'trim',      label:'Exact trim', shortLabel:'Trim',      minCount:1, desc:'Apply the same dB trim to every target slot. Good for a single slot or when you want one exact value.' },
      { id:'ramp',      label:'Ramp',       shortLabel:'Ramp',      minCount:2, desc:'Sweep from Low dB to High dB across the target slots in order.' },
      { id:'steps',     label:'Stepped',    shortLabel:'Stepped',   minCount:2, desc:'Quantized ramp from Low dB to High dB. Great for terraced wavetable loudness steps.' },
      { id:'pingpong',  label:'Ping-pong',  shortLabel:'Ping-pong', minCount:3, desc:'Sweep Low -> High -> Low across the target range. Mirrors the musical scan-path used elsewhere.' },
      { id:'alternate', label:'Alt skew',   shortLabel:'Alt skew',  minCount:2, desc:'Alternate around the midpoint between Low/High while increasing depth. A gain version of the Alt skew idea.' },
    ];

    const AMP_SHIFT_MODE_GROUPS = [
      { title:'Precision', items: AMP_SHIFT_MODES.filter(m=>m.id === 'trim') },
      { title:'Series', items: AMP_SHIFT_MODES.filter(m=>m.id !== 'trim') },
    ];

    function dpAmpModeMeta(modeId){
      const id = String(modeId || 'trim');
      return AMP_SHIFT_MODES.find(m=>m && m.id === id) || AMP_SHIFT_MODES[0];
    }

    function dpAmpClampDb(v, fallback){
      const n = Number(v);
      const base = isFinite(n) ? n : Number(fallback||0);
      return Math.max(-24, Math.min(24, base));
    }

    function dpAmpFormatDb(v){
      const db = dpAmpClampDb(v, 0);
      const s = (db > 0) ? '+' : '';
      return `${s}${db.toFixed(1)} dB`;
    }

    function dpAmpApplyCurveUnit(v, curve){
      const x = _clamp01(Number(v||0));
      if (String(curve||'linear') === 'smooth') return x*x*(3 - 2*x);
      return x;
    }

    function dpAmpLerp(lo, hi, t){
      return Number(lo||0) + (Number(hi||0) - Number(lo||0)) * Number(t||0);
    }

    function dpAmpPlanValues(countArg, opts){
      const count = Math.max(0, countArg|0);
      const out = [];
      if (count < 1) return out;

      opts = opts || {};
      const mode = String(opts.mode || 'trim');
      const exactDb = dpAmpClampDb(opts.exactDb, 0);
      const lowDb = dpAmpClampDb(opts.lowDb, 0);
      const highDb = dpAmpClampDb(opts.highDb, 0);
      const curve = (String(opts.curve || 'linear') === 'smooth') ? 'smooth' : 'linear';
      const stepBands = _clampInt(parseInt(opts.steps,10)||4, 2, 12);

      if (mode === 'trim'){
        for (let i=0;i<count;i++) out.push(exactDb);
        return out;
      }

      if (mode === 'alternate'){
        const mid = (lowDb + highDb) * 0.5;
        const halfSpan = (highDb - lowDb) * 0.5;
        const pairs = Math.ceil(count / 2);
        for (let i=0;i<count;i++){
          const pairIdx = Math.floor(i / 2);
          const depthRaw = (pairs <= 1) ? 1 : ((pairIdx + 1) / pairs);
          const depth = dpAmpApplyCurveUnit(depthRaw, curve);
          const sign = (i % 2 === 0) ? 1 : -1;
          out.push(mid + sign * halfSpan * depth);
        }
        return out;
      }

      let weights = [];
      if (mode === 'pingpong'){
        let peak = 0;
        for (let i=0;i<count;i++){
          const u = (count <= 1) ? 0 : (i / Math.max(1, count - 1));
          const tri = 1 - Math.abs(2*u - 1);
          if (tri > peak) peak = tri;
          weights.push(tri);
        }
        if (!(peak > 0)) peak = 1;
        weights = weights.map(v => v / peak);
      } else {
        for (let i=0;i<count;i++){
          const u = (count <= 1) ? 1 : (i / Math.max(1, count - 1));
          weights.push(u);
        }
      }

      for (let i=0;i<count;i++){
        let w = dpAmpApplyCurveUnit(weights[i], curve);
        if (mode === 'steps' && stepBands > 1){
          w = Math.round(w * (stepBands - 1)) / (stepBands - 1);
        }
        out.push(dpAmpLerp(lowDb, highDb, w));
      }

      return out;
    }

    function dpAmpPreviewTargets(scopeMode){
      const resolved = dpResolveAmpTargets(scopeMode);
      const scope = resolved.scope;
      const targets = resolved.targets || [];
      const editorSlot = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
      const slots = [];
      const waves = [];

      for (const s of targets){
        const isActive = (s === editorSlot);
        const useEditor = isActive && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length;
        const src = useEditor ? EDIT.dataU8 : (LIB.waves[s] ? LIB.waves[s].dataU8 : null);
        if (!src || !src.length) continue;
        slots.push(s|0);
        waves.push(src);
      }

      return { scope, slots, waves };
    }

    function dpAmpEstimateClipFlags(waves, dbValues){
      const arr = Array.isArray(waves) ? waves : [];
      const vals = Array.isArray(dbValues) ? dbValues : [];
      const flags = [];
      let clipCount = 0;
      let maxPeakOut = 0;

      for (let i=0;i<arr.length;i++){
        const src = arr[i];
        let peak = 0;
        if (src && src.length){
          for (let j=0;j<src.length;j++){
            const d = Math.abs((src[j]|0) - 128);
            if (d > peak) peak = d;
          }
        }
        const gain = (typeof dbToLinearGain === 'function')
          ? dbToLinearGain(vals[i] || 0)
          : Math.pow(10, Number(vals[i]||0) / 20);
        const outPeak = peak * (isFinite(gain) ? gain : 1);
        const clipped = outPeak > 127.0001;
        flags.push(clipped);
        if (clipped) clipCount++;
        if (outPeak > maxPeakOut) maxPeakOut = outPeak;
      }

      return { flags, clipCount, maxPeakOut };
    }

    function dpAmpSlotsLabel(slots){
      const arr = Array.isArray(slots) ? slots.slice() : [];
      if (!arr.length) return 'none';
      const nums = arr.map(n=>(n|0)+1);
      if (nums.length <= 6) return nums.join(', ');
      return `${nums[0]}..${nums[nums.length-1]}`;
    }

    function dpDrawAmpPlanPreview(canvas, dbValues, clipFlags){
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width = Math.max(240, (canvas.clientWidth|0) || 420);
      const h = canvas.height = 122;
      const padX = 10;
      const padY = 10;
      const innerW = Math.max(1, w - padX*2);
      const innerH = Math.max(1, h - padY*2);
      const zeroY = Math.round(padY + innerH * 0.5);

      const vals = Array.isArray(dbValues) ? dbValues : [];
      const flags = Array.isArray(clipFlags) ? clipFlags : [];

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#10161d';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      const guides = [-24, -12, 0, 12, 24];
      function yForDb(db){
        const norm = (24 - dpAmpClampDb(db, 0)) / 48;
        return Math.round(padY + norm * innerH);
      }
      for (const g of guides){
        const y = yForDb(g);
        ctx.beginPath();
        ctx.moveTo(padX, y + 0.5);
        ctx.lineTo(w - padX, y + 0.5);
        ctx.strokeStyle = (g === 0) ? 'rgba(122,167,255,0.45)' : 'rgba(255,255,255,0.08)';
        ctx.stroke();
      }

      if (!vals.length){
        ctx.fillStyle = 'rgba(230,237,243,0.65)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No preview targets', Math.round(w * 0.5), Math.round(h * 0.5));
        return;
      }

      const count = vals.length;
      for (let i=0;i<count;i++){
        const x0 = Math.floor(padX + (i * innerW / count));
        const x1 = Math.floor(padX + ((i + 1) * innerW / count)) - 1;
        const bw = Math.max(1, x1 - x0 + 1);
        const y = yForDb(vals[i]);
        const top = Math.min(zeroY, y);
        const barH = Math.max(1, Math.abs(y - zeroY));
        const clipped = !!flags[i];
        ctx.fillStyle = clipped
          ? 'rgba(255, 110, 110, 0.90)'
          : ((vals[i] || 0) >= 0)
            ? 'rgba(122, 167, 255, 0.90)'
            : 'rgba(111, 223, 182, 0.90)';
        ctx.fillRect(x0, top, bw, barH);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }

    function doGainSeriesSlots(opts){
      opts = opts || {};
      const modeMeta = dpAmpModeMeta(opts.mode);
      const resolved = dpResolveAmpTargets(opts.scope || 'auto');
      const scope = resolved.scope;
      const targets = resolved.targets || [];

      if (!targets.length){
        announceIO(scope === 'selected'
          ? 'No selected waves to adjust amplitude.'
          : 'No filled slots to adjust amplitude.', true);
        return;
      }

      if (targets.length < modeMeta.minCount){
        announceIO(`${modeMeta.label} needs ${modeMeta.minCount}+ target slot${modeMeta.minCount===1?'':'s'}.`, true);
        return;
      }

      const dbPlan = dpAmpPlanValues(targets.length, opts);
      if (!dbPlan.length){
        announceIO('No AMP gain plan was generated.', true);
        return;
      }

      const __bankBefore = captureBankState(targets, { preferEditor:true });
      const editorSlot = EDIT.slot|0;
      let activeTouched = false;
      let minDb = Infinity;
      let maxDb = -Infinity;
      let applied = 0;

      for (let i=0;i<targets.length;i++){
        const s = targets[i];
        const db = dpAmpClampDb(dbPlan[i], 0);
        const gain = (typeof dbToLinearGain === 'function') ? dbToLinearGain(db) : Math.pow(10, db/20);

        const isActive = (s === editorSlot);
        const useEditor = isActive && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length;
        const libRec = LIB.waves[s] || null;
        const srcU8 = useEditor ? EDIT.dataU8 : (libRec ? libRec.dataU8 : null);
        if (!srcU8 || !srcU8.length) continue;

        let canPreserveExtras = !useEditor;
        if (!canPreserveExtras && libRec && libRec.dataU8 && libRec.dataU8.length === srcU8.length){
          let same = true;
          for (let j=0;j<srcU8.length;j++){
            if (srcU8[j] !== libRec.dataU8[j]){ same = false; break; }
          }
          if (same) canPreserveExtras = true;
        }

        const outU8 = (typeof fxGainDbTo === 'function') ? fxGainDbTo(srcU8, db) : fxGainLinearTo(srcU8, gain*100);
        const nm = useEditor ? (EDIT.name||'WAVE') : ((libRec && libRec.name) ? libRec.name : 'WAVE');
        const heat = useEditor
          ? ((typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1)
          : (libRec ? dpHeatOf(libRec) : 1);

        const rec = { name:nm, dataU8: outU8, user:true, _dpHeat: heat };

        if (canPreserveExtras && libRec){
          if (libRec._srcFloat && libRec._srcFloat.length && typeof applyGainToFloat === 'function'){
            try{ rec._srcFloat = applyGainToFloat(libRec._srcFloat, gain); }catch(_){ }
          }

          if (libRec._tables6132 && libRec._tables6132.t0 && libRec._tables6132.t1 && libRec._tables6132.t2){
            try{
              if (typeof dpApplyHeatToTables === 'function') rec._tables6132 = dpApplyHeatToTables(libRec._tables6132, gain);
              else {
                const _scale = (arr)=>{
                  const a = (arr instanceof Int16Array) ? arr : new Int16Array(arr||[]);
                  const out = new Int16Array(a.length);
                  for (let j=0;j<a.length;j++){
                    let v = Math.round(a[j] * gain);
                    if (v > 32767) v = 32767;
                    else if (v < -32768) v = -32768;
                    out[j] = v;
                  }
                  return out;
                };
                rec._tables6132 = {
                  t0:_scale(libRec._tables6132.t0),
                  t1:_scale(libRec._tables6132.t1),
                  t2:_scale(libRec._tables6132.t2)
                };
              }
            }catch(_){ }
          }
        }

        LIB.waves[s] = attachDisplayRot(rec, false);
        LIB.userWaves[s] = LIB.waves[s];
        LIB.dirty.delete(s);
        paintGridCell(s);
        if (isActive) activeTouched = true;

        if (db < minDb) minDb = db;
        if (db > maxDb) maxDb = db;
        applied++;
      }

      if (!applied){
        announceIO('No target slots contained wave data to adjust.', true);
        return;
      }

      if (activeTouched) dpLoadWaveIntoEditor(editorSlot);

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`AMP ${modeMeta.shortLabel} ${scope === 'selected' ? 'SEL' : 'ALL'}`, before: __bankBefore, after: __bankAfter });
      if (activeTouched) resetUndoToCurrent(true);

      announceIO(`AMP ${modeMeta.shortLabel}: ${applied} slot${applied===1?'':'s'} (${dpAmpFormatDb(minDb)} -> ${dpAmpFormatDb(maxDb)}).`);
      updateButtonsState();
    }

    async function dpPromptAmpShiftOptions(){
      let seedDb = Number(gainAllSlider ? gainAllSlider.value : root.__digiproGainAllDb);
      if (!isFinite(seedDb)) seedDb = 0;

      const ST = root.__digiproAmpShiftState || (root.__digiproAmpShiftState = {
        mode: 'ramp',
        scope: 'auto',
        exactDb: seedDb,
        lowDb: Math.min(0, seedDb),
        highDb: Math.max(0, seedDb),
        curve: 'linear',
        steps: 4,
      });

      ST.mode = dpAmpModeMeta(ST.mode).id;
      ST.scope = (ST.scope === 'selected' || ST.scope === 'all') ? ST.scope : 'auto';
      ST.exactDb = dpAmpClampDb(ST.exactDb, seedDb);
      ST.lowDb = dpAmpClampDb(ST.lowDb, 0);
      ST.highDb = dpAmpClampDb(ST.highDb, 0);
      ST.curve = (String(ST.curve||'linear') === 'smooth') ? 'smooth' : 'linear';
      ST.steps = _clampInt(parseInt(ST.steps,10)||4, 2, 12);

      return await new Promise((resolve)=>{
        const guard = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        guard.appendChild(dlg);

        function close(val){
          try{ guard.remove(); }catch(_){}
          resolve(val || null);
        }

        guard.onclick = (e)=>{ if (e && e.target === guard) close(null); };
        guard.onkeydown = (e)=>{ if (e && e.key === 'Escape') close(null); };
        guard.tabIndex = -1;

        const h = el('h4');
        h.textContent = 'AMP tools';

        const blurb = el('div','mm-small');
        blurb.textContent = 'Design gain across the current AMP target set. Normal AMP uses the row slider; Shift+AMP adds slot-series shapes.';

        const modeUi = dpBuildModeGroups(AMP_SHIFT_MODE_GROUPS, (id)=>{ ST.mode = dpAmpModeMeta(id).id; refresh(); });

        const scopeRow = el('div','mm-digi-io mm-small');
        scopeRow.style.flexWrap = 'wrap';
        const scopeLbl = el('div');
        scopeLbl.textContent = 'Scope:';
        scopeLbl.style.minWidth = '52px';

        function mkScopeBtn(id, label, tip){
          const b = el('button');
          b.textContent = label;
          if (tip) b.title = tip;
          b.onclick = ()=>{ ST.scope = id; refresh(); };
          return b;
        }
        const bScopeAuto = mkScopeBtn('auto', 'Auto', 'Use selected slots if any are selected; otherwise use all filled slots.');
        const bScopeSel  = mkScopeBtn('selected', 'Selected', 'Only selected slots that contain wave data.');
        const bScopeAll  = mkScopeBtn('all', 'All filled', 'All filled slots, plus the dirty active slot when present.');
        scopeRow.append(scopeLbl, bScopeAuto, bScopeSel, bScopeAll);

        function makeDbSliderRow(labelText, getter, setter){
          const row = el('div','mm-amp-slider');
          const lbl = el('div','mm-small');
          lbl.textContent = labelText;
          lbl.style.minWidth = '72px';
          const slider = el('input');
          slider.type = 'range';
          slider.min = '-24';
          slider.max = '24';
          slider.step = '0.5';
          slider.value = String(dpAmpClampDb(getter(), 0));
          const val = el('div','mm-small');
          val.style.minWidth = '68px';
          function sync(){
            const db = dpAmpClampDb(slider.value, getter());
            slider.value = String(db);
            setter(db);
            val.textContent = dpAmpFormatDb(db);
          }
          slider.oninput = ()=>{ sync(); refreshPreview(); };
          slider.onchange = ()=>{ sync(); refreshPreview(); };
          sync();
          row.append(lbl, slider, val);
          return row;
        }

        const exactRow = makeDbSliderRow('Trim', ()=>ST.exactDb, (v)=>{ ST.exactDb = v; });
        const lowRow   = makeDbSliderRow('Low dB', ()=>ST.lowDb, (v)=>{ ST.lowDb = v; });
        const highRow  = makeDbSliderRow('High dB', ()=>ST.highDb, (v)=>{ ST.highDb = v; });

        const curveRow = el('div','mm-digi-io mm-small');
        curveRow.style.marginTop = '6px';
        const curveLbl = el('div');
        curveLbl.textContent = 'Curve:';
        curveLbl.style.minWidth = '52px';
        const bCurveLinear = el('button'); bCurveLinear.textContent = 'Linear'; bCurveLinear.title = 'Even gain change per slot.';
        const bCurveSmooth = el('button'); bCurveSmooth.textContent = 'Smooth'; bCurveSmooth.title = 'Gentler at the ends, stronger in the middle.';
        bCurveLinear.onclick = ()=>{ ST.curve = 'linear'; refresh(); };
        bCurveSmooth.onclick = ()=>{ ST.curve = 'smooth'; refresh(); };
        curveRow.append(curveLbl, bCurveLinear, bCurveSmooth);

        const stepsRow = el('div','mm-amp-slider');
        stepsRow.style.marginTop = '6px';
        const stepsLbl = el('div','mm-small');
        stepsLbl.textContent = 'Bands';
        stepsLbl.style.minWidth = '72px';
        const stepsIn = el('input');
        stepsIn.type = 'range';
        stepsIn.min = '2';
        stepsIn.max = '12';
        stepsIn.step = '1';
        stepsIn.value = String(ST.steps|0);
        const stepsVal = el('div','mm-small');
        stepsVal.style.minWidth = '68px';
        function syncSteps(){
          ST.steps = _clampInt(parseInt(stepsIn.value,10)||4, 2, 12);
          stepsIn.value = String(ST.steps);
          stepsVal.textContent = `${ST.steps}`;
        }
        stepsIn.oninput = ()=>{ syncSteps(); refreshPreview(); };
        stepsIn.onchange = ()=>{ syncSteps(); refreshPreview(); };
        syncSteps();
        stepsRow.append(stepsLbl, stepsIn, stepsVal);

        const note = el('div','mm-small');
        note.className = 'mm-small mm-amp-note';

        const previewWrap = el('div','mm-amp-preview');
        const previewMeta = el('div','mm-amp-preview-meta mm-small');
        const stats = el('div','mm-small');
        const previewInfo = el('div','mm-small');
        const previewCanvas = el('canvas');
        previewWrap.append(previewMeta, previewCanvas);
        previewMeta.append(stats, previewInfo);

        function setActive(btn, on){ btn.classList.toggle('mm-mode-active', !!on); }

        function refreshPreview(){
          const meta = dpAmpModeMeta(ST.mode);
          const prev = dpAmpPreviewTargets(ST.scope);
          const slotCount = prev.slots.length|0;
          const minCount = meta.minCount|0;
          const ready = slotCount >= minCount;
          const dbPlan = ready ? dpAmpPlanValues(slotCount, ST) : [];
          const clip = dpAmpEstimateClipFlags(prev.waves, dbPlan);

          stats.textContent = `Targets: ${slotCount} slot${slotCount===1?'':'s'} (${dpAmpSlotsLabel(prev.slots)})`;

          if (!slotCount){
            previewInfo.textContent = (ST.scope === 'selected')
              ? 'Pick 1+ filled slot(s) first.'
              : 'No filled slots available.';
            note.textContent = 'Nothing to preview yet.';
          } else if (!ready){
            previewInfo.textContent = `${meta.label} needs ${minCount}+ target slots.`;
            note.textContent = (meta.id === 'trim')
              ? 'Exact trim always works for a single slot.'
              : 'Choose Exact trim, add more selected slots, or switch Scope.';
          } else {
            let lo = Infinity, hi = -Infinity;
            for (const db of dbPlan){
              if (db < lo) lo = db;
              if (db > hi) hi = db;
            }
            previewInfo.textContent = `Range: ${dpAmpFormatDb(lo)} -> ${dpAmpFormatDb(hi)} • clip risk: ${clip.clipCount}`;
            if (meta.id === 'alternate'){
              note.textContent = `Alt skew alternates around ${dpAmpFormatDb((ST.lowDb + ST.highDb) * 0.5)} while increasing depth.`;
            } else if (meta.id === 'pingpong'){
              note.textContent = 'Ping-pong mirrors the gain rise back down across the target span.';
            } else if (meta.id === 'steps'){
              note.textContent = `Stepped mode quantizes the ramp into ${ST.steps} gain band${ST.steps===1?'':'s'}.`;
            } else {
              note.textContent = 'Preview bars show planned dB per target slot. Red bars may clip.';
            }
          }

          dpDrawAmpPlanPreview(previewCanvas, dbPlan, clip.flags);
          return { slotCount, minCount };
        }

        function refresh(){
          if (modeUi && typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeUi.btnPairs || [], ST.mode);
          }

          setActive(bScopeAuto, ST.scope === 'auto');
          setActive(bScopeSel,  ST.scope === 'selected');
          setActive(bScopeAll,  ST.scope === 'all');
          setActive(bCurveLinear, ST.curve === 'linear');
          setActive(bCurveSmooth, ST.curve === 'smooth');

          exactRow.style.display = (ST.mode === 'trim') ? 'flex' : 'none';
          lowRow.style.display   = (ST.mode === 'trim') ? 'none' : 'flex';
          highRow.style.display  = (ST.mode === 'trim') ? 'none' : 'flex';
          curveRow.style.display = (ST.mode === 'ramp' || ST.mode === 'steps' || ST.mode === 'pingpong' || ST.mode === 'alternate') ? 'flex' : 'none';
          stepsRow.style.display = (ST.mode === 'steps') ? 'flex' : 'none';

          const prevInfo = refreshPreview();
          btnApply.disabled = !(prevInfo.slotCount >= prevInfo.minCount);
        }

        const footer = el('div','mm-digi-io');
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';

        const btnCancel = el('button');
        btnCancel.textContent = 'Cancel';
        btnCancel.onclick = ()=>close(null);

        const btnApply = el('button');
        btnApply.textContent = 'Apply';
        btnApply.dataset.default = '1';
        btnApply.onclick = ()=>{
          ST.mode = dpAmpModeMeta(ST.mode).id;
          ST.scope = (ST.scope === 'selected' || ST.scope === 'all') ? ST.scope : 'auto';
          ST.exactDb = dpAmpClampDb(ST.exactDb, seedDb);
          ST.lowDb = dpAmpClampDb(ST.lowDb, 0);
          ST.highDb = dpAmpClampDb(ST.highDb, 0);
          ST.curve = (String(ST.curve||'linear') === 'smooth') ? 'smooth' : 'linear';
          ST.steps = _clampInt(parseInt(ST.steps,10)||4, 2, 12);

          close({
            mode: ST.mode,
            scope: ST.scope,
            exactDb: ST.exactDb,
            lowDb: ST.lowDb,
            highDb: ST.highDb,
            curve: ST.curve,
            steps: ST.steps|0,
          });
        };

        footer.append(btnCancel, btnApply);

        dlg.append(h, blurb);
        if (modeUi && modeUi.node) dlg.appendChild(modeUi.node);
        dlg.append(scopeRow, exactRow, lowRow, highRow, curveRow, stepsRow, note, previewWrap, footer);

        document.body.appendChild(guard);
        try{ guard.focus(); }catch(_){ }

        refresh();
      });
    }

    // --------------------------------------------------------------
    // Batch tool (Shift+NORM): Smooth chain playback (phase rotations)
    // --------------------------------------------------------------

    function dpResolveSmoothTargets(scopeMode){
      const mode = String(scopeMode || 'auto');

      if (mode === 'selected'){
        const selAll = Array.from(SELECTED||[])
          .map(x=>x|0)
          .filter(i=>i>=0 && i<64)
          .sort((a,b)=>a-b);
        if (!selAll.length) return { scope:'selected', targets: [] };

        const editorSlot = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
        const targets = [];
        for (const s of selAll){
          if (LIB.waves[s]) targets.push(s);
          else if (s===editorSlot && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length) targets.push(s);
        }
        return { scope:'selected', targets };
      }

      if (mode === 'all'){
        return { scope:'all', targets: dpListFilledSlotsIncludingDirtyActive() };
      }

      // auto
      return dpAmpNormTargets();
    }

    function dpMeasureChainBoundaryStats(waves, loop){
      // waves: Array<Uint8Array|ArrayLike<number>>
      const arr = Array.isArray(waves) ? waves : [];
      const K = arr.length|0;
      if (K < 2) return { max:0, mean:0, count:0, worst:-1 };

      let max = 0, sum = 0, count = 0, worst = -1;
      for (let i=0;i<K-1;i++){
        const a = arr[i], b = arr[i+1];
        if (!a || !b || !a.length || !b.length) continue;
        const d = Math.abs((a[a.length-1]|0) - (b[0]|0));
        sum += d; count++;
        if (d > max){ max = d; worst = i; }
      }
      if (loop){
        const a = arr[K-1], b = arr[0];
        if (a && b && a.length && b.length){
          const d = Math.abs((a[a.length-1]|0) - (b[0]|0));
          sum += d; count++;
          if (d > max){ max = d; worst = K-1; }
        }
      }
      return { max, mean: count ? (sum/count) : 0, count, worst };
    }

    function dpHealStartInPlace(u8, targetVal, len){
      // Mutates u8: pulls the first len samples toward targetVal.
      const a = u8;
      if (!(a instanceof Uint8Array) || !a.length) return;
      const N = a.length|0;
      let L = len|0;
      if (L < 1) return;
      if (L > N) L = N;
      const tgt = targetVal|0;
      if (L === 1){
        a[0] = clamp(tgt, 0, 255);
        return;
      }
      for (let j=0;j<L;j++){
        const t = j/(L-1);
        const v = (tgt*(1-t)) + ((a[j]|0)*t);
        a[j] = clamp(Math.round(v), 0, 255);
      }
    }

    function doSmoothChainSlots(opts){
      // Rotates slot waveforms so adjacent boundaries match better (reduces clicks when scanning).
      // opts:
      //   mode: 'seam' | 'zc' | 'zcseam'
      //   scope: 'auto' | 'selected' | 'all'
      //   loop: boolean (treat chain as cyclic, include last->first)
      //   slopePct: 0..100 (seam-only secondary preference)
      //   healLen: 0..16 (optional micro-ramp at each boundary; edits waveform)
      //   zcBaseline: 'mean' | '128'
      opts = opts || {};
      const mode = String(opts.mode || 'seam'); // seam | zc | zcseam
      const zcBaseline = (opts.zcBaseline === '128') ? '128' : 'mean';
      const loop = !!opts.loop;
      const slopePct = _clampInt(parseInt(opts.slopePct,10)||0, 0, 100);
      const healLen = _clampInt(parseInt(opts.healLen,10)||0, 0, 16);

      const resolved = dpResolveSmoothTargets(opts.scope || 'auto');
      const scope = resolved.scope;
      const targets = resolved.targets || [];
      if (!targets.length){
        announceIO(scope === 'selected'
          ? 'No selected slots contain wave data to smooth.'
          : 'No filled slots to smooth.', true);
        return;
      }

      const editorSlot = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;

      // Gather stable copies
      const slots = [];
      const names = [];
      const waves = [];
      for (const s of targets){
        const isActive = (s === editorSlot);
        const useEditor = isActive && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length;
        const src = useEditor ? EDIT.dataU8 : (LIB.waves[s] ? LIB.waves[s].dataU8 : null);
        if (!src || !src.length) continue;
        const nm = useEditor ? (EDIT.name||'WAVE') : ((LIB.waves[s] && LIB.waves[s].name) ? LIB.waves[s].name : 'WAVE');
        slots.push(s);
        names.push(nm);
        waves.push(new Uint8Array(src));
      }

      if (!waves.length){
        announceIO('No wave data found in the chosen scope.', true);
        return;
      }

      const before = dpMeasureChainBoundaryStats(waves, loop);

      let outWaves = waves.map(w => new Uint8Array(w));

      // 1) Optional: phase-normalize each slot to a good rising ZC.
      if ((mode === 'zc' || mode === 'zcseam') && typeof dpRotateToRisingZC_U8 === 'function'){
        outWaves = outWaves.map(w => dpRotateToRisingZC_U8(w, { baseline: zcBaseline }));
      }

      // 2) Optional: seam match as a chain (DP).
      if ((mode === 'seam' || mode === 'zcseam') && typeof dpSeamMatchRotationsU8 === 'function' && typeof dpRotateU8 === 'function'){
        const rots = dpSeamMatchRotationsU8(outWaves, { loop, slope: slopePct/100 });
        if (rots && rots.length){
          for (let i=0;i<outWaves.length;i++){
            outWaves[i] = dpRotateU8(outWaves[i], rots[i]|0);
          }
        }
      }

      // 3) Optional: heal any remaining step by nudging the start of each slot toward the previous end.
      // This is more invasive than rotation (it edits sample values), so default is off.
      if (healLen > 0 && outWaves.length > 1){
        for (let i=1;i<outWaves.length;i++){
          const prev = outWaves[i-1];
          const cur  = outWaves[i];
          if (!prev || !cur || !prev.length || !cur.length) continue;
          dpHealStartInPlace(cur, prev[prev.length-1]|0, healLen);
        }
        if (loop){
          const last = outWaves[outWaves.length-1];
          const first = outWaves[0];
          if (last && first && last.length && first.length){
            dpHealStartInPlace(first, last[last.length-1]|0, healLen);
          }
        }
      }

      const after = dpMeasureChainBoundaryStats(outWaves, loop);

      // Commit (destructive u8 edit, same policy as other FX: drop high-res caches)
      const __bankBefore = captureBankState(slots, { preferEditor:true });
      let activeTouched = false;

      for (let i=0;i<slots.length;i++){
        const s = slots[i];
        const isActive = (s === editorSlot);
        const nm = names[i] || ((LIB.waves[s] && LIB.waves[s].name) ? LIB.waves[s].name : 'WAVE');
        const out = outWaves[i];
        if (!out || !out.length) continue;

        LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
        LIB.userWaves[s] = LIB.waves[s];
        LIB.dirty.delete(s);
        paintGridCell(s);
        if (isActive) activeTouched = true;
      }

      if (activeTouched) dpLoadWaveIntoEditor(editorSlot);

      const __bankAfter = captureBankState(slots);
      const labelMode = (mode === 'zc') ? 'Rotate→ZC' : (mode === 'zcseam' ? 'ZC→Seam' : 'Seam match');
      const labelScope = (scope === 'selected') ? 'SEL' : 'ALL';
      bankPush({ label:`Smooth (${labelMode}) ${labelScope}`, before: __bankBefore, after: __bankAfter });
      if (activeTouched) resetUndoToCurrent(true);

      announceIO(`${labelMode}: ${slots.length} slot${slots.length===1?'':'s'} • max step ${before.max|0}→${after.max|0} • avg ${before.mean.toFixed(1)}→${after.mean.toFixed(1)}${loop?' (loop)':''}.`);
      updateButtonsState();
    }

    async function dpPromptSmoothChainOptions(){
      // Bespoke popup: pick seam match / rotate-to-ZC / hybrid and scope.
      const ST = root.__digiproSmoothChainState || (root.__digiproSmoothChainState = {
        mode: 'seam',       // seam | zc | zcseam
        scope: 'auto',      // auto | selected | all
        loop: true,         // include last->first
        slopePct: 0,        // 0..100
        healLen: 0,         // 0..16
        zcBaseline: 'mean', // mean | 128
      });

      // Clamp persisted values
      ST.mode = (ST.mode === 'zc' || ST.mode === 'zcseam') ? ST.mode : 'seam';
      ST.scope = (ST.scope === 'selected' || ST.scope === 'all') ? ST.scope : 'auto';
      ST.loop = !!ST.loop;
      ST.slopePct = _clampInt(parseInt(ST.slopePct,10)||0, 0, 100);
      ST.healLen  = _clampInt(parseInt(ST.healLen,10)||0, 0, 16);
      ST.zcBaseline = (ST.zcBaseline === '128') ? '128' : 'mean';

      return await new Promise((resolve)=>{
        const guard = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        guard.appendChild(dlg);

        function close(val){
          try{ guard.remove(); }catch(_){}
          resolve(val || null);
        }

        guard.onclick = (e)=>{ if (e && e.target === guard) close(null); };
        guard.onkeydown = (e)=>{ if (e && e.key === 'Escape') close(null); };
        guard.tabIndex = -1;

        const h = el('h4');
        h.textContent = 'Smooth chain playback';

        const blurb = el('div','mm-small');
        blurb.textContent = 'Reduces clicks when scanning/playing slots in sequence by rotating (phase-shifting) each slot. Rotation preserves waveform shape.';

        // --- Method mode buttons ---
        const smoothModes = [{
          title: 'Method',
          items: [
            { id:'seam',   label:'Seam match',  desc:'Rotate each slot so boundaries between adjacent slots have minimal jump (best for clickless scanning).' },
            { id:'zc',     label:'Rotate→ZC',   desc:'Rotate each slot so sample 0 starts at the best rising zero-cross (phase normalize). Not guaranteed clickless if waves differ a lot.' },
            { id:'zcseam', label:'ZC→Seam',     desc:'First phase-normalize each slot (Rotate→ZC), then seam match as a chain.' },
          ]
        }];

        const modeUi = dpBuildModeGroups(smoothModes, (id)=>{ ST.mode = String(id||'seam'); refresh(); });

        // --- Scope buttons ---
        const scopeRow = el('div','mm-digi-io mm-small');
        scopeRow.style.flexWrap = 'wrap';
        const scopeLbl = el('div');
        scopeLbl.textContent = 'Scope:';
        scopeLbl.style.minWidth = '52px';

        function mkScopeBtn(id, label, tip){
          const b = el('button');
          b.textContent = label;
          if (tip) b.title = tip;
          b.onclick = ()=>{ ST.scope = id; refresh(); };
          return b;
        }
        const bScopeAuto = mkScopeBtn('auto', 'Auto', 'Use selected slots if any are selected; otherwise use all filled slots.');
        const bScopeSel  = mkScopeBtn('selected', 'Selected', 'Only selected slots (must select 1+).');
        const bScopeAll  = mkScopeBtn('all', 'All filled', 'All filled slots (plus the dirty active slot if present).');

        scopeRow.append(scopeLbl, bScopeAuto, bScopeSel, bScopeAll);

        // --- Options ---
        const optWrap = el('div');
        optWrap.style.marginTop = '10px';

        // Chain loop
        const loopRow = el('label','mm-small');
        loopRow.style.display = 'flex';
        loopRow.style.alignItems = 'center';
        loopRow.style.gap = '8px';
        const loopChk = el('input'); loopChk.type = 'checkbox'; loopChk.checked = !!ST.loop;
        const loopTxt = el('span'); loopTxt.textContent = 'Loop-safe (match last→first)';
        loopRow.title = 'Treat the chain as cyclic and also minimize the boundary between the last and first slot.';
        loopRow.append(loopChk, loopTxt);
        loopChk.onchange = ()=>{ ST.loop = !!loopChk.checked; refreshStats(); };

        // Slope weight (seam modes)
        const slopeRow = el('div','mm-range');
        slopeRow.style.marginTop = '6px';
        const slopeLbl = el('div','mm-small'); slopeLbl.textContent = 'Slope match:';
        const slopeIn = el('input');
        slopeIn.type = 'range';
        slopeIn.min = '0';
        slopeIn.max = '100';
        slopeIn.step = '1';
        slopeIn.style.width = '180px';
        slopeIn.value = String(ST.slopePct|0);
        const slopeVal = el('div','mm-small');
        slopeVal.style.minWidth = '60px';
        function updateSlope(){
          ST.slopePct = _clampInt(parseInt(slopeIn.value,10)||0, 0, 100);
          slopeIn.value = String(ST.slopePct);
          slopeVal.textContent = `${ST.slopePct}%`;
        }
        slopeIn.oninput = ()=>{ updateSlope(); };
        slopeIn.onchange = ()=>{ updateSlope(); };
        updateSlope();
        slopeRow.append(slopeLbl, slopeIn, slopeVal);

        // Heal length
        const healRow = el('div','mm-range');
        healRow.style.marginTop = '6px';
        const healLbl = el('div','mm-small'); healLbl.textContent = 'Heal step:';
        const healIn = el('input');
        healIn.type = 'range';
        healIn.min = '0';
        healIn.max = '16';
        healIn.step = '1';
        healIn.style.width = '180px';
        healIn.value = String(ST.healLen|0);
        const healVal = el('div','mm-small');
        healVal.style.minWidth = '60px';
        function updateHeal(){
          ST.healLen = _clampInt(parseInt(healIn.value,10)||0, 0, 16);
          healIn.value = String(ST.healLen);
          healVal.textContent = ST.healLen ? `${ST.healLen} smp` : 'Off';
        }
        healIn.oninput = ()=>{ updateHeal(); };
        healIn.onchange = ()=>{ updateHeal(); refreshStats(); };
        updateHeal();
        healRow.title = 'Optional micro-ramp applied to the start of each slot to remove any remaining step. This edits sample values (rotation-only methods do not).';
        healRow.append(healLbl, healIn, healVal);

        // ZC baseline
        const zcRow = el('div','mm-digi-io mm-small');
        zcRow.style.marginTop = '6px';
        zcRow.style.flexWrap = 'wrap';
        const zcLbl = el('div');
        zcLbl.textContent = 'ZC baseline:';
        zcLbl.style.minWidth = '80px';
        const bZcMean = el('button'); bZcMean.textContent = 'Mean'; bZcMean.title = 'Use the wave mean as the midline (more robust if there is DC offset).';
        const bZc128  = el('button'); bZc128.textContent  = '128';  bZc128.title  = 'Use literal 8-bit center 128 as the midline.';
        bZcMean.onclick = ()=>{ ST.zcBaseline = 'mean'; refresh(); };
        bZc128.onclick  = ()=>{ ST.zcBaseline = '128'; refresh(); };
        zcRow.append(zcLbl, bZcMean, bZc128);

        optWrap.append(loopRow, slopeRow, healRow, zcRow);

        // --- Stats ---
        const stats = el('div','mm-small');
        stats.style.marginTop = '10px';
        stats.style.opacity = '0.9';

        function setActive(btn, on){ btn.classList.toggle('mm-mode-active', !!on); }

        function getPreviewWaves(){
          const resolved = dpResolveSmoothTargets(ST.scope);
          const scope = resolved.scope;
          const targets = resolved.targets || [];
          const editorSlot = (EDIT && typeof EDIT.slot==='number') ? (EDIT.slot|0) : 0;
          const waves = [];
          let count = 0;
          for (const s of targets){
            const isActive = (s === editorSlot);
            const useEditor = isActive && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length;
            const src = useEditor ? EDIT.dataU8 : (LIB.waves[s] ? LIB.waves[s].dataU8 : null);
            if (src && src.length){ waves.push(src); count++; }
          }
          return { scope, count, waves };
        }

        function refreshStats(){
          const prev = getPreviewWaves();
          if (prev.count < 1){
            stats.textContent = (ST.scope === 'selected')
              ? 'Targets: 0 (select 1+ slot(s))'
              : 'Targets: 0';
            return;
          }
          const st = dpMeasureChainBoundaryStats(prev.waves, !!ST.loop);
          stats.textContent = `Targets: ${prev.count} • current max step ${st.max|0} • avg ${st.mean.toFixed(1)}${ST.loop?' (loop)':''}`;
        }

        function refresh(){
          // Mode group highlight
          if (modeUi && typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeUi.btnPairs || [], ST.mode);
          }

          setActive(bScopeAuto, ST.scope === 'auto');
          setActive(bScopeSel,  ST.scope === 'selected');
          setActive(bScopeAll,  ST.scope === 'all');

          setActive(bZcMean, ST.zcBaseline === 'mean');
          setActive(bZc128,  ST.zcBaseline === '128');

          // Enable/disable option rows depending on mode
          const seamMode = (ST.mode === 'seam' || ST.mode === 'zcseam');
          const zcMode   = (ST.mode === 'zc'   || ST.mode === 'zcseam');

          loopRow.style.display  = seamMode ? 'flex' : 'none';
          slopeRow.style.display = seamMode ? 'flex' : 'none';
          zcRow.style.display    = zcMode   ? 'flex' : 'none';

          refreshStats();
        }

        // Footer buttons
        const footer = el('div','mm-digi-io');
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';

        const btnCancel = el('button'); btnCancel.textContent = 'Cancel';
        btnCancel.onclick = ()=>close(null);

        const btnApply = el('button'); btnApply.textContent = 'Apply';
        // Keyboard: Enter should trigger the primary action.
        btnApply.dataset.default = '1';
        btnApply.onclick = ()=>{
          // Persist state + return snapshot
          ST.mode = String(ST.mode||'seam');
          ST.scope = String(ST.scope||'auto');
          ST.loop = !!ST.loop;
          ST.slopePct = _clampInt(parseInt(ST.slopePct,10)||0, 0, 100);
          ST.healLen  = _clampInt(parseInt(ST.healLen,10)||0, 0, 16);
          ST.zcBaseline = (ST.zcBaseline === '128') ? '128' : 'mean';

          close({
            mode: ST.mode,
            scope: ST.scope,
            loop: !!ST.loop,
            slopePct: ST.slopePct|0,
            healLen: ST.healLen|0,
            zcBaseline: ST.zcBaseline,
          });
        };

        footer.append(btnCancel, btnApply);

        dlg.append(h, blurb);
        if (modeUi && modeUi.node) dlg.appendChild(modeUi.node);
        dlg.append(scopeRow, optWrap, stats, footer);

        document.body.appendChild(guard);
        try{ guard.focus(); }catch(_){}

        refresh();
      });
    }



    function doGainAllSlots(dbArg){
      // Gain trim applied to selected slots (if any) or to all filled slots (plus dirty active slot).
      // IMPORTANT: this is a pure multiply by a constant gain factor applied to every slot.
      //  - No per-slot normalization / peak matching
      //  - Preserve relative dynamics between slots
      //  - dB -> linear: gain = 10^(dB/20)

      const db = Number(dbArg);
      if (!isFinite(db)){
        announceIO('Invalid gain value (dB).', true);
        return;
      }

      const gain = (typeof dbToLinearGain === 'function') ? dbToLinearGain(db) : Math.pow(10, db/20);
      if (!isFinite(gain) || gain < 0){
        announceIO('Invalid gain factor.', true);
        return;
      }

      const { scope, targets } = dpAmpNormTargets();
      if (!targets.length){
        announceIO(scope === 'selected' ? 'No selected waves to adjust amplitude.' : 'No filled slots to adjust amplitude.', true);
        return;
      }

      const __bankBefore = captureBankState(targets);

      const editorSlot = EDIT.slot|0;

      let activeTouched = false;
      for (const s of targets){
        const isActive = (s === editorSlot);
        const useEditor = isActive && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length;
        const libRec = LIB.waves[s] || null;
        const srcU8 = useEditor ? EDIT.dataU8 : (libRec ? libRec.dataU8 : null);
        if (!srcU8 || !srcU8.length) continue;

        // If the active slot is dirty only due to metadata (e.g. rename), EDIT.dataU8 may still
        // match the library copy exactly. In that case we can safely preserve & scale fidelity-
        // critical sources (like _srcFloat / _tables6132) rather than dropping them.
        let canPreserveExtras = !useEditor;
        if (!canPreserveExtras && libRec && libRec.dataU8 && libRec.dataU8.length === srcU8.length){
          let same = true;
          for (let i=0;i<srcU8.length;i++){
            if (srcU8[i] !== libRec.dataU8[i]){ same = false; break; }
          }
          if (same) canPreserveExtras = true;
        }

        // Apply dB gain to the actual slot samples.
        const outU8 = (typeof fxGainDbTo === 'function') ? fxGainDbTo(srcU8, db) : fxGainLinearTo(srcU8, gain*100);

        const nm = useEditor ? (EDIT.name||'WAVE') : ((libRec && libRec.name) ? libRec.name : 'WAVE');
        const heat = useEditor
          ? ((typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1)
          : (libRec ? dpHeatOf(libRec) : 1);

        // Preserve fidelity-critical sources where possible:
        // - If a slot has a high-res float source (_srcFloat), scale it too so DP export/upload paths match the preview.
        // - If a slot has authoritative DigiPRO tables (_tables6132) (from SysEx/device), scale them too.
        //   (We intentionally drop derived caches like _tables6132_clip/_tables6132_norm so they'll be regenerated.)
        const rec = { name:nm, dataU8: outU8, user:true, _dpHeat: heat };

        if (canPreserveExtras && libRec){
          // High-res source float (used by DP table rendering / packed export) - keep and scale.
          if (libRec._srcFloat && libRec._srcFloat.length && typeof applyGainToFloat === 'function'){
            try{ rec._srcFloat = applyGainToFloat(libRec._srcFloat, gain); }catch(_){ /* ignore */ }
          }

          // Authoritative DigiPRO tables when present (SysEx/device imports).
          if (libRec._tables6132 && libRec._tables6132.t0 && libRec._tables6132.t1 && libRec._tables6132.t2){
            try{
              if (typeof dpApplyHeatToTables === 'function') rec._tables6132 = dpApplyHeatToTables(libRec._tables6132, gain);
              else {
                // Fallback: scale int16 tables directly.
                const _scale = (arr)=>{
                  const a = (arr instanceof Int16Array) ? arr : new Int16Array(arr||[]);
                  const out = new Int16Array(a.length);
                  for (let i=0;i<a.length;i++){
                    let v = Math.round(a[i] * gain);
                    if (v > 32767) v = 32767;
                    else if (v < -32768) v = -32768;
                    out[i] = v;
                  }
                  return out;
                };
                rec._tables6132 = { t0:_scale(libRec._tables6132.t0), t1:_scale(libRec._tables6132.t1), t2:_scale(libRec._tables6132.t2) };
              }
            }catch(_){ /* ignore */ }
          }
        }

        LIB.waves[s] = attachDisplayRot(rec, false);
        LIB.userWaves[s] = LIB.waves[s];
        LIB.dirty.delete(s);
        paintGridCell(s);
        if (isActive) activeTouched = true;
      }

      if (activeTouched) dpLoadWaveIntoEditor(editorSlot);

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Gain (${db} dB) ${scope === 'selected' ? 'SEL' : 'ALL'}`, before: __bankBefore, after: __bankAfter });
      if (activeTouched) resetUndoToCurrent(true);

      announceIO(`Applied ${db} dB gain (x${(gain||0).toFixed(3)}) to ${targets.length} ${scope === 'selected' ? 'selected ' : ''}slot${targets.length===1?'':'s'}.`);
      updateButtonsState();
    }





    function dpPromptBatchName(){
      return new Promise((resolve)=>{
        const state = root.__digiproBatchNameState || (root.__digiproBatchNameState = {
          scope: (SELECTED && SELECTED.size) ? 'selected' : 'filled',
          source: 'slot',
          placement: 'suffix',
          digits: 2,
          tag: 'WA',
        });
        // sanitize
        if (![2,3].includes(state.digits)) state.digits = 2;
        if (!['suffix','prefix'].includes(state.placement)) state.placement = 'suffix';
        if (!['slot','order'].includes(state.source)) state.source = 'slot';
        if (!['filled','selected'].includes(state.scope)) state.scope = (SELECTED && SELECTED.size) ? 'selected' : 'filled';

        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        const h = el('h4'); h.textContent = 'Batch name slots';
        const p = el('div'); p.className = 'mm-small';
        p.textContent = 'DigiPRO names are 4 characters. Choose a tag + numbering scheme. Example: WA01 or 001A.';

        const rowScope = el('div'); rowScope.className='mm-digi-io mm-small';
        const bFilled = el('button'); bFilled.textContent='Filled';
        const bSel = el('button'); bSel.textContent='Selected';
        if (!(SELECTED && SELECTED.size)) bSel.disabled = true;

        const rowDigits = el('div'); rowDigits.className='mm-digi-io mm-small';
        const bD2 = el('button'); bD2.textContent='AA##';
        const bD3 = el('button'); bD3.textContent='A###';

        const rowPlace = el('div'); rowPlace.className='mm-digi-io mm-small';
        const bSuffix = el('button'); bSuffix.textContent='Tag+Num';
        const bPrefix = el('button'); bPrefix.textContent='Num+Tag';

        const rowSrc = el('div'); rowSrc.className='mm-digi-io mm-small';
        const bSlot = el('button'); bSlot.textContent='Slot #';
        const bOrder = el('button'); bOrder.textContent='Order';

        const rowTag = el('div'); rowTag.className='mm-digi-io mm-small';
        const tagIn = el('input');
        tagIn.type='text';
        tagIn.maxLength = 8;
        tagIn.placeholder = (state.digits===2 ? 'WA' : 'W');
        tagIn.value = String(state.tag||'');
        tagIn.style.width = '5.5em';
        const tagLbl = el('span'); tagLbl.textContent='Tag:';
        rowTag.append(tagLbl, tagIn);

        const preview = el('div'); preview.className='mm-small';

        const rowBtns = el('div'); rowBtns.className='mm-digi-io mm-small';
        const bApply = el('button'); bApply.textContent='Apply';
        // Keyboard: Enter should trigger the primary action.
        bApply.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent='Cancel'; bCancel.title='Close without changing mode.'; bCancel.title='Close without changing anything.';
        rowBtns.append(bApply, bCancel);

        function setActive(btn, on){
          btn.classList.toggle('mm-mode-active', !!on);
        }

        function refresh(){
          setActive(bFilled, state.scope==='filled');
          setActive(bSel, state.scope==='selected');
          setActive(bD2, state.digits===2);
          setActive(bD3, state.digits===3);
          setActive(bSuffix, state.placement==='suffix');
          setActive(bPrefix, state.placement==='prefix');
          setActive(bSlot, state.source==='slot');
          setActive(bOrder, state.source==='order');
          // preview using slot 1
          const digits = state.digits;
          const numStr = String(1).padStart(digits,'0');
          const nm = dpMake4Name(tagIn.value, numStr, (state.placement==='prefix')?'prefix':'suffix');
          preview.textContent = `Preview: ${nm} (slot-aware import works with AB01 / A001 / 01AB / 001A patterns)`;
        }

        bFilled.onclick = ()=>{ state.scope='filled'; refresh(); };
        bSel.onclick = ()=>{ if (SELECTED && SELECTED.size){ state.scope='selected'; refresh(); } };
        bD2.onclick = ()=>{ state.digits=2; refresh(); };
        bD3.onclick = ()=>{ state.digits=3; refresh(); };
        bSuffix.onclick = ()=>{ state.placement='suffix'; refresh(); };
        bPrefix.onclick = ()=>{ state.placement='prefix'; refresh(); };
        bSlot.onclick = ()=>{ state.source='slot'; refresh(); };
        bOrder.onclick = ()=>{ state.source='order'; refresh(); };
        tagIn.oninput = ()=>{ refresh(); };

        bCancel.onclick = ()=>{ overlay.remove(); resolve(null); };
        bApply.onclick = ()=>{
          state.tag = String(tagIn.value||'');
          overlay.remove();
          resolve({
            scope: state.scope,
            source: state.source,
            placement: state.placement,
            digits: state.digits,
            tag: state.tag,
          });
        };

        rowScope.append(bFilled, bSel);
        rowDigits.append(bD2, bD3);
        rowPlace.append(bSuffix, bPrefix);
        rowSrc.append(bSlot, bOrder);

        dlg.append(h, p, el('hr'), rowScope, rowDigits, rowPlace, rowSrc, rowTag, preview, el('hr'), rowBtns);
        overlay.append(dlg);
        document.body.append(overlay);
        refresh();
      });
    }

    function doBatchRenameSlots(opts){
      if (!opts) return;
      const scope = opts.scope;
      const digits = (opts.digits===3) ? 3 : 2;
      const placement = (opts.placement==='prefix') ? 'prefix' : 'suffix';
      const source = (opts.source==='order') ? 'order' : 'slot';

      let slots = [];
      if (scope === 'selected' && SELECTED && SELECTED.size){
        slots = Array.from(SELECTED).sort((a,b)=>a-b);
      } else {
        for (let s=0;s<64;s++) if (LIB.waves[s]) slots.push(s);
      }

      slots = slots.filter(s=>!!LIB.waves[s]);

      if (!slots.length){
        announceIO('No target slots with waves to rename.', true);
        return;
      }

      const __bankBefore = captureBankState(slots);

      let renamed = 0;
      for (let i=0;i<slots.length;i++){
        const s = slots[i];
        const num = (source === 'slot') ? (s+1) : (i+1);
        const numStr = String(num).padStart(digits, '0');
        const nm = dpMake4Name(opts.tag, numStr, placement);

        const prev = LIB.waves[s];
        if (!prev) continue;
        const w = attachDisplayRot(Object.assign({}, prev, { name:nm, user:true }));
        LIB.waves[s] = w;
        LIB.userWaves[s] = w;
        paintGridCell(s);
        renamed++;

        if (s === (EDIT.slot|0)){
          EDIT.name = nm;
          if (nameIn) nameIn.value = nm;
        }
      }

      const __bankAfter = captureBankState(slots);
      bankPush({ label:`Batch Rename (${placement==='prefix'?'Num+Tag':'Tag+Num'})`, before:__bankBefore, after:__bankAfter });
      announceIO(`Renamed ${renamed} slot${renamed===1?'':'s'}.`);
      updateButtonsState();
    }

    const EVOLVE_RECIPES = [
      // NOTE: Keep this list flat (no new panels). Categories are via comments only.
      //
      // Some recipes declare `altSkew:true`. This enables the “Alt skew” scan-path,
      // which alternates direction each slot (±) while increasing intensity.
      // --- Spectral / harmonic / macro blends ---
      { id:'smoothfold',  label:'Smooth → Fold',            desc:'Progressively smooths the seed, then blends into wavefold + soft‑clip for a smoother→richer timbre.' },
      { id:'spectral',    altSkew:true, label:'Spectral Sweep',           desc:'Spectral tilt + harmonic “crush” that evolves across the series (brightness/lo‑fi detail changes).' },
      { id:'specsmear',   label:'Spectral Diffusion',      desc:'Gradually smears/blur magnitudes across neighboring harmonics while keeping phase mostly stable (buzzy → smoother/organ‑like).' },
      { id:'combform',    altSkew:true, label:'Comb-Formant Weave',       desc:'Sweeps a moving harmonic comb with a drifting formant bump for animated notches/peaks (vocal + metallic motion).' },
      { id:'oddeven',     label:'Odd ↔ Even Harmonics',     desc:'Crossfades harmonic emphasis between odd vs even partials (hollow ↔ buzzy character).' },
      { id:'amsweep',     label:'AM Sweep (→ rate)',        desc:'Applies amplitude modulation with sweeping mod rate + depth (adds motion + edge/saturation).' },
      { id:'unison',      label:'Octave Unison (2/3/4)',    desc:'Adds a pitched‑up unison layer (+2→+3→+4 oct) with gentle roll‑off and saturation (bright “WHI” vibe).' },

      // --- Wave / phase-domain bending (time-axis) ---
      { id:'pwm',         altSkew:true, label:'PWM Scan (zero-cross)',    desc:'Phase‑warps the cycle around a mid zero‑crossing to mimic PWM duty‑cycle scanning. Neutral is near t≈0.5; one‑way Evolve uses 0.5→1.0 to stay monotonic.' },
      { id:'phaseshift',       altSkew:true, label:'Phase Shift (clean)',      desc:'Pure circular phase rotation across the table. Preserves waveform shape (only phase offset changes).' },
      { id:'phaseshift_plus',  altSkew:true, label:'Phase Shift + Drift',      desc:'Phase rotation plus gentle phase-warp drift and subtle spectral tilt for extra movement while staying phase-led.' },
      { id:'phase_dispersion', altSkew:true, label:'Phase Dispersion',         desc:'Applies a frequency-dependent harmonic phase curve (magnitude stays intact) for glassy/plucky spectral spread.' },
      { id:'band_phase_rotate',altSkew:true, label:'Band Phase Rotate',        desc:'Rotates low/mid/high harmonic phase bands by different amounts with smooth band crossfades.' },
      { id:'phase_entropy',    altSkew:true, label:'Phase Entropy',            desc:'Deterministic random-walk phase drift across harmonics with low bins pinned for pitch stability.' },
      { id:'phase_reset_scan', altSkew:true, label:'Phase Reset Scan',         desc:'Moves a phase-reset point through the cycle (sync-like phase motion) with controlled smoothing.' },
      { id:'phasewarp',        altSkew:true, label:'Phase Warp (gentle)',      desc:'Time/phase warp: φ′ = φ + amount·sin(2πφ·h). Preserves amplitude but shifts partial timing (vocal-ish motion).' },
      { id:'phasewarp_asym',   altSkew:true, label:'Phase Warp (asym)',        desc:'Asymmetric phase warp variant (different curve for +/− regions) for more “talky” motion.' },
      { id:'phasewarp_odd',    altSkew:true, label:'Phase Warp (odd)',         desc:'Phase warp using odd-only harmonic bending (smooth but formant-like; great for pads).' },
      { id:'phasecoil',        altSkew:true, label:'Phase Coil',               desc:'Localized moving phase swirl around a drifting center. Creates expressive “inside-the-wave” motion without hard clipping.' },
      { id:'phasefold',        altSkew:true, label:'Phase Fold (wrap)',        desc:'Wrap-distortion in the phase domain (not amplitude). Adds rich upper partials without brutal clipping. Fold count ≤ 4.' },
      { id:'phasequant',       label:'Phase Quantize (hard)',    desc:'Hard staircase quantization of phase/time (sample-&-hold style). Steps decrease across the table: smooth → stepped.' },
      { id:'formant',     label:'Formant Sweep',            desc:'Moves a spectral “bump” (vowel/formant‑ish) through harmonics with a subtle tilt.' },
      { id:'formantdrift', label:'Formant Drift',           desc:'Subtle moving spectral-band emphasis with slow drift (pad/vocal tables). Great for anchor-based tables.' },
      { id:'phasespray',  label:'Phase Spray',              desc:'Keeps harmonic magnitudes but drifts phases toward a deterministic random set (adds complexity/noise without big level jumps).' },
      { id:'binswap',     label:'Bin Switch (time)',        desc:'Divides the cycle into bins, deterministically shuffles them, then morphs original→shuffled (glitchy time re‑ordering).' },
      { id:'harmswap',    label:'Harmonic Bin Swap',        desc:'Spectral version of bin‑switching: swaps groups of harmonics progressively (animated timbre shuffle).' },
      { id:'altdensity',  label:'Alt Density (hold/warp)',  desc:'Alternates sparse sample‑&‑hold bins with dense warped bins; morph amount increases contrast across the series.' },
      { id:'pdwarp',      altSkew:true, label:'Phase Distortion',         desc:'Classic PD‑style time warp sweep derived from the seed (bright/edgy without changing endpoints).' },
      { id:'pdint',      altSkew:true, label:'Integrated PD Warp',       desc:'Builds a monotonic phase map from the seed’s dynamics (abs + slope) and warps by it for stable PD‑ish sweeps.' },
      { id:'cheby',       label:'Chebyshev Shape',          desc:'Chebyshev waveshaping with a smoothly increasing order (adds harmonics), blended with the original.' },
      { id:'asymbend',    altSkew:true, label:'Asymmetric Bend',          desc:'Bends positive and negative halves differently (expressive “alive” motion). Deterministic per slot.' },
      { id:'harmrotate',  altSkew:true, label:'Harmonic Rotate',          desc:'Rotates/offsets harmonic bins by an increasing amount (spectral “shift/rotate” motion).' },
      { id:'gatescan',    altSkew:true, label:'Mute Scan',                desc:'Scans one/two moving notch windows around the cycle (creates evolving holes/gating).' },
      { id:'hardsync',    label:'Hard‑Sync Sweep',          desc:'Resamples the wave with an increasing phase rate (wrap), emulating classic oscillator hard‑sync harmonics (ripping/sweeping tables).' },
      { id:'hardsync2',   label:'Hard‑Sync Sweep+',         desc:'Enhanced hard‑sync: optional softening at high ratios + fundamental stabilization (brighter sweep with stable “note”).' },
      { id:'harmwarp',    altSkew:true, label:'Harmonic Warp',            desc:'Spectral remap that stretches/compresses harmonic positions over t (impossible but musically usable evolving spectra).' },
      { id:'harmstretch', altSkew:true, label:'Harmonic Stretch/Compress',desc:'FFT-light bin remap using power-law index warp (k^p), with low harmonics anchored. Smooth evolving brightness.' },
      { id:'phasestep',   label:'Phase Staircase',          desc:'Quantizes the phase/time domain into steps (steppy motion without pure amplitude bitcrush harshness).' },

      // --- Deterministic “random walk” (safe) ---
      { id:'seeded',      label:'Seeded Drift',             desc:'Deterministic “random walk”: picks a transform chain from the seed and blends through stages for varied but repeatable results.' },
    ];

    // UI grouping for the long Evolve / Morph / Blend mode lists.
    // Keeps ALL options visible, but makes them easier to scan.
    const EVOLVE_RECIPE_GROUP_DEFS = [
      {
        title: 'Spectral & Harmonic',
        ids: [
          'smoothfold','spectral','specsmear','combform','oddeven','unison',
          'formant','formantdrift',
          'harmswap','harmrotate','harmwarp','harmstretch'
        ]
      },
      {
        title: 'Phase & Time',
        ids: [
          'pwm',
          'phaseshift','phaseshift_plus',
          'phase_dispersion','band_phase_rotate','phase_entropy','phase_reset_scan',
          'phasewarp','phasewarp_asym','phasewarp_odd',
          'phasecoil',
          'phasefold','phasequant','phasestep',
          'pdwarp','pdint',
          'phasespray'
        ]
      },
      {
        title: 'Digital & Shaping',
        ids: [
          'amsweep',
          'binswap','altdensity',
          'cheby','asymbend',
          'gatescan',
          'hardsync','hardsync2'
        ]
      },
      { title: 'Random / Drift', ids: ['seeded'] },
    ];

    const EVOLVE_DUAL_MODE_GROUP_DEFS = [
      {
        title: 'Core morph',
        ids: ['xfade','pm','specblur','spectilt','harmweave','specsweep','harmxover']
      },
      { title: 'Cross-synthesis', ids: ['magA_phaseB','magB_phaseA','envxfer'] },
      { title: 'Shaping & Ring', ids: ['waveshape','ring','ringwarp'] },
      { title: 'Logic', ids: ['xor','and','or'] },
      ...EVOLVE_RECIPE_GROUP_DEFS.map(g=>({ title: 'Recipes — ' + g.title, ids: g.ids })),
    ];

    const BLEND_MODE_GROUP_DEFS = [
      { title: 'Averages', ids: ['avg','alignavg','median'] },
      { title: 'Mosaic', ids: ['mosaic8','mosaic12','mosaic16'] },
      { title: 'Spectral', ids: ['specmag','specmagdom','convolve'] },
      { title: 'Harmonic crossover', ids: ['harmx25','harmx50','harmx75'] },
      { title: 'Multiply', ids: ['ring'] },
      { title: 'Logic', ids: ['xor','and','or'] },
    ];

    function dpChainLabel(ids, labelFn, fallbackId){
      const arr = Array.isArray(ids) ? ids : [ids];
      const out = [];
      for (const raw of arr){
        const id = String(raw||'');
        if (!id || out.includes(id)) continue;
        out.push(id);
      }
      if (!out.length && fallbackId != null) out.push(String(fallbackId||''));
      return out.map(id=>labelFn(id)).join(' -> ');
    }

    function dpSanitizeModeChain(ids, items, fallbackId, max=3){
      const arr = Array.isArray(ids) ? ids : ((ids != null && ids !== '') ? [ids] : []);
      const valid = new Set((Array.isArray(items) ? items : []).map(it=>String(it && it.id || '')));
      const out = [];
      const lim = Math.max(1, max|0);
      for (const raw of arr){
        const id = String(raw||'');
        if (!id || !valid.has(id) || out.includes(id)) continue;
        out.push(id);
        if (out.length >= lim) break;
      }
      if (!out.length && fallbackId != null){
        const fb = String(fallbackId||'');
        if (!valid.size || valid.has(fb)) out.push(fb);
      }
      return out;
    }

    function dpGetStoredModeChain(state, arrayKey, singleKey, items, fallbackId, max=3){
      const src = state ? state[arrayKey] : null;
      const one = state ? state[singleKey] : null;
      return dpSanitizeModeChain((Array.isArray(src) && src.length) ? src : one, items, fallbackId, max);
    }

    function dpSetStoredModeChain(state, arrayKey, singleKey, ids, items, fallbackId, max=3){
      const chain = dpSanitizeModeChain(ids, items, fallbackId, max);
      if (state){
        state[arrayKey] = chain.slice();
        state[singleKey] = chain[0] || String(fallbackId||'');
      }
      return chain;
    }

    function dpPickStoredModeChain(state, arrayKey, singleKey, items, fallbackId, id, ev, max=3){
      const cur = dpGetStoredModeChain(state, arrayKey, singleKey, items, fallbackId, max);
      const pickId = String(id||'');
      const additive = !!(ev && (ev.metaKey || ev.ctrlKey));
      let next;
      if (!additive){
        next = [pickId];
      } else {
        next = cur.slice();
        const idx = next.indexOf(pickId);
        if (idx >= 0){
          if (next.length > 1) next.splice(idx, 1);
        } else if (next.length < Math.max(1, max|0)){
          next.push(pickId);
        } else {
          try{ announceIO(`Chain limit: ${Math.max(1, max|0)} step${(Math.max(1, max|0)===1)?'':'s'}.`, true); }catch(_){ }
        }
      }
      return dpSetStoredModeChain(state, arrayKey, singleKey, next, items, fallbackId, max);
    }

    function dpMoveStoredModeChain(state, arrayKey, singleKey, items, fallbackId, idx, dir, max=3){
      const cur = dpGetStoredModeChain(state, arrayKey, singleKey, items, fallbackId, max);
      const from = idx|0;
      const to = from + (dir|0);
      if (from < 0 || from >= cur.length || to < 0 || to >= cur.length || from === to) return cur;
      const next = cur.slice();
      const tmp = next[from];
      next[from] = next[to];
      next[to] = tmp;
      return dpSetStoredModeChain(state, arrayKey, singleKey, next, items, fallbackId, max);
    }

    function dpRemoveStoredModeChainStep(state, arrayKey, singleKey, items, fallbackId, idx, max=3){
      const cur = dpGetStoredModeChain(state, arrayKey, singleKey, items, fallbackId, max);
      if (cur.length <= 1) return cur;
      const next = cur.slice();
      next.splice(idx|0, 1);
      return dpSetStoredModeChain(state, arrayKey, singleKey, next, items, fallbackId, max);
    }

    function dpBuildModeChainEditor(opts){
      const o = opts || {};
      const wrap = el('div','mm-modechain');
      const title = el('div','mm-modegroup-title');
      title.textContent = String(o.title || 'Chain');
      const list = el('div','mm-modechain-list');
      wrap.append(title, list);

      function mkCtl(label, tip, onClick){
        const b = el('button','mm-modechain-btn');
        b.type = 'button';
        b.textContent = label;
        if (tip) b.title = tip;
        b.onclick = (ev)=>{
          try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){ }
          try{ onClick && onClick(); }catch(_){ }
        };
        return b;
      }

      function render(ids){
        list.replaceChildren();
        const chain = Array.isArray(ids) ? ids.slice() : [];
        if (!chain.length) return;

        chain.forEach((id, idx)=>{
          const item = el('div','mm-modechain-item');
          const n = el('div','mm-modechain-index');
          n.textContent = String(idx + 1);
          const label = el('div','mm-modechain-label');
          label.textContent = o.labelFn ? o.labelFn(id) : String(id||'');
          const ctrls = el('div','mm-modechain-controls');
          const bLeft = mkCtl('←', 'Move left', ()=>{ if (o.onMove) o.onMove(idx, -1); });
          const bRight = mkCtl('→', 'Move right', ()=>{ if (o.onMove) o.onMove(idx, 1); });
          const bRemove = mkCtl('Remove', 'Remove step', ()=>{ if (o.onRemove) o.onRemove(idx); });
          bLeft.disabled = idx === 0;
          bRight.disabled = idx === (chain.length - 1);
          bRemove.disabled = chain.length <= 1;
          ctrls.append(bLeft, bRight, bRemove);
          item.append(n, label, ctrls);
          list.append(item);
        });
      }

      return { node: wrap, render };
    }

    function dpEvolveRecipeLabel(id){
      if (Array.isArray(id)) return dpChainLabel(id, dpEvolveRecipeLabel, 'seeded');
      const r = EVOLVE_RECIPES.find(x=>x.id===id);
      return r ? r.label : String(id||'seeded');
    }

    function dpUpdateEvolveBtnTitle(){
      if (!btnEvolve) return;

      // Allow any integer length (2..64) instead of only 4/8/16/32/48/64.
      const count = _clampInt((EVOLVE_STATE.count|0) || 16, 2, 64);

      const recipes = dpGetStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', 3);
      const recipe = recipes[0] || 'seeded';

      // Scan-path / ordering presets (helps build “musical” scan tables, e.g. ping‑pong).
      const pathId = EVOLVE_STATE.path || 'oneway';
      const pwmDomain = (EVOLVE_STATE.pwmDomain === 'full') ? 'full' : 'half';

      const pathLabel = (pathId === 'pingpong') ? 'Ping‑pong'
        : (pathId === 'alternate') ? 'Alternate skew'
        : 'One‑way';

      const pwmLabel = (recipe === 'pwm')
        ? ((pathId === 'alternate') ? 'PWM: alternating ± (full)'
          : (pwmDomain === 'full') ? 'PWM: full 0→1'
          : 'PWM: one‑sided 0.5→1')
        : '';

      btnEvolve.textContent = `Evolve→${count}`;

      const dualSel = (typeof dpSelectedTwoWaveSlots === 'function') ? dpSelectedTwoWaveSlots() : [];
      const triSel  = (typeof dpSelectedThreeWaveSlots === 'function') ? dpSelectedThreeWaveSlots() : [];
      const quadSel = (typeof dpSelectedFourWaveSlots === 'function') ? dpSelectedFourWaveSlots() : [];
      const keySel  = (typeof dpSelectedKeyframeSlots === 'function') ? dpSelectedKeyframeSlots(5) : [];

      const dualHint = (dualSel && dualSel.length===2)
        ? '\n\nTwo-wave Morph: With exactly 2 selected waves, click Evolve to open morph mode.'
        : '';

      const triHint = (triSel && triSel.length===3)
        ? '\n\nThree-wave Morph: With exactly 3 selected waves, click Evolve to open A→B→C morph mode.'
        : '';

      const quadHint = (quadSel && quadSel.length===4)
        ? '\n\nFour-wave Morph: With exactly 4 selected waves, click Evolve to open A→B→C→D morph mode.'
        : '';

      const keyHint = (keySel && keySel.length>=5)
        ? '\n\nFill gaps: With 5+ selected waves, click Evolve to fill the gaps between the selected anchor slots (anchors are not overwritten).'
        : '';

      const modeLine = `Recipe: ${dpEvolveRecipeLabel(recipes)} • Path: ${pathLabel}${pwmLabel ? (' • ' + pwmLabel) : ''}`;

      btnEvolve.title = `Generate ${count-1} new waves using the active slot as the seed (overwrites the next ${count-1} slots, within the 64-slot bank). ${modeLine}. Shift-click to change options.${dualHint}${triHint}${quadHint}${keyHint}`;
    }

    // UI helper: distribute an array of buttons into a fixed number of rows.
    // Useful for long option lists (recipes / morph modes) so the dialog stays tidy.
    function dpButtonsToRows(btns, nRows, rowClass){
      const arr = Array.isArray(btns) ? btns : [];
      nRows = Math.max(1, nRows|0);
      const cls = rowClass || 'mm-digi-io mm-small';

      if (nRows === 1 || arr.length <= 1){
        const row = el('div', cls);
        for (const b of arr) row.append(b);
        return row;
      }

      const wrap = el('div');
      wrap.className = 'mm-btnrows';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '8px';

      const n = arr.length|0;
      const base = Math.floor(n / nRows);
      const rem = n % nRows;
      let idx = 0;

      for (let r=0; r<nRows; r++){
        const take = base + ((r < rem) ? 1 : 0);
        const row = el('div', cls);
        for (let j=0; j<take && idx<n; j++) row.append(arr[idx++]);
        // Skip empty rows (e.g. if nRows > n)
        if (row.childNodes && row.childNodes.length) wrap.append(row);
      }
      // If anything is left (shouldn't happen), append to the last row.
      while (idx < n){
        const last = wrap.lastChild || el('div', cls);
        if (!wrap.lastChild) wrap.append(last);
        last.append(arr[idx++]);
      }

      return wrap;
    }

    // UI helper: group items into labeled sections (keeps original order within each section).
    // Each groupDef is { title, ids:[...] } where ids is an array of item ids that belong in that group.
    function dpGroupItemsByIds(items, groupDefs, otherTitle){
      const arr = Array.isArray(items) ? items : [];
      const defs = Array.isArray(groupDefs) ? groupDefs : [];
      const groups = defs.map(d=>({ title:String(d.title||''), items:[] , _set: new Set(Array.isArray(d.ids)?d.ids.map(String):[]) }));
      const other = { title: String(otherTitle||'Other'), items:[] };

      for (const it of arr){
        const id = (it && typeof it.id !== 'undefined') ? String(it.id) : '';
        let placed = false;
        for (const g of groups){
          if (g._set && g._set.has(id)){
            g.items.push(it);
            placed = true;
            break;
          }
        }
        if (!placed) other.items.push(it);
      }

      const out = groups
        .map(g=>({ title:g.title, items:g.items }))
        .filter(g=>g.items && g.items.length);

      if (other.items.length) out.push(other);
      return out;
    }

    // UI helper: render groups of buttons into tidy labeled grids.
    function dpBuildModeGroups(groups, onPick){
      const wrap = el('div','mm-modegroups');
      const btnPairs = [];

      const gs = Array.isArray(groups) ? groups : [];
      for (const g of gs){
        if (!g || !Array.isArray(g.items) || !g.items.length) continue;

        const sec = el('div','mm-modegroup');

        if (g.title){
          const t = el('div','mm-modegroup-title');
          t.textContent = String(g.title);
          sec.append(t);
        }

        const grid = el('div','mm-modegrid');
        for (const it of g.items){
          if (!it) continue;
          const b = el('button');
          b.textContent = it.label || String(it.id||'');
          if (it.desc) b.title = it.desc;
          b.onclick = (ev)=>{ try{ onPick && onPick(it.id, ev); }catch(_){ /* ignore */ } };
          btnPairs.push({ id: it.id, btn: b });
          grid.append(b);
        }

        sec.append(grid);
        wrap.append(sec);
      }

      return { node: wrap, btnPairs };
    }

    function dpSetActiveInBtnPairs(btnPairs, activeId){
      const arr = Array.isArray(btnPairs) ? btnPairs : [];
      const ids = Array.isArray(activeId) ? activeId.map(v=>String(v||'')) : [String(activeId||'')];
      const idSet = new Set(ids.filter(Boolean));
      for (const p of arr){
        if (!p || !p.btn) continue;
        p.btn.classList.toggle('mm-mode-active', idSet.has(String(p.id)));
      }
    }

    function dpPromptEvolveOptions(){
      return new Promise((resolve)=>{
        // Seed slot is always the *active* slot (click a tile first to pick it).
        let seedSlot = (typeof activeIdx === 'number') ? (activeIdx|0) : (EDIT.slot|0);
        if (!(seedSlot >= 0 && seedSlot < 64)) seedSlot = (EDIT.slot|0);
        seedSlot = _clampInt(seedSlot, 0, 63);
        const seedNo = seedSlot + 1;

        // Sanitize persisted state (back-compat with older saves that only had count/recipe).
        EVOLVE_STATE.count = _clampInt((EVOLVE_STATE.count|0) || 16, 2, 64);
        dpSetStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_STATE.recipes || EVOLVE_STATE.recipe || 'seeded', EVOLVE_RECIPES, 'seeded', 3);
        EVOLVE_STATE.path = EVOLVE_STATE.path || 'oneway';
        EVOLVE_STATE.pwmDomain = (EVOLVE_STATE.pwmDomain === 'full') ? 'full' : 'half';

        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        dlg.classList.add('mm-evolve-dlg');

        const h = el('h4'); h.textContent = 'Evolve settings';

        const p = el('div'); p.className = 'mm-small';
        p.textContent = 'Uses the active slot as the seed, and writes variations into the following slots (seed slot is left unchanged).';

        const seedLine = el('div','mm-small');
        seedLine.style.marginBottom = '6px';

        // --- Slot count presets + integer input ---
        const rowCountPresets = el('div'); rowCountPresets.className = 'mm-digi-io mm-small';
        const countPresets = [4,8,16,32,48,64];
        const countBtns = countPresets.map(c=>{
          const b = el('button');
          b.textContent = String(c);
          b.title = `Total slots (incl. seed): ${c}  → generates ${c-1} new wave${(c-1)===1?'':'s'}.`;
          b.onclick = ()=>{
            // Clamp to what's left in the bank from the seed slot.
            const maxCount = 64 - seedSlot;
            EVOLVE_STATE.count = Math.max(2, Math.min(c|0, maxCount));
            refresh();
          };
          return b;
        });
        countBtns.forEach(b=>rowCountPresets.append(b));

        const rowCountInputs = el('div'); rowCountInputs.className = 'mm-digi-io mm-small';

        const lblCount = el('span'); lblCount.textContent = 'Total slots:';
        const countIn = el('input');
        countIn.type = 'number';
        countIn.min = '2';
        countIn.step = '1';
        countIn.style.width = '7.0em';

        const lblEnd = el('span'); lblEnd.textContent = 'End slot:';
        const endIn = el('input');
        endIn.type = 'number';
        endIn.step = '1';
        endIn.style.width = '7.0em';

        rowCountInputs.append(lblCount, countIn, lblEnd, endIn);

        // --- Scan-path / ordering presets ---
        const rowPath = el('div'); rowPath.className = 'mm-digi-io mm-small';

        const bPathOne = el('button'); bPathOne.textContent = 'One‑way';
        bPathOne.title = 'Monotonic: subtle → strong (classic evolve sweep).';

        const bPathPing = el('button'); bPathPing.textContent = 'Ping‑pong';
        bPathPing.title = 'Subtle → strong → subtle (palindrome feel). Great for “musical scanning” without needing a ping‑pong LFO.';

        const bPathAlt = el('button'); bPathAlt.textContent = 'Alt skew';
        bPathAlt.title = 'Alternates direction each slot (±) while increasing depth around a neutral center. Only appears for recipes that declare a musically meaningful signed/centered parameter.';

        rowPath.append(bPathOne, bPathPing, bPathAlt);

        // --- PWM domain (only meaningful for PWM recipe) ---
        const rowPwmDomain = el('div'); rowPwmDomain.className = 'mm-digi-io mm-small';

        const bPwmHalf = el('button'); bPwmHalf.textContent = 'One‑sided (0.5→1)';
        bPwmHalf.title = 'PWM recipe: treat t as scan position; use only the 0.5→1 half so the table stays one‑direction (no mid‑bank mirror).';

        const bPwmFull = el('button'); bPwmFull.textContent = 'Full (0→1)';
        bPwmFull.title = 'PWM recipe: scan across the full domain (0→1). This crosses “neutral” (t≈0.5) and reaches the opposite skew direction.';

        rowPwmDomain.append(bPwmHalf, bPwmFull);

        const note = el('div'); note.className = 'mm-small';
        note.style.opacity = '0.9';

        // --- Recipes (grouped) ---
        const recipeGroups = (typeof dpGroupItemsByIds === 'function')
          ? dpGroupItemsByIds(EVOLVE_RECIPES, (typeof EVOLVE_RECIPE_GROUP_DEFS !== 'undefined') ? EVOLVE_RECIPE_GROUP_DEFS : [], 'Other')
          : [{ title:'', items: EVOLVE_RECIPES }];

        const recUI = (typeof dpBuildModeGroups === 'function')
          ? dpBuildModeGroups(recipeGroups, (id, ev)=>{
              dpPickStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', id, ev, 3);
              refresh();
            })
          : (()=>{ const row=el('div','mm-digi-io mm-small'); (EVOLVE_RECIPES||[]).forEach(r=>{ const b=el('button'); b.textContent=r.label; if (r.desc) b.title=r.desc; b.onclick=(ev)=>{ dpPickStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', r.id, ev, 3); refresh(); }; row.append(b); }); return { node:row, btnPairs:[] }; })();

        const rowRec = recUI.node;
        const recBtnPairs = recUI.btnPairs;
        const chainUI = dpBuildModeChainEditor({
          title: 'Sequence',
          labelFn: (id)=>dpEvolveRecipeLabel(id),
          onMove: (idx, dir)=>{
            dpMoveStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', idx, dir, 3);
            refresh();
          },
          onRemove: (idx)=>{
            dpRemoveStoredModeChainStep(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', idx, 3);
            refresh();
          },
        });

        const preview = el('div'); preview.className = 'mm-small';
        preview.style.opacity = '0.9';

        const rowBtns = el('div'); rowBtns.className = 'mm-digi-io mm-small';
        const bRun = el('button'); bRun.textContent = 'Run';
        bRun.title = 'Run Evolve with these settings (overwrites the target slots).';
        // Keyboard: Enter should trigger the primary action.
        bRun.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent = 'Cancel';
        rowBtns.append(bRun, bCancel);

        function setActive(btn, on){ btn.classList.toggle('mm-mode-active', !!on); }

        function clampCount(v){
          const maxCount = 64 - seedSlot;
          v = _clampInt((v|0) || 0, 2, 64);
          if (v > maxCount) v = maxCount;
          return v;
        }

        function refresh(){
          const maxCount = 64 - seedSlot;

          // Seed line + max info
          seedLine.textContent = `Seed: slot ${seedNo}. Max length from here: ${maxCount} slot${maxCount===1?'':'s'} (incl. seed).`;

          // Clamp count to what's possible from this seed
          EVOLVE_STATE.count = clampCount(EVOLVE_STATE.count);

          // Inputs (linked: count <-> end slot)
          countIn.max = String(Math.max(0, maxCount));
          countIn.value = String(EVOLVE_STATE.count|0);

          const endSlotNo = seedSlot + (EVOLVE_STATE.count|0);
          const endMin = Math.min(64, seedNo + 1);
          endIn.min = String(endMin);
          endIn.max = '64';
          endIn.value = String(_clampInt(endSlotNo, endMin, 64));

          // Preset buttons
          countBtns.forEach((b,i)=>{
            const preset = countPresets[i]|0;
            b.disabled = preset > maxCount || maxCount < 2;
            setActive(b, preset === (EVOLVE_STATE.count|0));
          });

          // Scan-path buttons
          const recipes = dpGetStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', 3);
          const recipe = String(recipes[0] || 'seeded');
          const pathId = String(EVOLVE_STATE.path || 'oneway');

          // “Alt skew” only appears when every chain step supports it.
          const altOk = recipes.length > 0 && recipes.every(id=>{
            const rMeta = (EVOLVE_RECIPES||[]).find(r=>r && r.id === id) || null;
            return !!(rMeta && rMeta.altSkew);
          });
          bPathAlt.style.display = altOk ? '' : 'none';
          if (!altOk && pathId === 'alternate') EVOLVE_STATE.path = 'oneway';

          setActive(bPathOne, EVOLVE_STATE.path === 'oneway');
          setActive(bPathPing, EVOLVE_STATE.path === 'pingpong');
          setActive(bPathAlt,  EVOLVE_STATE.path === 'alternate');

          // PWM domain row only when PWM recipe, and not in Alt mode (Alt implies full domain).
          const hasPwm = recipes.includes('pwm');
          rowPwmDomain.style.display = hasPwm ? '' : 'none';
          if (hasPwm){
            const dom = (EVOLVE_STATE.pwmDomain === 'full') ? 'full' : 'half';
            // In Alt mode we force full scan behavior.
            const lockFull = (EVOLVE_STATE.path === 'alternate');
            bPwmHalf.disabled = lockFull;
            bPwmFull.disabled = lockFull;

            setActive(bPwmHalf, !lockFull && dom === 'half');
            setActive(bPwmFull, lockFull || dom === 'full');

            note.textContent = (EVOLVE_STATE.path === 'alternate')
              ? 'PWM note: “Alt skew” interleaves both directions (±) around neutral, so it always uses the full 0→1 domain.'
              : (dom === 'half')
                ? 'PWM note: neutral is near t≈0.5. One‑sided mode maps the sweep to 0.5→1.0 so the series stays one‑direction (clean, no mid‑bank mirror).'
                : 'PWM note: Full mode scans 0→1, crossing neutral (t≈0.5) and reaching the opposite skew direction.';
          } else {
            // Non-PWM note: keep it short so the dialog doesn’t “jump” between recipes.
            note.textContent = (EVOLVE_STATE.path === 'alternate' && altOk)
              ? 'Alt skew: alternates direction (±) around neutral while increasing intensity.'
              : '';
          }

          // Recipe buttons (group UI)
          if (typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(recBtnPairs, recipes);
          }
          chainUI.render(recipes);

          // Preview + run enable
          const count = EVOLVE_STATE.count|0;
          if (maxCount < 2 || count < 2){
            preview.textContent = 'Not enough slots after the seed to write an evolve series. Pick an earlier seed slot.';
            bRun.disabled = true;
          } else {
            const overwriteStartNo = seedNo + 1;
            const overwriteEndNo = seedSlot + count;
            const pathLabel = (EVOLVE_STATE.path === 'pingpong') ? 'Ping‑pong' : (EVOLVE_STATE.path === 'alternate' ? 'Alt skew' : 'One‑way');
            const dom = (EVOLVE_STATE.pwmDomain === 'full') ? 'full' : 'half';
            const domNote = hasPwm
              ? (EVOLVE_STATE.path === 'alternate') ? ' (PWM full, alternating ±)' : (dom === 'full' ? ' (PWM full 0→1)' : ' (PWM one‑sided 0.5→1)')
              : '';
            preview.textContent = `Will overwrite slots ${overwriteStartNo}..${overwriteEndNo} with ${count-1} new wave(s). Path: ${pathLabel}${domNote}. Recipe: ${dpEvolveRecipeLabel(recipes)}.`;
            bRun.disabled = false;
          }
        }

        // --- Wire controls ---
        countIn.oninput = ()=>{
          EVOLVE_STATE.count = clampCount(parseInt(countIn.value, 10));
          refresh();
        };
        countIn.onchange = countIn.oninput;

        endIn.oninput = ()=>{
          const v = parseInt(endIn.value, 10);
          if (!isFinite(v)){ refresh(); return; }
          EVOLVE_STATE.count = clampCount(v - seedSlot);
          refresh();
        };
        endIn.onchange = endIn.oninput;

        bPathOne.onclick = ()=>{ EVOLVE_STATE.path = 'oneway'; refresh(); };
        bPathPing.onclick = ()=>{ EVOLVE_STATE.path = 'pingpong'; refresh(); };
        bPathAlt.onclick = ()=>{ EVOLVE_STATE.path = 'alternate'; refresh(); };

        bPwmHalf.onclick = ()=>{ EVOLVE_STATE.pwmDomain = 'half'; refresh(); };
        bPwmFull.onclick = ()=>{ EVOLVE_STATE.pwmDomain = 'full'; refresh(); };

        // Robust cleanup on cancel/escape/click-outside
        function finish(result){
          try{ document.removeEventListener('keydown', onKey); }catch(_){ }
          try{ overlay.removeEventListener('click', onOverlayClick); }catch(_){ }
          overlay.remove();
          resolve(result);
        }
        function onKey(e){
          if (e && (e.key === 'Escape' || e.key === 'Esc')){
            try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
            finish(null);
          }
        }
        function onOverlayClick(e){
          if (e && e.target === overlay) finish(null);
        }

        bCancel.onclick = ()=>finish(null);
        bRun.onclick = ()=>{
          const recipes = dpGetStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', 3);
          finish({
            count: EVOLVE_STATE.count|0,
            recipe: recipes[0] || 'seeded',
            recipes,
            path: EVOLVE_STATE.path || 'oneway',
            pwmDomain: (EVOLVE_STATE.pwmDomain === 'full') ? 'full' : 'half',
          });
        };

        // Build dialog
        dlg.append(h, p, el('hr'), seedLine);

        const lblCount1 = el('div','mm-small'); lblCount1.textContent = 'Slot count (incl. seed):';
        const lblCount2 = el('div','mm-small'); lblCount2.textContent = 'Custom length / end slot:';
        const lblPath = el('div','mm-small'); lblPath.textContent = 'Scan path:';
        const lblPwm = el('div','mm-small'); lblPwm.textContent = 'PWM domain:';
        const lblRec = el('div','mm-small'); lblRec.textContent = 'Recipe:';

        dlg.append(lblCount1, rowCountPresets, lblCount2, rowCountInputs, el('hr'), lblPath, rowPath);

        // PWM domain + note (only shown when PWM)
        dlg.append(lblPwm, rowPwmDomain, note, el('hr'), lblRec, rowRec, chainUI.node, el('hr'), preview, el('hr'), rowBtns);

        overlay.append(dlg);
        document.body.append(overlay);

        // Attach listeners for closing
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', onOverlayClick);

        refresh();
      });
    }



function dpEvolveRecipeSupportsAlt(id){
      const r = (EVOLVE_RECIPES||[]).find(x=>x && x.id === String(id||''));
      return !!(r && r.altSkew);
    }

function dpApplyEvolveRecipeChain(baseU8, tBase, recipeIds, pathId, pwmDomain){
      const ids = dpSanitizeModeChain(recipeIds, EVOLVE_RECIPES, 'seeded', 3);
      const chainAltOk = ids.length > 0 && ids.every(id=>dpEvolveRecipeSupportsAlt(id));
      const path = (String(pathId||'oneway') === 'alternate' && chainAltOk) ? 'alternate' : String(pathId||'oneway');
      const dom = (String(pwmDomain||'half') === 'full') ? 'full' : 'half';
      let cur = new Uint8Array(baseU8 || []);
      for (const id of ids){
        let t = Number(tBase||0);
        if (id === 'pwm' && path !== 'alternate'){
          t = (dom === 'full') ? _clamp01(t) : (0.5 + 0.5 * _clamp01(t));
        } else {
          t = _clamp01(t);
        }
        cur = (path === 'alternate' && dpEvolveRecipeSupportsAlt(id))
          ? dpEvolveGenerate(cur, t, id, { altSkew:true })
          : dpEvolveGenerate(cur, t, id);
      }
      return cur;
    }

function doEvolveFromSlot(opts){
      // Optional one-shot override (e.g. from Shift-click menu)
      if (opts && typeof opts === 'object'){
        const c = (opts.count|0);
        if (c) EVOLVE_STATE.count = _clampInt(c, 2, 64);
        if (opts.recipes || opts.recipe){
          dpSetStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', opts.recipes || opts.recipe, EVOLVE_RECIPES, 'seeded', 3);
        }
        if (opts.path) EVOLVE_STATE.path = String(opts.path);
        if (opts.pwmDomain) EVOLVE_STATE.pwmDomain = (String(opts.pwmDomain) === 'full') ? 'full' : 'half';
        try{ dpUpdateEvolveBtnTitle(); }catch(_){ /* ignore */ }
      }

      // Allow any integer length (2..64). Clamp later to the remaining bank space from the seed slot.
      const requestedCount = _clampInt((EVOLVE_STATE.count|0) || 16, 2, 64);
      const recipes = dpGetStoredModeChain(EVOLVE_STATE, 'recipes', 'recipe', EVOLVE_RECIPES, 'seeded', 3);
      const recipe = recipes[0] || 'seeded';
      const pathId = EVOLVE_STATE.path || 'oneway';
      const pwmDomain = (EVOLVE_STATE.pwmDomain === 'full') ? 'full' : 'half';

      // “Alt skew” is only valid when every chained recipe opts in.
      const _altOk = recipes.length > 0 && recipes.every(id=>dpEvolveRecipeSupportsAlt(id));
      const _path = (pathId === 'alternate' && !_altOk) ? 'oneway' : pathId;

      // Seed slot = active tile (preferred), fallback to editor slot.
      let seedSlot = (typeof activeIdx === 'number') ? (activeIdx|0) : (EDIT.slot|0);
      if (!(seedSlot>=0 && seedSlot<64)) seedSlot = (EDIT.slot|0);
      seedSlot = _clampInt(seedSlot, 0, 63);

      const editorSlot = EDIT.slot|0;
      const seedRec = LIB.waves[seedSlot] || null;

      const base = ((editorSlot===seedSlot) && LIB.dirty.has(seedSlot))
        ? EDIT.dataU8
        : (seedRec ? seedRec.dataU8 : null);

      const baseName = ((editorSlot===seedSlot) && LIB.dirty.has(seedSlot))
        ? (EDIT.name||'WAVE')
        : (seedRec ? (seedRec.name||'WAVE') : 'WAVE');

      if (!base){
        announceIO(`Seed slot ${seedSlot+1} is empty. Load a wave into that slot first.`, true);
        return;
      }

      const maxCount = 64 - seedSlot;
      const count = Math.min(requestedCount, maxCount);

      if (count < 2){
        announceIO('Not enough slots after the seed to evolve. Choose an earlier slot.', true);
        return;
      }

      const seedNo = seedSlot + 1;
      const overwriteStartNo = seedSlot + 2;
      const overwriteEndNo = seedSlot + count;

      const pathLabel = (_path === 'pingpong') ? 'Ping‑pong'
        : (_path === 'alternate') ? 'Alt skew'
        : 'One‑way';

      const pwmShort = recipes.includes('pwm')
        ? ((_path === 'alternate') ? 'PWM alt ±'
          : (pwmDomain === 'full') ? 'PWM full'
          : 'PWM one‑sided')
        : '';

      const note = (count !== requestedCount)
        ? `\n\nNote: Only ${count} slot(s) remain from slot ${seedNo}, so this will fill up to slot ${overwriteEndNo}.`
        : '';

      const ok = confirm(
        `Evolve (${dpEvolveRecipeLabel(recipes)}) will overwrite slots ${overwriteStartNo}..${overwriteEndNo} with ${count-1} new waves. ` +
        `Slot ${seedNo} is left unchanged.\n\nPath: ${pathLabel}${pwmShort ? (' • ' + pwmShort) : ''}.\n\nContinue?${note}`
      );
      if (!ok) return;

      const targets = [];
      for (let s=seedSlot+1; s<seedSlot+count; s++) targets.push(s);

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      const prefix2 = fileToken4(baseName).slice(0,2).padEnd(2,'0');

      // Precompute ping‑pong normalization so we always reach t=1 at the midpoint even for even lengths.
      let pingMax = 1;
      if (_path === 'pingpong'){
        pingMax = 0;
        for (let i=0;i<targets.length;i++){
          const u = (i+1) / (targets.length + 1);
          const tri = 1 - Math.abs(2*u - 1);
          if (tri > pingMax) pingMax = tri;
        }
        if (!(pingMax > 0)) pingMax = 1;
      }

      try{
        for (let i=0;i<targets.length;i++){
          const s = targets[i];

          // Base “amount” for most recipes (0..1).
          let t;

          if (_path === 'pingpong'){
            // Triangle wave (subtle→strong→subtle), excludes exact 0/1 endpoints for nicer tables.
            const u = (i+1) / (targets.length + 1);
            t = (1 - Math.abs(2*u - 1)) / pingMax;
          } else if (_path === 'alternate' && _altOk){
            // Alt skew (opt-in): interleave left/right direction (±) around neutral (0.5)
            // with increasing depth.
            const pairs = Math.ceil(targets.length / 2);
            const pairIdx = Math.floor(i / 2);
            const depth = (pairs <= 1) ? 1 : ((pairIdx + 1) / pairs); // 0..1
            const sign = (i % 2 === 0) ? 1 : -1;
            // dpEvolveGenerate() receives t as a 0..1 scan position where 0.5 is neutral.
            t = 0.5 + (sign * 0.5 * depth); // 0..1
          } else {
            // One‑way (default): subtle→strong
            t = (targets.length<=1) ? 1 : ((i+1) / targets.length);
          }

          const out = dpApplyEvolveRecipeChain(base, t, recipes, _path, pwmDomain);

          // Name policy:
          //  - Default: 2-char prefix from seed + 2-digit global slot number.
          //  - Special-case (Unison + count=4): use seed's first 3 chars + (2/3/4) so you get e.g. WHI2/WHI3/WHI4.
          let nm;
          if (recipes.length === 1 && recipe === 'unison' && requestedCount === 4){
            const base3 = fileToken4(baseName).slice(0,3).padEnd(3,'0');
            const digit = String(2 + i).slice(-1);
            nm = (base3 + digit).slice(0,4).padEnd(4,'0');
          } else {
            const num2 = String(s+1).padStart(2,'0');
            nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');
          }

          LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
          LIB.userWaves[s] = LIB.waves[s];
          LIB.dirty.delete(s);
          paintGridCell(s);
        }
      } catch(err){
        console.error(err);
        // Robust: revert any partial writes.
        try{
          if (typeof applyBankState === 'function') applyBankState(__bankBefore);
        }catch(_){ }
        announceIO('Evolve failed (see Console).', true);
        return;
      }

      // If the editor is currently showing a slot we overwrote, reload it so the waveform updates.
      if (editorSlot > seedSlot && editorSlot < (seedSlot + count)){
        try{ dpLoadWaveIntoEditor(editorSlot); }catch(_){}
      }

      const __bankAfter = captureBankState(targets);

      const labelBits = [
        dpEvolveRecipeLabel(recipes),
        (_path === 'pingpong') ? 'pingpong' : (_path === 'alternate') ? 'alt' : 'oneway'
      ];
      if (recipes.includes('pwm')) labelBits.push((_path === 'alternate') ? 'full' : pwmDomain);

      bankPush({ label:`Evolve →${count} @${seedNo} (${labelBits.join(',')})`, before: __bankBefore, after: __bankAfter });

      announceIO(`Evolved slot ${seedNo} into ${count-1} new wave${count-1===1?'':'s'} (slots ${overwriteStartNo}..${overwriteEndNo}, ${dpEvolveRecipeLabel(recipes)}).`);
      updateButtonsState();
    }



    // === Two‑Wave Morph Evolve (special mode when exactly 2 slots are selected) ===

    // Two/Three-wave morph modes.
    // Core modes are purpose-built; the rest are "recipe" modes that reuse the single-wave
    // Evolve recipes as mid-series shaping layered on top of a time crossfade.
    const EVOLVE_DUAL_MODES = [
      { id:'xfade',     label:'Time Crossfade', desc:'Straight time-domain crossfade (fast + punchy).' },
      { id:'pm',        label:'FM/PM Boost', desc:'Crossfade with extra phase modulation around the midpoint (adds motion/edge).' },
      { id:'specblur',  label:'Spectral Blur', desc:'Spectral blend with a blurred midpoint for smoother transitions.' },
      { id:'spectilt',  label:'Spectral Tilt (A→B)', desc:'Tilts A’s spectral slope toward B with a 2-stage path; preserves target phase in the second stage for smooth timbral blends.' },
      { id:'harmweave', label:'Harmonic Weave', desc:'Spectral blend with alternating harmonic groups biased toward A/B (tighter mids).' },
      { id:'specsweep', label:'Spectral Sweep (A↔B)', desc:'Progressively swaps harmonic bands from A to B (high→low) for a sweep-like morph.' },
      { id:'harmxover',  label:'Harmonic Crossover', desc:'Low harmonics from A, high harmonics from B; crossover sweeps with t (body ↔ brightness).' },
      { id:'magA_phaseB', label:'Mag(A) + Phase(B)', desc:'Spectral cross-synthesis: reach Mag(A)+Phase(B) at midpoint, then morph to B.' },
      { id:'magB_phaseA', label:'Mag(B) + Phase(A)', desc:'Spectral cross-synthesis: reach Mag(B)+Phase(A) at midpoint, then morph to B.' },
      { id:'envxfer',    label:'Envelope Transfer (A→B)', desc:'Transfers B’s smoothed spectral envelope onto A at the midpoint, then resolves into B (cross-synth body transfer).' },
      { id:'waveshape',  label:'WaveShaper (B curves A)', desc:'Uses B as a transfer curve: A → shaped(A,B) → B (wild but controllable).' },
      { id:'ring',       label:'Ring Mod (A×B)', desc:'Time-domain multiply: A → (A×B) → B (sidebands / AM-like grit, great for metallic tables).' },
      { id:'ringwarp',   label:'Ring Warp (phase)', desc:'Uses ring product as a phase/time warp modulator (not plain multiply): crossfade with midpoint φ′ = φ + (A×B)·depth (smooth, expressive sidebands).' },
      { id:'xor',        label:'XOR (A⊕B)', desc:'Bitwise XOR: A → (A XOR B) → B (glitchy/digital, great for harsh tables).' },
      { id:'and',        label:'AND (A∧B)', desc:'Bitwise AND: A → (A AND B) → B (gated/fragmented digital morph).' },
      { id:'or',         label:'OR (A∨B)',  desc:'Bitwise OR: A → (A OR B) → B (bright/filled digital morph).' },
      // Extra modes borrowed from the single-wave Evolve recipes
      ...EVOLVE_RECIPES.map(r=>({
        id: r.id,
        label: r.label,
        desc: `Time-crossfade A→B with mid-series “${r.label}” shaping (reuses Evolve recipe).`,
      })),
    ];

    function dpEvolveDualModeLabel(id){
      if (Array.isArray(id)) return dpChainLabel(id, dpEvolveDualModeLabel, 'specblur');
      const m = EVOLVE_DUAL_MODES.find(x=>x.id===id);
      return m ? m.label : String(id||'specblur');
    }

    function dpApplyMorphModeChain(aU8, bU8, t, modeIds){
      const ids = dpSanitizeModeChain(modeIds, EVOLVE_DUAL_MODES, 'specblur', 3);
      const tt = _clamp01(t);
      const pmMax = 0.18;
      let curA = aU8;
      let out = null;
      for (const id of ids){
        if (id === 'pm'){
          if (typeof dpPhaseModGenerate !== 'function'){
            out = dpMorphGenerate(curA, bU8, tt, 'xfade');
          } else {
            const base = dpMorphGenerate(curA, bU8, tt, 'xfade');
            const depth = pmMax * 4 * tt * (1 - tt);
            out = dpPhaseModGenerate(base, bU8, depth);
          }
        } else {
          out = dpMorphGenerate(curA, bU8, tt, id);
        }
        curA = out;
      }
      return out || dpMorphGenerate(aU8, bU8, tt, 'xfade');
    }

    function dpSelectedTwoWaveSlots(){
      // Returns [a,b] if exactly two slots are selected AND both have wave data.
      if (!(SELECTED && SELECTED.size === 2)) return [];
      const sel = Array.from(SELECTED).map(n=>n|0).filter(i=>i>=0 && i<64).sort((a,b)=>a-b);
      if (sel.length !== 2) return [];
      const editorSlot = EDIT.slot|0;

      for (const s of sel){
        const ok = (s===editorSlot && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length)
          || (LIB.waves[s] && LIB.waves[s].dataU8 && LIB.waves[s].dataU8.length);
        if (!ok) return [];
      }
      return sel;
    }

    function dpSelectedThreeWaveSlots(){
      // Returns [a,b,c] if exactly three slots are selected AND all have wave data.
      if (!(SELECTED && SELECTED.size === 3)) return [];
      const sel = Array.from(SELECTED).map(n=>n|0).filter(i=>i>=0 && i<64).sort((a,b)=>a-b);
      if (sel.length !== 3) return [];
      const editorSlot = EDIT.slot|0;

      for (const s of sel){
        const ok = (s===editorSlot && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length)
          || (LIB.waves[s] && LIB.waves[s].dataU8 && LIB.waves[s].dataU8.length);
        if (!ok) return [];
      }
      return sel;
    }

    function dpSelectedFourWaveSlots(){
      // Returns [a,b,c,d] if exactly four slots are selected AND all have wave data.
      if (!(SELECTED && SELECTED.size === 4)) return [];
      const sel = Array.from(SELECTED).map(n=>n|0).filter(i=>i>=0 && i<64).sort((a,b)=>a-b);
      if (sel.length !== 4) return [];
      const editorSlot = EDIT.slot|0;

      for (const s of sel){
        const ok = (s===editorSlot && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length)
          || (LIB.waves[s] && LIB.waves[s].dataU8 && LIB.waves[s].dataU8.length);
        if (!ok) return [];
      }
      return sel;
    }

    function dpSelectedKeyframeSlots(minCount){
      // Returns sorted slot indices if at least `minCount` slots are selected AND all have wave data.
      const need = Math.max(2, (minCount|0) || 4);
      if (!(SELECTED && typeof SELECTED.size === 'number' && (SELECTED.size|0) >= need)) return [];
      const sel = Array.from(SELECTED).map(n=>n|0).filter(i=>i>=0 && i<64).sort((a,b)=>a-b);
      if (sel.length < need) return [];
      const editorSlot = EDIT.slot|0;

      for (const s of sel){
        const ok = (s===editorSlot && LIB.dirty && LIB.dirty.has(s) && EDIT.dataU8 && EDIT.dataU8.length)
          || (LIB.waves[s] && LIB.waves[s].dataU8 && LIB.waves[s].dataU8.length);
        if (!ok) return [];
      }
      return sel;
    }

    function dpGetSlotWaveRecord(slotIdx){
      // Fetches wave data for an operation, preferring the editor buffer if that slot is dirty.
      slotIdx = slotIdx|0;
      const editorSlot = EDIT.slot|0;
      if (slotIdx === editorSlot && LIB.dirty && LIB.dirty.has(slotIdx) && EDIT.dataU8 && EDIT.dataU8.length){
        return { name: (EDIT.name||'WAVE'), dataU8: new Uint8Array(EDIT.dataU8) };
      }
      const w = LIB.waves[slotIdx];
      if (w && w.dataU8 && w.dataU8.length){
        return { name: (w.name||'WAVE'), dataU8: new Uint8Array(w.dataU8) };
      }
      return null;
    }



    function dpPromptEvolveDualOptions(aSlot, bSlot){
      // aSlot/bSlot are the *source* endpoints (A → B), not the overwrite targets.
      return new Promise((resolve)=>{
        aSlot = _clampInt(aSlot|0, 0, 63);
        bSlot = _clampInt(bSlot|0, 0, 63);
        if (aSlot === bSlot){ resolve(null); return; }

        // sanitize persisted state
        EVOLVE_DUAL_STATE.count = _clampInt((EVOLVE_DUAL_STATE.count|0) || 16, 2, 64);
        dpSetStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_STATE.modes || EVOLVE_DUAL_STATE.mode || 'specblur', EVOLVE_DUAL_MODES, 'specblur', 3);
        EVOLVE_DUAL_STATE.placement = (EVOLVE_DUAL_STATE.placement === 'between') ? 'between' : 'afterA';

        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        dlg.classList.add('mm-evolve-dlg');
        const h = el('h4'); h.textContent='Two-wave morph (Evolve)';
        const p = el('div'); p.className='mm-small';
        p.textContent='Combines TWO selected waves and generates a morph series. Endpoints are never overwritten.';

        const srcLine = el('div'); srcLine.className='mm-small';
        srcLine.style.marginBottom = '6px';

        const rowSwap = el('div'); rowSwap.className='mm-digi-io mm-small';
        const bSwap = el('button'); bSwap.textContent='Swap A↔B';
        rowSwap.append(bSwap);

        const rowPlace = el('div'); rowPlace.className='mm-digi-io mm-small';
        const bBetween = el('button'); bBetween.textContent='Fill gap (between A & B)';
        const bAfter   = el('button'); bAfter.textContent='Write after A';
        rowPlace.append(bBetween, bAfter);

        const rowCount = el('div'); rowCount.className='mm-digi-io mm-small';
        const counts = [4,8,16,32,48,64];
        const countBtns = counts.map(c=>{ const b=el('button'); b.textContent=String(c); b.onclick=()=>{ EVOLVE_DUAL_STATE.count=c; refresh(); }; return b; });
        countBtns.forEach(b=>rowCount.append(b));
        const rowCountIn = el('div'); rowCountIn.className='mm-digi-io mm-small';
        const lblCountIn = el('span'); lblCountIn.textContent='Custom count:';
        const countIn = el('input');
        countIn.type='number'; countIn.min='2'; countIn.max='64'; countIn.step='1'; countIn.style.width='7.0em';
        rowCountIn.append(lblCountIn, countIn);


        // Morph modes (grouped): keeps all options visible but easier to scan.
        const modeGroups = (typeof dpGroupItemsByIds === 'function')
          ? dpGroupItemsByIds(EVOLVE_DUAL_MODES, (typeof EVOLVE_DUAL_MODE_GROUP_DEFS !== 'undefined') ? EVOLVE_DUAL_MODE_GROUP_DEFS : [], 'Other')
          : [{ title:'', items: EVOLVE_DUAL_MODES }];

        const modeUI = (typeof dpBuildModeGroups === 'function')
          ? dpBuildModeGroups(modeGroups, (id, ev)=>{
              dpPickStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', id, ev, 3);
              refresh();
            })
          : (()=>{ const row=el('div','mm-digi-io mm-small'); (EVOLVE_DUAL_MODES||[]).forEach(m=>{ const b=el('button'); b.textContent=m.label; if (m.desc) b.title=m.desc; b.onclick=(ev)=>{ dpPickStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', m.id, ev, 3); refresh(); }; row.append(b); }); return { node:row, btnPairs:[] }; })();

        const rowMode = modeUI.node;
        const modeBtnPairs = modeUI.btnPairs;
        const chainUI = dpBuildModeChainEditor({
          title: 'Sequence',
          labelFn: (id)=>dpEvolveDualModeLabel(id),
          onMove: (idx, dir)=>{
            dpMoveStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, dir, 3);
            refresh();
          },
          onRemove: (idx)=>{
            dpRemoveStoredModeChainStep(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, 3);
            refresh();
          },
        });

        const preview = el('div'); preview.className='mm-small';
        preview.style.opacity = '0.9';

        const rowBtns = el('div'); rowBtns.className='mm-digi-io mm-small';
        const bRun = el('button'); bRun.textContent='Run Morph';
        // Keyboard: Enter should trigger the primary action.
        bRun.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent='Cancel';
        rowBtns.append(bRun, bCancel);

        function slotLabel(s){
          const rec = dpGetSlotWaveRecord(s);
          const nm = rec ? (rec.name||'WAVE') : 'EMPTY';
          return `S${String(s+1).padStart(2,'0')} "${nm}"`;
        }

        function setActive(btn, on){ btn.classList.toggle('mm-mode-active', !!on); }

        function refresh(){
          // sources
          srcLine.textContent = `A: ${slotLabel(aSlot)}   →   B: ${slotLabel(bSlot)}`;

          // placement toggles
          const gap = Math.abs(bSlot - aSlot) - 1;
          bBetween.disabled = gap < 1;
          setActive(bBetween, EVOLVE_DUAL_STATE.placement === 'between');
          setActive(bAfter,   EVOLVE_DUAL_STATE.placement !== 'between');

          // count controls (only meaningful for "after A")
          const useCount = (EVOLVE_DUAL_STATE.placement !== 'between');

          // Clamp to sane range (2..64). We clamp again later to bank end.
          EVOLVE_DUAL_STATE.count = _clampInt((EVOLVE_DUAL_STATE.count|0) || 16, 2, 64);

          countIn.disabled = !useCount;
          countIn.max = String(Math.max(0, 64 - aSlot));
          countIn.value = String(EVOLVE_DUAL_STATE.count|0);

          countBtns.forEach((b,i)=>{
            b.disabled = !useCount;
            setActive(b, useCount && counts[i]===(EVOLVE_DUAL_STATE.count|0));
          });

          // mode buttons
          const modes = dpGetStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          if (typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeBtnPairs, modes);
          }
          chainUI.render(modes);

          // preview overwrite + run enable
          if (EVOLVE_DUAL_STATE.placement === 'between'){
            if (gap < 1){
              preview.textContent = 'No slots between A and B (choose "Write after A").';
              bRun.disabled = true;
            } else {
              const lo = Math.min(aSlot,bSlot)+1;
              const hi = Math.max(aSlot,bSlot)-1;
              preview.textContent = `Will overwrite slot(s) ${lo+1}..${hi+1} (${gap} step${gap===1?'':'s'}) using mode: ${dpEvolveDualModeLabel(modes)}.`;
              bRun.disabled = false;
            }
          } else {
            const req = _clampInt((EVOLVE_DUAL_STATE.count|0) || 16, 2, 64);
            const maxCount = 64 - aSlot;
            const count = Math.min(req, maxCount);
            if (count < 2){
              preview.textContent = 'Not enough slots after A to write a morph series.';
              bRun.disabled = true;
            } else {
              const start = aSlot + 2;
              const end = aSlot + count;
              const note = (count !== req) ? ` (clamped to ${count} because of bank end)` : '';
              const overlap = [];
              if (bSlot >= (aSlot+1) && bSlot < (aSlot+count)) overlap.push(bSlot+1);
              const warn = overlap.length
                ? ` Warning: anchor slot ${overlap.join(', ')} will also be overwritten in this placement.`
                : '';
              preview.textContent = `Will overwrite slots ${start}..${end}${note} using mode: ${dpEvolveDualModeLabel(modes)}.${warn}`;
              bRun.disabled = false;
            }
          }
        }

        bSwap.onclick = ()=>{ const tmp=aSlot; aSlot=bSlot; bSlot=tmp; refresh(); };
        bBetween.onclick = ()=>{ EVOLVE_DUAL_STATE.placement='between'; refresh(); };
        bAfter.onclick   = ()=>{ EVOLVE_DUAL_STATE.placement='afterA'; refresh(); };

        countIn.oninput = ()=>{ EVOLVE_DUAL_STATE.count = _clampInt(parseInt(countIn.value, 10) || 0, 2, 64); refresh(); };
        countIn.onchange = countIn.oninput;

        bCancel.onclick = ()=>{ overlay.remove(); resolve(null); };
        bRun.onclick = ()=>{
          const modes = dpGetStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          overlay.remove();
          resolve({
            aSlot, bSlot,
            placement: (EVOLVE_DUAL_STATE.placement==='between') ? 'between' : 'afterA',
            count: EVOLVE_DUAL_STATE.count|0,
            mode: modes[0] || 'specblur',
            modes,
          });
        };

        // Build clean dialog
        dlg.append(h,p,el('hr'), srcLine, rowSwap, el('hr'));
        const l1 = el('div','mm-small'); l1.textContent='Placement:';
        const l2 = el('div','mm-small'); l2.textContent='Slot count (Write after A):';
        const l3 = el('div','mm-small'); l3.textContent='Morph mode:';
        dlg.append(l1, rowPlace, l2, rowCount, rowCountIn, l3, rowMode, chainUI.node, el('hr'), preview, el('hr'), rowBtns);

        overlay.append(dlg);
        document.body.append(overlay);
        refresh();
      });
    }

    async function doEvolveTwoSelected(opts){
      opts = opts || {};
      let aSlot = _clampInt(opts.aSlot|0, 0, 63);
      let bSlot = _clampInt(opts.bSlot|0, 0, 63);
      if (aSlot === bSlot){
        announceIO('Pick two different waves to morph.', true);
        return;
      }

      const aRec = dpGetSlotWaveRecord(aSlot);
      const bRec = dpGetSlotWaveRecord(bSlot);
      if (!aRec || !bRec){
        announceIO('Two-wave morph needs 2 selected slots that contain waves.', true);
        return;
      }

      const modes = dpSanitizeModeChain(opts.modes || opts.mode || EVOLVE_DUAL_STATE.modes || EVOLVE_DUAL_STATE.mode, EVOLVE_DUAL_MODES, 'specblur', 3);
      const mode = modes[0] || 'specblur';
      const placement = (opts.placement === 'between') ? 'between' : 'afterA';
      const requestedCount = _clampInt((opts.count|0) || (EVOLVE_DUAL_STATE.count|0) || 16, 2, 64);

      // Determine overwrite targets
      const targets = [];
      let note = '';
      if (placement === 'between'){
        const step = (bSlot > aSlot) ? 1 : -1;
        for (let s=aSlot+step; s!==bSlot; s+=step) targets.push(s);
        if (!targets.length){
          announceIO('No slots between A and B. Choose “Write after A”.', true);
          return;
        }
      } else {
        const maxCount = 64 - aSlot;
        const count = Math.min(requestedCount, maxCount);
        if (count < 2){
          announceIO('Not enough slots after A to write a morph series. Choose an earlier slot for A.', true);
          return;
        }
        if (count !== requestedCount) note = `

Note: Only ${count} slot(s) remain from slot ${aSlot+1}, so this will fill up to slot ${aSlot+count}.`;
        for (let s=aSlot+1; s<aSlot+count; s++) targets.push(s);
      }

      // Confirm overwrite
      const aName = (aRec.name||'WAVE');
      const bName = (bRec.name||'WAVE');
      const label = dpEvolveDualModeLabel(modes);
      let msg;

      if (placement === 'between'){
        const lo = Math.min(aSlot,bSlot)+1;
        const hi = Math.max(aSlot,bSlot)-1;
        msg = `Two-wave morph (${label}) will overwrite slot(s) ${lo+1}..${hi+1} with ${targets.length} in-between wave(s).

A: slot ${aSlot+1} (${aName})
B: slot ${bSlot+1} (${bName})

Endpoints are left unchanged. Continue?`;
      } else {
        const overwriteStartNo = aSlot + 2;
        const overwriteEndNo = aSlot + 1 + targets.length;
        const overlap = [];
        if (targets.includes(bSlot)) overlap.push(bSlot+1);
        const overlapNote = overlap.length
          ? `\n\nWarning: With “Write after A”, anchor slot ${overlap.join(', ')} will also be overwritten.`
          : '';
        msg = `Two-wave morph (${label}) will overwrite slots ${overwriteStartNo}..${overwriteEndNo} with ${targets.length} new wave(s).

A: slot ${aSlot+1} (${aName})
B: slot ${bSlot+1} (${bName})

Slot ${aSlot+1} is left unchanged. Continue?${note}${overlapNote}`;
      }

      if (!confirm(msg)) return;

      const __bankBefore = captureBankState(targets, { preferEditor:true });
      const aTok = fileToken4(aName);
      const bTok = fileToken4(bName);
      const prefix2 = ((aTok[0]||'M') + (bTok[0]||'M')).toUpperCase().slice(0,2).padEnd(2,'M');

      try{
        if (placement === 'between'){
          const totalSteps = Math.abs(bSlot - aSlot);
          for (let i=0;i<targets.length;i++){
            const s = targets[i]|0;
            const dist = Math.abs(s - aSlot);
            const t = (totalSteps>0) ? (dist / totalSteps) : 1;

            const out = dpApplyMorphModeChain(aRec.dataU8, bRec.dataU8, t, modes);

            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');

            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        } else {
          const n = targets.length;
          for (let i=0;i<n;i++){
            const s = targets[i]|0;
            const t = (n<=1) ? 1 : ((i+1) / n);

            const out = dpApplyMorphModeChain(aRec.dataU8, bRec.dataU8, t, modes);

            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');

            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        }
      } catch(err){
        console.error(err);
        // Robust: revert any partial writes.
        try{
          if (typeof applyBankState === 'function') applyBankState(__bankBefore);
        }catch(_){ }
        announceIO('Two-wave morph failed (see Console).', true);
        return;
      }

      // If the editor is showing a slot we overwrote, reload it so the waveform updates.
      const editorSlot = EDIT.slot|0;
      if (targets.includes(editorSlot)){
        try{ dpLoadWaveIntoEditor(editorSlot); }catch(_){}
      }

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Morph ${aSlot+1}→${bSlot+1} (${dpEvolveDualModeLabel(modes)})`, before: __bankBefore, after: __bankAfter });

      announceIO(`Morphed A(${aSlot+1}) → B(${bSlot+1}) into ${targets.length} slot${targets.length===1?'':'s'} (${dpEvolveDualModeLabel(modes)}).`);
      updateButtonsState();
    }

    // === Three‑Wave Morph Evolve (special mode when exactly 3 slots are selected) ===

    function dpPromptEvolveTripleOptions(aSlot, bSlot, cSlot){
      // aSlot/bSlot/cSlot are the *source* endpoints (A → B → C), not the overwrite targets.
      return new Promise((resolve)=>{
        aSlot = _clampInt(aSlot|0, 0, 63);
        bSlot = _clampInt(bSlot|0, 0, 63);
        cSlot = _clampInt(cSlot|0, 0, 63);
        if (aSlot===bSlot || bSlot===cSlot || aSlot===cSlot){ resolve(null); return; }

        // sanitize persisted state
        EVOLVE_TRIPLE_STATE.count = _clampInt((EVOLVE_TRIPLE_STATE.count|0) || 16, 2, 64);
        dpSetStoredModeChain(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_TRIPLE_STATE.modes || EVOLVE_TRIPLE_STATE.mode || 'specblur', EVOLVE_DUAL_MODES, 'specblur', 3);
        EVOLVE_TRIPLE_STATE.placement = (EVOLVE_TRIPLE_STATE.placement === 'between') ? 'between' : 'afterA';

        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        dlg.classList.add('mm-evolve-dlg');
        const h = el('h4'); h.textContent='Three-wave morph (Evolve)';
        const p = el('div'); p.className='mm-small';
        p.textContent='Combines THREE selected waves and generates a morph series using B as the midpoint (A→B→C). Endpoints are never overwritten.';

        const srcLine = el('div'); srcLine.className='mm-small';
        srcLine.style.marginBottom = '6px';

        const rowOrder = el('div'); rowOrder.className='mm-digi-io mm-small';
        const bSwapAB = el('button'); bSwapAB.textContent='Swap A↔B';
        const bSwapBC = el('button'); bSwapBC.textContent='Swap B↔C';
        const bSwapAC = el('button'); bSwapAC.textContent='Swap A↔C';
        rowOrder.append(bSwapAB, bSwapBC, bSwapAC);

        const rowPlace = el('div'); rowPlace.className='mm-digi-io mm-small';
        const bBetween = el('button'); bBetween.textContent='Fill gaps (between A↔B↔C)';
        const bAfter   = el('button'); bAfter.textContent='Write after A';
        rowPlace.append(bBetween, bAfter);

        const rowCount = el('div'); rowCount.className='mm-digi-io mm-small';
        const counts = [4,8,16,32,48,64];
        const countBtns = counts.map(c=>{ const b=el('button'); b.textContent=String(c); b.onclick=()=>{ EVOLVE_TRIPLE_STATE.count=c; refresh(); }; return b; });
        countBtns.forEach(b=>rowCount.append(b));
        const rowCountIn = el('div'); rowCountIn.className='mm-digi-io mm-small';
        const lblCountIn = el('span'); lblCountIn.textContent='Custom count:';
        const countIn = el('input');
        countIn.type='number'; countIn.min='2'; countIn.max='64'; countIn.step='1'; countIn.style.width='7.0em';
        rowCountIn.append(lblCountIn, countIn);


        // Morph modes (grouped): keeps all options visible but easier to scan.
        const modeGroups = (typeof dpGroupItemsByIds === 'function')
          ? dpGroupItemsByIds(EVOLVE_DUAL_MODES, (typeof EVOLVE_DUAL_MODE_GROUP_DEFS !== 'undefined') ? EVOLVE_DUAL_MODE_GROUP_DEFS : [], 'Other')
          : [{ title:'', items: EVOLVE_DUAL_MODES }];

        const modeUI = (typeof dpBuildModeGroups === 'function')
          ? dpBuildModeGroups(modeGroups, (id, ev)=>{ dpPickStoredModeChain(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', id, ev, 3); refresh(); })
          : (()=>{ const row=el('div','mm-digi-io mm-small'); (EVOLVE_DUAL_MODES||[]).forEach(m=>{ const b=el('button'); b.textContent=m.label; if (m.desc) b.title=m.desc; b.onclick=(ev)=>{ dpPickStoredModeChain(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', m.id, ev, 3); refresh(); }; row.append(b); }); return { node:row, btnPairs:[] }; })();

        const rowMode = modeUI.node;
        const modeBtnPairs = modeUI.btnPairs;
        const chainUI = dpBuildModeChainEditor({
          title: 'Sequence',
          labelFn: (id)=>dpEvolveDualModeLabel(id),
          onMove: (idx, dir)=>{ dpMoveStoredModeChain(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, dir, 3); refresh(); },
          onRemove: (idx)=>{ dpRemoveStoredModeChainStep(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, 3); refresh(); },
        });

        const preview = el('div'); preview.className='mm-small';
        preview.style.opacity = '0.9';

        const rowBtns = el('div'); rowBtns.className='mm-digi-io mm-small';
        const bRun = el('button'); bRun.textContent='Run Morph';
        // Keyboard: Enter should trigger the primary action.
        bRun.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent='Cancel';
        rowBtns.append(bRun, bCancel);

        function slotLabel(s){
          const rec = dpGetSlotWaveRecord(s);
          const nm = rec ? (rec.name||'WAVE') : 'EMPTY';
          return `S${String(s+1).padStart(2,'0')} "${nm}"`;
        }

        function setActive(btn, on){ btn.classList.toggle('mm-mode-active', !!on); }

        function isMonotonic(){
          return (aSlot < bSlot && bSlot < cSlot) || (aSlot > bSlot && bSlot > cSlot);
        }

        // Compute a "between" plan that always makes sense for any 3 distinct slots:
        // - B becomes the median slot (between the other two)
        // - A/C become the endpoints (ascending or descending).
        // We preserve the *current A direction* when possible (if A is already an endpoint).
        function computeBetweenPlan(){
          const sorted = [aSlot, bSlot, cSlot].slice().sort((x,y)=>x-y);
          const lo = sorted[0], mid = sorted[1], hi = sorted[2];

          // Preserve direction if A is already an endpoint.
          let A, B, C;
          if (aSlot === hi){
            A = hi; B = mid; C = lo; // descending
          } else {
            A = lo; B = mid; C = hi; // ascending
          }

          const gapAB = Math.abs(B - A) - 1;
          const gapBC = Math.abs(C - B) - 1;
          const ab = Math.max(0, gapAB);
          const bc = Math.max(0, gapBC);
          const total = ab + bc;
          return { A, B, C, ab, bc, total, monotonic:isMonotonic() };
        }

        function refresh(){
          // sources
          srcLine.textContent = `A: ${slotLabel(aSlot)}   →   B: ${slotLabel(bSlot)}   →   C: ${slotLabel(cSlot)}`;

          // placement toggles
          const betweenInfo = computeBetweenPlan();
          // Enable “Fill gaps” whenever there are actually gap slots to fill,
          // even if the current A/B/C ordering isn't monotonic.
          bBetween.disabled = !(betweenInfo.total >= 1);
          setActive(bBetween, EVOLVE_TRIPLE_STATE.placement === 'between');
          setActive(bAfter,   EVOLVE_TRIPLE_STATE.placement !== 'between');

          // count controls (only meaningful for "after A")
          const useCount = (EVOLVE_TRIPLE_STATE.placement !== 'between');

          // Clamp to sane range (2..64). We clamp again later to bank end.
          EVOLVE_TRIPLE_STATE.count = _clampInt((EVOLVE_TRIPLE_STATE.count|0) || 16, 2, 64);

          countIn.disabled = !useCount;
          countIn.max = String(Math.max(0, 64 - aSlot));
          countIn.value = String(EVOLVE_TRIPLE_STATE.count|0);

          countBtns.forEach((b,i)=>{
            b.disabled = !useCount;
            setActive(b, useCount && counts[i]===(EVOLVE_TRIPLE_STATE.count|0));
          });

          // mode buttons
          const modes = dpGetStoredModeChain(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          if (typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeBtnPairs, modes);
          }
          chainUI.render(modes);

          // preview overwrite + run enable
          if (EVOLVE_TRIPLE_STATE.placement === 'between'){
            if (betweenInfo.total < 1){
              preview.textContent = 'No slots between A↔B↔C (choose "Write after A").';
              bRun.disabled = true;
            } else {
              const auto = (!betweenInfo.monotonic)
                ? ` (auto-reordering to A=${betweenInfo.A+1}, B=${betweenInfo.B+1}, C=${betweenInfo.C+1})`
                : '';
              preview.textContent = `Will overwrite ${betweenInfo.total} slot(s): ${betweenInfo.ab} between A↔B and ${betweenInfo.bc} between B↔C${auto} using mode: ${dpEvolveDualModeLabel(modes)}.`;
              bRun.disabled = false;
            }
          } else {
            const req = _clampInt((EVOLVE_TRIPLE_STATE.count|0) || 16, 2, 64);
            const maxCount = 64 - aSlot;
            const count = Math.min(req, maxCount);
            if (count < 2){
              preview.textContent = 'Not enough slots after A to write a morph series.';
              bRun.disabled = true;
            } else {
              const start = aSlot + 2;
              const end = aSlot + count;
              const note = (count !== req) ? ` (clamped to ${count} because of bank end)` : '';
              const overlap = [];
              if (bSlot >= (aSlot+1) && bSlot < (aSlot+count)) overlap.push(bSlot+1);
              if (cSlot >= (aSlot+1) && cSlot < (aSlot+count)) overlap.push(cSlot+1);
              const warn = overlap.length
                ? ` Warning: anchor slot(s) ${overlap.join(', ')} will also be overwritten in this placement.`
                : '';
              preview.textContent = `Will overwrite slots ${start}..${end}${note} (B influences the midpoint of the series) using mode: ${dpEvolveDualModeLabel(modes)}.${warn}`;
              bRun.disabled = false;
            }
          }
        }

        bSwapAB.onclick = ()=>{ const tmp=aSlot; aSlot=bSlot; bSlot=tmp; refresh(); };
        bSwapBC.onclick = ()=>{ const tmp=bSlot; bSlot=cSlot; cSlot=tmp; refresh(); };
        bSwapAC.onclick = ()=>{ const tmp=aSlot; aSlot=cSlot; cSlot=tmp; refresh(); };

        bBetween.onclick = ()=>{
          // If A/B/C are not monotonic, auto-normalize so “Fill gaps” always does something sensible.
          const plan = computeBetweenPlan();
          if (!plan.monotonic){
            aSlot = plan.A; bSlot = plan.B; cSlot = plan.C;
          }
          EVOLVE_TRIPLE_STATE.placement = 'between';
          refresh();
        };
        bAfter.onclick   = ()=>{ EVOLVE_TRIPLE_STATE.placement = 'afterA'; refresh(); };

        countIn.oninput = ()=>{ EVOLVE_TRIPLE_STATE.count = _clampInt(parseInt(countIn.value, 10) || 0, 2, 64); refresh(); };
        countIn.onchange = countIn.oninput;

        // Robust cleanup on cancel/escape/click-outside
        function finish(result){
          try{ document.removeEventListener('keydown', onKey); }catch(_){ }
          try{ overlay.removeEventListener('click', onOverlayClick); }catch(_){ }
          overlay.remove();
          resolve(result);
        }
        function onKey(e){
          if (e && (e.key === 'Escape' || e.key === 'Esc')){
            try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
            finish(null);
          }
        }
        function onOverlayClick(e){
          if (e && e.target === overlay) finish(null);
        }

        bCancel.onclick = ()=>finish(null);
        bRun.onclick = ()=>{
          const modes = dpGetStoredModeChain(EVOLVE_TRIPLE_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          finish({
            aSlot, bSlot, cSlot,
            placement: (EVOLVE_TRIPLE_STATE.placement === 'between') ? 'between' : 'afterA',
            count: EVOLVE_TRIPLE_STATE.count|0,
            mode: modes[0] || 'specblur',
            modes,
          });
        };

        dlg.append(h,p,el('hr'), srcLine, rowOrder, el('hr'));
        const l1 = el('div','mm-small'); l1.textContent='Placement:';
        const l2 = el('div','mm-small'); l2.textContent='Slot count (Write after A):';
        const l3 = el('div','mm-small'); l3.textContent='Morph mode:';
        dlg.append(l1, rowPlace, l2, rowCount, rowCountIn, l3, rowMode, chainUI.node, el('hr'), preview, el('hr'), rowBtns);

        overlay.append(dlg);
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', onOverlayClick);
        refresh();
      });
    }

    async function doEvolveThreeSelected(opts){
      opts = opts || {};

      let aSlot = _clampInt(opts.aSlot|0, 0, 63);
      let bSlot = _clampInt(opts.bSlot|0, 0, 63);
      let cSlot = _clampInt(opts.cSlot|0, 0, 63);

      if (aSlot===bSlot || bSlot===cSlot || aSlot===cSlot){
        announceIO('Pick 3 different waves to morph.', true);
        return;
      }

      const modes = dpSanitizeModeChain(opts.modes || opts.mode || EVOLVE_TRIPLE_STATE.modes || EVOLVE_TRIPLE_STATE.mode, EVOLVE_DUAL_MODES, 'specblur', 3);
      const mode = modes[0] || 'specblur';
      const placement = (opts.placement === 'between') ? 'between' : 'afterA';
      const requestedCount = _clampInt((opts.count|0) || (EVOLVE_TRIPLE_STATE.count|0) || 16, 2, 64);

      // If user picked “between”, make sure we have a monotonic A→B→C ordering.
      // This mirrors the prompt's auto-normalize behavior and prevents “Fill gaps”
      // from feeling like it silently did nothing.
      if (placement === 'between'){
        const monotonic = (aSlot < bSlot && bSlot < cSlot) || (aSlot > bSlot && bSlot > cSlot);
        if (!monotonic){
          const sorted = [aSlot, bSlot, cSlot].slice().sort((x,y)=>x-y);
          const lo = sorted[0], mid = sorted[1], hi = sorted[2];
          // Preserve direction if A is already an endpoint.
          if (aSlot === hi){
            aSlot = hi; bSlot = mid; cSlot = lo; // descending
          } else {
            aSlot = lo; bSlot = mid; cSlot = hi; // ascending
          }
        }
      }

      const aRec = dpGetSlotWaveRecord(aSlot);
      const bRec = dpGetSlotWaveRecord(bSlot);
      const cRec = dpGetSlotWaveRecord(cSlot);
      if (!aRec || !bRec || !cRec){
        announceIO('Three-wave morph needs 3 selected slots that contain waves.', true);
        return;
      }

      // Determine overwrite targets
      const targets = [];
      const targetsAB = [];
      const targetsBC = [];
      let note = '';
      if (placement === 'between'){
        // Fill A↔B gap
        {
          const step = (bSlot > aSlot) ? 1 : -1;
          for (let s=aSlot+step; s!==bSlot; s+=step) targetsAB.push(s);
        }
        // Fill B↔C gap
        {
          const step = (cSlot > bSlot) ? 1 : -1;
          for (let s=bSlot+step; s!==cSlot; s+=step) targetsBC.push(s);
        }

        targets.push(...targetsAB, ...targetsBC);
        if (!targets.length){
          announceIO('No slots between A↔B↔C. Choose "Write after A".', true);
          return;
        }
      } else {
        const maxCount = 64 - aSlot;
        const count = Math.min(requestedCount, maxCount);
        if (count < 2){
          announceIO('Not enough slots after A to write a morph series. Choose an earlier slot for A.', true);
          return;
        }
        if (count !== requestedCount) note = `\n\nNote: Only ${count} slot(s) remain from slot ${aSlot+1}, so this will fill up to slot ${aSlot+count}.`;
        for (let s=aSlot+1; s<aSlot+count; s++) targets.push(s);
      }

      // Confirm overwrite
      const aName = (aRec.name||'WAVE');
      const bName = (bRec.name||'WAVE');
      const cName = (cRec.name||'WAVE');
      const label = dpEvolveDualModeLabel(modes);
      let msg;

      if (placement === 'between'){
        msg = `Three-wave morph (${label}) will overwrite ${targets.length} slot(s) between A↔B and B↔C.\n\nA: slot ${aSlot+1} (${aName})\nB: slot ${bSlot+1} (${bName})\nC: slot ${cSlot+1} (${cName})\n\nEndpoints are left unchanged. Continue?`;
      } else {
        const overwriteStartNo = aSlot + 2;
        const overwriteEndNo = aSlot + 1 + targets.length;
        const overlap = [];
        if (targets.includes(bSlot)) overlap.push(bSlot+1);
        if (targets.includes(cSlot)) overlap.push(cSlot+1);
        const overlapNote = overlap.length
          ? `\n\nWarning: With “Write after A”, anchor slot(s) ${overlap.join(', ')} will also be overwritten.`
          : '';
        msg = `Three-wave morph (${label}) will overwrite slots ${overwriteStartNo}..${overwriteEndNo} with ${targets.length} new wave(s).\n\nA: slot ${aSlot+1} (${aName})\nB: slot ${bSlot+1} (${bName}) [midpoint]\nC: slot ${cSlot+1} (${cName})\n\nSlot ${aSlot+1} is left unchanged. Continue?${note}`;
        msg += overlapNote;
      }

      if (!confirm(msg)) return;

      const __bankBefore = captureBankState(targets, { preferEditor:true });
      const aTok = fileToken4(aName);
      const cTok = fileToken4(cName);
      const prefix2 = ((aTok[0]||'M') + (cTok[0]||'M')).toUpperCase().slice(0,2).padEnd(2,'M');

      try{
        if (placement === 'between'){
          const totalStepsAB = Math.abs(bSlot - aSlot);
          for (let i=0;i<targetsAB.length;i++){
            const s = targetsAB[i]|0;
            const dist = Math.abs(s - aSlot);
            const t = (totalStepsAB>0) ? (dist / totalStepsAB) : 1;

            const out = dpApplyMorphModeChain(aRec.dataU8, bRec.dataU8, t, modes);

            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');

            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }

          const totalStepsBC = Math.abs(cSlot - bSlot);
          for (let i=0;i<targetsBC.length;i++){
            const s = targetsBC[i]|0;
            const dist = Math.abs(s - bSlot);
            const t = (totalStepsBC>0) ? (dist / totalStepsBC) : 1;

            const out = dpApplyMorphModeChain(bRec.dataU8, cRec.dataU8, t, modes);

            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');

            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        } else {
          const n = targets.length;
          for (let i=0;i<n;i++){
            const s = targets[i]|0;
            const tGlobal = (n<=1) ? 1 : ((i+1) / n); // 0..1

            // Piecewise A→B (first half) then B→C (second half).
            const out = (tGlobal <= 0.5)
              ? dpApplyMorphModeChain(aRec.dataU8, bRec.dataU8, (tGlobal/0.5), modes)
              : dpApplyMorphModeChain(bRec.dataU8, cRec.dataU8, ((tGlobal-0.5)/0.5), modes);

            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');

            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        }
      } catch(err){
        console.error(err);
        // Robust: revert any partial writes.
        try{
          if (typeof applyBankState === 'function') applyBankState(__bankBefore);
        }catch(_){ }
        announceIO('Three-wave morph failed (see Console).', true);
        return;
      }

      // If the editor is showing a slot we overwrote, reload it so the waveform updates.
      const editorSlot = EDIT.slot|0;
      if (targets.includes(editorSlot)){
        try{ dpLoadWaveIntoEditor(editorSlot); }catch(_){ }
      }

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Morph ${aSlot+1}→${bSlot+1}→${cSlot+1} (${dpEvolveDualModeLabel(modes)})`, before: __bankBefore, after: __bankAfter });

      announceIO(`Morphed A(${aSlot+1}) → B(${bSlot+1}) → C(${cSlot+1}) into ${targets.length} slot${targets.length===1?'':'s'} (${dpEvolveDualModeLabel(modes)}).`);
      updateButtonsState();
    }


    // === Four‑Wave Morph Evolve (special mode when exactly 4 slots are selected) ===

    function dpPromptEvolveQuadOptions(aSlot, bSlot, cSlot, dSlot){
      // aSlot/bSlot/cSlot/dSlot are the *source* anchors (A → B → C → D), not the overwrite targets.
      return new Promise((resolve)=>{
        aSlot = _clampInt(aSlot|0, 0, 63);
        bSlot = _clampInt(bSlot|0, 0, 63);
        cSlot = _clampInt(cSlot|0, 0, 63);
        dSlot = _clampInt(dSlot|0, 0, 63);
        if (aSlot===bSlot || aSlot===cSlot || aSlot===dSlot || bSlot===cSlot || bSlot===dSlot || cSlot===dSlot){
          resolve(null);
          return;
        }

        // sanitize persisted state
        EVOLVE_QUAD_STATE.count = _clampInt((EVOLVE_QUAD_STATE.count|0) || 16, 2, 64);
        dpSetStoredModeChain(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_QUAD_STATE.modes || EVOLVE_QUAD_STATE.mode || 'specblur', EVOLVE_DUAL_MODES, 'specblur', 3);
        EVOLVE_QUAD_STATE.placement = (EVOLVE_QUAD_STATE.placement === 'between') ? 'between' : 'afterA';

        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        dlg.classList.add('mm-evolve-dlg');
        const h = el('h4'); h.textContent='Four-wave morph (Evolve)';
        const p = el('div'); p.className='mm-small';
        p.textContent='Combines FOUR selected waves and generates a morph series (A→B→C→D). When using “Fill gaps”, anchors are never overwritten.';

        const srcLine = el('div'); srcLine.className='mm-small';
        srcLine.style.marginBottom = '6px';

        const rowOrder = el('div'); rowOrder.className='mm-digi-io mm-small';
        const bSwapAB = el('button'); bSwapAB.textContent='Swap A↔B';
        const bSwapBC = el('button'); bSwapBC.textContent='Swap B↔C';
        const bSwapCD = el('button'); bSwapCD.textContent='Swap C↔D';
        const bReverse = el('button'); bReverse.textContent='Reverse';
        bReverse.title = 'Reverse the anchor order (A↔D, B↔C).';
        rowOrder.append(bSwapAB, bSwapBC, bSwapCD, bReverse);

        const rowPlace = el('div'); rowPlace.className='mm-digi-io mm-small';
        const bBetween = el('button'); bBetween.textContent='Fill gaps (between A↔B↔C↔D)';
        const bAfter   = el('button'); bAfter.textContent='Write after A';
        rowPlace.append(bBetween, bAfter);

        const rowCount = el('div'); rowCount.className='mm-digi-io mm-small';
        const counts = [4,8,16,32,48,64];
        const countBtns = counts.map(c=>{ const b=el('button'); b.textContent=String(c); b.onclick=()=>{ EVOLVE_QUAD_STATE.count=c; refresh(); }; return b; });
        countBtns.forEach(b=>rowCount.append(b));
        const rowCountIn = el('div'); rowCountIn.className='mm-digi-io mm-small';
        const lblCountIn = el('span'); lblCountIn.textContent='Custom count:';
        const countIn = el('input');
        countIn.type='number'; countIn.min='2'; countIn.max='64'; countIn.step='1'; countIn.style.width='7.0em';
        rowCountIn.append(lblCountIn, countIn);

        // Morph modes (grouped): keeps all options visible but easier to scan.
        const modeGroups = (typeof dpGroupItemsByIds === 'function')
          ? dpGroupItemsByIds(EVOLVE_DUAL_MODES, (typeof EVOLVE_DUAL_MODE_GROUP_DEFS !== 'undefined') ? EVOLVE_DUAL_MODE_GROUP_DEFS : [], 'Other')
          : [{ title:'', items: EVOLVE_DUAL_MODES }];

        const modeUI = (typeof dpBuildModeGroups === 'function')
          ? dpBuildModeGroups(modeGroups, (id, ev)=>{ dpPickStoredModeChain(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', id, ev, 3); refresh(); })
          : (()=>{ const row=el('div','mm-digi-io mm-small'); (EVOLVE_DUAL_MODES||[]).forEach(m=>{ const b=el('button'); b.textContent=m.label; if (m.desc) b.title=m.desc; b.onclick=(ev)=>{ dpPickStoredModeChain(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', m.id, ev, 3); refresh(); }; row.append(b); }); return { node:row, btnPairs:[] }; })();

        const rowMode = modeUI.node;
        const modeBtnPairs = modeUI.btnPairs;
        const chainUI = dpBuildModeChainEditor({
          title: 'Sequence',
          labelFn: (id)=>dpEvolveDualModeLabel(id),
          onMove: (idx, dir)=>{ dpMoveStoredModeChain(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, dir, 3); refresh(); },
          onRemove: (idx)=>{ dpRemoveStoredModeChainStep(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, 3); refresh(); },
        });

        const preview = el('div'); preview.className='mm-small';
        preview.style.opacity = '0.9';

        const rowBtns = el('div'); rowBtns.className='mm-digi-io mm-small';
        const bRun = el('button'); bRun.textContent='Run Morph';
        // Keyboard: Enter should trigger the primary action.
        bRun.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent='Cancel';
        rowBtns.append(bRun, bCancel);

        function slotLabel(s){
          const rec = dpGetSlotWaveRecord(s);
          const nm = rec ? (rec.name||'WAVE') : 'EMPTY';
          return `S${String(s+1).padStart(2,'0')} "${nm}"`;
        }

        function setActive(btn, on){ btn.classList.toggle('mm-mode-active', !!on); }

        function isMonotonic(){
          return (aSlot < bSlot && bSlot < cSlot && cSlot < dSlot)
            || (aSlot > bSlot && bSlot > cSlot && cSlot > dSlot);
        }

        // Compute a monotonic “fill gaps” plan that always makes sense:
        // - Use the four selected slots sorted by position.
        // - Preserve direction if A is already an endpoint.
        function computeBetweenPlan(){
          const sorted = [aSlot, bSlot, cSlot, dSlot].slice().sort((x,y)=>x-y);
          const lo = sorted[0], m1 = sorted[1], m2 = sorted[2], hi = sorted[3];

          let A,B,C,D;
          if (aSlot === hi){
            A = hi; B = m2; C = m1; D = lo; // descending
          } else {
            A = lo; B = m1; C = m2; D = hi; // ascending
          }

          const gapAB = Math.abs(B - A) - 1;
          const gapBC = Math.abs(C - B) - 1;
          const gapCD = Math.abs(D - C) - 1;
          const ab = Math.max(0, gapAB);
          const bc = Math.max(0, gapBC);
          const cd = Math.max(0, gapCD);
          const total = ab + bc + cd;
          return { A,B,C,D, ab,bc,cd, total, monotonic:isMonotonic() };
        }

        function refresh(){
          srcLine.textContent = `A: ${slotLabel(aSlot)}   →   B: ${slotLabel(bSlot)}   →   C: ${slotLabel(cSlot)}   →   D: ${slotLabel(dSlot)}`;

          const betweenInfo = computeBetweenPlan();
          bBetween.disabled = !(betweenInfo.total >= 1);
          setActive(bBetween, EVOLVE_QUAD_STATE.placement === 'between');
          setActive(bAfter,   EVOLVE_QUAD_STATE.placement !== 'between');

          const useCount = (EVOLVE_QUAD_STATE.placement !== 'between');
          EVOLVE_QUAD_STATE.count = _clampInt((EVOLVE_QUAD_STATE.count|0) || 16, 2, 64);

          countIn.disabled = !useCount;
          countIn.max = String(Math.max(0, 64 - aSlot));
          countIn.value = String(EVOLVE_QUAD_STATE.count|0);

          countBtns.forEach((b,i)=>{
            b.disabled = !useCount;
            setActive(b, useCount && counts[i]===(EVOLVE_QUAD_STATE.count|0));
          });

          const modes = dpGetStoredModeChain(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          if (typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeBtnPairs, modes);
          }
          chainUI.render(modes);

          if (EVOLVE_QUAD_STATE.placement === 'between'){
            if (betweenInfo.total < 1){
              preview.textContent = 'No slots between A↔B↔C↔D (choose "Write after A").';
              bRun.disabled = true;
            } else {
              const auto = (!betweenInfo.monotonic)
                ? ` (auto-reordering to A=${betweenInfo.A+1}, B=${betweenInfo.B+1}, C=${betweenInfo.C+1}, D=${betweenInfo.D+1})`
                : '';
              preview.textContent = `Will overwrite ${betweenInfo.total} slot(s): ${betweenInfo.ab} between A↔B, ${betweenInfo.bc} between B↔C, ${betweenInfo.cd} between C↔D${auto} using mode: ${dpEvolveDualModeLabel(modes)}.`;
              bRun.disabled = false;
            }
          } else {
            const req = _clampInt((EVOLVE_QUAD_STATE.count|0) || 16, 2, 64);
            const maxCount = 64 - aSlot;
            const count = Math.min(req, maxCount);
            if (count < 2){
              preview.textContent = 'Not enough slots after A to write a morph series.';
              bRun.disabled = true;
            } else {
              const start = aSlot + 2;
              const end = aSlot + count;
              const note = (count !== req) ? ` (clamped to ${count} because of bank end)` : '';
              const overlap = [];
              if (bSlot >= (aSlot+1) && bSlot < (aSlot+count)) overlap.push(bSlot+1);
              if (cSlot >= (aSlot+1) && cSlot < (aSlot+count)) overlap.push(cSlot+1);
              if (dSlot >= (aSlot+1) && dSlot < (aSlot+count)) overlap.push(dSlot+1);
              const warn = overlap.length
                ? ` Warning: anchor slot(s) ${overlap.join(', ')} will also be overwritten in this placement.`
                : '';
              preview.textContent = `Will overwrite slots ${start}..${end}${note} (B/C shape the interior; D is the end) using mode: ${dpEvolveDualModeLabel(modes)}.${warn}`;
              bRun.disabled = false;
            }
          }
        }

        bSwapAB.onclick = ()=>{ const tmp=aSlot; aSlot=bSlot; bSlot=tmp; refresh(); };
        bSwapBC.onclick = ()=>{ const tmp=bSlot; bSlot=cSlot; cSlot=tmp; refresh(); };
        bSwapCD.onclick = ()=>{ const tmp=cSlot; cSlot=dSlot; dSlot=tmp; refresh(); };
        bReverse.onclick = ()=>{ const ta=aSlot, tb=bSlot, tc=cSlot, td=dSlot; aSlot=td; bSlot=tc; cSlot=tb; dSlot=ta; refresh(); };

        bBetween.onclick = ()=>{
          const plan = computeBetweenPlan();
          if (!plan.monotonic){
            aSlot = plan.A; bSlot = plan.B; cSlot = plan.C; dSlot = plan.D;
          }
          EVOLVE_QUAD_STATE.placement = 'between';
          refresh();
        };
        bAfter.onclick   = ()=>{ EVOLVE_QUAD_STATE.placement = 'afterA'; refresh(); };

        countIn.oninput = ()=>{ EVOLVE_QUAD_STATE.count = _clampInt(parseInt(countIn.value, 10) || 0, 2, 64); refresh(); };
        countIn.onchange = countIn.oninput;

        function finish(result){
          try{ document.removeEventListener('keydown', onKey); }catch(_){ }
          try{ overlay.removeEventListener('click', onOverlayClick); }catch(_){ }
          overlay.remove();
          resolve(result);
        }
        function onKey(e){
          if (e && (e.key === 'Escape' || e.key === 'Esc')){
            try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
            finish(null);
          }
        }
        function onOverlayClick(e){
          if (e && e.target === overlay) finish(null);
        }

        bCancel.onclick = ()=>finish(null);
        bRun.onclick = ()=>{
          const modes = dpGetStoredModeChain(EVOLVE_QUAD_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          finish({
            aSlot, bSlot, cSlot, dSlot,
            placement: (EVOLVE_QUAD_STATE.placement === 'between') ? 'between' : 'afterA',
            count: EVOLVE_QUAD_STATE.count|0,
            mode: modes[0] || 'specblur',
            modes,
          });
        };

        dlg.append(h,p,el('hr'), srcLine, rowOrder, el('hr'));
        const l1 = el('div','mm-small'); l1.textContent='Placement:';
        const l2 = el('div','mm-small'); l2.textContent='Slot count (Write after A):';
        const l3 = el('div','mm-small'); l3.textContent='Morph mode:';
        dlg.append(l1, rowPlace, l2, rowCount, rowCountIn, l3, rowMode, chainUI.node, el('hr'), preview, el('hr'), rowBtns);

        overlay.append(dlg);
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', onOverlayClick);
        refresh();
      });
    }

    async function doEvolveFourSelected(opts){
      opts = opts || {};

      let aSlot = _clampInt(opts.aSlot|0, 0, 63);
      let bSlot = _clampInt(opts.bSlot|0, 0, 63);
      let cSlot = _clampInt(opts.cSlot|0, 0, 63);
      let dSlot = _clampInt(opts.dSlot|0, 0, 63);

      if (aSlot===bSlot || aSlot===cSlot || aSlot===dSlot || bSlot===cSlot || bSlot===dSlot || cSlot===dSlot){
        announceIO('Pick 4 different waves to morph.', true);
        return;
      }

      const modes = dpSanitizeModeChain(opts.modes || opts.mode || EVOLVE_QUAD_STATE.modes || EVOLVE_QUAD_STATE.mode, EVOLVE_DUAL_MODES, 'specblur', 3);
      const mode = modes[0] || 'specblur';
      const placement = (opts.placement === 'between') ? 'between' : 'afterA';
      const requestedCount = _clampInt((opts.count|0) || (EVOLVE_QUAD_STATE.count|0) || 16, 2, 64);

      // If user picked “between”, make sure we have a monotonic A→B→C→D ordering.
      if (placement === 'between'){
        const monotonic = (aSlot < bSlot && bSlot < cSlot && cSlot < dSlot)
          || (aSlot > bSlot && bSlot > cSlot && cSlot > dSlot);
        if (!monotonic){
          const sorted = [aSlot, bSlot, cSlot, dSlot].slice().sort((x,y)=>x-y);
          const lo = sorted[0], m1 = sorted[1], m2 = sorted[2], hi = sorted[3];
          if (aSlot === hi){
            aSlot = hi; bSlot = m2; cSlot = m1; dSlot = lo; // descending
          } else {
            aSlot = lo; bSlot = m1; cSlot = m2; dSlot = hi; // ascending
          }
        }
      }

      const aRec = dpGetSlotWaveRecord(aSlot);
      const bRec = dpGetSlotWaveRecord(bSlot);
      const cRec = dpGetSlotWaveRecord(cSlot);
      const dRec = dpGetSlotWaveRecord(dSlot);
      if (!aRec || !bRec || !cRec || !dRec){
        announceIO('Four-wave morph needs 4 selected slots that contain waves.', true);
        return;
      }

      // Determine overwrite targets
      const targets = [];
      const targetsAB = [];
      const targetsBC = [];
      const targetsCD = [];
      let note = '';

      if (placement === 'between'){
        {
          const step = (bSlot > aSlot) ? 1 : -1;
          for (let s=aSlot+step; s!==bSlot; s+=step) targetsAB.push(s);
        }
        {
          const step = (cSlot > bSlot) ? 1 : -1;
          for (let s=bSlot+step; s!==cSlot; s+=step) targetsBC.push(s);
        }
        {
          const step = (dSlot > cSlot) ? 1 : -1;
          for (let s=cSlot+step; s!==dSlot; s+=step) targetsCD.push(s);
        }

        targets.push(...targetsAB, ...targetsBC, ...targetsCD);
        if (!targets.length){
          announceIO('No slots between A↔B↔C↔D. Choose "Write after A".', true);
          return;
        }
      } else {
        const maxCount = 64 - aSlot;
        const count = Math.min(requestedCount, maxCount);
        if (count < 2){
          announceIO('Not enough slots after A to write a morph series. Choose an earlier slot for A.', true);
          return;
        }
        if (count !== requestedCount) note = `\n\nNote: Only ${count} slot(s) remain from slot ${aSlot+1}, so this will fill up to slot ${aSlot+count}.`;
        for (let s=aSlot+1; s<aSlot+count; s++) targets.push(s);
      }

      // Confirm overwrite
      const aName = (aRec.name||'WAVE');
      const bName = (bRec.name||'WAVE');
      const cName = (cRec.name||'WAVE');
      const dName = (dRec.name||'WAVE');
      const label = dpEvolveDualModeLabel(modes);
      let msg;

      if (placement === 'between'){
        msg = `Four-wave morph (${label}) will overwrite ${targets.length} slot(s) between A↔B, B↔C and C↔D.\n\nA: slot ${aSlot+1} (${aName})\nB: slot ${bSlot+1} (${bName})\nC: slot ${cSlot+1} (${cName})\nD: slot ${dSlot+1} (${dName})\n\nAnchors are left unchanged. Continue?`;
      } else {
        const overwriteStartNo = aSlot + 2;
        const overwriteEndNo = aSlot + 1 + targets.length;
        const overlap = [];
        if (targets.includes(bSlot)) overlap.push(bSlot+1);
        if (targets.includes(cSlot)) overlap.push(cSlot+1);
        if (targets.includes(dSlot)) overlap.push(dSlot+1);
        const overlapNote = overlap.length
          ? `\n\nWarning: With “Write after A”, anchor slot(s) ${overlap.join(', ')} will also be overwritten.`
          : '';
        msg = `Four-wave morph (${label}) will overwrite slots ${overwriteStartNo}..${overwriteEndNo} with ${targets.length} new wave(s).\n\nA: slot ${aSlot+1} (${aName})\nB: slot ${bSlot+1} (${bName})\nC: slot ${cSlot+1} (${cName})\nD: slot ${dSlot+1} (${dName})\n\nSlot ${aSlot+1} is left unchanged. Continue?${note}`;
        msg += overlapNote;
      }

      if (!confirm(msg)) return;

      const __bankBefore = captureBankState(targets, { preferEditor:true });
      const aTok = fileToken4(aName);
      const dTok = fileToken4(dName);
      const prefix2 = ((aTok[0]||'M') + (dTok[0]||'M')).toUpperCase().slice(0,2).padEnd(2,'M');

      try{
        if (placement === 'between'){
          const totalStepsAB = Math.abs(bSlot - aSlot);
          for (let i=0;i<targetsAB.length;i++){
            const s = targetsAB[i]|0;
            const dist = Math.abs(s - aSlot);
            const t = (totalStepsAB>0) ? (dist / totalStepsAB) : 1;

            const out = dpApplyMorphModeChain(aRec.dataU8, bRec.dataU8, t, modes);
            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');
            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }

          const totalStepsBC = Math.abs(cSlot - bSlot);
          for (let i=0;i<targetsBC.length;i++){
            const s = targetsBC[i]|0;
            const dist = Math.abs(s - bSlot);
            const t = (totalStepsBC>0) ? (dist / totalStepsBC) : 1;

            const out = dpApplyMorphModeChain(bRec.dataU8, cRec.dataU8, t, modes);
            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');
            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }

          const totalStepsCD = Math.abs(dSlot - cSlot);
          for (let i=0;i<targetsCD.length;i++){
            const s = targetsCD[i]|0;
            const dist = Math.abs(s - cSlot);
            const t = (totalStepsCD>0) ? (dist / totalStepsCD) : 1;

            const out = dpApplyMorphModeChain(cRec.dataU8, dRec.dataU8, t, modes);
            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');
            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        } else {
          const n = targets.length;
          const oneThird = 1/3;
          for (let i=0;i<n;i++){
            const s = targets[i]|0;
            const tGlobal = (n<=1) ? 1 : ((i+1) / n); // 0..1

            const out = (tGlobal <= oneThird)
              ? dpApplyMorphModeChain(aRec.dataU8, bRec.dataU8, (tGlobal/oneThird), modes)
              : (tGlobal <= 2*oneThird)
                ? dpApplyMorphModeChain(bRec.dataU8, cRec.dataU8, ((tGlobal-oneThird)/oneThird), modes)
                : dpApplyMorphModeChain(cRec.dataU8, dRec.dataU8, ((tGlobal-2*oneThird)/oneThird), modes);
            const num2 = String(s+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');
            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        }
      } catch(err){
        console.error(err);
        try{ if (typeof applyBankState === 'function') applyBankState(__bankBefore); }catch(_){ }
        announceIO('Four-wave morph failed (see Console).', true);
        return;
      }

      // If the editor is showing a slot we overwrote, reload it so the waveform updates.
      const editorSlot = EDIT.slot|0;
      if (targets.includes(editorSlot)){
        try{ dpLoadWaveIntoEditor(editorSlot); }catch(_){ }
      }

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Morph ${aSlot+1}→${bSlot+1}→${cSlot+1}→${dSlot+1} (${dpEvolveDualModeLabel(modes)})`, before: __bankBefore, after: __bankAfter });

      announceIO(`Morphed A(${aSlot+1}) → B(${bSlot+1}) → C(${cSlot+1}) → D(${dSlot+1}) into ${targets.length} slot${targets.length===1?'':'s'} (${dpEvolveDualModeLabel(modes)}).`);
      updateButtonsState();
    }


    // === Multi-slot gap fill (4+ selected slots) ===
    // Treats 4+ selected waves as anchors and fills only the gaps between adjacent anchors.
    // Anchor slots are never overwritten.

    function dpPromptEvolveKeyframeOptions(keySlots){
      return new Promise((resolve)=>{
        const slots = (Array.isArray(keySlots) ? keySlots.slice() : [])
          .map(n=>_clampInt(n|0, 0, 63))
          .filter(i=>i>=0 && i<64)
          .sort((a,b)=>a-b);

        if (slots.length < 4){ resolve(null); return; }

        dpSetStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_STATE.modes || EVOLVE_DUAL_STATE.mode || 'specblur', EVOLVE_DUAL_MODES, 'specblur', 3);

        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        dlg.classList.add('mm-evolve-dlg');

        const h = el('h4');
        h.textContent = 'Fill gaps (multi-select)';

        const p = el('div');
        p.className = 'mm-small';
        p.textContent = 'Fills only the gaps between the selected anchor slots using the chosen morph mode. Anchor slots are never overwritten.';

        const keyLine = el('div');
        keyLine.className = 'mm-small';
        keyLine.style.opacity = '0.9';
        keyLine.style.marginBottom = '6px';

        const modeLbl = el('div');
        modeLbl.className = 'mm-small';
        modeLbl.textContent = 'Morph mode:';

        // Morph modes (grouped): keeps all options visible but easier to scan.
        const modeGroups = (typeof dpGroupItemsByIds === 'function')
          ? dpGroupItemsByIds(EVOLVE_DUAL_MODES, (typeof EVOLVE_DUAL_MODE_GROUP_DEFS !== 'undefined') ? EVOLVE_DUAL_MODE_GROUP_DEFS : [], 'Other')
          : [{ title:'', items: EVOLVE_DUAL_MODES }];

        const modeUI = (typeof dpBuildModeGroups === 'function')
          ? dpBuildModeGroups(modeGroups, (id, ev)=>{ dpPickStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', id, ev, 3); refresh(); })
          : (()=>{ const row=el('div','mm-digi-io mm-small'); (EVOLVE_DUAL_MODES||[]).forEach(m=>{ const b=el('button'); b.textContent=m.label; if (m.desc) b.title=m.desc; b.onclick=(ev)=>{ dpPickStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', m.id, ev, 3); refresh(); }; row.append(b); }); return { node:row, btnPairs:[] }; })();

        const rowModes = modeUI.node;
        const modeBtnPairs = modeUI.btnPairs;
        const chainUI = dpBuildModeChainEditor({
          title: 'Sequence',
          labelFn: (id)=>dpEvolveDualModeLabel(id),
          onMove: (idx, dir)=>{ dpMoveStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, dir, 3); refresh(); },
          onRemove: (idx)=>{ dpRemoveStoredModeChainStep(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', idx, 3); refresh(); },
        });

        const preview = el('div');
        preview.className = 'mm-small';
        preview.style.opacity = '0.9';

        const rowBtns = el('div','mm-digi-io mm-small');
        const bRun = el('button'); bRun.textContent = 'Run';
        // Keyboard: Enter should trigger the primary action.
        bRun.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent = 'Cancel';
        rowBtns.append(bRun, bCancel);

        function setActive(btn, on){
          btn.classList.toggle('mm-mode-active', !!on);
        }

        function calcTargets(){
          const t = [];
          for (let i=0;i<slots.length-1;i++){
            const a = slots[i]|0;
            const b = slots[i+1]|0;
            for (let s=a+1; s<b; s++) t.push(s);
          }
          return t;
        }

        function refresh(){
          // Show anchors with names (compact).
          const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          const parts = slots.map((s, i)=>{
            const rec = dpGetSlotWaveRecord(s);
            const nm = rec ? (rec.name||'WAVE') : 'WAVE';
            const tag = letters[i] || String(i+1);
            return `${tag}:${s+1}(${nm})`;
          });
          keyLine.textContent = `Anchors: ${parts.join(' • ')}`;

          const modes = dpGetStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          if (typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeBtnPairs, modes);
          }
          chainUI.render(modes);

          const targets = calcTargets();
          if (!targets.length){
            preview.textContent = 'No gaps between anchors (nothing to fill).';
            bRun.disabled = true;
          } else {
            bRun.disabled = false;
            const lo = Math.min(...targets) + 1;
            const hi = Math.max(...targets) + 1;
            preview.textContent = `Will overwrite ${targets.length} slot(s) between anchors (slot ${lo}..${hi}). Mode: ${dpEvolveDualModeLabel(modes)}.`;
          }
        }

        function close(v){
          try{ overlay.remove(); }catch(_){}
          try{ document.removeEventListener('keydown', onKey); }catch(_){}
          resolve(v);
        }

        function onKey(e){
          if (e.key === 'Escape'){
            e.preventDefault();
            close(null);
          }
        }

        overlay.onclick = (e)=>{ if (e.target === overlay) close(null); };
        bCancel.onclick = ()=>close(null);
        bRun.onclick = ()=>{
          const modes = dpGetStoredModeChain(EVOLVE_DUAL_STATE, 'modes', 'mode', EVOLVE_DUAL_MODES, 'specblur', 3);
          close({ slots, mode: modes[0] || 'specblur', modes });
        };

        dlg.append(h, p, el('hr'), keyLine, modeLbl, rowModes, chainUI.node, el('hr'), preview, rowBtns);
        overlay.append(dlg);
        document.body.append(overlay);
        document.addEventListener('keydown', onKey);

        refresh();
      });
    }

    async function doEvolveKeyframesSelected(opts){
      opts = opts || {};
      const slots = (Array.isArray(opts.slots) ? opts.slots.slice() : dpSelectedKeyframeSlots(4))
        .map(n=>_clampInt(n|0, 0, 63))
        .filter(i=>i>=0 && i<64)
        .sort((a,b)=>a-b);

      if (slots.length < 4){
        announceIO('Fill gaps requires 4+ selected slots that contain waves.', true);
        return;
      }

      const modes = dpSanitizeModeChain(opts.modes || opts.mode || EVOLVE_DUAL_STATE.modes || EVOLVE_DUAL_STATE.mode, EVOLVE_DUAL_MODES, 'specblur', 3);
      const mode = modes[0] || 'specblur';

      const recs = slots.map(s=>dpGetSlotWaveRecord(s));
      if (recs.some(r=>!r || !r.dataU8 || !r.dataU8.length)){
        announceIO('Fill gaps requires all selected anchor slots to contain wave data.', true);
        return;
      }

      // Build segments + overwrite targets (gaps only).
      const segments = [];
      const targets = [];
      for (let i=0;i<slots.length-1;i++){
        const aSlot = slots[i]|0;
        const bSlot = slots[i+1]|0;
        const segTargets = [];
        for (let s=aSlot+1; s<bSlot; s++) segTargets.push(s);
        if (segTargets.length){
          segments.push({ aSlot, bSlot, aRec: recs[i], bRec: recs[i+1], targets: segTargets });
          targets.push(...segTargets);
        }
      }

      if (!targets.length){
        announceIO('No gaps between selected anchors to fill.', true);
        return;
      }

      // Confirm overwrite
      const label = dpEvolveDualModeLabel(modes);
      const keyLines = slots.map((s, idx)=>{
        const nm = (recs[idx] && recs[idx].name) ? recs[idx].name : 'WAVE';
        return `  • slot ${s+1} (${nm})`;
      }).join('\n');

      const msg =
        `Fill gaps (${label}) will overwrite ${targets.length} slot(s) between the selected anchors.\n\n` +
        `Anchors:\n${keyLines}\n\n` +
        `Anchors are left unchanged. Continue?`;

      if (!confirm(msg)) return;

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      const firstTok = fileToken4((recs[0] && recs[0].name) ? recs[0].name : 'KEY');
      const lastTok  = fileToken4((recs[recs.length-1] && recs[recs.length-1].name) ? recs[recs.length-1].name : 'KEY');
      const prefix2 = ((firstTok[0]||'K') + (lastTok[0]||'F')).toUpperCase().slice(0,2).padEnd(2,'K');

      try{
        for (const seg of segments){
          const totalSteps = Math.abs(seg.bSlot - seg.aSlot);

          for (const s of seg.targets){
            const dist = Math.abs((s|0) - seg.aSlot);
            const t = (totalSteps>0) ? (dist / totalSteps) : 1;

            const out = dpApplyMorphModeChain(seg.aRec.dataU8, seg.bRec.dataU8, t, modes);

            const num2 = String((s|0)+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');

            LIB.waves[s] = attachDisplayRot({ name:nm, dataU8: out, user:true });
            LIB.userWaves[s] = LIB.waves[s];
            LIB.dirty.delete(s);
            paintGridCell(s);
          }
        }
      } catch(err){
        console.error(err);
        // Robust: revert any partial writes.
        try{
          if (typeof applyBankState === 'function') applyBankState(__bankBefore);
        }catch(_){ }
        announceIO('Fill gaps failed (see Console).', true);
        return;
      }

      // If the editor is showing a slot we overwrote, reload it so the waveform updates.
      const editorSlot = EDIT.slot|0;
      if (targets.includes(editorSlot)){
        try{ dpLoadWaveIntoEditor(editorSlot); }catch(_){ }
      }

      const __bankAfter = captureBankState(targets);
      bankPush({ label:`Fill Gaps (${dpEvolveDualModeLabel(modes)})`, before: __bankBefore, after: __bankAfter });

      announceIO(`Filled gaps: ${slots.length} anchors → wrote ${targets.length} slot${targets.length===1?'':'s'} (${label}).`);
      updateButtonsState();
    }

    const BLEND_MODES = [
      { id:'avg',        label:'Time Avg',           desc:'Simple time-domain averaging of the selected cycles (punchy, predictable).' },
      { id:'alignavg',   label:'Aligned Avg',        desc:'Align each selected wave to the first (best circular shift), then average (stronger fundamentals, less hollow).' },
      { id:'median',     label:'Median',             desc:'Per-sample median across selected waves (removes outliers, keeps detail).' },
      { id:'mosaic8',    label:'Mosaic 8',           desc:'Segment mosaic with 8 segments (seeded + tiny crossfades): glitchy but still wavetable-coherent.' },
      { id:'mosaic12',   label:'Mosaic 12',          desc:'Segment mosaic with 12 segments (seeded + tiny crossfades): glitchy but still wavetable-coherent.' },
      { id:'mosaic16',   label:'Mosaic 16',          desc:'Segment mosaic with 16 segments (seeded + tiny crossfades): glitchy but still wavetable-coherent.' },

      { id:'specmag',    label:'Spec Mag (1st phase)', desc:'Average spectral magnitudes then reconstruct, using phase from the first selected wave (smooth, less phasey).' },
      { id:'specmagdom', label:'Spec Mag (dom phase)', desc:'Average spectral magnitudes then reconstruct, using phase from the most energetic selected wave.' },
      { id:'harmx25',    label:'Harm Xover 25%',     desc:'Low harmonics from wave #1, high harmonics from wave #2 (crossover ≈25% of spectrum).' },
      { id:'harmx50',    label:'Harm Xover 50%',     desc:'Low harmonics from wave #1, high harmonics from wave #2 (crossover ≈50% of spectrum).' },
      { id:'harmx75',    label:'Harm Xover 75%',     desc:'Low harmonics from wave #1, high harmonics from wave #2 (crossover ≈75% of spectrum).' },
      { id:'convolve',   label:'Convolve',           desc:'Circular convolution via spectral multiplication (timbres multiply; can get gnarly fast).' },

      { id:'ring',       label:'Ring',               desc:'Ring-multiplies cycles together (can add sideband/AM-like grit).' },
      { id:'xor',        label:'XOR',                desc:'Bitwise XOR across samples (brutal digital glitch; normalize afterwards).' },
      { id:'and',        label:'AND',                desc:'Bitwise AND across samples (digital gating; normalize afterwards).' },
      { id:'or',         label:'OR',                 desc:'Bitwise OR across samples (digital crunch; normalize afterwards).' },
    ];

    function dpBlendModeLabel(id){
      if (Array.isArray(id)) return dpChainLabel(id, dpBlendModeLabel, 'avg');
      const m = BLEND_MODES.find(x=>x.id===id);
      return m ? m.label : String(id||'avg');
    }

    function dpUpdateBlendBtnTitle(){
      if (!btnBlend) return;
      const modes = dpGetStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', 3);
      btnBlend.textContent = 'Blend Sel';
      btnBlend.title = `Blend 2+ selected waves and write the result to a destination slot (prefers the slot after the last selected; if at bank end, uses the first available slot). Mode: ${dpBlendModeLabel(modes)}. Shift-click to change mode.`;
    }

    function dpPromptBlendMode(){
      return new Promise((resolve)=>{
        dpSetStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_STATE.modes || BLEND_STATE.mode || 'avg', BLEND_MODES, 'avg', 3);
        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        const h = el('h4'); h.textContent='Blend mode';
        const p = el('div'); p.className='mm-small';
        p.textContent='Blends selected waves into a single cycle and writes the result to a destination slot (prefers after the last selected; falls back to the first available slot at bank end).';
        // Blend modes (grouped): keeps all options visible but easier to scan.
        const modeGroups = (typeof dpGroupItemsByIds === 'function')
          ? dpGroupItemsByIds(BLEND_MODES, (typeof BLEND_MODE_GROUP_DEFS !== 'undefined') ? BLEND_MODE_GROUP_DEFS : [], 'Other')
          : [{ title:'', items: BLEND_MODES }];

        const modeUI = (typeof dpBuildModeGroups === 'function')
          ? dpBuildModeGroups(modeGroups, (id, ev)=>{ dpPickStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', id, ev, 3); refresh(); })
          : (()=>{ const r=el('div','mm-digi-io mm-small'); (BLEND_MODES||[]).forEach(m=>{ const b=el('button'); b.textContent=m.label; if (m.desc) b.title=m.desc; b.onclick=(ev)=>{ dpPickStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', m.id, ev, 3); refresh(); }; r.append(b); }); return { node:r, btnPairs:[] }; })();

        const rows = modeUI.node;
        const modeBtnPairs = modeUI.btnPairs;
        const chainUI = dpBuildModeChainEditor({
          title: 'Sequence',
          labelFn: (id)=>dpBlendModeLabel(id),
          onMove: (idx, dir)=>{ dpMoveStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', idx, dir, 3); refresh(); },
          onRemove: (idx)=>{ dpRemoveStoredModeChainStep(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', idx, 3); refresh(); },
        });
        const rowBtns = el('div'); rowBtns.className='mm-digi-io mm-small';
        const bOk = el('button'); bOk.textContent='OK'; bOk.title='Use this blend mode.';
        // Keyboard: Enter should confirm the current selection.
        bOk.dataset.default = '1';
        const bCancel = el('button'); bCancel.textContent='Cancel';
        rowBtns.append(bOk,bCancel);
        function setActive(btn,on){ btn.classList.toggle('mm-mode-active', !!on); }
        function refresh(){
          const modes = dpGetStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', 3);
          if (typeof dpSetActiveInBtnPairs === 'function'){
            dpSetActiveInBtnPairs(modeBtnPairs, modes);
          }
          chainUI.render(modes);
        }
        bCancel.onclick=()=>{ overlay.remove(); resolve(null); };
        bOk.onclick=()=>{
          const modes = dpGetStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', 3);
          overlay.remove();
          resolve({ mode: modes[0] || 'avg', modes });
        };
        dlg.append(h,p,el('hr'),rows,chainUI.node,el('hr'),rowBtns);
        overlay.append(dlg);
        document.body.append(overlay);
        refresh();
      });
    }

    function doBlendSelected(){
      const modes = dpGetStoredModeChain(BLEND_STATE, 'modes', 'mode', BLEND_MODES, 'avg', 3);
      const mode = modes[0] || 'avg';
      const editorSlot = EDIT.slot|0;
      const sel = SELECTED ? Array.from(SELECTED).sort((a,b)=>a-b) : [];
      if (sel.length < 2){
        announceIO('Select 2+ slots with waves to blend.', true);
        return;
      }

      // Prefer writing after the last selected slot. If that would overflow (slot 64+),
      // gracefully fall back to an available non-source slot (matching FUSE behavior).
      const lastSel = (sel[sel.length-1]|0);
      const srcSet = new Set(sel.map(n=>n|0));
      let targetSlot = lastSel + 1;
      if (targetSlot < 0 || targetSlot >= 64){
        let found = -1;
        for (let s=0;s<64;s++){
          if (srcSet.has(s)) continue;
          const isDirtyActive = (s===editorSlot) && (LIB.dirty && LIB.dirty.has && LIB.dirty.has(s)) && EDIT.dataU8 && EDIT.dataU8.length;
          if (isDirtyActive) continue;
          if (!LIB.waves[s]){ found = s; break; }
        }
        // If no empty destination exists, fall back to any non-source slot (will confirm overwrite).
        if (found < 0){
          for (let s=0;s<64;s++){
            if (!srcSet.has(s)){ found = s; break; }
          }
        }
        targetSlot = (found >= 0) ? found : (lastSel|0);
      }

      // Safety: warn before overwriting an existing slot (or unsaved editor buffer).
      const __tRec = LIB.waves[targetSlot] || null;
      const __tHas = !!(__tRec && __tRec.dataU8 && __tRec.dataU8.length);
      const __tDirty = (targetSlot===editorSlot) && (LIB.dirty && LIB.dirty.has && LIB.dirty.has(targetSlot));
      const __overwritingSource = srcSet.has(targetSlot|0);
      if (__tHas || __tDirty || __overwritingSource){
        const __prevName = (__tDirty ? (EDIT && EDIT.name) : (__tRec && __tRec.name)) || 'WAVE';
        const __what = __overwritingSource
          ? 'one of your SOURCE slots'
          : (__tDirty ? 'UNSAVED editor changes' : 'an existing wave');
        const __ok = confirm(`Blend will overwrite slot ${targetSlot+1} (${__prevName}) which currently contains ${__what}. Continue?`);
        if (!__ok) return;
      }


      const sources = [];
      for (const s of sel){
        if (s===editorSlot && LIB.dirty.has(s) && EDIT.dataU8){
          sources.push(new Uint8Array(EDIT.dataU8));
        } else if (LIB.waves[s] && LIB.waves[s].dataU8){
          sources.push(new Uint8Array(LIB.waves[s].dataU8));
        }
      }

      if (sources.length < 2){
        announceIO('Select 2+ slots with waves to blend.', true);
        return;
      }

      const N = (EDIT.dataU8 && EDIT.dataU8.length) ? EDIT.dataU8.length : 96;
      const resampToN = (a)=>{
        if (a.length===N) return a;
        if (typeof resampleU8_AA === 'function') return resampleU8_AA(a, N, 16);
        const tmp = new Uint8Array(N);
        const M = (a.length|0) || 1;
        for (let i=0;i<N;i++) tmp[i] = a[Math.floor(i*M/N)] || 128;
        return tmp;
      };
      const src = sources.map(resampToN);

      const pct = _clampInt(Number(NORM_PCT||100),0,100);

      // --- Blend helpers (deterministic + cheap at N=96) ---
      const _hashU8 = (u8)=>{
        let h = 2166136261>>>0;
        for (let i=0;i<u8.length;i++) h = Math.imul(h ^ (u8[i] & 255), 16777619);
        return h>>>0;
      };
      const _mulberry32 = (seed)=>{
        let a = seed>>>0;
        return ()=>{
          a |= 0;
          a = (a + 0x6D2B79F5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      };
      const _rotateU8 = (u8, shift)=>{
        const NN = u8.length|0;
        const out = new Uint8Array(NN);
        if (!NN) return out;
        let s = shift|0;
        s = ((s % NN) + NN) % NN;
        for (let i=0;i<NN;i++) out[i] = u8[(i + s) % NN];
        return out;
      };
      const _bestCircularShift = (refU8, candU8)=>{
        const NN = refU8.length|0;
        let bestS = 0;
        let bestDot = -Infinity;
        for (let s=0;s<NN;s++){
          let dot = 0;
          for (let i=0;i<NN;i++) dot += ((refU8[i]-128)) * ((candU8[(i+s)%NN]-128));
          if (dot > bestDot){ bestDot = dot; bestS = s; }
        }
        return bestS;
      };
      const _smoothstep = (x)=>{
        x = _clamp01(x);
        return x*x*(3-2*x);
      };

      const computeBlendOnce = (modeId, srcSet)=>{
        const mode = String(modeId || 'avg');
        const src = Array.isArray(srcSet) ? srcSet : [];
        let out;

      if (mode === 'specmag' || mode === 'specmagdom'){
        // Average magnitudes, keep phase from first (or dominant) wave
        const dfts = src.map(a=>dftRealU8(a));
        const N2 = dfts[0].re.length;
        const outRe = new Float32Array(N2);
        const outIm = new Float32Array(N2);

        let phSrc = dfts[0];
        if (mode === 'specmagdom' && dfts.length > 1){
          let bestJ = 0;
          let bestE = -Infinity;
          const H = N2>>1;
          for (let j=0;j<dfts.length;j++){
            let e = 0;
            for (let k=1;k<H;k++){
              const re = dfts[j].re[k], im = dfts[j].im[k];
              e += re*re + im*im;
            }
            if (e > bestE){ bestE = e; bestJ = j; }
          }
          phSrc = dfts[bestJ];
        }

        for (let k=0;k<N2;k++){
          let magSum = 0;
          for (let j=0;j<dfts.length;j++){
            const re = dfts[j].re[k], im = dfts[j].im[k];
            magSum += Math.hypot(re, im);
          }
          const mag = magSum / dfts.length;
          const ph = Math.atan2(phSrc.im[k], phSrc.re[k]);
          outRe[k] = mag * Math.cos(ph);
          outIm[k] = mag * Math.sin(ph);
        }
        enforceConjugateSym(outRe, outIm);
        out = idftToU8(outRe, outIm);

      } else if (mode === 'convolve'){
        // Circular convolution: multiply complex spectra bin-wise, then iDFT.
        const dfts = src.map(a=>dftRealU8(a));
        const N2 = dfts[0].re.length;
        const outRe = new Float64Array(N2);
        const outIm = new Float64Array(N2);
        outRe.set(dfts[0].re);
        outIm.set(dfts[0].im);
        for (let j=1;j<dfts.length;j++){
          const reB = dfts[j].re, imB = dfts[j].im;
          for (let k=0;k<N2;k++){
            const ar = outRe[k], ai = outIm[k];
            const br = reB[k], bi = imB[k];
            outRe[k] = ar*br - ai*bi;
            outIm[k] = ar*bi + ai*br;
          }
        }
        enforceConjugateSym(outRe, outIm);
        out = idftToU8(outRe, outIm);

      } else if (mode === 'harmx25' || mode === 'harmx50' || mode === 'harmx75'){
        // Harmonic crossover: low harmonics from wave #1, high harmonics from wave #2.
        const a = src[0], b = src[1];
        const dA = dftRealU8(a);
        const dB = dftRealU8(b);
        const N2 = dA.re.length;
        const H = N2>>1;
        const frac = (mode === 'harmx25') ? 0.25 : (mode === 'harmx75') ? 0.75 : 0.50;
        const k0 = Math.round(frac * (H - 1));
        const width = Math.max(1, Math.min(6, Math.floor((H-1)/16) || 2));

        const outRe = new Float32Array(N2);
        const outIm = new Float32Array(N2);

        // DC from A ("body"), Nyquist from B ("air")
        outRe[0] = dA.re[0]; outIm[0] = 0;
        outRe[H] = dB.re[H]; outIm[H] = 0;

        for (let k=1;k<H;k++){
          const wk = _smoothstep((k - k0 + width) / (2*width));
          outRe[k] = dA.re[k]*(1-wk) + dB.re[k]*wk;
          outIm[k] = dA.im[k]*(1-wk) + dB.im[k]*wk;
        }
        enforceConjugateSym(outRe, outIm);
        out = idftToU8(outRe, outIm);

      } else if (mode === 'alignavg'){
        // Phase-aligned blend: align each selected wave to the first by best circular shift, then average.
        const aligned = [src[0]];
        const ref = src[0];
        for (let j=1;j<src.length;j++){
          const sh = _bestCircularShift(ref, src[j]);
          aligned.push(_rotateU8(src[j], sh));
        }

        const outF = new Float32Array(N);
        for (let i=0;i<N;i++){
          let sum = 0;
          for (let j=0;j<aligned.length;j++) sum += ((aligned[j][i]-128)/127);
          outF[i] = sum / aligned.length;
        }
        // remove DC
        let mean=0; for (let i=0;i<N;i++) mean += outF[i]; mean/=N;
        for (let i=0;i<N;i++) outF[i] -= mean;
        // gentle soft clip
        for (let i=0;i<N;i++) outF[i] = Math.tanh(outF[i]*1.25) / Math.tanh(1.25);
        // scale to target
        let peak=0; for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i]));
        const tgt = _clampInt(Number(NORM_PCT||100),0,100)/100;
        const sc = (peak>1e-9) ? (tgt/peak) : 0;
        out = new Uint8Array(N);
        for (let i=0;i<N;i++) out[i] = clamp(Math.round((outF[i]*sc)*127 + 128),0,255);

      } else if (mode === 'median'){
        // Per-sample median across selected waves
        const M = src.length|0;
        const tmp = new Array(M);
        out = new Uint8Array(N);
        for (let i=0;i<N;i++){
          for (let j=0;j<M;j++) tmp[j] = src[j][i];
          tmp.sort((a,b)=>a-b);
          const mid = M>>1;
          const med = (M & 1) ? tmp[mid] : 0.5*(tmp[mid-1] + tmp[mid]);
          out[i] = clamp(Math.round(med), 0, 255);
        }

      } else if (mode === 'mosaic8' || mode === 'mosaic12' || mode === 'mosaic16'){
        // Segment Mosaic blend: pick source per segment (seeded), stitch with tiny crossfades.
        const segs = (mode === 'mosaic8') ? 8 : (mode === 'mosaic16') ? 16 : 12;
        const L0 = Math.max(1, Math.floor(N / segs));

        // Seed: selection + first wave hash (repeatable)
        let seed = (0xC0FFEE ^ _hashU8(src[0])) >>> 0;
        for (const s of sel) seed = Math.imul(seed ^ ((s|0)+1), 16777619) >>> 0;
        seed ^= (src.length<<16) ^ (segs<<8);
        const rng = _mulberry32(seed);

        const segSrc = new Array(segs);
        out = new Uint8Array(N);

        for (let seg=0; seg<segs; seg++){
          const pick = Math.floor(rng() * src.length) | 0;
          segSrc[seg] = pick;
          const start = seg * L0;
          const end = (seg === segs-1) ? N : Math.min(N, (seg+1)*L0);
          for (let i=start;i<end;i++) out[i] = src[pick][i];
        }

        // Crossfade at each boundary (including wrap-around)
        const fade = Math.min(4, Math.max(1, Math.floor(L0/2)));
        const denom = Math.max(1, (2*fade - 1));
        for (let seg=0; seg<segs; seg++){
          const b = seg * L0;
          const prev = segSrc[(seg - 1 + segs) % segs];
          const next = segSrc[seg];
          if (prev === next) continue;
          for (let d=-fade; d<=fade-1; d++){
            const idx = (b + d + N) % N;
            const w = _smoothstep((d + fade) / denom);
            const aV = src[prev][idx];
            const bV = src[next][idx];
            out[idx] = clamp(Math.round(aV*(1-w) + bV*w), 0, 255);
          }
        }

      } else if (mode === 'xor' || mode === 'and' || mode === 'or'){
        // Bitwise blend modes
        out = new Uint8Array(N);
        for (let i=0;i<N;i++){
          let v = src[0][i] | 0;
          if (mode === 'xor'){
            for (let j=1;j<src.length;j++) v = v ^ (src[j][i] | 0);
          } else if (mode === 'and'){
            for (let j=1;j<src.length;j++) v = v & (src[j][i] | 0);
          } else {
            for (let j=1;j<src.length;j++) v = v | (src[j][i] | 0);
          }
          out[i] = v & 255;
        }

      } else if (mode === 'ring'){
        const outF = new Float32Array(N);
        for (let i=0;i<N;i++){
          const c = ((src[0][i]-128)/127);
          let acc = 0;
          for (let j=1;j<src.length;j++){
            acc += c * ((src[j][i]-128)/127);
          }
          outF[i] = acc / Math.max(1,(src.length-1));
        }
        // remove DC
        let mean=0; for (let i=0;i<N;i++) mean += outF[i]; mean/=N;
        for (let i=0;i<N;i++) outF[i] -= mean;
        // scale to target
        let peak=0; for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i]));
        const tgt = _clampInt(Number(NORM_PCT||100),0,100)/100;
        const sc = (peak>1e-9) ? (tgt/peak) : 0;
        out = new Uint8Array(N);
        for (let i=0;i<N;i++) out[i] = clamp(Math.round((outF[i]*sc)*127 + 128),0,255);

      } else {
        // time-domain average
        const outF = new Float32Array(N);
        for (let i=0;i<N;i++){
          let sum = 0;
          for (let j=0;j<src.length;j++) sum += ((src[j][i]-128)/127);
          outF[i] = sum / src.length;
        }
        // remove DC
        let mean=0; for (let i=0;i<N;i++) mean += outF[i]; mean/=N;
        for (let i=0;i<N;i++) outF[i] -= mean;
        // gentle soft clip
        for (let i=0;i<N;i++) outF[i] = Math.tanh(outF[i]*1.25) / Math.tanh(1.25);
        // scale to target
        let peak=0; for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i]));
        const tgt = _clampInt(Number(NORM_PCT||100),0,100)/100;
        const sc = (peak>1e-9) ? (tgt/peak) : 0;
        out = new Uint8Array(N);
        for (let i=0;i<N;i++) out[i] = clamp(Math.round((outF[i]*sc)*127 + 128),0,255);
      }

        return out;
      };

      const baseSrc = src.map(a=>new Uint8Array(a));
      let curSrc = baseSrc.map(a=>new Uint8Array(a));
      let out = null;
      for (let i=0;i<modes.length;i++){
        out = computeBlendOnce(modes[i], curSrc);
        if (i < (modes.length - 1)){
          curSrc = [new Uint8Array(out)];
          for (let j=1;j<baseSrc.length;j++) curSrc.push(new Uint8Array(baseSrc[j]));
        }
      }

      // Normalize (uses the same target as other batch ops)
      out = fxNormalizeTo(out, pct);

      // Commit to bank (undoable)
      const __bankBefore = captureBankState([targetSlot], { preferEditor:true });

      const num2 = String(targetSlot+1).padStart(2,'0');
      const nm = ('BL' + num2).slice(0,4).padEnd(4,'0');
      LIB.waves[targetSlot] = attachDisplayRot({ name:nm, dataU8: out, user:true });
      LIB.userWaves[targetSlot] = LIB.waves[targetSlot];
      LIB.dirty.delete(targetSlot);
      paintGridCell(targetSlot);

      // If we overwrote the editor's slot, reload it so the waveform updates.
      if ((EDIT.slot|0) === (targetSlot|0)){
        try{ dpLoadWaveIntoEditor(targetSlot|0); }catch(_){ }
      }

      const __bankAfter = captureBankState([targetSlot]);
      bankPush({ label:`Blend →${targetSlot+1} (${dpBlendModeLabel(modes)})`, before: __bankBefore, after: __bankAfter });

      announceIO(`Blended ${sources.length} waves → slot ${targetSlot+1} (${dpBlendModeLabel(modes)}).`);
      updateButtonsState();
    }

        // --- Bottom tools layout (preferred screenshot) ---

    // Mutate amount slider (used when pressing “Mutate”)
    mutateSlider = el('input');
    mutateSlider.type = 'range';
    mutateSlider.min = '0';
    mutateSlider.max = '100';
    mutateSlider.step = '1';
    mutateSlider.value = String(MUTATE_PCT|0);
    mutateSlider.title = `Amount: ${MUTATE_PCT|0}% (Mutate + FUSE)`;

    mutateSlider.oninput = ()=>{
      MUTATE_PCT = clamp(parseInt(mutateSlider.value||'0',10)||0, 0, 100);
      mutateSlider.title = `Amount: ${MUTATE_PCT}% (Mutate + FUSE)`;
      updateButtonsState();
    };

    btnMutate = el('button');
    btnMutate.textContent = 'Mutate';
    btnMutate.title =
      'Mutate selected slots (if any are selected), otherwise mutate all filled slots.\n' +
      'Uses the Amount slider.\n\n' +
      'Click: classic mutate (subtle → gnarlier as Amount increases).\n' +
      'Shift‑click: Wild mutate (more chaotic + surprising), still controlled by Amount.';

    btnClear = el('button');
    btnClear.textContent = 'Clear';
    btnClear.title = 'Clear selected slots (if any are selected), otherwise clear all 64 slots.';
    btnClear.onclick = ()=>{
      const sel = Array.from(SELECTED || []).filter(i=>i>=0 && i<64);
      const targets = sel.length ? sel : Array.from({length:64}, (_,i)=>i);
      promptClearSlots(targets);
    };

    btnMutate.onclick = (ev)=>{
      const targets = gatherMutateTargets();
      doMutateSlots(targets, MUTATE_PCT|0, { wild: !!(ev && ev.shiftKey) });
    };

    // FUSE: new creative generator button (right side of the Mutate slider)
    btnFuse = el('button');
    btnFuse.textContent = 'FUSE';
    btnFuse.title =
      'Create a new wave derived from the selected slot(s) (or the active editor slot if none).\n' +
      'Writes into the slot after the last source (or finds an empty slot if needed).\n' +
      'Uses the Amount slider.\n\n' +
      'Click: subtle harmonic “best‑of” fusion (musical + coherent).\n' +
      'Shift‑click: Harmonic roulette ✨ (unexpected + wild).';
    btnFuse.onclick = (ev)=>dpFuseFromSelection(ev);

    // AMP (gain trim) + NORM (normalize) tools
    // AMP: applies a global dB gain trim across slots (preserves relative levels).
    // NORM: one-click normalize to 100% peak for selected slots.
    // Note: with C6 parity encoding the device path normalises amplitude anyway, so the
    // old “Normalize %” slider is redundant and has been removed.

    // Keep the legacy global around for other tools (Blend/Evolve helpers), but force
    // it to the only meaningful value now that the slider is gone.
    NORM_PCT = 100;

    // Restore persisted dB trim for the AMP operation.
    if (typeof root.__digiproGainAllDb !== 'number' || !isFinite(root.__digiproGainAllDb)){
      let saved = null;
      try{ saved = (root.localStorage && localStorage.getItem('mm_dp_gainAllDb')) ? localStorage.getItem('mm_dp_gainAllDb') : null; }catch(_){ saved = null; }
      const v = Number(saved);
      root.__digiproGainAllDb = isFinite(v) ? v : 0;
    }

    // Gain Trim (dB) slider (no prompt).
    gainAllSlider = el('input');
    gainAllSlider.type = 'range';
    gainAllSlider.min = '-24';
    gainAllSlider.max = '24';
    gainAllSlider.step = '0.5';
    gainAllSlider.value = String(root.__digiproGainAllDb);
    gainAllSlider.title = `Gain trim: ${Number(gainAllSlider.value||0).toFixed(1)} dB`;

    // Compact value label (updates with slider).
    const gainWrap = el('div','mm-rangewrap');
    const gainLabel = el('div','mm-range-labels');
    gainLabel.style.justifyContent = 'center';
    const gainVal = el('span','mm-small');

    const __fmtDb = (v)=>{
      v = Number(v||0);
      if (!isFinite(v)) v = 0;
      const s = (v > 0) ? '+' : '';
      return `${s}${v.toFixed(1)}`;
    };
    gainVal.textContent = `${__fmtDb(root.__digiproGainAllDb)} dB`;
    gainLabel.append(gainVal);
    gainWrap.append(gainAllSlider, gainLabel);

    btnAmpBatch = el('button');
    btnAmpBatch.textContent = 'AMP';
    btnAmpBatch.title =
      'Apply gain trim (dB) to selected slots (if any). If nothing is selected, applies to all filled slots (and the dirty active slot).\n' +
      'Uses the Gain Trim slider. This is a pure multiply (no per-slot normalization), so relative slot levels are preserved.\n\n' +
      'Shift+click: AMP tools (exact trim, ramp, ping-pong, alt skew, stepped gain).';

    gainAllSlider.oninput = ()=>{
      const db = Number(gainAllSlider.value||0);
      root.__digiproGainAllDb = isFinite(db) ? db : 0;
      gainAllSlider.title = `Gain trim: ${root.__digiproGainAllDb.toFixed(1)} dB`;
      // Keep the on-screen value label in sync.
      try{ gainVal.textContent = `${__fmtDb(root.__digiproGainAllDb)} dB`; }catch(_){ }
      try{ root.localStorage && localStorage.setItem('mm_dp_gainAllDb', String(root.__digiproGainAllDb)); }catch(_){ }
    };

    btnAmpBatch.onclick = async (ev)=>{
      if (ev && ev.shiftKey){
        try{
          const opts = await dpPromptAmpShiftOptions();
          if (!opts) return;

          if (opts.mode === 'trim' && gainAllSlider){
            const db = dpAmpClampDb(opts.exactDb, root.__digiproGainAllDb);
            root.__digiproGainAllDb = db;
            gainAllSlider.value = String(db);
            gainAllSlider.title = `Gain trim: ${db.toFixed(1)} dB`;
            try{ gainVal.textContent = `${__fmtDb(db)} dB`; }catch(_){ }
            try{ root.localStorage && localStorage.setItem('mm_dp_gainAllDb', String(db)); }catch(_){ }
          }

          doGainSeriesSlots(opts);
        }catch(err){
          console.warn('AMP tools cancelled/failed:', err);
        }
        return;
      }

      const db = Number(gainAllSlider ? gainAllSlider.value : 0);
      if (!isFinite(db)){
        announceIO('Invalid dB value.', true);
        return;
      }
      doGainAllSlots(db);
    };

    btnNormBatch = el('button');
    btnNormBatch.textContent = 'NORM';
    btnNormBatch.title =
      'Click: Normalize selected slots to 100% peak (undoable).\n' +
      'This peak‑matches slots and removes relative level differences.\n\n' +
      'Shift‑click: Smooth chain playback (phase rotations) — opens options.';

    btnNormBatch.onclick = async (ev)=>{
      // Normal click: peak-normalize selection. Shift-click: smooth chain playback tools.
      if (ev && ev.shiftKey){
        try{
          const opts = await dpPromptSmoothChainOptions();
          if (opts) doSmoothChainSlots(opts);
        }catch(err){
          console.warn('Smooth chain cancelled/failed:', err);
        }
        return;
      }
      doNormalizeAllSlots(100);
    };

    // Batch Name / Evolve / Blend tools
    btnBatchName = el('button');
    btnBatchName.textContent = 'Batch Name';
    btnBatchName.title = 'Batch rename slot names (4 chars). Uses slot numbers so exported files can be reimported to the same positions.';
    btnBatchName.onclick = async ()=>{
      const opts = await dpPromptBatchName();
      if (opts) doBatchRenameSlots(opts);
    };

    btnEvolve = el('button');
    btnEvolve.textContent = 'Evolve';
    btnEvolve.onclick = async (ev)=>{
      // Multi-selection always takes precedence over the single-wave Evolve UI.
      // If 2+ tiles are selected, never show the single-wave Evolve settings.
      const selCount = (SELECTED && typeof SELECTED.size === 'number') ? (SELECTED.size|0) : 0;
      if (selCount >= 2){
        // Special case: if exactly THREE slots are selected (and all contain waves),
        // open the Three‑Wave Morph mode (A→B→C, with B as midpoint).
        const sel3 = (typeof dpSelectedThreeWaveSlots === 'function') ? dpSelectedThreeWaveSlots() : [];
        if (sel3 && sel3.length===3){
          // A/B/C order should always match the *visual* slot order (1→64),
          // regardless of click/selection order.
          const sorted = sel3.slice().sort((a,b)=>a-b);
          const aSlot = sorted[0], bSlot = sorted[1], cSlot = sorted[2];

          const opts = await dpPromptEvolveTripleOptions(aSlot, bSlot, cSlot);
          if (!opts) return;
          await doEvolveThreeSelected(opts);
          return;
        }

        // Special case: if exactly TWO slots are selected (and both contain waves),
        // open the Two‑Wave Morph mode.
        const sel2 = (typeof dpSelectedTwoWaveSlots === 'function') ? dpSelectedTwoWaveSlots() : [];
        if (sel2 && sel2.length===2){
          // A/B order should always match the *visual* slot order (1→64),
          // regardless of click/selection order.
          const sorted = sel2.slice().sort((a,b)=>a-b);
          const aSlot = sorted[0], bSlot = sorted[1];

          const opts = await dpPromptEvolveDualOptions(aSlot, bSlot);
          if (!opts) return;
          await doEvolveTwoSelected(opts);
          return;
        }

        // Special case: if exactly FOUR slots are selected (and all contain waves),
        // open the Four‑Wave Morph mode (A→B→C→D).
        const sel4 = (typeof dpSelectedFourWaveSlots === 'function') ? dpSelectedFourWaveSlots() : [];
        if (sel4 && sel4.length===4){
          const sorted = sel4.slice().sort((a,b)=>a-b);
          const aSlot = sorted[0], bSlot = sorted[1], cSlot = sorted[2], dSlot = sorted[3];

          const opts = await dpPromptEvolveQuadOptions(aSlot, bSlot, cSlot, dSlot);
          if (!opts) return;
          await doEvolveFourSelected(opts);
          return;
        }

        // Special case: if 5+ slots are selected (and all contain waves),
        // fill the gaps between each adjacent anchor.
        const selK = (typeof dpSelectedKeyframeSlots === 'function') ? dpSelectedKeyframeSlots(5) : [];
        if (selK && selK.length>=5){
          const opts = await dpPromptEvolveKeyframeOptions(selK);
          if (!opts) return;
          await doEvolveKeyframesSelected(opts);
          return;
        }

        // Multi-selection is active, but it isn't a valid Evolve target.
        announceIO('Multi‑Evolve requires either: 2 selected waves (Dual morph), 3 selected waves (Triple morph), 4 selected waves (Four-wave morph), or 5+ selected waves (Fill gaps). All selected slots must contain wave data.', true);
        return;
      }

      // Single-wave Evolve:
      //  - Shift-click opens settings.
      //  - Normal click runs using last settings.
      if (ev && ev.shiftKey){
        const opts = await dpPromptEvolveOptions();
        if (!opts) return;
        dpUpdateEvolveBtnTitle();
        await doEvolveFromSlot(opts);
      } else {
        await doEvolveFromSlot();
      }
    };
    dpUpdateEvolveBtnTitle();

    btnBlend = el('button');
    btnBlend.textContent = 'Blend Sel';
    btnBlend.onclick = async (ev)=>{
      if (ev && ev.shiftKey){
        const opts = await dpPromptBlendMode();
        if (!opts) return;
        dpUpdateBlendBtnTitle();
      }
      doBlendSelected();
    };
    dpUpdateBlendBtnTitle();

    // --- Assemble rows to match the preferred screenshot ---
    const rowMutate = el('div','mm-dp-row mm-dp-btnslider');
    rowMutate.append(btnMutate, mutateSlider, btnFuse);

    const rowBatch = el('div','mm-dp-row mm-dp-two');
    rowBatch.append(btnBatchName, btnEvolve);

    const rowBlend = el('div','mm-dp-row mm-dp-two');
    rowBlend.append(btnBlend, btnRandAll);

    const rowNorm = el('div','mm-dp-row mm-dp-btnslider mm-dp-norm-row');
    // One row: AMP button + wide gain slider + NORM button (normalize is always 100% now).
    rowNorm.append(btnAmpBatch, gainWrap, btnNormBatch);
    const rowSave = el('div','mm-dp-row mm-dp-save-row');
    // Slot number + name (moved from the top-left controls panel)
    rowSave.append(slotRow, btnClear);

// --- Header rows (match reference UI layout) ---
    // Build compact IO groups first.
    const rowDl = el('div','mm-digi-io mm-small');
    rowDl.append(btnReqSlots, btnReqAll);

    const rowUl = el('div','mm-digi-io mm-small');
    rowUl.append(btnUploadSlots, btnUploadAll);

    const rowLoad = el('div','mm-digi-io mm-small');
    // Keep inputs in DOM (hidden) for Safari’s security model
    fIn.style.display = 'none';
    fLoopIn.style.display = 'none';
    const btnLoadAudio = el('button'); btnLoadAudio.textContent = 'Load Audio';
    btnLoadAudio.title = 'Import WAVs into the active slot (multi-select fills consecutive slots). Shift-click to respect slot numbers in filenames/SysEx; Alt-click forces sequential.';
    btnLoadAudio.onclick = (ev)=>{
      if (FILE_IMPORT_STATE){
        FILE_IMPORT_STATE.mode = (ev && ev.shiftKey) ? 'auto' : ((ev && ev.altKey) ? 'sequential' : 'smart');
        FILE_IMPORT_STATE.fixedSlot = (typeof activeIdx === 'number') ? (activeIdx|0) : ((EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : 0);
      }
      // User feedback: file picker opens next.
      try{ if (!(JOB && JOB.running)) announceIO('Choose file(s) to import…'); }catch(_){ }
      fIn.click();
    };
    const dpLoopModeLabel = (mode)=>{
      mode = String(mode||'raw');
      const base = (mode === 'raw') ? 'Raw contiguous (playback)'
        : (mode === 'equal') ? 'Wavetable: Equal slices'
        : (mode === 'overlap8') ? 'Wavetable: Overlap ×8'
        : 'Wavetable: Overlap ×4';

      // Include creative options in the hover title (keep the on-button label compact).
      const seam = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.seam) ? String(LOOP_IMPORT_STATE.seam) : 'none';
      const dc = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.dc) ? String(LOOP_IMPORT_STATE.dc) : 'keep';
      const rev = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.reverse) ? String(LOOP_IMPORT_STATE.reverse) : 'none';
      const inv = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.invert) ? String(LOOP_IMPORT_STATE.invert) : 'none';
      const gain = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.gain) ? String(LOOP_IMPORT_STATE.gain) : 'none';
      const ws = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.warpSt,10))) ? (parseInt(LOOP_IMPORT_STATE.warpSt,10)|0) : 0;
      const wc = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.warpCt,10))) ? (parseInt(LOOP_IMPORT_STATE.warpCt,10)|0) : 0;
      const wr = !!(LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.warpRamp);

      const order = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.order) ? String(LOOP_IMPORT_STATE.order) : 'normal';
      const orderSeed = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.orderSeed,10))) ? (parseInt(LOOP_IMPORT_STATE.orderSeed,10)|0) : 1;
      const alignAdj = !!(LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.alignAdj);
      const alignWin = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.alignWin,10))) ? (parseInt(LOOP_IMPORT_STATE.alignWin,10)|0) : 64;
      const tilt = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.tilt) ? String(LOOP_IMPORT_STATE.tilt) : 'none';
      const tiltAmt = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.tiltAmt,10))) ? (parseInt(LOOP_IMPORT_STATE.tiltAmt,10)|0) : 0;
      const rawOverlap = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.rawOverlap,10))) ? (parseInt(LOOP_IMPORT_STATE.rawOverlap,10)|0) : 0;
      const rawWindow = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.rawWindow) ? String(LOOP_IMPORT_STATE.rawWindow) : 'none';

      const extras = [];

      if (mode === 'raw'){
        if (dc && dc !== 'keep') extras.push(`DC:${dc==='perSlice'?'per-slice':'global'}`);
        if (seam && seam !== 'none'){
          const zcw = (LOOP_IMPORT_STATE && isFinite(parseInt(LOOP_IMPORT_STATE.zcWin,10))) ? (parseInt(LOOP_IMPORT_STATE.zcWin,10)|0) : 32;
          extras.push(seam==='detrend' ? 'detrend' : seam==='rotateZC' ? 'rotate→ZC' : seam==='zcCut' ? `ZC cut ±${zcw}` : seam);
        }
        if (rawOverlap > 0){
          extras.push(`Overlap:${rawOverlap}%${(rawWindow && rawWindow !== 'none') ? (' ' + rawWindow) : ''}`);
        }
      }

      // Creative transforms that apply to both raw and wavetable modes
      if (order && order !== 'normal'){
        extras.push(order === 'scramble' ? (`Order:scramble (seed ${orderSeed})`) : (`Order:${order}`));
      }
      if (tilt && tilt !== 'none' && tiltAmt > 0){
        extras.push(`Tilt:${tilt} @${tiltAmt}`);
      }
      if (alignAdj){
        extras.push(`Align:${alignWin}`);
      }

      const fx = [];
      if (rev && rev !== 'none') fx.push(`rev:${rev}`);
      if (inv && inv !== 'none') fx.push(`inv:${inv}`);
      if (gain && gain !== 'none') fx.push(`gain:${gain}`);
      if (ws || wc){
        let w = '';
        if (ws) w += `${ws}st`;
        if (wc) w += `${wc>=0?'+':''}${wc}c`;
        if (!w) w = '0';
        fx.push(`warp:${w}${wr?' ramp':''}`);
      }
      if (fx.length) extras.push('FX ' + fx.join(','));

      return extras.length ? (base + ' (' + extras.join('; ') + ')') : base;
    };

    function dpPromptLoopImportMode(){
      return new Promise((resolve)=>{
        const overlay = el('div','mm-digi-guard');
        const dlg = el('div','dlg');
        dlg.style.width = 'min(1200px, 96vw)';
dlg.style.maxHeight = '92vh';
dlg.style.overflow = 'auto';
dlg.style.boxSizing = 'border-box';
        const h = el('h4'); h.textContent = 'Loop import options';
        const p = el('div'); p.className = 'mm-small';
        p.textContent = 'Choose how to map a loop into slots. Import starts at the currently active slot and writes forward. “Raw contiguous” is intended for breakbeat/loop playback by stepping through slots. Normal click uses the last settings; Shift‑click opens this menu.';

        function setOutline(btn, on){ btn.style.outline = on ? '2px solid #fff' : ''; }

        // --- Slot count ---
        const countLbl = el('div'); countLbl.className = 'mm-small';
        countLbl.textContent = 'Slots:';
        const rowCount = el('div');
        rowCount.style.display = 'flex';
        rowCount.style.flexWrap = 'wrap';
        rowCount.style.gap = '8px';
        rowCount.style.marginTop = '6px';

        const counts = [8,16,32,48,64];
        const countBtns = [];
        function setCount(c){
          LOOP_IMPORT_STATE.count = c;
          countBtns.forEach(b=> setOutline(b, b.__count === c));
        }
        counts.forEach(c=>{
          const b = el('button');
          b.textContent = String(c);
          b.title = `Fill ${c} slots starting at the active slot (writes forward).`;
          b.__count = c;
          b.onclick = ()=> setCount(c);
          countBtns.push(b);
          rowCount.appendChild(b);
        });

        // --- Mode ---
        const modeLbl = el('div'); modeLbl.className = 'mm-small';
        modeLbl.textContent = 'Mode:';
        const rowMode = el('div');
        rowMode.style.display = 'flex';
        rowMode.style.flexWrap = 'wrap';
        rowMode.style.gap = '8px';
        rowMode.style.marginTop = '6px';

        const modeBtns = [];
        function setMode(mode){
          LOOP_IMPORT_STATE.mode = mode;
          modeBtns.forEach(b=> setOutline(b, b.__mode === mode));
        }
        function addModeBtn(label, mode, title){
          const b = el('button');
          b.textContent = label;
          b.__mode = mode;
          if (title) b.title = title;
          b.onclick = ()=>{ setMode(mode); refreshAll(); };
          modeBtns.push(b);
          rowMode.appendChild(b);
        }
        addModeBtn('Raw contiguous (loop playback)', 'raw', 'Slices the loop into contiguous chunks so stepping through slots plays the loop (great for breakbeat/loop playback).');
        addModeBtn('Wavetable: Equal slices', 'equal', 'Splits the loop into equal-length slices and derives per-slot cycles (classic wavetable from a loop).');
        addModeBtn('Wavetable: Overlap ×4 (classic)', 'overlap4', 'Builds each slot from 4 overlapping windows (smoother table scans; classic mode).');
        addModeBtn('Wavetable: Overlap ×8 (smoother)', 'overlap8', 'Like Overlap ×4 but with 8 windows (even smoother/less stepping, slightly softer).');

        // --- Raw seam options (raw-only) ---
        const rawLbl = el('div'); rawLbl.className = 'mm-small';
        rawLbl.textContent = 'Raw slice seam (raw-only):';
        const rowSeam = el('div');
        rowSeam.style.display = 'flex';
        rowSeam.style.flexWrap = 'wrap';
        rowSeam.style.gap = '8px';
        rowSeam.style.marginTop = '6px';

        const seamOpts = [
          { id:'none',     label:'Legacy',     title:'Hard cuts at slice boundaries (fast, may click).' },
          { id:'detrend',  label:'Detrend',    title:'Removes per-slice slope/DC to reduce clicks and “thumps” at seams.' },
          { id:'rotateZC', label:'Rotate→ZC',  title:'Rotates each slice so it starts near a zero-crossing (good click reduction, preserves content).' },
          { id:'zcCut',    label:'ZC cut',     title:'Moves the cut point to the nearest zero-crossing within the window (disabled when Raw overlap > 0%).' },
        ];
        const seamBtns = [];
        function setSeam(id){
          LOOP_IMPORT_STATE.seam = id;
          seamBtns.forEach(b=> setOutline(b, b.__seam === id));
        }
        seamOpts.forEach(o=>{
          const b = el('button');
          b.textContent = o.label;
          if (o.title) b.title = o.title;
          b.__seam = o.id;
          b.onclick = ()=>{ setSeam(o.id); refreshAll(); };
          seamBtns.push(b);
          rowSeam.appendChild(b);
        });

        const zcLbl = el('div'); zcLbl.className = 'mm-small';
        zcLbl.textContent = 'Zero-cross window (samples):';
        const rowZc = el('div');
        rowZc.style.display = 'flex';
        rowZc.style.flexWrap = 'wrap';
        rowZc.style.gap = '8px';
        rowZc.style.marginTop = '6px';

        const zcVals = [8,16,32,64,128,256];
        const zcBtns = [];
        function setZcWin(v){
          LOOP_IMPORT_STATE.zcWin = v|0;
          zcBtns.forEach(b=> setOutline(b, b.__zc === (v|0)));
        }
        zcVals.forEach(v=>{
          const b = el('button');
          b.textContent = String(v);
          b.title = `Zero-cross search window: ${v} samples (used by Rotate→ZC / ZC cut).`;
          b.__zc = v|0;
          b.onclick = ()=> setZcWin(v);
          zcBtns.push(b);
          rowZc.appendChild(b);
        });

        const dcLbl = el('div'); dcLbl.className = 'mm-small';
        dcLbl.textContent = 'DC remove (raw-only):';
        const rowDc = el('div');
        rowDc.style.display = 'flex';
        rowDc.style.flexWrap = 'wrap';
        rowDc.style.gap = '8px';
        rowDc.style.marginTop = '6px';

        const dcOpts = [
          { id:'keep',     label:'Keep',     title:'Do not remove DC offset.' },
          { id:'global',   label:'Global',   title:'Remove DC offset from the entire imported region (one value for all slices).' },
          { id:'perSlice', label:'Per-slice',title:'Remove DC offset per slice (centers every slot independently).' },
        ];
        const dcBtns = [];
        function setDc(id){
          LOOP_IMPORT_STATE.dc = id;
          dcBtns.forEach(b=> setOutline(b, b.__dc === id));
        }
        dcOpts.forEach(o=>{
          const b = el('button');
          b.textContent = o.label;
          if (o.title) b.title = o.title;
          b.__dc = o.id;
          b.onclick = ()=> setDc(o.id);
          dcBtns.push(b);
          rowDc.appendChild(b);
        });

        // --- Creative FX (applies to all modes) ---
        const fxLbl = el('div'); fxLbl.className = 'mm-small';
        fxLbl.textContent = 'Creative transforms (applies after slicing):';

        function makeFxRow(labelText, opts, getId, setId){
          const lbl = el('div'); lbl.className = 'mm-small'; lbl.textContent = labelText;
          const row = el('div');
          row.style.display = 'flex';
          row.style.flexWrap = 'wrap';
          row.style.gap = '8px';
          row.style.marginTop = '6px';
          const btns = [];
          function refresh(){
            const cur = String(getId() || 'none');
            btns.forEach(b=> setOutline(b, b.__id === cur));
          }
          opts.forEach(o=>{
            const b = el('button');
            b.textContent = o.label;
            if (o.title) b.title = o.title;
            b.__id = o.id;
            b.onclick = ()=>{ setId(o.id); refresh(); };
            btns.push(b);
            row.appendChild(b);
          });
          refresh();
          return { lbl, row, refresh };
        }

        const reverseOpts = [
          { id:'none', label:'Off',  title:'No reverse.' },
          { id:'odd',  label:'Odd',  title:'Reverse odd-numbered slots only.' },
          { id:'even', label:'Even', title:'Reverse even-numbered slots only.' },
          { id:'all',  label:'All',  title:'Reverse every slot.' },
          { id:'ramp', label:'Ramp', title:'Progressively crossfade normal → reversed across slots.' },
        ];

        const invertOpts = [
          { id:'none', label:'Off',  title:'No inversion.' },
          { id:'odd',  label:'Odd',  title:'Invert odd-numbered slots only.' },
          { id:'even', label:'Even', title:'Invert even-numbered slots only.' },
          { id:'all',  label:'All',  title:'Invert every slot.' },
          { id:'ramp', label:'Ramp', title:'Progressively flip polarity across slots (+1 → -1; midpoint approaches 0).' },
        ];

        const revUI = makeFxRow('Reverse:', reverseOpts,
          ()=> LOOP_IMPORT_STATE.reverse,
          (id)=>{ LOOP_IMPORT_STATE.reverse = id; });

        const invUI = makeFxRow('Invert:', invertOpts,
          ()=> LOOP_IMPORT_STATE.invert,
          (id)=>{ LOOP_IMPORT_STATE.invert = id; });

        const gainOpts = [
          { id:'none',       label:'Off',          title:'No gain shaping.' },
          { id:'rampUp',     label:'Ramp↑',        title:'Gain ramps up across slots (quiet → loud).' },
          { id:'rampDown',   label:'Ramp↓',        title:'Gain ramps down across slots (loud → quiet).' },
          { id:'triangle',   label:'Triangle',     title:'Gain peaks around the middle slot (triangle shape).' },
          { id:'oddevenGate',label:'Odd/Even gate',title:'Mutes every other slot (odd slots).' },
        ];

        const gainUI = makeFxRow('Gain:', gainOpts,
          ()=> LOOP_IMPORT_STATE.gain,
          (id)=>{ LOOP_IMPORT_STATE.gain = id; });

        // Warp (semitones)
        const warpWrap = el('div');
        warpWrap.style.marginTop = '6px';

        const warpRow = el('div');
        warpRow.style.display = 'flex';
        warpRow.style.alignItems = 'center';
        warpRow.style.gap = '8px';
        warpRow.style.flexWrap = 'wrap';

        const warpLbl = el('div'); warpLbl.className = 'mm-small'; warpLbl.title = 'Pitch-warp per slice (semitones). Positive = up, negative = down.';
        function updateWarpLbl(){
          const st = parseInt(LOOP_IMPORT_STATE.warpSt,10) || 0;
          const s = (st>=0?'+':'') + st;
          warpLbl.textContent = `Warp (st): ${s}${LOOP_IMPORT_STATE.warpRamp ? ' (ramp)' : ''}`;
        }

        const warpSlider = el('input');
        warpSlider.type = 'range';
        warpSlider.min = '-12';
        warpSlider.max = '12';
        warpSlider.step = '1';
        warpSlider.value = String(parseInt(LOOP_IMPORT_STATE.warpSt,10) || 0);
        warpSlider.style.width = '180px';
        warpSlider.title = 'Warp each slice by semitones (cyclic pitch warp). Use “Ramp across slots” to sweep.';
        warpSlider.oninput = ()=>{
          LOOP_IMPORT_STATE.warpSt = parseInt(warpSlider.value,10) || 0;
          updateWarpLbl();
        };

        const warpZero = el('button');
        warpZero.textContent = '0';
        warpZero.title = 'Reset warp to 0';
        warpZero.onclick = ()=>{
          LOOP_IMPORT_STATE.warpSt = 0;
          warpSlider.value = '0';
          updateWarpLbl();
        };

        const warpRampBtn = el('button');
        warpRampBtn.textContent = 'Ramp across slots';
        warpRampBtn.title = 'When enabled, warp amount ramps from 0 at the first slot to the full value at the last slot.';
        warpRampBtn.onclick = ()=>{
          LOOP_IMPORT_STATE.warpRamp = !LOOP_IMPORT_STATE.warpRamp;
          refreshAll();
        };

        warpRow.append(warpLbl, warpSlider, warpZero, warpRampBtn);
        warpWrap.appendChild(warpRow);

        // Warp (cents) — fine detune / phase nudging
        const warpCtRow = el('div');
        warpCtRow.style.display = 'flex';
        warpCtRow.style.alignItems = 'center';
        warpCtRow.style.gap = '8px';
        warpCtRow.style.flexWrap = 'wrap';

        const warpCtLbl = el('div'); warpCtLbl.className = 'mm-small'; warpCtLbl.title = 'Fine warp in cents (adds to semitone warp). Useful for subtle motion / detune.';
        function updateWarpCtLbl(){
          const ct = parseInt(LOOP_IMPORT_STATE.warpCt,10) || 0;
          const s = (ct>=0?'+':'') + ct;
          warpCtLbl.textContent = `Warp (c): ${s}`;
        }

        const warpCtSlider = el('input');
        warpCtSlider.type = 'range';
        warpCtSlider.min = '-200';
        warpCtSlider.max = '200';
        warpCtSlider.step = '1';
        warpCtSlider.value = String(parseInt(LOOP_IMPORT_STATE.warpCt,10) || 0);
        warpCtSlider.style.width = '180px';
        warpCtSlider.title = 'Fine warp amount in cents (-200..+200). Combined with semitone warp.';
        warpCtSlider.oninput = ()=>{
          LOOP_IMPORT_STATE.warpCt = parseInt(warpCtSlider.value,10) || 0;
          updateWarpCtLbl();
        };

        const warpCtZero = el('button');
        warpCtZero.textContent = '0c';
        warpCtZero.title = 'Reset cents to 0';
        warpCtZero.onclick = ()=>{
          LOOP_IMPORT_STATE.warpCt = 0;
          warpCtSlider.value = '0';
          updateWarpCtLbl();
        };

        warpCtRow.append(warpCtLbl, warpCtSlider, warpCtZero);
        warpWrap.appendChild(warpCtRow);

        // --- Extra table creativity ---
        const tableHdr = el('div','mm-small');
        tableHdr.textContent = 'Table transforms:';
        tableHdr.style.marginTop = '10px';

        // Slot order transforms
        const orderLbl = el('div','mm-small');
        orderLbl.textContent = 'Slot order:';

        const orderBtns = [];
        const ORDER_PRESETS = [
          ['normal',   'Normal',    'Keep slots in the original sliced order.' ],
          ['pingpong', 'Ping‑pong', 'Order goes forward then backward (useful for back‑and‑forth table scans).' ],
          ['evenodd',  'Even/Odd',  'All even slots first, then odd slots.' ],
          ['oddeven',  'Odd/Even',  'All odd slots first, then even slots.' ],
          ['scramble', 'Scramble',  'Pseudo‑random shuffle of slots (uses the Seed).' ],
        ];
        function setOrder(val){
          LOOP_IMPORT_STATE.order = String(val||'normal');
          orderBtns.forEach(b=> setOutline(b, b.__ord === LOOP_IMPORT_STATE.order));
          seedWrap.style.display = (LOOP_IMPORT_STATE.order === 'scramble') ? 'flex' : 'none';
        }
        ORDER_PRESETS.forEach(([k,label,tip])=>{
          const b = el('button');
          b.textContent = label;
                    if (tip) b.title = tip;
          b.__ord = k;
          b.onclick = ()=>{ setOrder(k); };
          orderBtns.push(b);
        });
        const orderRows = dpButtonsToRows(orderBtns, 3);

        const seedWrap = el('div');
        seedWrap.style.marginTop = '6px';
        seedWrap.style.gap = '8px';
        seedWrap.style.alignItems = 'center';
        seedWrap.style.flexWrap = 'wrap';
        seedWrap.style.display = 'none';
        const seedLbl = el('div','mm-small');
        seedLbl.textContent = 'Seed:'; seedLbl.title = 'Only used when Slot order is Scramble.';
        const seedIn = el('input');
        seedIn.type = 'number';
        seedIn.min = '0';
        seedIn.max = '999999';
        seedIn.step = '1';
        seedIn.style.width = '96px';
        seedIn.title = 'Seed for Scramble order. Same seed = same shuffle.';
        seedIn.onchange = ()=>{
          LOOP_IMPORT_STATE.orderSeed = _clampInt(parseInt(seedIn.value,10)||1, 0, 999999);
          seedIn.value = String(LOOP_IMPORT_STATE.orderSeed);
        };
        seedWrap.append(seedLbl, seedIn);

        // Adjacent-slot continuity alignment
        const alignRow = el('div');
        alignRow.style.display = 'flex';
        alignRow.style.gap = '8px';
        alignRow.style.alignItems = 'center';
        alignRow.style.marginTop = '10px';
        const alignBox = el('input');
        alignBox.type = 'checkbox';
        alignBox.title = 'Rotates each slot to reduce discontinuity between adjacent slots (helps smooth wavetable scanning).';
        alignBox.onchange = ()=>{
          LOOP_IMPORT_STATE.alignAdj = !!alignBox.checked;
          refreshAll();
        };
        const alignLbl = el('div','mm-small');
        alignLbl.textContent = 'Align adjacent slots (rotate for continuity)';
        alignLbl.title = 'Rotates each slot to reduce discontinuity between adjacent slots (helps smooth wavetable scanning).';
        alignRow.append(alignBox, alignLbl);

	      // Keep naming consistent with the rest of the dialog.
	      // refreshAll() + dlg.append(...) expect *Wrap variables.
	      const alignWrap = alignRow;

        const alignWinRow = el('div');
        alignWinRow.className = 'mm-range';
        alignWinRow.style.marginTop = '6px';
        const alignWinLbl = el('div','mm-small');
        alignWinLbl.textContent = 'Align win:';
        const alignWinSlider = el('input');
        alignWinSlider.type = 'range';
        alignWinSlider.title = 'Search window size (in samples) used to align/rotate adjacent slots.';
        alignWinSlider.min = '16';
        alignWinSlider.max = '256';
        alignWinSlider.step = '16';
        alignWinSlider.style.width = '180px';
        const alignWinVal = el('div','mm-small');
        alignWinVal.style.minWidth = '60px';
        function updateAlignWinLbl(){
          const w = _clampInt(parseInt(LOOP_IMPORT_STATE.alignWin,10)||64, 16, 256);
          LOOP_IMPORT_STATE.alignWin = w;
          alignWinVal.textContent = `${w} smp`;
        }
        alignWinSlider.oninput = ()=>{
          LOOP_IMPORT_STATE.alignWin = _clampInt(parseInt(alignWinSlider.value,10)||64, 16, 256);
          updateAlignWinLbl();
        };
        alignWinRow.append(alignWinLbl, alignWinSlider, alignWinVal);

	      const alignWinWrap = alignWinRow;

        // Spectral tilt / brightness ramp
        const tiltLbl = el('div','mm-small');
        tiltLbl.textContent = 'Spectral tilt:';
        tiltLbl.style.marginTop = '10px';
        const tiltBtns = [];
        const TILT_PRESETS = [
          ['none',        'None',        'No spectral tilt.' ],
          ['dark2bright', 'Dark→Bright', 'Across slots, tilt spectrum from darker → brighter.' ],
          ['bright2dark', 'Bright→Dark', 'Across slots, tilt spectrum from brighter → darker.' ],
        ];
        function setTilt(val){
          LOOP_IMPORT_STATE.tilt = String(val||'none');
          tiltBtns.forEach(b=> setOutline(b, b.__tilt === LOOP_IMPORT_STATE.tilt));
        }
        TILT_PRESETS.forEach(([k,label,tip])=>{
          const b = el('button');
          b.textContent = label;
          if (tip) b.title = tip;
          b.__tilt = k;
	          b.onclick = ()=>{ setTilt(k); refreshAll(); };
          tiltBtns.push(b);
        });
        const tiltRows = dpButtonsToRows(tiltBtns, 3);

        const tiltAmtRow = el('div');
        tiltAmtRow.className = 'mm-range';
        tiltAmtRow.style.marginTop = '6px';
        const tiltAmtLbl = el('div','mm-small');
        tiltAmtLbl.textContent = 'Strength:'; tiltAmtLbl.title = 'How strong the spectral tilt is (0 = none).';
        const tiltAmtSlider = el('input');
        tiltAmtSlider.type = 'range';
        tiltAmtSlider.title = 'Spectral tilt strength (0 = none).';
        tiltAmtSlider.min = '0';
        tiltAmtSlider.max = '12';
        tiltAmtSlider.step = '1';
        tiltAmtSlider.style.width = '180px';
        const tiltAmtVal = el('div','mm-small');
        tiltAmtVal.style.minWidth = '60px';
        function updateTiltAmtLbl(){
          const a = _clampInt(parseInt(LOOP_IMPORT_STATE.tiltAmt,10)||0, 0, 12);
          LOOP_IMPORT_STATE.tiltAmt = a;
          tiltAmtVal.textContent = `${a}`;
        }
        tiltAmtSlider.oninput = ()=>{
          LOOP_IMPORT_STATE.tiltAmt = _clampInt(parseInt(tiltAmtSlider.value,10)||0, 0, 12);
          updateTiltAmtLbl();
        };
        tiltAmtRow.append(tiltAmtLbl, tiltAmtSlider, tiltAmtVal);

	      const tiltAmtWrap = tiltAmtRow;

        // Raw overlap crossfade (raw mode only)
        const rawOverlapWrap = el('div');
        rawOverlapWrap.style.marginTop = '10px';

        const overlapLbl = el('div','mm-small');
        overlapLbl.textContent = 'Raw overlap:';
        overlapLbl.title = 'Crossfade between adjacent raw slices (reduces clicks). Note: ZC cut is disabled when overlap > 0%.';

        const overlapBtns = [];
        const OVERLAP_PRESETS = [
          [0,  '0%',  'No overlap (hard slice boundaries). Most “accurate” for step-through playback, but may click.' ],
          [25, '25%', '25% overlap crossfade between slices (click reduction).' ],
          [50, '50%', '50% overlap crossfade (smoother, less “step” character).' ],
          [75, '75%', '75% overlap crossfade (very smooth, more smeared).' ],
        ];
        function setOverlap(val){
          LOOP_IMPORT_STATE.rawOverlap = _clampInt(parseInt(val,10)||0, 0, 75);
          overlapBtns.forEach(b=> setOutline(b, (b.__ov|0) === (LOOP_IMPORT_STATE.rawOverlap|0)));
          refreshAll();
        }
        OVERLAP_PRESETS.forEach(([k,label,tip])=>{
          const b = el('button');
          b.textContent = label;
          if (tip) b.title = tip;
          b.__ov = k;
          b.onclick = ()=>{ setOverlap(k); };
          overlapBtns.push(b);
        });
        const overlapRows = dpButtonsToRows(overlapBtns, 4);

        const winLbl = el('div','mm-small');
        winLbl.textContent = 'Window:'; winLbl.title = 'Windowing smooths raw slice edges (use with overlap for best results).';
        winLbl.style.marginTop = '6px';
        const winBtns = [];
        const WIN_PRESETS = [
          ['none',    'None',    'No windowing.' ],
          ['hann',    'Hann',    'Hann window (good general-purpose fade).' ],
          ['hamming', 'Hamming', 'Hamming window (slightly different sidelobes; sometimes preserves body a bit more).' ],
        ];
        function setWin(val){
          LOOP_IMPORT_STATE.rawWindow = String(val||'none');
          winBtns.forEach(b=> setOutline(b, b.__win === LOOP_IMPORT_STATE.rawWindow));
        }
        WIN_PRESETS.forEach(([k,label,tip])=>{
          const b = el('button');
          b.textContent = label;
          if (tip) b.title = tip;
          b.__win = k;
          b.onclick = ()=>{ setWin(k); };
          winBtns.push(b);
        });
        const winRows = dpButtonsToRows(winBtns, 3);

	      // dpButtonsToRows returns a single element (row or wrap), not an array.
	      // Avoid spreading (would throw "object is not iterable").
	      rawOverlapWrap.append(overlapLbl, overlapRows, winLbl, winRows);

        // --- Buttons ---
        const rowBtn = el('div');
        rowBtn.style.marginTop = '12px';
        rowBtn.style.display = 'flex';
        rowBtn.style.gap = '8px';

        const bApply = el('button');
        bApply.textContent = 'Use settings';
        bApply.title = 'Use these settings for loop import (normal click will reuse them).';
        // Keyboard: Enter should trigger the primary action.
        bApply.dataset.default = '1';
        bApply.onclick = ()=>{
          overlay.remove();
          resolve({
            mode:String(LOOP_IMPORT_STATE.mode||'raw'),
            count:(LOOP_IMPORT_STATE.count|0)||64,
            seam:String(LOOP_IMPORT_STATE.seam||'none')
          });
        };

        const bCancel = el('button');
        bCancel.textContent = 'Cancel';
        bCancel.onclick = ()=>{ overlay.remove(); resolve(null); };
        rowBtn.append(bApply, bCancel);

        function refreshAll(){
          const m = String(LOOP_IMPORT_STATE.mode||'raw');
          const isRaw = (m === 'raw');

          // Core (count/mode/seam)
          setCount((LOOP_IMPORT_STATE.count|0) || 64);
          setMode(m);

          // Raw overlap can make zcCut ambiguous (boundaries are no longer contiguous)
          const ov = _clampInt(parseInt(LOOP_IMPORT_STATE.rawOverlap,10)||0, 0, 75);
          if (isRaw && ov > 0 && String(LOOP_IMPORT_STATE.seam||'none') === 'zcCut'){
            LOOP_IMPORT_STATE.seam = 'none';
          }

          setSeam(String(LOOP_IMPORT_STATE.seam||'none'));
          setZcWin((LOOP_IMPORT_STATE.zcWin|0) || 32);
          setDc(String(LOOP_IMPORT_STATE.dc||'keep'));

          // Disable zcCut when it can't behave deterministically
          seamBtns.forEach(b=>{
            if (String(b.__seam) === 'zcCut'){
              b.disabled = !isRaw || (ov > 0);
            } else {
              b.disabled = false;
            }
          });

          // Reverse/Invert/Gain UI
          revUI.refresh();
          invUI.refresh();
          gainUI.refresh();

          // Warp UI (semitones)
          LOOP_IMPORT_STATE.warpSt = _clampInt(parseInt(LOOP_IMPORT_STATE.warpSt,10)||0, -24, 24);
          warpSlider.value = String(LOOP_IMPORT_STATE.warpSt|0);
          updateWarpLbl();
          setOutline(warpRampBtn, !!LOOP_IMPORT_STATE.warpRamp);

          // Warp UI (cents)
          LOOP_IMPORT_STATE.warpCt = _clampInt(parseInt(LOOP_IMPORT_STATE.warpCt,10)||0, -200, 200);
          warpCtSlider.value = String(LOOP_IMPORT_STATE.warpCt|0);
          updateWarpCtLbl();

          // Table transforms: order/seed
          setOrder(String(LOOP_IMPORT_STATE.order||'normal'));
          LOOP_IMPORT_STATE.orderSeed = _clampInt(parseInt(LOOP_IMPORT_STATE.orderSeed,10)||1, 0, 999999);
          seedIn.value = String(LOOP_IMPORT_STATE.orderSeed|0);

          // Table transforms: adjacent alignment
          LOOP_IMPORT_STATE.alignAdj = !!LOOP_IMPORT_STATE.alignAdj;
          alignBox.checked = !!LOOP_IMPORT_STATE.alignAdj;
          LOOP_IMPORT_STATE.alignWin = _clampInt(parseInt(LOOP_IMPORT_STATE.alignWin,10)||64, 16, 256);
          alignWinSlider.value = String(LOOP_IMPORT_STATE.alignWin|0);
          updateAlignWinLbl();
          alignWinSlider.disabled = !alignBox.checked;
          alignWinWrap.style.opacity = alignWinSlider.disabled ? '0.5' : '1';

          // Table transforms: spectral tilt
          setTilt(String(LOOP_IMPORT_STATE.tilt||'none'));
          LOOP_IMPORT_STATE.tiltAmt = _clampInt(parseInt(LOOP_IMPORT_STATE.tiltAmt,10)||0, 0, 12);
          tiltAmtSlider.value = String(LOOP_IMPORT_STATE.tiltAmt|0);
          updateTiltAmtLbl();
          tiltAmtSlider.disabled = (String(LOOP_IMPORT_STATE.tilt||'none') === 'none');
          tiltAmtWrap.style.opacity = tiltAmtSlider.disabled ? '0.5' : '1';

          // Raw-only: overlap/window
          rawOverlapWrap.style.display = isRaw ? '' : 'none';
          LOOP_IMPORT_STATE.rawOverlap = ov;
          overlapBtns.forEach(b=> setOutline(b, (parseInt(b.__ov,10)||0) === ov));
          rawOverlapWrap.style.opacity = (ov > 0) ? '1' : '0.8';

          LOOP_IMPORT_STATE.rawWindow = String(LOOP_IMPORT_STATE.rawWindow||'none');
          winBtns.forEach(b=> setOutline(b, b.__win === LOOP_IMPORT_STATE.rawWindow));
          winBtns.forEach(b=>{ b.disabled = !isRaw || (ov === 0); });
        }

        // --- 2-column body layout ---
  const body = el('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = 'repeat(2, minmax(320px, 1fr))';
  body.style.gap = '14px';
  body.style.alignItems = 'start';
  body.style.marginTop = '10px';
  body.style.maxWidth = '100%';

  // helper: make a tidy section
  function section(titleText, ...nodes){
    const s = el('div');
    s.style.padding = '8px';
    s.style.border = '1px solid rgba(255,255,255,0.12)';
    s.style.borderRadius = '8px';
    s.style.boxSizing = 'border-box';

    const t = el('div','mm-small');
    t.textContent = titleText;
    t.style.opacity = '0.9';
    t.style.marginBottom = '6px';

    s.appendChild(t);
    nodes.forEach(n => { if (n) s.appendChild(n); });
    return s;
  }

  // column wrappers
  const col1 = el('div');
  const col2 = el('div');
  [col1,col2].forEach(c=>{
    c.style.display = 'flex';
    c.style.flexDirection = 'column';
    c.style.gap = '12px';
    c.style.minWidth = '0';
  });

  // --- Column 1: slots/mode/raw seam ---
  col1.appendChild(section('Slots', rowCount));
  col1.appendChild(section('Mode', rowMode));
  col1.appendChild(section('Raw slice seam (raw-only)', rowSeam, rowZc, rowDc));

  // --- Column 2: creative + table + raw overlap/window ---
  col1.appendChild(section('Creative transforms (after slicing)',
    revUI.row,
    invUI.row,
    gainUI.row,
    warpWrap
  ));

  col2.appendChild(section('Table transforms',
    orderRows,
    seedWrap,
    alignWrap,
    alignWinWrap,
    tiltRows,
    tiltAmtWrap
  ));

  col2.appendChild(section('Raw overlap/window (raw-only)', rawOverlapWrap));

  body.append(col1, col2);

  // Responsive fallback (small screens)
  try{
    const mq1 = window.matchMedia('(max-width: 820px)');
    function applyCols(){
      body.style.gridTemplateColumns = mq1.matches ? '1fr' : 'repeat(2, minmax(320px, 1fr))';
    }
    mq1.addEventListener?.('change', applyCols);
    applyCols();
  } catch(e){ /* ignore */ }

  // Final dialog assembly
  dlg.append(
    h,
    p,
    body,
    el('hr'),
    rowBtn
  );

        overlay.appendChild(dlg);

        overlay.addEventListener('click', (e)=>{
          if (e.target === overlay){
            overlay.remove();
            resolve(null);
          }
        });

        document.body.appendChild(overlay);
        refreshAll();
      });
    }


    const btnLoadLoop = el('button');
    function dpUpdateLoopBtnTitle(){
      const count = (LOOP_IMPORT_STATE && LOOP_IMPORT_STATE.count) ? (LOOP_IMPORT_STATE.count|0) : 64;
      btnLoadLoop.textContent = `Slice Loop→${count}`;
      btnLoadLoop.title = `Import a loop and split over ${count} slots starting at the active slot.
Mode: ${dpLoopModeLabel(LOOP_IMPORT_STATE.mode)}
Shift‑click to choose slots/mode/seam/FX.`;
    }
    dpUpdateLoopBtnTitle();
    btnLoadLoop.onclick = (ev)=>{
      if (ev && ev.shiftKey){
        dpPromptLoopImportMode().then((opts)=>{
          if (opts){
            dpUpdateLoopBtnTitle();
            // User feedback: file picker opens next.
            try{ if (!(JOB && JOB.running)) announceIO('Choose loop WAV to slice…'); }catch(_){ }
            fLoopIn.click();
          }
        });
      } else {
        dpUpdateLoopBtnTitle();
        // User feedback: file picker opens next.
        try{ if (!(JOB && JOB.running)) announceIO('Choose loop WAV to slice…'); }catch(_){ }
        fLoopIn.click();
      }
    };
    // Keep inputs in DOM (hidden) for Safari’s security model
    rowLoad.append(btnLoadAudio, btnLoadLoop, fIn, fLoopIn);

    const rowEx = el('div','mm-digi-io mm-small');
    // Bank exports (top row)
    rowEx.append(btnExportBank, btnExportBankZip, btnExportBankSyx);

    // Slot exports (bottom row)
    const rowExSyx = el('div','mm-digi-io mm-small');
    rowExSyx.append(btnExportSlot);
    if (btnExportSlotSyx) rowExSyx.append(btnExportSlotSyx);
    // --- Layout (reference UI): header rows + main two-column area ---

    const shell = el('div','mm-digi-shell');

    // --- Layout (reference screenshot): left stack (controls + wave+keys) + right tools panel ---
    const topRow = el('div','mm-digi-toprow');

    // Left column: controls (top) + waveform+keyboard (below)
    const leftCol = el('div','mm-digi-leftcol');

    const controls = el('div','mm-digi-controls');

    const cRowDl = el('div','mm-digi-row');
    cRowDl.append(rowDl);

    const cRowUl = el('div','mm-digi-row');
    cRowUl.append(rowUl);

    const cRow2 = el('div','mm-digi-row');

    // force the export group onto a new line
    const br = el('div');
    br.style.flexBasis = '100%';
    br.style.height = '0';

    cRow2.append(rowLoad, br, rowEx);

    const cRow3 = el('div','mm-digi-row');
    cRow3.append(rowExSyx);

    controls.append(cRowDl, cRowUl, cRow2, cRow3);

    // Waveform + keyboard (no gap; same width)
    const waveKeys = el('div','mm-digi-wavekeys');

    // Left panel: big waveform canvas
    left.innerHTML = '';
    left.append(canv, wavetableCanv, wavetableTuneOverlay);

	    // Keyboard area under waveform: shift-click toggles between Piano Keys and 64 Slot Pads.
	    const pianoWrap = el('div','mm-piano-wrap');
	    pianoWrap.style.display = 'flex';
	    pianoWrap.style.flexDirection = 'row';
	    pianoWrap.style.alignItems = 'stretch';

		    // No visible Keys/Pads buttons: shift-click on either canvas toggles view.
		    // Clear any previous references in case renderEditorBar rebuilds.
		    kbBtnKeys = null; kbBtnPads = null;

	    // Main canvas area (can scroll horizontally for the long piano keyboard)
	    const kbMain = el('div');
	    kbMainWrap = kbMain;
	    kbMain.className = 'mm-kb-main';
	    kbMain.style.flex = '1 1 auto';
	    kbMain.style.overflowX = 'auto';
	    kbMain.style.overflowY = 'hidden';

	    const piano = pianoCanvas = el('canvas');
	    piano.className = 'mm-piano';

	    const pads = padsCanvas = el('canvas');
	    pads.className = 'mm-slotpads';

		    kbMain.append(piano, pads);
		    pianoWrap.append(kbMain);

	    waveKeys.append(left, pianoWrap);
    leftCol.append(controls, waveKeys);

    // Right column: tools panel spans height of left stack
    const rightPane = el('div','mm-digi-rightpane');

    // Status row inside tools panel
    statusRow.append(ioMsgEl, simpleModeToggle);

    toolsWrap.innerHTML = '';
    toolsWrap.append(statusRow, toolsSwap, historyRow, rowMutate, rowBatch, rowBlend, rowNorm, rowSave);

    rightPane.appendChild(toolsWrap);

    topRow.append(leftCol, rightPane);
    shell.append(topRow);

    const barEl = bySel('#digiproEditorBar');
    barEl.append(shell);

	    // Keyboard / pads
	    drawPiano();
	    drawSlotPads();
	    attachPianoEvents();
	    attachSlotPadsEvents();
	    attachWavetableViewportEvents();
	    // Start in the last view (defaults to keys). Buttons + canvas visibility are handled here.
	    setKeyboardView(KB_VIEW_MODE || 'keys');

    // --- Option A: fit waveform canvas to fill the Wave+Keys panel (no gap above the keyboard) ---
    const fitWaveCanvasToPanel = ()=>{
      try{
        // renderEditorBar rebuilds DOM often; ensure elements are still connected.
        if (!waveKeys || !waveKeys.isConnected) return;

        const wkH = (waveKeys.clientHeight|0);
        const pianoH = pianoWrap ? (pianoWrap.offsetHeight|0) : 0;

        let targetH = (wkH - pianoH);

        // If layout isn't settled yet, retry next frame.
        if (!(targetH > 0)){
          requestAnimationFrame(fitWaveCanvasToPanel);
          return;
        }

        // Avoid an unusably tiny editor on small screens.
        targetH = Math.max(WAVE_MIN_H, targetH|0);

        // Avoid needless resets (setting canvas.height clears the bitmap).
        if (fitWaveCanvasToPanel._lastH === targetH) return;
        fitWaveCanvasToPanel._lastH = targetH;

        // Lock the editor region to exactly the available height (keeps keyboard flush).
        left.style.flex = '0 0 auto';
        left.style.height = targetH + 'px';

        // Canvas fills the editor region; internal bitmap matches the content box height.
        canv.style.height = '100%';
        const cs = getComputedStyle(canv);
        const bt = parseFloat(cs.borderTopWidth)||0;
        const bb = parseFloat(cs.borderBottomWidth)||0;
        const innerH = Math.max(1, Math.round(targetH - bt - bb));

        if ((canv.height|0) !== innerH){
          canv.height = innerH;
        }

        paint();
        try{
          if (typeof requestWavetableViewportDraw === 'function') requestWavetableViewportDraw();
        }catch(_){}
      }catch(_){}
    };

    // Clean up any previous fit handlers from earlier renders
    try{ if (window.__mmDPWaveFitCleanup) window.__mmDPWaveFitCleanup(); }catch(_){}

    const __onWinResize = ()=>{ fitWaveCanvasToPanel(); };
    window.addEventListener('resize', __onWinResize);

    let __ro = null;
    if (typeof ResizeObserver !== 'undefined'){
      try{
        __ro = new ResizeObserver(()=>{ fitWaveCanvasToPanel(); });
        __ro.observe(waveKeys);
      }catch(_){}
    }

    window.__mmDPWaveFitCleanup = ()=>{
      try{ window.removeEventListener('resize', __onWinResize); }catch(_){}
      try{ __ro && __ro.disconnect(); }catch(_){}
    };

    // Run once after layout settles
    requestAnimationFrame(fitWaveCanvasToPanel);

    refreshEditorBar = function(){
      try{
        if (!bar || !bar.isConnected || !canv || !canv.isConnected) return false;

        const Nnext = Math.max(16, EDIT.dataU8?.length || 96);
        if ((canv.width|0) !== Nnext) canv.width = Nnext;

        if (slotLbl) slotLbl.textContent = String((EDIT.slot|0)+1) + ':';
        if (nameIn){
          nameIn.value = (EDIT.name || 'WAVE').toUpperCase();
        }
        try{ syncSimpleModeUi(); }catch(_){ }
        try{ syncWavetableTuneUi(); }catch(_){ }

        const refreshHeat = dpHeatOf(EDIT);
        if (heatBadge){
          heatBadge.title = `HOT gain ×${refreshHeat.toFixed(2)} (affects upload/export; may clip)`;
          heatBadge.style.display = (refreshHeat > 1.0001) ? '' : 'none';
        }

        paint();
        try{ drawPiano(); }catch(_){}
        try{ drawSlotPads(); }catch(_){}
        try{
          if (typeof requestWavetableViewportDraw === 'function') requestWavetableViewportDraw();
        }catch(_){}
        try{ fitWaveCanvasToPanel(); }catch(_){}
        updateButtonsState();
        updateUndoButtons();
        return true;
      }catch(_){
        return false;
      }
    };

    syncSimpleModeUi();
    updateButtonsState();
    updateUndoButtons();
  }
