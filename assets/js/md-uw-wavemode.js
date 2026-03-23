// md-uw-wavemode.js
// Machinedrum UW “matchedrum mode” — shift+upload options + SDS sender
// Build: 2026-01-02
//
// Exposes:
//   window.mmPromptShiftUpload(actionLabel, ctx) -> Promise<choice|null>
//   window.mmSendWavesToMachinedrumUW(waves, choice, hooks) -> Promise<void>
//
// Designed to work with either MIDI stack:
//  - DigiPRO Wave Lab midi.js (mmAddSysexListener + sendBytes + MidiWireClock)
//  - MDDT midi.js (onMidiMessageUW)

(function(){
  'use strict';

  // Prevent double-initialisation (hot reload / accidental duplicate script tag).
  if (window.__mdUwWaveModeInitOnce) return;
  window.__mdUwWaveModeInitOnce = true;

  const BUILD = '2026-01-02';
  window.__MD_UW_WAVEMODE_BUILD = BUILD;

  // Persisted Shift+Upload settings.
  //
  // Requirement:
  // - Store BOTH DigiPRO (Monomachine) and Machinedrum UW settings locally.
  // - Switching targets must NOT wipe the other target's settings.
  // - Normal click should use the last-selected destination.
  //
  // V1 stored a single "choice" object (either {target:'digipro', gainMode} OR {target:'machinedrum', ...}).
  // V2 stores both sub-profiles + the active target.
  const LS_KEY_V2 = 'mmShiftUploadPrefsV2';
  const LS_KEY_V1 = 'mmShiftUploadChoiceV1';

  function _normDigiproPrefs(obj){
    obj = (obj && typeof obj === 'object') ? obj : {};
    return { gainMode: (obj.gainMode === 'clip') ? 'clip' : 'c6' };
  }

  function _normMachinedrumPrefs(obj){
    obj = (obj && typeof obj === 'object') ? obj : {};
    const mdMaxSlots = _clampInt((obj.mdMaxSlots != null) ? obj.mdMaxSlots : 48, 1, 128);
    return {
      mdMode: (obj.mdMode === 'pack') ? 'pack' : 'single',
      mdMaxSlots,
      mdStartSlot: _clampInt((obj.mdStartSlot != null) ? obj.mdStartSlot : 0, 0, mdMaxSlots - 1),
      mdSlot: _clampInt((obj.mdSlot != null) ? obj.mdSlot : 0, 0, mdMaxSlots - 1),
      pointsPerCycle: _clampInt((obj.pointsPerCycle != null) ? obj.pointsPerCycle : 96, 8, 8192),
      pitchOctaves: _clampInt((obj.pitchOctaves != null) ? obj.pitchOctaves : 0, -6, 6),
      boundaryXfade: !!obj.boundaryXfade,
      palindrome: !!obj.palindrome,
      // Pack-only extras (still persisted even if mode=single)
      packDcRemove: (obj.packDcRemove !== false),
      packMorph: _clampInt((obj.packMorph != null) ? obj.packMorph : 0, 0, 3),
      // null/undefined => auto
      packJoinXfade: (obj.packJoinXfade == null) ? null : _clampInt(obj.packJoinXfade, 0, 256),
      packFx: _normPackFxId(obj.packFx),
      sampleRate: _clampInt((obj.sampleRate != null) ? obj.sampleRate : 44100, 4000, 96000),
      phaseAlign: (obj.phaseAlign !== false),
      setName: (obj.setName !== false),
      forceOpenLoop: !!obj.forceOpenLoop,
      mdDeviceId: _clampInt((obj.mdDeviceId != null) ? obj.mdDeviceId : 0, 0, 126),
      // Pack-only convenience: optionally download a WAV of the packed loop sample.
      downloadPackedWav: !!obj.downloadPackedWav,
    };
  }

  function _defaultShiftUploadPrefs(){
    return {
      v: 2,
      target: 'digipro',
      digipro: _normDigiproPrefs({ gainMode: 'c6' }),
      machinedrum: _normMachinedrumPrefs({})
    };
  }

  function _loadShiftUploadPrefs(){
    // Start from defaults; merge in anything we can read.
    const base = _defaultShiftUploadPrefs();
    let raw = null;

    // 1) V2
    try{
      if (typeof localStorage !== 'undefined'){
        raw = JSON.parse(localStorage.getItem(LS_KEY_V2) || 'null');
      }
    }catch(_){ raw = null; }

    // 2) Legacy V1 fallback
    if (!raw || typeof raw !== 'object'){
      try{
        if (typeof localStorage !== 'undefined'){
          raw = JSON.parse(localStorage.getItem(LS_KEY_V1) || 'null');
        }
      }catch(_){ raw = null; }
    }

    if (!raw || typeof raw !== 'object') return base;

    // Detect V2 shape
    const looksV2 = !!(raw && typeof raw === 'object' && (raw.digipro || raw.machinedrum));

    if (looksV2){
      base.target = (raw.target === 'machinedrum') ? 'machinedrum' : 'digipro';
      base.digipro = _normDigiproPrefs(raw.digipro);
      base.machinedrum = _normMachinedrumPrefs(raw.machinedrum);
      return base;
    }

    // Legacy V1 object: either a DigiPRO-only choice or a Machinedrum-only choice.
    if (raw.target === 'machinedrum'){
      base.target = 'machinedrum';
      base.machinedrum = _normMachinedrumPrefs(raw);
      // Preserve legacy gainMode if present (some dev builds wrote it), else default.
      if ('gainMode' in raw) base.digipro = _normDigiproPrefs(raw);
    } else {
      base.target = 'digipro';
      base.digipro = _normDigiproPrefs(raw);
      // Preserve legacy MD fields if present (unlikely), else default.
      if ('mdMode' in raw || 'mdMaxSlots' in raw) base.machinedrum = _normMachinedrumPrefs(raw);
    }

    // Best-effort migrate V1 -> V2 so subsequent loads are stable.
    try{
      if (typeof localStorage !== 'undefined'){
        localStorage.setItem(LS_KEY_V2, JSON.stringify(base));
      }
    }catch(_){ }

    return base;
  }

  function _saveShiftUploadPrefs(prefs){
    try{
      if (typeof localStorage === 'undefined') return;
      const out = Object.assign({}, prefs, { v: 2 });
      localStorage.setItem(LS_KEY_V2, JSON.stringify(out));
    }catch(_){ }
  }

  // Read the most recent upload choice for normal (non-shift) Upload clicks.
  // Returns a normalised object with defaults + sanity clamping.
  window.mmGetShiftUploadChoice = function(){
    const prefs = _loadShiftUploadPrefs();
    if (prefs && prefs.target === 'machinedrum'){
      return Object.assign({ target:'machinedrum' }, _normMachinedrumPrefs(prefs.machinedrum));
    }
    const dp = (prefs && prefs.digipro) ? prefs.digipro : null;
    return { target:'digipro', gainMode: (dp && dp.gainMode === 'clip') ? 'clip' : 'c6' };
  };

  // --- SDS handshake codes ---
  const SDS_ACK    = 0x7F;
  const SDS_NAK    = 0x7E;
  const SDS_CANCEL = 0x7D;
  const SDS_WAIT   = 0x7C;
  const SDS_EOF    = 0x7B;

  const MD_CLOCK = 1000000000; // SDS uses a 1e9 Hz clock for samplePeriod

  // --- Small helpers ---
  function _clampInt(v, lo, hi){
    v = Math.round(Number(v));
    if (!Number.isFinite(v)) v = lo;
    return Math.max(lo, Math.min(hi, v));
  }

  function _sleep(ms, signal){
    ms = Math.max(0, Number(ms)||0);
    return new Promise((resolve, reject)=>{
      let t = null;
      const onAbort = ()=>{
        if (t) { try{ clearTimeout(t); }catch(_){} t = null; }
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal){
        if (signal.aborted) return onAbort();
        try{ signal.addEventListener('abort', onAbort, { once:true }); }catch(_){}
      }
      t = setTimeout(()=>{
        if (signal){ try{ signal.removeEventListener('abort', onAbort); }catch(_){} }
        resolve();
      }, ms);
    });
  }

  function _requireMidiOut(){
    if (!window.selectedMidiOut) throw new Error('No MIDI Out selected.');
  }

  function _sendSysex(bytes){
    _requireMidiOut();
    const u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    if (typeof window.sendBytes === 'function') window.sendBytes(u8);
    else window.selectedMidiOut.send(u8);
    return u8.length;
  }

  async function _waitWireDrain(extraMs, signal){
    const extra = Math.max(0, Number(extraMs)||0);
    if (window.MidiWireClock && typeof window.MidiWireClock.waitForDrain === 'function'){
      await window.MidiWireClock.waitForDrain(extra, signal);
      return;
    }
    // Best-effort fallback if no wire clock is available.
    await _sleep(Math.max(2, extra), signal);
  }

  // --- SDS handshake capture ---
  let _installed = false;
  let _waiter = null; // { expectPkt|null, resolve, timer, onAbort, signal }

  function _handshakeType(cmd){
    switch (cmd & 0x7F){
      case SDS_ACK: return 'ACK';
      case SDS_WAIT: return 'WAIT';
      case SDS_NAK: return 'NAK';
      case SDS_CANCEL: return 'CANCEL';
      case SDS_EOF: return 'EOF';
      default: return 'UNKNOWN';
    }
  }

  function _handleIncomingSysex(msg){
    if (!_waiter) return;
    const u8 = (msg instanceof Uint8Array) ? msg : (Array.isArray(msg) ? new Uint8Array(msg) : null);
    if (!u8 || u8.length < 6) return;
    if (u8[0] !== 0xF0 || u8[u8.length-1] !== 0xF7) return;
    if (u8[1] !== 0x7E) return; // Universal SysEx (SDS)

    const cmd = u8[3] & 0x7F;
    if (cmd !== SDS_ACK && cmd !== SDS_WAIT && cmd !== SDS_NAK && cmd !== SDS_CANCEL && cmd !== SDS_EOF) return;

    const pkt = (u8.length >= 6) ? (u8[4] & 0x7F) : null;
    if (_waiter.expectPkt != null && pkt != null && pkt !== (_waiter.expectPkt & 0x7F)) return;

    const res = { ok: (cmd === SDS_ACK || cmd === SDS_WAIT || cmd === SDS_EOF), type: _handshakeType(cmd), packet: pkt };

    const w = _waiter;
    _waiter = null;
    try{ clearTimeout(w.timer); }catch(_){}
    if (w.signal && w.onAbort){ try{ w.signal.removeEventListener('abort', w.onAbort); }catch(_){} }
    try{ w.resolve(res); }catch(_){}
  }

  function _installHandshakeListener(){
    if (_installed) return;
    _installed = true;

    // 1) DigiPRO Wave Lab midi.js style
    if (typeof window.mmAddSysexListener === 'function'){
      try{
        window.mmAddSysexListener(_handleIncomingSysex);
      }catch(err){
        console.warn('[MD-UW] mmAddSysexListener failed:', err);
      }
    }

    // 2) MDDT midi.js style (calls onMidiMessageUW(arr) for every inbound message)
    if (!window.__mdUwWaveModeWrappedOnMidiMessageUW){
      const wrap = ()=>{
        if (typeof window.onMidiMessageUW !== 'function') return false;
        if (window.__mdUwWaveModeWrappedOnMidiMessageUW) return true;
        const orig = window.onMidiMessageUW;
        window.onMidiMessageUW = function(arr){
          try{ _handleIncomingSysex(arr); }catch(_){}
          return orig.apply(this, arguments);
        };
        window.__mdUwWaveModeWrappedOnMidiMessageUW = true;
        return true;
      };
      // Try now, and once again after load.
      try{ wrap(); }catch(_){}
      try{ window.addEventListener('load', ()=>{ try{ wrap(); }catch(_){} }, { once:true }); }catch(_){}
    }
  }

  function _waitHandshake(expectPkt, timeoutMs, signal){
    _installHandshakeListener();
    if (_waiter) return Promise.resolve({ ok:false, type:'BUSY', packet:null });

    const to = Math.max(50, Number(timeoutMs)||1000);

    return new Promise((resolve, reject)=>{
      const w = { expectPkt: (expectPkt==null?null:(expectPkt&0x7F)), resolve, signal, timer:null, onAbort:null };
      _waiter = w;
      w.timer = setTimeout(()=>{
        if (_waiter !== w) return;
        _waiter = null;
        if (signal && w.onAbort){ try{ signal.removeEventListener('abort', w.onAbort); }catch(_){} }
        resolve({ ok:false, type:'NO_HANDSHAKE', packet: w.expectPkt });
      }, to);

      if (signal){
        if (signal.aborted){
          try{ clearTimeout(w.timer); }catch(_){}
          _waiter = null;
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        w.onAbort = ()=>{
          try{ clearTimeout(w.timer); }catch(_){}
          if (_waiter === w) _waiter = null;
          reject(new DOMException('Aborted', 'AbortError'));
        };
        try{ signal.addEventListener('abort', w.onAbort, { once:true }); }catch(_){}
      }
    });
  }

  // --- SDS encoding ---
  function _encodeValueTo7BitBytes(val, n){
    let v = Number(val) >>> 0;
    const out = [];
    for (let i=0;i<n;i++){
      out.push(v & 0x7F);
      v = v >>> 7;
    }
    return out;
  }

  function _encodePCMTo7Bit(pcmBuffer, sampleFormat){
    // sampleFormat: 8 or 16
    const view = new DataView(pcmBuffer);
    const numSamples = pcmBuffer.byteLength / 2;
    const n = (sampleFormat === 8) ? 2 : 3;
    const offset = Math.pow(2, sampleFormat) / 2;

    const out = new Uint8Array(numSamples * n);
    let o = 0;
    for (let i=0;i<numSamples;i++){
      const s = view.getInt16(i*2, true);
      const u = s + offset;
      const temp = u << (8 - n);
      for (let j=n-1;j>=0;j--){
        out[o++] = (temp >> (7*j)) & 0x7F;
      }
    }
    return out;
  }

  function _buildSdsDataPacket(packetNumber, body120){
    const pkt = new Uint8Array(127);
    pkt[0] = 0xF0;
    pkt[1] = 0x7E;
    pkt[2] = 0x00;
    pkt[3] = 0x02;
    pkt[4] = packetNumber & 0x7F;
    pkt.set(body120, 5);
    let c = 0;
    for (let i=1;i<5;i++) c ^= pkt[i];
    for (let i=0;i<120;i++) c ^= body120[i];
    pkt[125] = c & 0x7F;
    pkt[126] = 0xF7;
    return pkt;
  }

  function _buildSdsHeader(sampleNumber, sampleFormat, sampleRate, totalWords, loopStart, loopEnd, loopType){
    const samplePeriod = Math.round(MD_CLOCK / Math.max(1, sampleRate));

    const bytes = [
      0xF0, 0x7E, 0x00, 0x01,
      sampleNumber & 0x7F,
      (sampleNumber >> 7) & 0x7F,
      sampleFormat & 0x7F,
      ..._encodeValueTo7BitBytes(samplePeriod, 3),
      ..._encodeValueTo7BitBytes(totalWords, 3),
      ..._encodeValueTo7BitBytes(loopStart, 3),
      ..._encodeValueTo7BitBytes(loopEnd, 3),
      loopType & 0x7F,
      0xF7
    ];
    return new Uint8Array(bytes);
  }

  // --- Wave conversion (DigiPRO wave -> PCM16) ---

  function _mod(n, m){
    n = n|0; m = m|0;
    if (m <= 0) return 0;
    n = n % m;
    return (n < 0) ? (n + m) : n;
  }

  function _u8ToFloatCycle(u8){
    const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    const f = new Float32Array(a.length);
    for (let i=0;i<a.length;i++) f[i] = ((a[i]|0) - 128) / 127;
    return f;
  }

  function _findRisingZeroCrossingRot(f){
    const n = f.length|0;
    if (n < 2) return 0;
    let best = 0;
    let bestSlope = -1e9;
    for (let i=0;i<n;i++){
      const a = f[i];
      const b = f[(i+1)%n];
      if (a <= 0 && b > 0){
        const slope = b - a;
        if (slope > bestSlope){
          bestSlope = slope;
          best = (i+1)%n;
        }
      }
    }
    if (bestSlope > -1e8) return best;

    // Fallback: closest to 0
    let bestAbs = 1e9;
    for (let i=0;i<n;i++){
      const v = Math.abs(f[i]);
      if (v < bestAbs){ bestAbs = v; best = i; }
    }
    return best;
  }

  function _rotateFloat(f, rot){
    const n = f.length|0;
    rot = ((rot|0)%n + n) % n;
    if (!rot) return f;
    const out = new Float32Array(n);
    for (let i=0;i<n;i++) out[i] = f[(i+rot)%n];
    return out;
  }

  // Periodic resample for float cycles.
  // - Upsampling uses a Catmull-Rom cubic (smooth).
  // - Downsampling uses a simple multi-tap box filter (anti-alias-ish).
  function _resampleCycleFloat(srcF, targetLen){
    const src = (srcF instanceof Float32Array) ? srcF : Float32Array.from(srcF||[]);
    const N = src.length|0;
    const M = (targetLen|0);
    if (!N || !M || N === M) return (src instanceof Float32Array) ? new Float32Array(src) : Float32Array.from(src);

    // Downsample: average multiple linear samples per output.
    if (N > M){
      const taps = Math.max(4, Math.min(32, Math.round(N / M * 8)));
      const out = new Float32Array(M);
      const step = N / M;
      for (let i=0;i<M;i++){
        let acc = 0;
        for (let t=0;t<taps;t++){
          const x = (i + (t + 0.5)/taps) * step;
          const xi = Math.floor(x);
          const i0 = _mod(xi, N);
          const i1 = (i0 + 1) % N;
          const frac = x - xi;
          acc += src[i0]*(1-frac) + src[i1]*frac;
        }
        out[i] = acc / taps;
      }
      return out;
    }

    // Upsample: Catmull-Rom cubic interpolation (periodic).
    const out = new Float32Array(M);
    const step = N / M;
    for (let i=0;i<M;i++){
      const x = i * step;
      const i1 = Math.floor(x);
      const t = x - i1;
      // p0, p1, p2, p3 around i1
      const p0 = src[_mod(i1 - 1, N)];
      const p1 = src[_mod(i1,     N)];
      const p2 = src[_mod(i1 + 1, N)];
      const p3 = src[_mod(i1 + 2, N)];
      const t2 = t*t;
      const t3 = t2*t;
      // Catmull-Rom spline (0.5 tension)
      out[i] = 0.5 * (
        (2*p1) +
        (-p0 + p2) * t +
        (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
        (-p0 + 3*p1 - 3*p2 + p3) * t3
      );
    }
    return out;
  }

  function _defaultBoundaryXfadeLen(n){
    // “Very short”: ~1.5% of the cycle length.
    // 96 → 2, 256 → 4, 512 → 8
    const L = Math.round((n|0) * 0.015);
    return Math.max(2, Math.min(32, L));
  }

  function _applyBoundaryCrossfadeInPlace(f, len){
    const n = f.length|0;
    len = Math.max(0, len|0);
    if (n < 4 || len < 1) return f;
    len = Math.min(len, (n>>1));

    for (let i=0;i<len;i++){
      const aIdx = i;
      const bIdx = (n - 1 - i);
      const a = f[aIdx];
      const b = f[bIdx];

      // Weight: 0.5 at the boundary, tapering to 0.
      let w = 0.5;
      if (len > 1){
        const win = 0.5 * (1 + Math.cos(Math.PI * (i / (len - 1))));
        w = 0.5 * win;
      }

      f[aIdx] = a*(1 - w) + b*w;
      f[bIdx] = b*(1 - w) + a*w;
    }
    return f;
  }

  // Crossfade *across* a boundary between two adjacent segments in a longer buffer.
  // boundaryIdx is the index of the first sample of the right-hand segment.
  // This is useful for smoothing a single "turnaround" join in palindromic/ping‑pong packs.
  function _applyAdjacentCrossfadeInPlace(f, boundaryIdx, len){
    const n = f.length|0;
    boundaryIdx = boundaryIdx|0;
    len = Math.max(0, len|0);
    if (n < 8 || len < 1) return f;
    if (boundaryIdx <= 0 || boundaryIdx >= n) return f;
    // Clamp so we don't walk outside either side.
    len = Math.min(len, boundaryIdx, n - boundaryIdx);
    if (len < 1) return f;

    for (let i=0;i<len;i++){
      const aIdx = boundaryIdx - len + i;
      const bIdx = boundaryIdx + i;
      const a = f[aIdx];
      const b = f[bIdx];

      // Equal-power-ish cosine ramp 0..1
      const t = (i + 0.5) / len;
      const w = 0.5 - 0.5 * Math.cos(Math.PI * t);

      f[aIdx] = a*(1 - w) + b*w;
      f[bIdx] = b*(1 - w) + a*w;
    }
    return f;
  }

  // --- Packed-loop helpers ---
  function _removeDCInPlace(f){
    const n = f.length|0;
    if (n < 2) return f;
    let mean = 0;
    for (let i=0;i<n;i++){
      const v = Number(f[i]);
      mean += Number.isFinite(v) ? v : 0;
    }
    mean /= n;
    if (!Number.isFinite(mean) || Math.abs(mean) < 1e-12) return f;
    for (let i=0;i<n;i++){
      const v = Number(f[i]);
      f[i] = (Number.isFinite(v) ? v : 0) - mean;
    }
    return f;
  }

  function _blendCyclesFloat(a, b, t){
    const n = Math.min(a.length|0, b.length|0);
    const out = new Float32Array(n);
    const tt = Math.max(0, Math.min(1, Number(t)));
    const it = 1 - tt;
    for (let i=0;i<n;i++) out[i] = a[i]*it + b[i]*tt;
    return out;
  }

  // Generate k blended in-betweens between each neighbor (k=1..3).
  // Cost: increases packed length, but makes scanning/looping much smoother.
  function _expandInterSlotMorph(cycles, inbetweens){
    const k = _clampInt(inbetweens, 0, 3);
    if (!Array.isArray(cycles) || cycles.length < 2 || k <= 0) return cycles;
    const out = [];
    for (let i=0;i<cycles.length;i++){
      const A = cycles[i];
      out.push(A);
      if (i < cycles.length - 1){
        const B = cycles[i+1];
        for (let j=1;j<=k;j++){
          const t = j / (k + 1);
          out.push(_blendCyclesFloat(A, B, t));
        }
      }
    }
    return out;
  }

  function _normPackFxId(v){
    const s = String(v || 'none').toLowerCase();
    switch (s){
      case 'softclip':
      case 'wavefold':
      case 'rectify_half':
      case 'rectify_full':
      case 'bitcrush12':
      case 'bitcrush10':
      case 'bitcrush8':
        return s;
      default:
        return 'none';
    }
  }

  function _applyPackFxInPlace(f, fxId){
    fxId = _normPackFxId(fxId);
    const n = f.length|0;
    if (fxId === 'none' || n < 1) return f;

    if (fxId === 'softclip'){
      // Gentle tanh drive (keeps loop stability while adding harmonics).
      const drive = 1.6;
      const norm = Math.tanh(drive) || 1;
      for (let i=0;i<n;i++){
        let x = Number(f[i]);
        if (!Number.isFinite(x)) x = 0;
        f[i] = Math.tanh(x * drive) / norm;
      }
      return f;
    }

    if (fxId === 'wavefold'){
      const thr = 0.65;
      const limit = 8; // prevent pathological loops
      for (let i=0;i<n;i++){
        let x = Number(f[i]);
        if (!Number.isFinite(x)) x = 0;
        let y = x;
        let it = 0;
        while ((y > thr || y < -thr) && it++ < limit){
          if (y > thr) y = 2*thr - y;
          else if (y < -thr) y = -2*thr - y;
        }
        if (y > 1) y = 1;
        if (y < -1) y = -1;
        f[i] = y;
      }
      return f;
    }

    if (fxId === 'rectify_half'){
      for (let i=0;i<n;i++){
        let x = Number(f[i]);
        if (!Number.isFinite(x)) x = 0;
        f[i] = Math.max(0, x);
      }
      return f;
    }

    if (fxId === 'rectify_full'){
      for (let i=0;i<n;i++){
        let x = Number(f[i]);
        if (!Number.isFinite(x)) x = 0;
        f[i] = Math.abs(x);
      }
      return f;
    }

    if (fxId === 'bitcrush12' || fxId === 'bitcrush10' || fxId === 'bitcrush8'){
      const bits = (fxId === 'bitcrush8') ? 8 : (fxId === 'bitcrush10') ? 10 : 12;
      const levels = Math.max(2, Math.round(Math.pow(2, bits)));
      const denom = levels - 1;
      for (let i=0;i<n;i++){
        let x = Number(f[i]);
        if (!Number.isFinite(x)) x = 0;
        if (x > 1) x = 1;
        if (x < -1) x = -1;
        const u = (x * 0.5) + 0.5;
        const q = Math.round(u * denom) / denom;
        f[i] = (q - 0.5) * 2;
      }
      return f;
    }

    return f;
  }

  function _floatToPCM16Buffer(f){
    const n = f.length|0;
    const buf = new ArrayBuffer(n * 2);
    const dv = new DataView(buf);
    for (let i=0;i<n;i++){
      let x = Number(f[i]);
      if (!Number.isFinite(x)) x = 0;
      if (x > 1) x = 1;
      if (x < -1) x = -1;
      let s = Math.round(x * 32767);
      if (s < -32768) s = -32768;
      if (s > 32767) s = 32767;
      dv.setInt16(i*2, s, true);
    }
    return buf;
  }

  function _waveToAlignedCycleFloat(wave, opts){
    opts = opts || {};
    const phaseAlign = (opts.phaseAlign !== false);
    // When true, force the final sample to equal the first sample.
    // Useful for single-cycle oscillator playback on devices that include the loop-end sample.
    // For packed-loop scans, callers can disable this to preserve the native cycle edge shape.
    const closeCycle = (opts.closeCycle !== false);

    const basePPC = (opts.pointsPerCycle != null) ? (opts.pointsPerCycle|0) : 96;
    const pitchOctaves = (opts.pitchOctaves != null) ? (opts.pitchOctaves|0) : 0;

    // Pitch shift (repitch) is implemented by changing the cycle length:
    //   +1 octave => half as many samples per cycle (higher base pitch)
    //   -1 octave => double samples per cycle (lower base pitch)
    let pointsPerCycle = basePPC;
    if (pitchOctaves){
      const pow2 = Math.pow(2, pitchOctaves);
      if (Number.isFinite(pow2) && pow2 > 0){
        pointsPerCycle = Math.round(basePPC / pow2);
      }
    }
    // Safety clamp (prevents pathological allocations if called with extreme values).
    pointsPerCycle = _clampInt(pointsPerCycle, 8, 32768);

    const boundaryXfade = !!opts.boundaryXfade;

    let f = null;

    // Prefer high-res float if provided
    if (wave && wave._srcFloat && wave._srcFloat.length){
      const src = wave._srcFloat;
      f = (src instanceof Float32Array) ? new Float32Array(src) : Float32Array.from(src);
    } else if (wave && wave.dataU8){
      f = _u8ToFloatCycle(wave.dataU8);
    } else {
      f = new Float32Array(0);
    }

    if (phaseAlign && f.length >= 2){
      // If the UI has already computed a display rotation, prefer it.
      let rot = 0;
      try{
        if (wave && wave.dataU8 && typeof wave.dataU8.displayRot === 'number') rot = wave.dataU8.displayRot|0;
      }catch(_){ rot = 0; }
      if (!rot) rot = _findRisingZeroCrossingRot(f);
      f = _rotateFloat(f, rot);
    }

    // Resample points-per-cycle (96 → 256/512 etc.) for smoother oscillator playback.
    if (f.length && pointsPerCycle > 0 && f.length !== pointsPerCycle){
      f = _resampleCycleFloat(f, pointsPerCycle);
    }

    // Optional boundary smoothing (helps if some waves still click despite phase-align).
    if (boundaryXfade && f.length >= 4){
      _applyBoundaryCrossfadeInPlace(f, _defaultBoundaryXfadeLen(f.length));
    }
    if (closeCycle && f.length >= 2){
      // Robust closure for devices that include the loop end sample.
      f[f.length - 1] = f[0];
    }
    return f;
  }

  function _makeSingleCycleSample(wave, opts){
    const sampleRate = _clampInt(opts.sampleRate || 44100, 4000, 96000);
    const f = _waveToAlignedCycleFloat(wave, opts);
    const pcm = _floatToPCM16Buffer(f);

    const numSamples = f.length|0;
    return {
      rawPCM: pcm,
      numSamples,
      sampleRate,
      loopStart: 0,
      loopEnd: numSamples, // matches UW sample-manager semantics
      name: (wave && wave.name) ? String(wave.name) : '----'
    };
  }
  function _makePackedSample(waves, opts){
    opts = opts || {};
    const sampleRate = _clampInt(opts.sampleRate || 44100, 4000, 96000);
    const palindrome = !!opts.palindrome;

    // --- Pack-only processing options (safe defaults) ---
    const basePPC = (opts.pointsPerCycle != null) ? (opts.pointsPerCycle|0) : 96;
    const packDcRemove = (opts.packDcRemove !== false);
    const packMorph = _clampInt((opts.packMorph != null) ? opts.packMorph : 0, 0, 3);
    const packFx = _normPackFxId(opts.packFx);

    // Short per-boundary crossfade at every slot join.
    // null/undefined => auto (recommended), 0 => off
    let joinLen = null;
    if (opts.packJoinXfade != null) joinLen = _clampInt(opts.packJoinXfade, 0, 256);
    if (joinLen == null){
      if (palindrome || opts.boundaryXfade){
        // Aim for ~3% of cycle length, clamped to 4..16 samples.
        joinLen = _clampInt(Math.round(basePPC * 0.03), 4, 16);
      } else {
        joinLen = 0;
      }
    }

    // Global wrap smoothing (end -> start). Palindrome packs benefit from a longer blend.
    let wrapLen = 0;
    if (palindrome || joinLen > 0 || opts.boundaryXfade){
      wrapLen = _defaultBoundaryXfadeLen(Math.max(8, basePPC));
      if (palindrome) wrapLen = Math.max(8, Math.min(256, wrapLen * 4));
      else wrapLen = Math.max(4, Math.min(128, wrapLen * 2));
    }

    // Build cycles as *open* cycles (do not force last==first); we handle continuity at the packed level.
    const cycleOpts = Object.assign({}, opts, { closeCycle:false });
    const cycles = [];
    for (const w of (waves||[])){
      const f = _waveToAlignedCycleFloat(w, cycleOpts);
      if (!f.length) continue;

      if (packFx !== 'none') _applyPackFxInPlace(f, packFx);
      if (packDcRemove) _removeDCInPlace(f);

      cycles.push(f);
    }
    if (!cycles.length) throw new Error('No wave data to pack.');

    // Inter-slot morphing (frame blend): insert 1..3 blended cycles between each neighbor.
    let frames = cycles;
    if (packMorph > 0) frames = _expandInterSlotMorph(cycles, packMorph);

    // Build the packed sample order.
    // Palindrome (ping‑pong) notes:
    // - We avoid endpoint repeats to prevent the classic “double-hit” at the turnaround or loop wrap.
    //   forward: 0..N-1
    //   reverse: N-2..1
    // Result length in cycles = 2N-2 (for N>=2), and in the infinite loop you get ...2,1,0,1,2... with no stalls.
    let seq = frames;
    if (palindrome && frames.length > 1){
      seq = [];
      for (let i=0;i<frames.length;i++) seq.push(frames[i]);
      for (let i=frames.length-2; i>=1; i--) seq.push(frames[i]);
    }

    let outLen = 0;
    for (const f of seq) outLen += (f.length|0);
    const out = new Float32Array(outLen);

    const boundaries = [];
    let off = 0;
    for (const f of seq){
      if (off > 0) boundaries.push(off);
      out.set(f, off);
      off += f.length;
    }

    // Crossfade every slot boundary (helps eliminate boundary ticks almost entirely).
    if (joinLen > 0 && out.length >= 8){
      for (let i=0;i<boundaries.length;i++){
        _applyAdjacentCrossfadeInPlace(out, boundaries[i], joinLen);
      }
    }

    // Smooth the wrap (end -> start) as well.
    if (wrapLen > 0 && out.length >= 8){
      _applyBoundaryCrossfadeInPlace(out, wrapLen);
    }

    // Ensure the whole packed sample closes exactly (robust on devices that include loopEnd).
    if (out.length >= 2) out[out.length - 1] = out[0];

    const pcm = _floatToPCM16Buffer(out);
    return {
      rawPCM: pcm,
      numSamples: out.length|0,
      sampleRate,
      loopStart: 0,
      loopEnd: out.length|0,
      name: (waves && waves[0] && waves[0].name) ? String(waves[0].name) : (palindrome ? 'PALI' : 'PACK')
    };
  }

  // --- Machinedrum non-SDS helper: set sample name (Elektron sysex 0x73) ---
  async function _mdSetSampleName(sampleNumber, name, mdDeviceId, signal){
    _requireMidiOut();
    const nm = (String(name||'----').toUpperCase().padEnd(4,'-')).slice(0,4);
    const devId = _clampInt(mdDeviceId||0, 0, 126);

    const bytes = [
      0xF0, 0x00, 0x20, 0x3C, 0x02, devId,
      0x73,
      sampleNumber & 0x7F,
      nm.charCodeAt(0) & 0x7F,
      nm.charCodeAt(1) & 0x7F,
      nm.charCodeAt(2) & 0x7F,
      nm.charCodeAt(3) & 0x7F,
      0xF7
    ];
    _sendSysex(bytes);
    // Just give the device a moment; this is not SDS-handshaked.
    await _waitWireDrain(2, signal);
  }

  // --- Core SDS send ---
  async function _sendSdsSample(sampleNumber, sampleObj, opts){
    const signal = opts.signal;
    const openLoopForced = !!opts.forceOpenLoop;
    const setName = (opts.setName !== false);
    const phaseAlign = (opts.phaseAlign !== false);
    const mdDeviceId = _clampInt(opts.mdDeviceId||0, 0, 126);

    const sampleRate = _clampInt(sampleObj.sampleRate || 44100, 4000, 96000);
    const totalWords = sampleObj.numSamples|0;
    const loopStart  = (sampleObj.loopStart==null ? 0 : (sampleObj.loopStart|0));
    const loopEnd    = (sampleObj.loopEnd==null ? totalWords : (sampleObj.loopEnd|0));
    const hasLoop = (loopStart != null && loopEnd != null);
    const loopType = hasLoop ? 0 : 0x7F;

    const header = _buildSdsHeader(sampleNumber|0, 16, sampleRate, totalWords, loopStart, loopEnd, loopType);

    // 1) Send header
    _sendSysex(header);

    let openLoop = openLoopForced;

    // 2) Wait for initial handshake (if using closed-loop)
    if (!openLoop){
      // Header ACK can be slow if MD isn't in RECV yet.
      const headerTimeout = (window.turboActive ? 1500 : 5000);
      let hdr = await _waitHandshake(null, headerTimeout, signal);

      // WAIT is allowed; keep waiting (with a tiny backoff so we don't spin).
      while (hdr.type === 'WAIT'){
        await _sleep(window.turboActive ? 10 : 80, signal);
        hdr = await _waitHandshake(null, headerTimeout, signal);
      }

      if (hdr.type === 'NO_HANDSHAKE' || hdr.type === 'BUSY'){
        // Fallback to open-loop.
        openLoop = true;
      } else if (!hdr.ok){
        throw new Error('SDS header rejected: ' + hdr.type);
      }
    }

    // 3) Optional: set sample name (Elektron extension)
    if (setName){
      try{ await _mdSetSampleName(sampleNumber|0, sampleObj.name, mdDeviceId, signal); }catch(_){ /* ignore */ }
    }

    // 4) Send data
    const encoded = _encodePCMTo7Bit(sampleObj.rawPCM, 16);
    const chunk = new Uint8Array(120);

    let offset = 0;
    let packetNumber = 0;
    let sawEOF = false;

    const onProgress = (typeof opts.onProgress === 'function') ? opts.onProgress : null;

    if (openLoop){
      while (offset < encoded.length){
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const n = Math.min(120, encoded.length - offset);
        chunk.fill(0);
        chunk.set(encoded.subarray(offset, offset + n), 0);
        offset += n;

        const pkt = _buildSdsDataPacket(packetNumber, chunk);
        _sendSysex(pkt);

        if (onProgress) onProgress(offset / encoded.length);

        packetNumber = (packetNumber + 1) & 0x7F;
        await _waitWireDrain(0, signal);
      }

      // Mirror the sample-manager behavior: set the name again after the dump.
      if (setName){
        try{ await _mdSetSampleName(sampleNumber|0, sampleObj.name, mdDeviceId, signal); }catch(_){ }
      }
      return;
    }

    // Closed-loop (robust)
    while (offset < encoded.length){
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const n = Math.min(120, encoded.length - offset);
      chunk.fill(0);
      chunk.set(encoded.subarray(offset, offset + n), 0);

      const pkt = _buildSdsDataPacket(packetNumber, chunk);

      let attempts = 0;
      for (;;){
        attempts++;
        _sendSysex(pkt);

        const r = await _waitHandshake(packetNumber, window.turboActive ? 1200 : 2000, signal);
        if (r.type === 'WAIT'){
          // Device says it's busy: back off briefly, then resend.
          await _sleep(window.turboActive ? 5 : 25, signal);
          continue;
        }
        if (r.type === 'NO_HANDSHAKE'){
          // Give up and fallback to open-loop for remaining packets
          openLoop = true;
          break;
        }
        if (r.type === 'EOF'){
          sawEOF = true;
          break;
        }
        if (r.ok){
          break;
        }
        if (r.type === 'NAK' && attempts < 3){
          // resend with a small delay (gives the receiver time to flush)
          await _sleep(window.turboActive ? 5 : 25, signal);
          continue;
        }
        throw new Error('SDS data rejected (pkt ' + packetNumber + '): ' + r.type);
      }

      if (openLoop){
        // Commit this chunk and switch to open-loop for the rest
        offset += n;
        if (onProgress) onProgress(offset / encoded.length);
        packetNumber = (packetNumber + 1) & 0x7F;
        break;
      }

      offset += n;
      if (onProgress) onProgress(offset / encoded.length);
      packetNumber = (packetNumber + 1) & 0x7F;
    }

    // If we fell back to open-loop mid-way
    if (openLoop && offset < encoded.length){
      while (offset < encoded.length){
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const n = Math.min(120, encoded.length - offset);
        chunk.fill(0);
        chunk.set(encoded.subarray(offset, offset + n), 0);
        offset += n;
        const pkt = _buildSdsDataPacket(packetNumber, chunk);
        _sendSysex(pkt);
        if (onProgress) onProgress(offset / encoded.length);
        packetNumber = (packetNumber + 1) & 0x7F;
        await _waitWireDrain(0, signal);
      }

      // Mirror the open-loop path in the sample-manager script.
      if (setName){
        try{ await _mdSetSampleName(sampleNumber|0, sampleObj.name, mdDeviceId, signal); }catch(_){ }
      }
      return;
    }

    // End-of-transfer handshake (optional)
    if (!sawEOF){
      await _waitHandshake(null, window.turboActive ? 1200 : 2000, signal).catch(()=>null);
    }

    // Some MD setups only apply name reliably after transfer
    if (setName){
      try{ await _mdSetSampleName(sampleNumber|0, sampleObj.name, mdDeviceId, signal); }catch(_){ }
    }
  }

  // --- Packed-loop → WAV download helpers (optional convenience) ---
  function _pcm16BufferToInt16LE(buf){
    try{
      const ab = (buf instanceof ArrayBuffer) ? buf : (buf && buf.buffer) ? buf.buffer : null;
      if (!ab) return new Int16Array(0);
      const dv = new DataView(ab);
      const n = Math.floor(dv.byteLength/2);
      const out = new Int16Array(n);
      for (let i=0;i<n;i++) out[i] = dv.getInt16(i*2, true);
      return out;
    }catch(_){
      try{ return new Int16Array(buf||[]); }catch(__){ return new Int16Array(0); }
    }
  }

  // Build a RIFF "smpl" chunk that encodes a forward loop.
  // Many samplers/editors honor this for seamless looping.
  function _buildSmplLoopChunk(loopStart, loopEnd, sampleRate){
    loopStart = Math.max(0, (loopStart|0));
    loopEnd = Math.max(loopStart+1, (loopEnd|0));
    const sr = Math.max(1, (sampleRate|0));

    const numLoops = 1;
    const size = 36 + (numLoops*24);
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    let o = 0;
    function U32(v){ dv.setUint32(o, v>>>0, true); o+=4; }

    const samplePeriod = Math.round(MD_CLOCK / sr);

    U32(0); // manufacturer
    U32(0); // product
    U32(samplePeriod); // sample period (ns)
    U32(60); // MIDI unity note
    U32(0); // pitch fraction
    U32(0); // SMPTE format
    U32(0); // SMPTE offset
    U32(numLoops);
    U32(0); // sampler data bytes

    // Loop record
    U32(0); // identifier
    U32(0); // type: forward
    U32(loopStart>>>0);
    U32(Math.max(loopStart, loopEnd-1)>>>0); // end (inclusive)
    U32(0); // fraction
    U32(0); // play count (0 = infinite)

    return new Uint8Array(buf);
  }

  function _sanitizeFilenameStem(s){
    s = String(s||'').trim();
    if (!s) return 'packed';
    // Keep it simple + filesystem-safe.
    return s
      .replace(/\s+/g,'_')
      .replace(/[^A-Za-z0-9._-]/g,'-')
      .replace(/-+/g,'-')
      .slice(0, 64);
  }

  function _downloadBlobCompat(blob, filename){
    filename = String(filename||'download.wav');
    try{
      if (typeof window.downloadBlob === 'function'){
        window.downloadBlob(blob, filename);
        return;
      }
    }catch(_){ }
    // Fallback: anchor click
    try{
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){}; try{ a.remove(); }catch(_){}; }, 0);
    }catch(_){ }
  }

  function _downloadPackedWav(sampleObj, meta){
    if (!sampleObj || !sampleObj.rawPCM) return false;
    const i16 = _pcm16BufferToInt16LE(sampleObj.rawPCM);
    const sr = (sampleObj.sampleRate|0) || 44100;

    const extras = [];
    try{
      if (sampleObj.loopStart != null && sampleObj.loopEnd != null){
        extras.push({ id:'smpl', bytes:_buildSmplLoopChunk(sampleObj.loopStart|0, sampleObj.loopEnd|0, sr) });
      }
    }catch(_){ }

    let wavBytes = null;
    try{
      if (typeof window.pcm16WavFromInt16 === 'function'){
        wavBytes = window.pcm16WavFromInt16(i16, sr, extras);
      }
    }catch(_){ wavBytes = null; }

    if (!wavBytes) return false;

    const blob = new Blob([wavBytes], { type:'audio/wav' });

    const stem = _sanitizeFilenameStem((meta && meta.stem) ? meta.stem : 'packed');
    const fname = `${stem}.wav`;
    _downloadBlobCompat(blob, fname);
    return true;
  }

  // --- Public helper: build a packed-loop WAV (bytes) without sending to a device ---
  // Used by the DigiPRO export modal to offer a fast "packed wavetable" download.
  //
  // waves: [{ name, dataU8, _srcFloat?, dataU8.displayRot? }, ...]
  // opts : { sampleRate, pointsPerCycle, palindrome, boundaryXfade, phaseAlign, packMorph, packDcRemove, packFx, embedLoop }
  // returns: { wavBytes: Uint8Array, sample } | null
  window.mmBuildPackedWavBytes = function(waves, opts){
    waves = Array.isArray(waves) ? waves : [];
    opts = opts || {};
    try{
      const sampleObj = _makePackedSample(waves, opts);
      if (!sampleObj || !sampleObj.rawPCM) return null;

      const i16 = _pcm16BufferToInt16LE(sampleObj.rawPCM);
      const sr = (sampleObj.sampleRate|0) || 44100;

      const extras = [];
      try{
        const embedLoop = (opts.embedLoop !== false);
        if (embedLoop && sampleObj.loopStart != null && sampleObj.loopEnd != null){
          extras.push({ id:'smpl', bytes:_buildSmplLoopChunk(sampleObj.loopStart|0, sampleObj.loopEnd|0, sr) });
        }
      }catch(_){ }

      if (typeof window.pcm16WavFromInt16 !== 'function') return null;
      const wavBytes = window.pcm16WavFromInt16(i16, sr, extras);
      if (!wavBytes) return null;

      return { wavBytes, sample: sampleObj };
    }catch(e){
      try{ console.error(e); }catch(_){ }
      return null;
    }
  };

  // --- Public: send waves to Machinedrum UW ---
  window.mmSendWavesToMachinedrumUW = async function(waves, choice, hooks){
    waves = Array.isArray(waves) ? waves : [];
    choice = choice || {};
    hooks = hooks || {};

    const signal = hooks.signal;
    const onStatus = (typeof hooks.onStatus === 'function') ? hooks.onStatus : null;
    const onWaveState = (typeof hooks.onWaveState === 'function') ? hooks.onWaveState : null;
    const onProgressOuter = (typeof hooks.onProgress === 'function') ? hooks.onProgress : null;

    if (!waves.length) throw new Error('No waves provided.');

    // Autodetect slot count if a UW manager is present
    const mdMaxSlots = _clampInt(
      (choice.mdMaxSlots != null) ? choice.mdMaxSlots : (window.uwSamples && window.uwSamples.maxSlots) ? window.uwSamples.maxSlots : 48,
      1,
      128
    );

    const mdMode = (choice.mdMode === 'pack') ? 'pack' : 'single';
    const mdStartSlot = _clampInt(choice.mdStartSlot==null?0:choice.mdStartSlot, 0, mdMaxSlots-1);
    const mdSlot = _clampInt(choice.mdSlot==null?0:choice.mdSlot, 0, mdMaxSlots-1);

    const optsBase = {
      sampleRate: _clampInt(choice.sampleRate || 44100, 4000, 96000),
      phaseAlign: (choice.phaseAlign !== false),
      pointsPerCycle: _clampInt((choice.pointsPerCycle != null) ? choice.pointsPerCycle : 96, 8, 8192),
      pitchOctaves: _clampInt((choice.pitchOctaves != null) ? choice.pitchOctaves : 0, -6, 6),
      boundaryXfade: !!choice.boundaryXfade,
      palindrome: !!choice.palindrome,
      // Packed-loop extras (ignored in single mode)
      packDcRemove: (choice.packDcRemove !== false),
      packMorph: _clampInt((choice.packMorph != null) ? choice.packMorph : 0, 0, 3),
      packJoinXfade: (choice.packJoinXfade == null) ? null : _clampInt(choice.packJoinXfade, 0, 256),
      packFx: _normPackFxId(choice.packFx),
      setName: (choice.setName !== false),
      forceOpenLoop: !!choice.forceOpenLoop,
      mdDeviceId: _clampInt(choice.mdDeviceId||0, 0, 126),
      signal
    };

    if (mdMode === 'pack'){
      const palLabel = optsBase.palindrome ? ' (palindrome)' : '';
      if (onStatus) onStatus(`Packing ${waves.length} wave(s)${palLabel} → MD slot ${mdSlot+1} (looped SDS)…`);
      const sample = _makePackedSample(waves, optsBase);

      // Optional convenience: download the packed loop sample as a WAV
      // (includes an embedded RIFF "smpl" loop chunk when possible).
      if (choice && choice.downloadPackedWav){
        try{
          const baseName = (()=>{
            const n0 = waves && waves[0] && waves[0].name ? String(waves[0].name) : '';
            const n1 = waves && waves[waves.length-1] && waves[waves.length-1].name ? String(waves[waves.length-1].name) : '';
            const range = (n0 && n1 && n0!==n1) ? `${n0}-${n1}` : (n0 || 'PACK');
            const pal = optsBase.palindrome ? '_pal' : '';
            return `packed_${waves.length}w_${optsBase.pointsPerCycle}ppc_${optsBase.sampleRate}Hz${pal}_${range}`;
          })();
          const ok = _downloadPackedWav(sample, { stem: baseName });
          if (onStatus && ok) onStatus(`Downloaded packed WAV: ${_sanitizeFilenameStem(baseName)}.wav`);
          if (onStatus && !ok) onStatus('Packed WAV download failed.');
        }catch(_){
          if (onStatus) onStatus('Packed WAV download failed.');
        }
      }

      await _sendSdsSample(mdSlot, sample, {
        ...optsBase,
        onProgress: (p)=>{ if (onProgressOuter) onProgressOuter(-1, Math.round(p*100)); }
      });
      if (onWaveState){
        for (const w of waves){
          try{ onWaveState(w.dpSlot, 'sent'); }catch(_){}
        }
      }
      return;
    }

    // single mode: each wave goes to consecutive slots
    const maxSend = Math.max(0, mdMaxSlots - mdStartSlot);
    const count = Math.min(waves.length, maxSend);

    if (!count) throw new Error('No destination slots available (start slot too high).');

    if (waves.length > count){
      const skipped = waves.length - count;
      if (onStatus) onStatus(`Note: ${skipped} wave(s) won’t fit (MD has ${mdMaxSlots} slot(s); start slot ${mdStartSlot+1}). Only sending the first ${count}.`);
      if (onWaveState){
        for (let j=count;j<waves.length;j++){
          try{ onWaveState(waves[j].dpSlot, 'skipped'); }catch(_){ }
        }
      }
    }

    const label = (waves.length > count) ? `${count} of ${waves.length}` : `${count}`;
    if (onStatus) onStatus(`Sending ${label} wave(s) as single-cycle SDS → MD slots ${mdStartSlot+1}..${mdStartSlot+count}…`);

    for (let i=0;i<count;i++){
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const w = waves[i];
      const dst = mdStartSlot + i;
      if (onWaveState) { try{ onWaveState(w.dpSlot, 'sending'); }catch(_){} }

      const sample = _makeSingleCycleSample(w, optsBase);

      try{
        await _sendSdsSample(dst, sample, {
          ...optsBase,
          onProgress: (p)=>{ if (onProgressOuter) onProgressOuter(w.dpSlot, Math.round(p*100)); }
        });
        if (onWaveState) { try{ onWaveState(w.dpSlot, 'sent'); }catch(_){} }
      }catch(err){
        if (onWaveState) { try{ onWaveState(w.dpSlot, 'failed'); }catch(_){} }
        throw err;
      }

      // Breather between samples helps the MD commit the previous sample (and avoids late EOF/ACK
      // being mistaken as the next header handshake).
      const gapMs = window.turboActive ? 25 : 110;
      await _sleep(gapMs, signal);
    }
  };

  // --- Public: shift-click prompt ---
  window.mmPromptShiftUpload = function(actionLabel, ctx){
    actionLabel = String(actionLabel || 'Upload');
    ctx = ctx || {};

    // Load persisted settings for BOTH targets so switching destinations does not
    // wipe the other target's configuration.
    const prefs = _loadShiftUploadPrefs();
    const defTarget = (prefs && prefs.target === 'machinedrum') ? 'machinedrum' : 'digipro';
    const prevDp = _normDigiproPrefs(prefs ? prefs.digipro : null);
    const prevMd = _normMachinedrumPrefs(prefs ? prefs.machinedrum : null);

    // Helper to build radio rows without extra CSS.
    const row = (html)=>`<div style="display:flex; gap:10px; align-items:flex-start; margin:6px 0;">${html}</div>`;

    const html = `
      <div class="mm-digi-guard">
        <div class="dlg" style="max-width:740px;">
          <div style="font-weight:700; font-size:16px; margin-bottom:10px;">Shift+${actionLabel}: choose upload mode</div>

          <div style="margin-bottom:10px; opacity:.9;">
            <div style="font-size:13px;">This sets the default upload mode for “Upload slot(s)” / “Upload ALL”. <b>Shift‑click</b> either button to change these settings.</div>
          </div>

          <div style="margin:10px 0; padding:10px; border:1px solid rgba(148,163,184,.25); border-radius:10px;">
            <div style="font-weight:600; margin-bottom:6px;">Destination</div>
            ${row(`<label title="Upload to Monomachine DigiPRO using the existing DigiPRO sysex method."><input type="radio" name="mmDest" value="digipro"> Monomachine DigiPRO (current behavior)</label>`)}
            ${row(`<label title="Send as SDS to Machinedrum UW (single-cycle samples or packed loop)."><input type="radio" name="mmDest" value="machinedrum"> Machinedrum UW (SDS single‑cycle)</label>`)}
          </div>

          <div id="mmDigiproPane" style="margin:10px 0; padding:10px; border:1px solid rgba(148,163,184,.25); border-radius:10px; display:none;">
            <div style="font-weight:600; margin-bottom:6px;">DigiPRO upload gain mode</div>
            ${row(`<label title="Use DigiPro format (normalized; consistent peak across waves)."><input type="radio" name="mmGain" value="c6"> DigiPro format</label>`)}
            ${row(`<label title="Preserve original amplitude (hotter); may clip depending on content/device."><input type="radio" name="mmGain" value="clip"> Hot/clip (preserve amplitude, may clip on MnM when wave is above red line)</label>`)}
          </div>

          <div id="mmMdPane" style="margin:10px 0; padding:10px; border:1px solid rgba(148,163,184,.25); border-radius:10px; display:none;">
            <div style="font-weight:600; margin-bottom:6px;">Machinedrum UW SDS mode</div>

            ${row(`<label title="Each wave becomes its own single-cycle SDS sample, written across MD slots starting at Start slot."><input type="radio" name="mmMdMode" value="single"> Send each wave as its own single‑cycle sample (fills MD slots)</label>`)}
            ${row(`<label title="Concatenates selected waves into one long looped sample and sends it to a single MD slot (Pack → slot)."><input type="radio" name="mmMdMode" value="pack"> Pack selected waves into one long looped sample (1 MD slot)</label>`)}

            ${row(`<label title="Pack mode only: creates a ping‑pong / palindrome scan (forward then backward) while avoiding endpoint repeats (reduces ticks/clicks at the turnaround and loop wrap)."><input id="mmMdPal" type="checkbox"> Palindromic pack (ping‑pong, no endpoint repeats)</label>`)}

            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:8px;">
              <label title="Select your UW model (sets the maximum number of sample slots)." style="display:flex; gap:6px; align-items:center;">MD slots
                <select id="mmMdSlots" style="width:140px;">
                  <option value="48">UW MKII (48)</option>
                  <option value="32">UW MKI (32)</option>
                </select>
              </label>
              <label title="First destination sample slot (1-based) when sending single-cycle samples." style="display:flex; gap:6px; align-items:center;">Start slot <input id="mmMdStart" type="number" min="1" max="48" value="1" style="width:80px;"></label>
              <label title="Destination sample slot (1-based) used in Pack mode (concatenated loop sample)." style="display:flex; gap:6px; align-items:center;">Pack → slot <input id="mmMdPack" type="number" min="1" max="48" value="1" style="width:80px;"></label>
              <label title="Samples per cycle before packing (higher = smoother but larger)." style="display:flex; gap:6px; align-items:center;">Points/cycle
                <select id="mmMdPPC" style="width:110px;">
                  <option value="96">96 (original)</option>
                  <option value="256">256</option>
                  <option value="512">512</option>
                </select>
              </label>
              <label title="Octave shift (repitch). +1 = octave up (shorter cycle / higher base pitch). -1 = octave down (longer cycle / lower base pitch)." style="display:flex; gap:6px; align-items:center;">Octave
                <select id="mmMdPitch" style="width:110px;">
                  <option value="-2">-2 oct</option>
                  <option value="-1">-1 oct</option>
                  <option value="0" selected>0 (none)</option>
                  <option value="1">+1 oct</option>
                  <option value="2">+2 oct</option>
                </select>
              </label>
              <label title="SDS sample rate for Machinedrum (lower = smaller/lo-fi)." style="display:flex; gap:6px; align-items:center;">Sample rate
                <select id="mmMdSR" style="width:120px;">
                  <option value="44100">44100 Hz</option>
                  <option value="22050">22050 Hz</option>
                  <option value="11025">11025 Hz</option>
                  <option value="5512">5512 Hz</option>
                  <option value="4000">4000 Hz</option>
                </select>
              </label>
            </div>

            <details style="margin-top:10px;">
              <summary style="cursor:pointer; opacity:.9;">Advanced</summary>
              <div style="margin-top:8px; display:flex; gap:14px; flex-wrap:wrap;">
                <label title="Rotate each cycle to start at a rising zero-crossing (helps reduce clicks)."><input id="mmMdPhase" type="checkbox" checked> Phase‑align cycles (rising zero‑cross)</label>
                <label title="Adds a tiny crossfade at cycle boundaries (reduces clicks, slightly softens transients)."><input id="mmMdXfade" type="checkbox"> Boundary crossfade (tiny)</label>
                <label title="Writes 4-character sample names derived from wave names (if available)."><input id="mmMdName" type="checkbox" checked> Set sample names (4 chars)</label>
                <label title="Skips SDS handshakes / WAITING detection (use only if your setup can’t handshake)."><input id="mmMdOpen" type="checkbox"> Force open‑loop (no handshakes)</label>
              </div>
              <div id="mmMdPackOpts" style="margin-top:10px; padding-top:8px; border-top:1px dashed rgba(148,163,184,.25); display:none; gap:14px; flex-wrap:wrap;">
                <label title="Pack mode: subtract the mean from each cycle before packing (reduces clicks / improves modulation response)."><input id="mmMdDC" type="checkbox" checked> DC removal per cycle</label>
                <label title="Pack mode: generate blended in-between cycles between neighboring slots (smoother scanning; uses more memory)." style="display:flex; gap:6px; align-items:center;">Inter-slot morph
                  <select id="mmMdMorph" style="width:92px;">
                    <option value="0" selected>Off</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
                <label title="Pack mode: short crossfade at every slot boundary (4–16 samples) to eliminate boundary ticks." style="display:flex; gap:6px; align-items:center;">Slot join xfade
                  <select id="mmMdJoin" style="width:110px;">
                    <option value="auto" selected>Auto</option>
                    <option value="0">Off</option>
                    <option value="4">4</option>
                    <option value="8">8</option>
                    <option value="16">16</option>
                  </select>
                </label>
                <label title="Pack mode: optional waveshaper for extra character (applied per cycle before packing)." style="display:flex; gap:6px; align-items:center;">Pack FX
                  <select id="mmMdFx" style="width:170px;">
                    <option value="none" selected>None</option>
                    <option value="softclip">Soft clip</option>
                    <option value="wavefold">Wavefold</option>
                    <option value="rectify_half">Rectify (half)</option>
                    <option value="rectify_full">Rectify (full)</option>
                    <option value="bitcrush12">Bitcrush (12‑bit)</option>
                    <option value="bitcrush10">Bitcrush (10‑bit)</option>
                    <option value="bitcrush8">Bitcrush (8‑bit)</option>
                  </select>
                </label>
                <label title="Pack mode: also create a WAV file of the packed loop sample (with embedded loop points) and download it."><input id="mmMdDlWav" type="checkbox"> Download packed WAV (looped)</label>
              </div>
              <div style="margin-top:8px; display:flex; gap:12px; flex-wrap:wrap;">
                <label title="Machinedrum MIDI Device ID (0–126). Usually 0 unless you changed it." style="display:flex; gap:6px; align-items:center;">MD device ID <input id="mmMdDev" type="number" min="0" max="126" value="0" style="width:80px;"></label>
              </div>
            </details>

            <div style="margin-top:10px; font-size:12px; opacity:.85;">
              On Machinedrum: go to <b>SAMPLE MGR → RECV → POS/SIZE → ORG</b> (bottom) so it shows <b>WAITING</b>, then press OK here.
            </div>
          </div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px;">
            <button id="mmCancel" title="Close without uploading.">Cancel</button>
            <button id="mmOk" title="Confirm these options and proceed.">OK</button>
          </div>
        </div>
      </div>
    `;

    return new Promise((resolve)=>{
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      const guard = wrap.querySelector('.mm-digi-guard');
      const dlg = wrap.querySelector('.dlg');

      const q = (sel)=>wrap.querySelector(sel);
      const setPane = ()=>{
        const dest = (dlg.querySelector('input[name="mmDest"]:checked')||{}).value || 'digipro';
        q('#mmDigiproPane').style.display = (dest==='digipro') ? '' : 'none';
        q('#mmMdPane').style.display = (dest==='machinedrum') ? '' : 'none';
      };

      // Show/hide pack-only options in the Machinedrum pane.
      const setMdModePane = ()=>{
        const mdMode = (dlg.querySelector('input[name="mmMdMode"]:checked')||{}).value || 'single';
        const isPack = (mdMode === 'pack');
        const po = q('#mmMdPackOpts');
        if (po) po.style.display = isPack ? 'flex' : 'none';
        const pal = q('#mmMdPal');
        if (pal) pal.disabled = !isPack;
      };

      const close = (val)=>{
        try{ document.body.removeChild(wrap); }catch(_){ wrap.remove(); }
        resolve(val);
      };

      guard.addEventListener('click', (ev)=>{ if (ev.target === guard) close(null); });
      dlg.addEventListener('click', (ev)=>ev.stopPropagation());

      // Default selections
      (dlg.querySelector(`input[name="mmDest"][value="${defTarget==='machinedrum'?'machinedrum':'digipro'}"]`) || {}).checked = true;
      (dlg.querySelector(`input[name="mmGain"][value="${(prevDp && prevDp.gainMode==='clip')?'clip':'c6'}"]`) || {}).checked = true;
      (dlg.querySelector(`input[name="mmMdMode"][value="${(prevMd && prevMd.mdMode==='pack')?'pack':'single'}"]`) || {}).checked = true;

      const setSelectValue = (sel, value, labelFn)=>{
        const el = q(sel);
        if (!el) return;
        if (value == null) return;
        const v = String(value|0);
        const exists = Array.from(el.options).some(o=>o.value === v);
        if (!exists){
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = (typeof labelFn === 'function') ? labelFn(v) : v;
          el.appendChild(opt);
        }
        el.value = v;
      };

      const syncMdSlotLimits = ()=>{
        const maxSlots = _clampInt(q('#mmMdSlots').value||'48', 1, 128);
        const s = q('#mmMdStart');
        const p = q('#mmMdPack');
        if (s){
          s.max = String(maxSlots);
          s.value = String(_clampInt(s.value||'1', 1, maxSlots));
        }
        if (p){
          p.max = String(maxSlots);
          p.value = String(_clampInt(p.value||'1', 1, maxSlots));
        }
      };

      // Prefill
      try{ if (prevMd && prevMd.mdMaxSlots) setSelectValue('#mmMdSlots', (prevMd.mdMaxSlots|0), (v)=>((v==='32')?'UW MKI (32)':'UW MKII (48)')); }catch(_){ }
      try{ if (prevMd && prevMd.mdStartSlot!=null) q('#mmMdStart').value = String((prevMd.mdStartSlot|0)+1); }catch(_){ }
      try{ if (prevMd && prevMd.mdSlot!=null) q('#mmMdPack').value = String((prevMd.mdSlot|0)+1); }catch(_){ }
      try{ if (prevMd && prevMd.pointsPerCycle) setSelectValue('#mmMdPPC', (prevMd.pointsPerCycle|0), (v)=>v); }catch(_){ }
      try{ if (prevMd && prevMd.pitchOctaves!=null) setSelectValue('#mmMdPitch', (prevMd.pitchOctaves|0), (v)=>{ const n = parseInt(v,10)||0; if (!n) return '0 (none)'; return (n>0?('+'+n+' oct'):(n+' oct')); }); }catch(_){ }
      try{ if (prevMd && prevMd.sampleRate) setSelectValue('#mmMdSR', (prevMd.sampleRate|0), (v)=>`${v} Hz`); }catch(_){ }
      try{ if (prevMd && typeof prevMd.phaseAlign==='boolean') q('#mmMdPhase').checked = prevMd.phaseAlign; }catch(_){ }
      try{ if (prevMd && typeof prevMd.boundaryXfade==='boolean') q('#mmMdXfade').checked = prevMd.boundaryXfade; }catch(_){ }
      try{ if (prevMd && typeof prevMd.palindrome==='boolean') q('#mmMdPal').checked = prevMd.palindrome; }catch(_){ }
      try{ if (prevMd && typeof prevMd.packDcRemove==='boolean') q('#mmMdDC').checked = prevMd.packDcRemove; }catch(_){ }
      try{ if (prevMd && prevMd.packMorph!=null) setSelectValue('#mmMdMorph', (prevMd.packMorph|0), (v)=>v); }catch(_){ }
      try{
        const el = q('#mmMdJoin');
        if (el){
          const j = (prevMd && ('packJoinXfade' in prevMd)) ? prevMd.packJoinXfade : null;
          if (j == null){
            el.value = 'auto';
          } else {
            const v = String(_clampInt(j, 0, 256));
            const exists = Array.from(el.options).some(o=>o.value===v);
            if (!exists){
              const opt = document.createElement('option');
              opt.value = v;
              opt.textContent = v;
              el.appendChild(opt);
            }
            el.value = v;
          }
        }
      }catch(_){ }
      try{ if (prevMd && prevMd.packFx!=null) q('#mmMdFx').value = _normPackFxId(prevMd.packFx); }catch(_){ }
      try{ if (prevMd && typeof prevMd.downloadPackedWav==='boolean') q('#mmMdDlWav').checked = prevMd.downloadPackedWav; }catch(_){ }
      try{ if (prevMd && typeof prevMd.setName==='boolean') q('#mmMdName').checked = prevMd.setName; }catch(_){ }
      try{ if (prevMd && typeof prevMd.forceOpenLoop==='boolean') q('#mmMdOpen').checked = prevMd.forceOpenLoop; }catch(_){ }
      try{ if (prevMd && prevMd.mdDeviceId!=null) q('#mmMdDev').value = String(prevMd.mdDeviceId|0); }catch(_){ }

      // Clamp slot inputs to selected MD slot count.
      syncMdSlotLimits();
      try{ q('#mmMdSlots').addEventListener('change', syncMdSlotLimits); }catch(_){ }

      // If ctx clearly indicates there is only 0/1 wave, default to "single" (unless the user
      // explicitly chose Pack last time — in that case, keep their preference).
      try{
        const raw = (ctx && ('selectedCount' in ctx)) ? ctx.selectedCount : null;
        const selCount = (typeof raw === 'number' && Number.isFinite(raw)) ? raw : null;
        const hadPrevPack = !!(prevMd && prevMd.mdMode === 'pack');
        if (selCount != null && selCount < 2 && !hadPrevPack){
          (dlg.querySelector('input[name="mmMdMode"][value="single"]')||{}).checked = true;
        }
      }catch(_){ }

      const onDestChange = ()=>{ setPane(); setMdModePane(); };
      for (const r of dlg.querySelectorAll('input[name="mmDest"]')) r.addEventListener('change', onDestChange);
      for (const r of dlg.querySelectorAll('input[name="mmMdMode"]')) r.addEventListener('change', setMdModePane);

      onDestChange();

      q('#mmCancel').onclick = ()=> close(null);
      q('#mmOk').onclick = ()=>{
        // Capture BOTH profiles on every confirmation so switching destinations
        // never wipes the other side's settings.
        const dest = (dlg.querySelector('input[name="mmDest"]:checked')||{}).value || 'digipro';
        const target = (dest === 'machinedrum') ? 'machinedrum' : 'digipro';

        // Clamp slot inputs to selected MD slot count before reading values.
        try{ syncMdSlotLimits(); }catch(_){ }

        const digiproPrefs = _normDigiproPrefs({
          gainMode: (dlg.querySelector('input[name="mmGain"]:checked')||{}).value || 'c6'
        });

        const mdMode = (dlg.querySelector('input[name="mmMdMode"]:checked')||{}).value || 'single';
        const mdMaxSlots = _clampInt((q('#mmMdSlots')||{}).value || '48', 1, 128);

        const mdPrefs = _normMachinedrumPrefs({
          mdMode: (mdMode === 'pack') ? 'pack' : 'single',
          mdMaxSlots,
          mdStartSlot: _clampInt((q('#mmMdStart')||{}).value || '1', 1, mdMaxSlots) - 1,
          mdSlot: _clampInt((q('#mmMdPack')||{}).value || '1', 1, mdMaxSlots) - 1,
          pointsPerCycle: _clampInt((q('#mmMdPPC')||{}).value || '96', 8, 8192),
          pitchOctaves: _clampInt((q('#mmMdPitch')||{}).value || '0', -6, 6),
          boundaryXfade: !!((q('#mmMdXfade')||{}).checked),
          palindrome: !!((q('#mmMdPal')||{}).checked),
          packDcRemove: !!((q('#mmMdDC')||{}).checked),
          packMorph: _clampInt((q('#mmMdMorph')||{}).value || '0', 0, 3),
          packJoinXfade: (()=>{
            const v = String((q('#mmMdJoin')||{}).value || 'auto');
            if (v === 'auto') return null;
            return _clampInt(v, 0, 256);
          })(),
          packFx: _normPackFxId((q('#mmMdFx')||{}).value || 'none'),
          downloadPackedWav: !!((q('#mmMdDlWav')||{}).checked),
          sampleRate: _clampInt((q('#mmMdSR')||{}).value || '44100', 4000, 96000),
          phaseAlign: !!((q('#mmMdPhase')||{}).checked),
          setName: !!((q('#mmMdName')||{}).checked),
          forceOpenLoop: !!((q('#mmMdOpen')||{}).checked),
          mdDeviceId: _clampInt((q('#mmMdDev')||{}).value || '0', 0, 126)
        });

        const prefsOut = { v:2, target, digipro: digiproPrefs, machinedrum: mdPrefs };
        _saveShiftUploadPrefs(prefsOut);

        if (target === 'machinedrum'){
          close(Object.assign({ target:'machinedrum' }, mdPrefs));
        } else {
          close({ target:'digipro', gainMode: digiproPrefs.gainMode });
        }
      };
    });
  };

})();
