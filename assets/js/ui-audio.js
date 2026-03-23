// DigiPRO UI split: AudioContext preview helpers

'use strict';

// -------------- audio preview --------------
  function isSilentU8(u8){
    if (!u8 || !u8.length) return true;
    for (let i=0;i<u8.length;i++) if ((u8[i]|0) !== 128) return false;
    return true;
  }

  function scaleU8Around128(u8, gain){
    const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    const N = a.length|0;
    const g = Math.max(0, Math.min(2, +gain || 0));
    const out = new Uint8Array(N);
    for (let i=0;i<N;i++){
      const v = 128 + ((a[i]|0) - 128) * g;
      out[i] = clamp(Math.round(v), 0, 255);
    }
    return out;
  }

  let audioCtx = null;
  function ensureAudio(){
    const ac = (root.Tone && root.Tone.getContext)
      ? root.Tone.getContext().rawContext
      : (audioCtx || (audioCtx = new (window.AudioContext||window.webkitAudioContext)()));

    // Best-effort unlock/resume. Avoid unhandled promise rejections.
    try{
      if (root.Tone && typeof root.Tone.start === 'function'){
        const p = root.Tone.start();
        if (p && typeof p.catch === 'function') p.catch(()=>{});
      }
    }catch(_){ }
    try{
      if (ac && ac.state === 'suspended' && typeof ac.resume === 'function'){
        const p = ac.resume();
        if (p && typeof p.catch === 'function') p.catch(()=>{});
      }
    }catch(_){ }

    return ac;
  }
  let _activeSrc = null, _activeGain = null;
  let _smoothPreviewCurrent = null;
  let _smoothPreviewDebounceTimer = 0;
  let _smoothPreviewSessionId = 0;
  const _smoothPreviewFading = new Set();

  function _previewTargetGain(){
    return 0.4;
  }

  function _buildLoopPreviewVoice(dataU8, midi){
    if (!dataU8 || !dataU8.length || isSilentU8(dataU8)) return null;
    const ac = ensureAudio();
    midi = clamp(midi, 0, 127);

    const N = dataU8.length|0;
    if (!(N > 0)) return null;
    const sr = ac.sampleRate || 44100;
    const baseFreq = sr / N;
    const targetFreq = 440 * Math.pow(2, (midi-69)/12);
    const rate = targetFreq / baseFreq;

    const buf = ac.createBuffer(1, N, sr);
    const ch = buf.getChannelData(0);
    for (let i=0;i<N;i++) ch[i] = ((dataU8[i]|0) - 128) / 128;

    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = Math.max(0.001, rate);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    src.connect(gain).connect(ac.destination);

    return { ac, src, gain, key:null, midi:midi|0, stopTimer:0 };
  }

  function _clearSmoothPreviewDebounce(){
    if (_smoothPreviewDebounceTimer){
      try{ clearTimeout(_smoothPreviewDebounceTimer); }catch(_){ }
      _smoothPreviewDebounceTimer = 0;
    }
  }

  function _stopPreviewVoice(voice, fadeMs){
    if (!voice) return;
    if (voice.stopTimer){
      try{ clearTimeout(voice.stopTimer); }catch(_){ }
      voice.stopTimer = 0;
    }
    try{
      const ac = voice.ac || ensureAudio();
      const t = ac.currentTime;
      const fadeSecs = Math.max(0, (fadeMs|0) / 1000);
      voice.gain.gain.cancelScheduledValues(t);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
      if (fadeSecs > 0){
        voice.gain.gain.linearRampToValueAtTime(0, t + fadeSecs);
        voice.src.stop(t + fadeSecs + 0.015);
      } else {
        voice.src.stop();
      }
    }catch(_){ }
  }

  function stopSmoothPreview(){
    _smoothPreviewSessionId++;
    _clearSmoothPreviewDebounce();
    if (_smoothPreviewCurrent){
      _stopPreviewVoice(_smoothPreviewCurrent, 18);
      _smoothPreviewCurrent = null;
    }
    for (const voice of Array.from(_smoothPreviewFading)){
      _smoothPreviewFading.delete(voice);
      _stopPreviewVoice(voice, 18);
    }
  }

  function _applySmoothPreview(dataU8, midi, opts){
    opts = opts || {};
    if (!dataU8 || !dataU8.length || isSilentU8(dataU8)){
      stopSmoothPreview();
      return;
    }

    const key = (opts.key == null) ? null : String(opts.key);
    const fadeMs = Math.max(0, parseInt(opts.fadeMs, 10) || 18);
    const targetGain = _previewTargetGain();
    const current = _smoothPreviewCurrent;

    if (current && current.key === key && (current.midi|0) === (midi|0)) return;

    const voice = _buildLoopPreviewVoice(dataU8, midi);
    if (!voice) return;
    voice.key = key;

    try{ voice.src.start(); }catch(_){ return; }

    const t = voice.ac.currentTime;
    voice.gain.gain.setValueAtTime(0, t);
    voice.gain.gain.linearRampToValueAtTime(targetGain, t + Math.max(0.001, fadeMs / 1000));

    _smoothPreviewCurrent = voice;

    if (current){
      _smoothPreviewFading.add(current);
      _stopPreviewVoice(current, fadeMs);
      current.stopTimer = setTimeout(()=>{
        _smoothPreviewFading.delete(current);
        current.stopTimer = 0;
      }, Math.max(40, fadeMs + 40));
    }
  }

  function startSmoothPreview(dataU8, midi=60, opts){
    opts = opts || {};
    const debounceMs = Math.max(0, parseInt(opts.debounceMs, 10) || 0);
    const sessionId = ++_smoothPreviewSessionId;
    const payload = {
      dataU8,
      midi,
      opts: Object.assign({}, opts, { debounceMs: 0 })
    };

    _clearSmoothPreviewDebounce();
    if (!(debounceMs > 0)){
      _applySmoothPreview(payload.dataU8, payload.midi, payload.opts);
      return;
    }

    _smoothPreviewDebounceTimer = setTimeout(()=>{
      _smoothPreviewDebounceTimer = 0;
      if (sessionId !== _smoothPreviewSessionId) return;
      _applySmoothPreview(payload.dataU8, payload.midi, payload.opts);
    }, debounceMs);
  }

  function stopPreview(){
  const ac = ensureAudio();
  try{
    if (_activeGain){
      const t = ac.currentTime;
      _activeGain.gain.cancelScheduledValues(t);
      _activeGain.gain.setValueAtTime(_activeGain.gain.value, t);
      _activeGain.gain.linearRampToValueAtTime(0, t + 0.02);   // short release
      _activeSrc && _activeSrc.stop(t + 0.03);
    } else if (_activeSrc){
      _activeSrc.stop();
    }
  }catch(_){}
  _activeSrc=null; _activeGain=null;
  try{ stopSmoothPreview(); }catch(_){ }
}
function startPreview(dataU8, midi=60){
    if (!dataU8 || !dataU8.length || isSilentU8(dataU8)) { stopPreview(); return; }
    stopPreview(); return playLoop(dataU8, midi);
  }
  function playLoop(dataU8, midi=60, secs){
  if (!dataU8 || !dataU8.length || isSilentU8(dataU8)) return;
  const ac = ensureAudio();
  midi = clamp(midi, 0, 127); // safety clamp C2..C7

  // Build a 1‑cycle loop from 8‑bit values [0..255] -> [-1..1]
  const N = dataU8.length;
  const sr = ac.sampleRate || 44100;
  const baseFreq = sr / N; // 1 cycle of N samples at sampleRate
  const targetFreq = 440 * Math.pow(2, (midi-69)/12);
  const rate = targetFreq / baseFreq;

  const buf = ac.createBuffer(1, N, sr);
  const ch = buf.getChannelData(0);
  for (let i=0;i<N;i++) ch[i] = ((dataU8[i]|0) - 128) / 128;

  const src = ac.createBufferSource(); _activeSrc = src;
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = Math.max(0.001, rate);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(0.4, ac.currentTime + 0.01); // tiny fade‑in
  src.connect(gain).connect(ac.destination);
  _activeGain = gain;

  src.start();

  if (typeof secs === 'number' && secs > 0 && isFinite(secs)) {
    setTimeout(() => {
      try { stopPreview(); } catch (e) { console.warn("stopPreview failed:", e); }
    }, Math.max(200, secs * 1000));
  }
}


// -------------- wavetable scan preview --------------
  let _wtScanToken = 0;
  let _wtScanRunning = false;

  function isWavetablePreviewRunning(){
    return !!_wtScanRunning;
  }

  function stopWavetablePreview(){
    // Invalidate any onended handlers from prior preview sessions.
    _wtScanToken++;
    _wtScanRunning = false;
    try{ stopPreview(); }catch(_){ }
  }

  // Preview a wavetable as a packed/chain WAV: concatenates frames and plays straight through.
  // This matches the "packed chain" export behavior and avoids per-slot looping.
  //
  // list: Array of Uint8Array cycles OR objects { dataU8: Uint8Array }
  // opts: { midi, stepMs, loop }
  //  - midi: target note for playback pitch (same as the single-cycle preview)
  //  - stepMs: accepted for API compatibility (ignored in chain playback)
  //  - loop: if true, loops the entire chain

  // Preview a wavetable as a packed/chain WAV: concatenates frames and plays straight through.
  // This matches the "packed chain" export behavior and avoids per-slot looping.
  //
  // list: Array of Uint8Array cycles OR objects { dataU8: Uint8Array }
  // opts: {
  //   midi, stepMs, loop,
  //   // NEW: export-style pitch (preferred)
  //   sampleRate,      // WAV header sample-rate to emulate
  //   pointsPerCycle,  // exported samples-per-cycle (after FFT/tune resample)
  //   pitchMethod,     // 'sr' | 'fft' (hint; when 'fft' we try to match export resampler)
  //   pitchParams      // optional full object { sampleRate, pointsPerCycle, pitchMethod, tuneEnabled, ... }
  // }
  function startWavetablePreview(list, opts){
    opts = opts || {};

    function clampInt(v, lo, hi){
      v = Number(v);
      if (!isFinite(v)) v = lo;
      v = Math.round(v);
      if (v < lo) v = lo;
      if (v > hi) v = hi;
      return v;
    }

    // Back-compat: MIDI note audition (used when export-style pitch is not provided).
    const midiIn = opts.midi;
    const midi = (midiIn === null || midiIn === undefined) ? null : clamp(parseInt(midiIn, 10) || 60, 0, 127);

    // Export-style pitch controls (preferred when provided)
    const pp = (opts.pitchParams && typeof opts.pitchParams === 'object') ? opts.pitchParams : null;
    const srIn  = (pp && pp.sampleRate != null) ? pp.sampleRate : opts.sampleRate;
    const ppcIn = (pp && pp.pointsPerCycle != null) ? pp.pointsPerCycle : opts.pointsPerCycle;
    const method = (pp && pp.pitchMethod) ? pp.pitchMethod : (opts.pitchMethod || null);

    const outSR  = (srIn === null || srIn === undefined || srIn === '') ? null : clampInt(parseInt(srIn,10) || 0, 1000, 192000);
    const outPPC = (ppcIn === null || ppcIn === undefined || ppcIn === '') ? null : clampInt(parseInt(ppcIn,10) || 0, 1, 1<<20);

    const loop = (opts.loop == null) ? true : !!opts.loop;

    stopWavetablePreview();

    const seqIn = Array.isArray(list) ? list.slice() : [];
    const seq = seqIn
      .map(it => (it && it.dataU8) ? it.dataU8 : it)
      .filter(u8 => u8 && u8.length);

    if (!seq.length) return;

    const ac = ensureAudio();

    const baseN = (seq[0].length|0) || 0;
    if (baseN <= 0) return;

    // Choose the output cycle length.
    // - If pointsPerCycle is specified (export FFT/tune), resample to that length.
    // - Otherwise keep the native length.
    const N = (outPPC != null) ? outPPC : baseN;

    // Convert + (optionally) resample each frame to Float32 [-1..1] so we can fill the AudioBuffer directly.
    const frames = new Array(seq.length);

    function u8ToFloat(u8){
      const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
      const L = a.length|0;
      const f = new Float32Array(L);
      for (let i=0;i<L;i++) f[i] = ((a[i]|0) - 128) / 128;
      return f;
    }

    function resampleFloatToLen(srcF, targetLen){
      const M = targetLen|0;
      if (!srcF || !srcF.length || M <= 0) return new Float32Array(0);
      const L = srcF.length|0;
      if (L === M) return (srcF instanceof Float32Array) ? new Float32Array(srcF) : Float32Array.from(srcF);

      // Best match to export: FFT periodic resample.
      if (method === 'fft' && typeof periodicResampleFloatFFT === 'function'){
        try{
          const out = periodicResampleFloatFFT(srcF, M);
          if (out && (out.length|0) === M) return out;
        }catch(_){ }
      }

      // Fallback: AA resample in u8-domain (fast), then convert back to float.
      if (typeof resampleU8_AA === 'function'){
        try{
          const u8 = new Uint8Array(L);
          for (let i=0;i<L;i++) u8[i] = clamp(Math.round((srcF[i] * 128) + 128), 0, 255);
          const u8r = resampleU8_AA(u8, M, 16);
          const out = new Float32Array(M);
          for (let i=0;i<M;i++) out[i] = ((u8r[i]|0) - 128) / 128;
          return out;
        }catch(_){ }
      }

      // Last resort: nearest-neighbor.
      const out = new Float32Array(M);
      for (let i=0;i<M;i++) out[i] = srcF[Math.floor(i*L/M)] || 0;
      return out;
    }

    for (let j=0;j<seq.length;j++){
      let u8 = seq[j];
      if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8||[]);
      if (!(u8 && (u8.length|0))) continue;

      let f = u8ToFloat(u8);
      if ((f.length|0) !== N){
        f = resampleFloatToLen(f, N);
        // Match export behavior: when we FFT-resample a single-cycle, explicitly re-close it.
        if (method === 'fft' && (f.length|0) >= 2) f[f.length - 1] = f[0];
      }

      frames[j] = f;
    }

    // Build a single contiguous AudioBuffer (the packed/chain WAV).
    const totalSamples = (N|0) * (frames.length|0);
    if (!(totalSamples > 0)) return;

    // If export-style sampleRate is provided, create the buffer at that rate.
    // This makes playback at rate=1 match the exported WAV's pitch.
    const bufSR = (outSR != null) ? outSR : (ac.sampleRate || 44100);

    const buf = ac.createBuffer(1, totalSamples, bufSR);
    const ch = buf.getChannelData(0);

    let o = 0;
    for (let j=0;j<frames.length;j++){
      const f = frames[j];
      if (!f || (f.length|0) !== N){
        // Robust: fill missing frame with silence.
        for (let i=0;i<N;i++) ch[o++] = 0;
        continue;
      }
      for (let i=0;i<N;i++){
        let v = f[i];
        if (!isFinite(v)) v = 0;
        if (v > 1) v = 1;
        else if (v < -1) v = -1;
        ch[o++] = v;
      }
    }

    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = loop;

    // Playback rate:
    // - If MIDI is provided: audition as an oscillator at that note (even for export-style buffers).
    // - Otherwise: rate=1 plays back exactly as a WAV at bufSR.
    let rate = 1;
    if (midi !== null){
      const baseFreq = bufSR / N;
      const targetFreq = 440 * Math.pow(2, (midi-69)/12);
      rate = targetFreq / baseFreq;
    }
    src.playbackRate.value = Math.max(0.001, rate);

    // Fade in (and rely on stopPreview() for a short fade out).
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.4, ac.currentTime + 0.01);

    src.connect(gain).connect(ac.destination);

    // Track "running" state for the UI toggle.
    const token = ++_wtScanToken;
    _wtScanRunning = true;

    src.onended = ()=>{
      if (token !== _wtScanToken) return;
      _wtScanRunning = false;
    };

    // Share the same global stopPreview() path as the normal preview.
    _activeSrc = src;
    _activeGain = gain;

    try{ src.start(); }catch(err){
      console.warn('Wavetable preview failed:', err);
      _wtScanRunning = false;
      try{ stopPreview(); }catch(_){ }
    }
  }

  // Export helpers for UI code.

  try{
    root.startWavetablePreview = startWavetablePreview;
    root.stopWavetablePreview = stopWavetablePreview;
    root.isWavetablePreviewRunning = isWavetablePreviewRunning;
    root.startSmoothPreview = startSmoothPreview;
    root.stopSmoothPreview = stopSmoothPreview;
  }catch(_){ }
