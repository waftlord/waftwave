// mmdt-midi.js — robust WebMIDI glue (Turbo + SysEx reassembly)
(function(){
'use strict';

  // Prevent double-initialisation (hot reload / accidental duplicate script tag).
  if (window.__dpMidiInitOnce) return;
  window.__dpMidiInitOnce = true;

  // -----------------------------
  // Globals / state
  // -----------------------------
  window.selectedMidiIn  = window.selectedMidiIn  || null;
  window.selectedMidiOut = window.selectedMidiOut || null;
  window.__digiproRequestsInFlight = window.__digiproRequestsInFlight || new Set();

  // Tracks whether we're currently receiving an inbound SysEx (used to avoid sending
  // extra SysEx requests mid-dump, which can break reliability at high Turbo rates).
  window.__mmSysexRxInProgress = false;

  // One source of truth for Turbo speed.
  // - currentTurboFactor: numeric multiplier (1.0 = normal)
  // - turboActive: boolean convenience (derived)
  window.currentTurboFactor = Number(window.currentTurboFactor) || 1.0;
  window.turboActive = !!(window.currentTurboFactor > 1.0001);
  window.turboFactorSource = window.turboFactorSource || 'not detected';

  function _clamp01(n){ n = Number(n); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
  function _clampInt(n, lo, hi){
    n = Number(n);
    if (!isFinite(n)) n = lo;
    n = Math.round(n);
    return Math.max(lo, Math.min(hi, n));
  }

  // Remember the user's preferred Turbo speed (speed value 1..8).
  // This is what the Turbo button enables when Turbo is currently off.
  // (Speed value 1 is "off" / normal MIDI.)
  const LS_TURBO_SPEED_KEY = 'digipro_turbo_speed_val_v1';

  function loadTurboPreferredSpeedVal(){
    try{
      const ls = window.localStorage;
      if (!ls) return null;
      const raw = ls.getItem(LS_TURBO_SPEED_KEY);
      if (raw == null || raw === '') return null;
      const v = Number(raw);
      if (!isFinite(v)) return null;
      const c = _clampInt(v, 1, 8);
      // Only persist non-1 speeds ("last used turbo").
      if (c <= 1) return null;
      return c;
    }catch(_){
      return null;
    }
  }

  function saveTurboPreferredSpeedVal(v){
    try{
      const ls = window.localStorage;
      if (!ls) return;
      if (v == null){
        ls.removeItem(LS_TURBO_SPEED_KEY);
      } else {
        const c = _clampInt(v, 1, 8);
        // Only store meaningful turbo speeds.
        if (c <= 1) ls.removeItem(LS_TURBO_SPEED_KEY);
        else ls.setItem(LS_TURBO_SPEED_KEY, String(c));
      }
    }catch(_){ }
  }

  const savedTurboPref = loadTurboPreferredSpeedVal();
  if (savedTurboPref != null) window.turboPreferredSpeedVal = savedTurboPref;
  window.turboPreferredSpeedVal = _clampInt(window.turboPreferredSpeedVal || 8, 1, 8);
  if (window.turboPreferredSpeedVal <= 1) window.turboPreferredSpeedVal = 8;


  // Small helper: promise-based sleep that respects AbortSignal.
  function sleepAbortable(ms, signal){
    ms = Math.max(0, Number(ms)||0);
    return new Promise((resolve, reject)=>{
      let t = null;
      function cleanup(){
        if (t) { try{ clearTimeout(t); }catch(_){ } t = null; }
        if (signal) { try{ signal.removeEventListener('abort', onAbort); }catch(_){ } }
      }
      function onAbort(){
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      }
      if (signal){
        if (signal.aborted) return onAbort();
        try{ signal.addEventListener('abort', onAbort, { once:true }); }catch(_){}
      }
      t = setTimeout(()=>{ cleanup(); resolve(); }, ms);
    });
  }

// -----------------------------
  // Wire clock (Turbo-aware pacing)
  // -----------------------------
  class MidiWireClock {
    constructor(getFactorFn){
      this._getFactor = typeof getFactorFn === 'function' ? getFactorFn : ()=>1.0;
      this._wireEndAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }
    _now(){
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }
    bytesPerSecond(){
      const f = Number(this._getFactor()) || 1.0;
      // 31,250 bits/sec, 10 bits per MIDI byte -> 3,125 bytes/sec at 1×.
      return 3125 * Math.max(0.1, f);
    }
    reserve(byteCount){
      const now = this._now();
      const start = Math.max(now, this._wireEndAt);
      const durMs = (Math.max(0, byteCount) / this.bytesPerSecond()) * 1000;
      const done = start + durMs;
      this._wireEndAt = done;
      return { sendAt: start, doneAt: done };
    }
    timeUntilDrain(){
      const now = this._now();
      return Math.max(0, this._wireEndAt - now);
    }
    reset(){
      this._wireEndAt = this._now();
    }
    async waitForDrain(extraMs=0, signal){
      const extra = Math.max(0, Number(extraMs)||0);
      const waitMs = this.timeUntilDrain() + extra;
      if (waitMs <= 0) return;
      await sleepAbortable(waitMs, signal);
    }
  }

  window.MidiWireClock = window.MidiWireClock || new MidiWireClock(()=>window.currentTurboFactor || 1.0);

  // Schedule a send using the wire clock (best-effort timestamped send).
  window.sendWireCounted = function(bytes){
    if (!window.selectedMidiOut) throw new Error('No MIDI Out selected.');
    const u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    const { sendAt, doneAt } = window.MidiWireClock.reserve(u8.length);
    try{
      // Timestamped send helps avoid bursting and gives more accurate wire pacing.
      window.selectedMidiOut.send(u8, sendAt);
    }catch(err){
      // Fallback: immediate send.
      try{ window.selectedMidiOut.send(u8); }catch(_){ throw err; }
    }
    return { sendAt, doneAt, length: u8.length };
  };

  // Legacy helper (kept for compatibility)
  // Turbo-aware: when available, route through sendWireCounted so:
  //  - the wire clock reflects real on-wire occupancy (used for pacing + keepalive suppression)
  //  - large SysEx uploads don't get Active Sensing injected mid-stream
  window.sendBytes = function sendBytes(bytes){
    if (!window.selectedMidiOut) throw new Error('No MIDI Out selected.');
    const u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    if (typeof window.sendWireCounted === 'function'){
      return window.sendWireCounted(u8);
    }
    window.selectedMidiOut.send(u8);
    return { length: u8.length };
  };
// -----------------------------
  // SysEx helpers + robust reassembly
  // -----------------------------
  function isSysex(u8){
    return !!(u8 && u8.length >= 2 && (u8[0] === 0xF0) && (u8[u8.length-1] === 0xF7));
  }
  function isElektron(u8){
    return !!(u8 && u8.length >= 5 && u8[0]===0xF0 && u8[1]===0x00 && u8[2]===0x20 && u8[3]===0x3C);
  }

  // How many *data* bytes follow this status byte for standard MIDI messages.
  // Used to robustly ignore non-realtime messages that (illegally) appear while
  // we're in the middle of a SysEx reassembly.
  function midiDataBytesForStatus(status){
    status = status & 0xFF;
    // Channel Voice: 0x8n..0xEn
    if (status >= 0x80 && status <= 0xEF){
      const hi = status & 0xF0;
      // Program Change + Channel Pressure are 2-byte messages
      if (hi === 0xC0 || hi === 0xD0) return 1;
      // Note Off/On, Poly Pressure, CC, Pitch Bend are 3-byte messages
      return 2;
    }
    // System Common
    if (status === 0xF1) return 1; // MTC Quarter Frame
    if (status === 0xF2) return 2; // Song Position Pointer
    if (status === 0xF3) return 1; // Song Select
    // 0xF6 Tune Request has 0 data bytes; 0xF4/0xF5 undefined.
    return 0;
  }

  // Single central "complete SysEx" fan-out.
  window.__mmSysexListeners = window.__mmSysexListeners || new Set();
  window.mmAddSysexListener = function(fn){
    if (typeof fn !== 'function') return ()=>{};
    window.__mmSysexListeners.add(fn);
    return ()=>{ try{ window.__mmSysexListeners.delete(fn); }catch(_){} };
  };

  function emitCompleteSysex(u8){
    for (const fn of Array.from(window.__mmSysexListeners)){
      try{ fn(u8); }catch(e){ console.warn('SysEx listener error:', e); }
    }
  }

  // Auto-learn SysEx Device/Unit ID from incoming Monomachine SysEx (byte[5]).
  window.mmLearnedSysexDeviceId = (typeof window.mmLearnedSysexDeviceId === 'number') ? window.mmLearnedSysexDeviceId : null;
  window.mmGetSysexDeviceId = function(){
    // Prefer an explicit override, then a learned device ID, else default to 0x00
    // (matches the working MMDT build + Monomachine default).
    const override = window.mmSysexDeviceId;
    if (Number.isInteger(override) && override >= 0 && override <= 126) return override & 0x7F;

    const learned = window.mmLearnedSysexDeviceId;
    if (Number.isInteger(learned) && learned >= 0 && learned <= 126) return learned & 0x7F;

    return 0x00;
  };

  function maybeLearnDeviceId(u8){
    // Monomachine / Machinedrum model identifier is fixed at byte[4] = 0x03.
    if (!u8 || u8.length < 6) return;
    if (u8[0]!==0xF0 || u8[1]!==0x00 || u8[2]!==0x20 || u8[3]!==0x3C) return;
    if ((u8[4] & 0x7F) !== 0x03) return;
    const dev = (u8[5] & 0x7F);
    if (dev !== 0x7F && window.mmLearnedSysexDeviceId !== dev){
      window.mmLearnedSysexDeviceId = dev;
      try{ if (window.updateSysexPreview) window.updateSysexPreview(); }catch(_){}
    }
  }

  // Robust SysEx chunk reassembly:
  // - start at 0xF0
  // - append chunks
  // - finish at 0xF7
  // - tolerate multiple messages per chunk and re-sync on stray 0xF0
  class SysExReassembler {
    constructor(onComplete){
      this._onComplete = typeof onComplete === 'function' ? onComplete : ()=>{};
      this._buf = [];
      this._in = false;
      // Number of *data* bytes to skip after we drop a non-realtime status byte
      // that illegally appeared mid-SysEx (e.g. Song Position Pointer 0xF2).
      // This must persist across feed() calls because some stacks deliver the
      // status byte and its data bytes in separate chunks.
      this._skip = 0;
      this._lastAt = 0;
      this._maxBytes = 200000; // safety guard
      this._staleMs = 1500;    // drop partial SysEx if no bytes for this long

      // Some MIDI stacks (especially at high Turbo speeds) occasionally drop the
      // final EOX (0xF7) byte when the SysEx stream goes idle right after a dump.
      // This is catastrophic for fixed-size messages like Elektron DigiPRO 0x5D
      // (7027 bytes), because a strict 0xF7-terminated reassembler will never emit
      // the message.
      //
      // We therefore add a *very small* "auto-finish" path for known fixed-size
      // messages: once we can identify a DigiPRO 0x5D, we remember its expected
      // length and if we reach (len-1) without seeing 0xF7, we wait a short grace
      // window and then append a missing 0xF7 and emit.
      this._expectedLen = 0;
      this._autofinishTimer = null;
    }
    _now(){
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    _clearAutofinish(){
      if (this._autofinishTimer){
        try{ clearTimeout(this._autofinishTimer); }catch(_){ }
        this._autofinishTimer = null;
      }
    }

    _autofinishDelayMs(){
      // Tunable for field debugging.
      // If a user reports "Turbo download sees bytes but never completes",
      // lowering this can help; raising it can help if their stack delays EOX.
      const v = window.mmSysexAutofinishMs;
      if (typeof v === 'number' && isFinite(v)){
        return Math.max(10, Math.min(250, Math.round(v)));
      }
      // Default: short enough to keep "Download ALL" fast, long enough to
      // tolerate small scheduling jitter.
      return 40;
    }

    _maybeSetExpectedLen(){
      if (this._expectedLen) return;
      // Need at least: F0 00 20 3C 03 <dev> <msgId>
      if (!this._buf || this._buf.length < 7) return;
      if (this._buf[0] !== 0xF0) return;
      if (this._buf[1] !== 0x00 || this._buf[2] !== 0x20 || this._buf[3] !== 0x3C) return;
      if ((this._buf[4] & 0x7F) !== 0x03) return;
      const msgId = this._buf[6] & 0x7F;
      // Elektron Monomachine DigiPRO waveform dump
      if (msgId === 0x5D){
        const need = (window.MMDT_DigiPRO && window.MMDT_DigiPRO.MSG_SIZE_BYTES)
          ? (window.MMDT_DigiPRO.MSG_SIZE_BYTES|0)
          : 7027;
        this._expectedLen = (need > 0) ? need : 0;
      }
    }

    _finish(){
      const out = new Uint8Array(this._buf);
      this._buf = [];
      this._in = false;
      this._expectedLen = 0;
      this._clearAutofinish();
      try{ window.__mmSysexRxInProgress = false; }catch(_){ }
      this._onComplete(out);
    }

    _maybeScheduleAutofinish(){
      if (!this._in || !this._expectedLen) return;
      const need = this._expectedLen|0;
      if (need <= 0) return;

      // If we're one byte short of the expected fixed length, we expect the next
      // non-realtime byte to be 0xF7. If it never arrives, auto-finish soon.
      if (this._buf.length === (need - 1)){
        if (this._autofinishTimer) return;
        const delay = this._autofinishDelayMs();
        this._autofinishTimer = setTimeout(()=>{
          this._autofinishTimer = null;
          if (!this._in) return;
          if (!this._expectedLen) return;
          if (this._buf && this._buf.length === (this._expectedLen - 1)){
            // Patch the missing EOX and emit.
            this._buf.push(0xF7);

            // Optional debug counters.
            try{
              window.__mmSysexStats = window.__mmSysexStats || {};
              window.__mmSysexStats.autofinishEOX = (window.__mmSysexStats.autofinishEOX||0) + 1;
            }catch(_){ }

            this._finish();
          }
        }, delay);
      } else {
        // Any further progress cancels the pending autofinish.
        this._clearAutofinish();
      }
    }

    reset(){
      this._clearAutofinish();
      this._buf.length = 0;
      this._in = false;
      this._skip = 0;
      this._expectedLen = 0;
      this._lastAt = this._now();
      try{ window.__mmSysexRxInProgress = false; }catch(_){ }
    }
    feed(u8){
      if (!u8 || !u8.length) return;
      const now = this._now();
      if (this._in && this._lastAt && (now - this._lastAt) > this._staleMs){
        // Stale partial SysEx — drop it to avoid poisoning the next message.
        // If it looks like we only missed a trailing EOX for a known fixed-size
        // message, salvage it instead of dropping.
        if (this._expectedLen && this._buf && this._buf.length === (this._expectedLen - 1)){
          this._buf.push(0xF7);
          try{
            window.__mmSysexStats = window.__mmSysexStats || {};
            window.__mmSysexStats.autofinishEOX = (window.__mmSysexStats.autofinishEOX||0) + 1;
          }catch(_){ }
          this._finish();
        } else {
          this.reset();
        }
      }
      this._lastAt = now;

      for (let i=0; i<u8.length; i++){
        const b = u8[i] & 0xFF;

        // MIDI real-time messages (0xF8–0xFF) may legally interleave anywhere in the
        // byte stream, including *inside* a SysEx message. They must not be added to
        // the SysEx buffer, or offsets/checksums will break at high Turbo rates.
        if (b >= 0xF8) continue;

        // If we previously dropped an illegal (non-realtime) status byte while inside
        // a SysEx, also drop its data bytes so they don't corrupt the reconstructed dump.
        if (this._skip > 0){
          if (b < 0x80){
            this._skip--;
            continue;
          }
          // New status byte observed before consuming the expected data bytes.
          // Abandon the remaining skip and handle this status normally.
          this._skip = 0;
        }

        // SysEx payload bytes must be 7-bit (0x00–0x7F). Only real-time bytes are
        // allowed to interleave inside a SysEx by spec, but some MIDI stacks/devices
        // have been observed injecting other status bytes (e.g. transport/SPP).
        // If that happens while we're mid-SysEx, ignore the status *and* its associated
        // data bytes so the reconstructed dump stays byte-aligned.
        if (this._in && b >= 0x80 && b !== 0xF0 && b !== 0xF7){
          this._skip = midiDataBytesForStatus(b);
          continue;
        }

        if (!this._in){
          if (b === 0xF0){
            this._in = true;
            this._buf = [0xF0];
            this._expectedLen = 0;
            this._clearAutofinish();
            try{ window.__mmSysexRxInProgress = true; }catch(_){ }
          }
          continue;
        }

        // Already in a SysEx
        if (b === 0xF0 && this._buf.length > 1){
          // Unexpected new start — assume previous message was truncated.
          // Restart from this new 0xF0.

          // If we were one byte short of a known fixed-size message, treat the
          // new 0xF0 as an implicit EOX and salvage the previous message.
          if (this._expectedLen && this._buf.length === (this._expectedLen - 1)){
            this._buf.push(0xF7);
            try{
              window.__mmSysexStats = window.__mmSysexStats || {};
              window.__mmSysexStats.autofinishEOX = (window.__mmSysexStats.autofinishEOX||0) + 1;
            }catch(_){ }
            this._finish();
          }

          this._buf = [0xF0];
          this._in = true;
          this._expectedLen = 0;
          this._clearAutofinish();
          try{ window.__mmSysexRxInProgress = true; }catch(_){ }
          continue;
        }

        this._buf.push(b);

        // Once we have enough header bytes, detect if this is a known fixed-size
        // dump and enable the EOX autofinish guard.
        this._maybeSetExpectedLen();

        if (b === 0xF7){
          this._finish();
          continue;
        }

        // If this is a fixed-size message and we're at (len-1), schedule an
        // auto-finish to compensate for missing EOX on some MIDI stacks.
        this._maybeScheduleAutofinish();

        if (this._buf.length > this._maxBytes){
          console.warn('SysEx too large; dropping partial buffer.');
          this.reset();
          return;
        }
      }
    }
  }

  // -----------------------------
  // Turbo handling
  // -----------------------------
  function speedValueToFactor(v){
    // Turbo speed "values" (from Elektron docs) map to real multipliers.
    // 1 -> 1× (normal)
    // 2 -> 2×
    // 3 -> 3.33×
    // 4 -> 4×
    // 5 -> 5×
    // 6 -> 6.66×
    // 7 -> 8×
    // 8 -> 10×
    // 9 -> 13.3×
    // 10 -> 16×
    // 11 -> 20×
    const map = {
      1: 1.0,
      2: 2.0,
      3: 3.3333333333,
      4: 4.0,
      5: 5.0,
      6: 6.6666666667,
      7: 8.0,
      8: 10.0,
      9: 13.3333333333,
      10: 16.0,
      11: 20.0
    };
    return map[v] || 1.0;
  }

  window.setTurboFactor = function(factor, source){
    let f = Number(factor);
    if (!isFinite(f) || f <= 0) f = 1.0;

    window.currentTurboFactor = f;
    window.turboActive = !!(f > 1.0001);
    window.turboFactorSource = source || (window.turboActive ? 'detected' : 'not detected');

    // Conservative inter-slot delay presets (overridable via window.turboDelayPerSlot)
    // Ported from the working MDDT turbo pathway.
    try{
      if (window.turboActive){
        if (f >= 13)      window.turboDelayPerSlot = 5;
        else if (f >= 8)  window.turboDelayPerSlot = 6;
        else if (f >= 5)  window.turboDelayPerSlot = 8;
        else if (f >= 3)  window.turboDelayPerSlot = 9;
        else              window.turboDelayPerSlot = 10;
      }
    }catch(_){}

    // Update wire clock (reset to avoid large queued offsets on factor changes).
    try{ if (window.MidiWireClock) window.MidiWireClock.reset(); }catch(_){}

    // Update UI if present.
    try{ if (window.updateTurboUI) window.updateTurboUI(); }catch(_){}
  };

  // Keepalive: send Active Sensing (0xFE) when Turbo is active.
  // Elektron docs recommend ~150ms. We skip sending if the wire is currently busy.
  window.__turboKeepAliveTimer = window.__turboKeepAliveTimer || null;
  function stopTurboKeepAlive(){
    if (window.__turboKeepAliveTimer){
      try{ clearInterval(window.__turboKeepAliveTimer); }catch(_){}
      window.__turboKeepAliveTimer = null;
    }
  }
  function startTurboKeepAlive(){
    stopTurboKeepAlive();
    if (!window.selectedMidiOut) return;
    if (!(window.currentTurboFactor > 1.0001)) return;

    window.__turboKeepAliveTimer = setInterval(()=>{
      try{
        if (!window.selectedMidiOut) return;
        if (!(window.currentTurboFactor > 1.0001)) return;

        // If we're in the middle of scheduled SysEx, skip — the traffic itself keeps Turbo alive.
        const busyMs = (window.MidiWireClock && window.MidiWireClock.timeUntilDrain) ? window.MidiWireClock.timeUntilDrain() : 0;
        if (busyMs > 50) return;

        window.selectedMidiOut.send([0xFE]); // Active Sensing (real-time)
      }catch(_){}
    }, 150);
  }

  // Parse TM‑1 Turbo status messages (product 0x04, cmd 0x02).
  // Example: F0 00 20 3C 04 00 02 <speedVal> F7
  function maybeHandleTurbo(u8){
    if (!isSysex(u8) || !isElektron(u8) || u8.length < 8) return false;

    const prod = u8[4] & 0x7F;
    const sub  = u8[5] & 0x7F;
    const cmd  = u8[6] & 0x7F;

    // TM-1: speed status / reply
    if (prod === 0x04 && sub === 0x00 && cmd === 0x02 && u8.length >= 9){
      const speedVal = u8[7] & 0x7F;
      const f = speedValueToFactor(speedVal);
      window.setTurboFactor(f, 'TM‑1 detected');
      if (f > 1.0001) startTurboKeepAlive(); else stopTurboKeepAlive();
      return true;
    }

    return false;
  }


  // Query the TM‑1 for its currently active Turbo rate (C6-style vendor query).
  // Request:  F0 00 20 3C 04 00 01 F7
  // Reply:    F0 00 20 3C 04 00 02 <idx 1..11> F7
  async function queryTM1SpeedOnce(timeoutMs=450, signal){
    if (!window.selectedMidiOut || !window.selectedMidiIn) return null;

    const Q = new Uint8Array([0xF0,0x00,0x20,0x3C,0x04,0x00,0x01,0xF7]);

    return await new Promise((resolve) => {
      if (signal && signal.aborted) return resolve(null);

      let done = false;
      let timer = null;
      let unsub = null;

      function finish(res){
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){}
        timer = null;
        try{ if (unsub) unsub(); }catch(_){}
        unsub = null;
        try{ signal?.removeEventListener('abort', onAbort); }catch(_){}
        resolve(res || null);
      }

      function onAbort(){ finish(null); }

      function onSysex(u8){
        try{
          const d = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
          if (!(isSysex(d) && isElektron(d))) return;
          if ((d[4]&0x7F)===0x04 && (d[5]&0x7F)===0x00 && (d[6]&0x7F)===0x02 && d.length>=9){
            const idx = d[7] & 0x7F;
            const factor = speedValueToFactor(idx);
            finish({ idx, factor });
          }
        }catch(_){}
      }

      // Prefer the central complete-SysEx bus (robust to chunked input)
      if (typeof window.mmAddSysexListener === 'function'){
        unsub = window.mmAddSysexListener(onSysex);
      } else {
        const raw = (ev)=>{ try{ onSysex(new Uint8Array(ev.data||[])); }catch(_){} };
        window.selectedMidiIn.addEventListener('midimessage', raw);
        unsub = ()=>{ try{ window.selectedMidiIn.removeEventListener('midimessage', raw); }catch(_){} };
      }

      if (signal) signal.addEventListener('abort', onAbort, { once:true });

      timer = setTimeout(()=>finish(null), Math.max(60, Number(timeoutMs)||450));

      // Fire query after listener is armed
      try{
        if (typeof window.sendWireCounted === 'function') window.sendWireCounted(Q);
        else window.selectedMidiOut.send(Q);
      }catch(_){
        finish(null);
      }
    });
  }

  // Set the TM‑1 Turbo speed (C6-style vendor set).
  // Set:      F0 00 20 3C 04 00 03 <idx 1..11> F7
  // Reply:    F0 00 20 3C 04 00 02 <idx 1..11> F7
  async function setTM1SpeedOnce(speedIdx, timeoutMs=650, signal){
    if (!window.selectedMidiOut || !window.selectedMidiIn) return null;

    const idx = (Math.max(1, Math.min(0x7F, (speedIdx|0))) & 0x7F);
    const S = new Uint8Array([0xF0,0x00,0x20,0x3C,0x04,0x00,0x03, idx, 0xF7]);

    return await new Promise((resolve) => {
      if (signal && signal.aborted) return resolve(null);

      let done = false;
      let timer = null;
      let unsub = null;

      function finish(res){
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){}
        try{ if (unsub) unsub(); }catch(_){}
        if (signal) try{ signal.removeEventListener('abort', onAbort); }catch(_){}
        resolve(res);
      }

      function onAbort(){ finish(null); }

      // Listen for TM‑1 speed reply (same format as query reply)
      try{
        unsub = window.mmAddSysexListener((data)=>{
          const d = (data instanceof Uint8Array) ? data : new Uint8Array(data||[]);
          if (d && d.length >= 9 &&
              d[0]===0xF0 && d[1]===0x00 && d[2]===0x20 && d[3]===0x3C &&
              (d[4]&0x7F)===0x04 && (d[5]&0x7F)===0x00 &&
              (d[6]&0x7F)===0x02 &&
              d[d.length-1]===0xF7){
            const r = d[7] & 0x7F;
            finish({ idx:r, factor: speedValueToFactor(r) });
          }
        });
      }catch(_){
        unsub = null;
      }

      if (signal) signal.addEventListener('abort', onAbort, { once:true });

      timer = setTimeout(()=>finish(null), Math.max(80, Number(timeoutMs)||650));

      // Fire set command after listener is armed
      try{
        if (typeof window.sendWireCounted === 'function') window.sendWireCounted(S);
        else window.selectedMidiOut.send(S);
      }catch(_){
        finish(null);
      }
    });
  }


  // Negotiation (master-side): ask supported speeds, choose best, request it, wait for ack.
  async function negotiateTurboOnce(opts){
    const timeoutMs = (opts && opts.timeoutMs) ? opts.timeoutMs : 800;
    const capMaxSpeedVal = (opts && opts.maxSpeedVal) ? _clampInt(opts.maxSpeedVal, 1, 11) : 8; // Monomachine max is typically 8 (10×)
    const signal = opts && opts.signal;

    if (!window.selectedMidiOut || !window.selectedMidiIn){
      throw new Error('Select MIDI In and MIDI Out first.');
    }

    // Helper: wait for a complete SysEx matching predicate.
    const waitFor = (pred, ms)=>{
      return new Promise((resolve, reject)=>{
        let done = false;
        let t = null;
        const unsub = window.mmAddSysexListener((u8)=>{
          if (done) return;
          try{
            if (pred(u8)){
              done = true;
              cleanup();
              resolve(u8);
            }
          }catch(_){}
        });

        function onAbort(){
          if (done) return;
          done = true;
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        }

        function cleanup(){
          try{ unsub(); }catch(_){}
          if (t) { try{ clearTimeout(t); }catch(_){ } }
          if (signal) { try{ signal.removeEventListener('abort', onAbort); }catch(_){ } }
        }

        if (signal){
          if (signal.aborted) return onAbort();
          try{ signal.addEventListener('abort', onAbort, { once:true }); }catch(_){}
        }

        t = setTimeout(()=>{
          if (done) return;
          done = true;
          cleanup();
          reject(new Error('Timeout'));
        }, ms);
      });
    };

    // Speed request (0x10) and answer (0x11)
    const speedReq = new Uint8Array([0xF0,0x00,0x20,0x3C,0x00,0x00,0x10,0xF7]);
    window.sendWireCounted(speedReq);
    await window.MidiWireClock.waitForDrain(5, signal);

    const ans = await waitFor((u8)=>{
      return isSysex(u8) && isElektron(u8) &&
        (u8[4]&0x7F)===0x00 && (u8[5]&0x7F)===0x00 && (u8[6]&0x7F)===0x11 &&
        u8.length >= 12;
    }, timeoutMs);

    // Parse supported speeds bitmasks
    const supportedA = ans[7] & 0x7F;
    const supportedB = ans[8] & 0x7F;
    const certifiedA = ans[9] & 0x7F;
    const certifiedB = ans[10] & 0x7F;

    const supported = [1];
    const certified = [1];

    // Bits 0..6 => speed values 2..8 (2× .. 10×)
    for (let bit=0; bit<=6; bit++){
      const speedVal = bit + 2;
      if (supportedA & (1<<bit)) supported.push(speedVal);
      if (certifiedA & (1<<bit)) certified.push(speedVal);
    }
    // Bits 0..2 => speed values 9..11 (13.3×, 16×, 20×)
    for (let bit=0; bit<=2; bit++){
      const speedVal = bit + 9;
      if (supportedB & (1<<bit)) supported.push(speedVal);
      if (certifiedB & (1<<bit)) certified.push(speedVal);
    }

    // Choose best speed value (prefer certified, else supported), capped.
    const bestFrom = (arr)=>{
      let best = 1;
      for (const v of arr){
        if (v > best && v <= capMaxSpeedVal) best = v;
      }
      return best;
    };

    let desired = bestFrom(certified);
    if (desired <= 1) desired = bestFrom(supported);
    desired = _clampInt(desired, 1, capMaxSpeedVal);

    if (desired <= 1){
      return { ok:false, factor:1.0, speedVal:1, reason:'Turbo not supported' };
    }

    // Speed negotiation (0x12) + ack (0x13)
    const speedNeg = new Uint8Array([0xF0,0x00,0x20,0x3C,0x00,0x00,0x12, desired & 0x0F, desired & 0x0F, 0xF7]);
    window.sendWireCounted(speedNeg);
    await window.MidiWireClock.waitForDrain(5, signal);

    await waitFor((u8)=>{
      return isSysex(u8) && isElektron(u8) &&
        (u8[4]&0x7F)===0x00 && (u8[5]&0x7F)===0x00 && (u8[6]&0x7F)===0x13;
    }, timeoutMs);

    const factor = speedValueToFactor(desired);
    return { ok:true, factor, speedVal:desired };
  }

  // Public: Turbo button behaviour (no extra controls)
    window.toggleTurbo = async function(){
      // Avoid concurrent toggles (double-clicks)
      if (window._turboToggleBusy){
        return { ok:false, factor: window.currentTurboFactor || 1.0, error:'busy' };
      }
      window._turboToggleBusy = true;

      try{
        // Probe TM‑1 once up-front so we know whether we can/should require a confirmation.
        const tmProbe = await queryTM1SpeedOnce(250).catch(()=>null);
        const hasTM1 = !!(tmProbe && typeof tmProbe.idx === 'number');

        // Toggle off: ask TM‑1 to drop back to OFF (idx=1), then stop keepalive.
        if (window.currentTurboFactor > 1.0001){
          if (hasTM1){
            await setTM1SpeedOnce(1, 650).catch(()=>null);
          }

          window.setTurboFactor(1.0, 'not detected');
          stopTurboKeepAlive();

          // If a TM‑1 is present and still running Turbo, don't pretend we're at x1.00.
          const tm = hasTM1 ? await queryTM1SpeedOnce(420).catch(()=>null) : null;
          if (tm && tm.factor && tm.factor > 1.0001){
            window.setTurboFactor(tm.factor, 'TM‑1 detected');
            startTurboKeepAlive();
            if (window.announceIO) window.announceIO(`Turbo still active (TM‑1 reports x${tm.factor.toFixed(2)}).`);
            return { ok:true, factor:tm.factor, source:'tm1' };
          }

          if (window.announceIO) window.announceIO('Turbo disabled — using normal speed.');
          return { ok:true, factor:1.0, source: hasTM1 ? 'tm1' : 'none' };
        }

        // Toggle on:
        // If TM‑1 is already in Turbo, just follow it.
        if (tmProbe && tmProbe.factor && tmProbe.factor > 1.0001){
          window.setTurboFactor(tmProbe.factor, 'TM‑1 detected');
          startTurboKeepAlive();
          if (window.announceIO) window.announceIO(`Turbo detected — using x${tmProbe.factor.toFixed(2)}.`);
          return { ok:true, factor:tmProbe.factor, source:'tm1' };
        }

        // Negotiate TurboMIDI (Elektron 0x10/0x11/0x12/0x13).
        window.setTurboFactor(1.0, 'negotiating…');
        if (window.announceIO) window.announceIO('Trying to negotiate Turbo…');

        const maxSpeedVal = _clampInt(window.turboPreferredSpeedVal || 8, 1, 8);
        const res = await negotiateTurboOnce({ timeoutMs: 900, maxSpeedVal });

        if (res && res.ok){
          // If a TM‑1 is present, explicitly set it to the negotiated speed value.
          if (hasTM1 && res.speedVal){
            await setTM1SpeedOnce(res.speedVal, 800).catch(()=>null);
          }

          // Confirm actual on-wire speed from TM‑1 if present (prevents “turboActive” lying).
          const tm2 = await queryTM1SpeedOnce(650).catch(()=>null);
          if (tm2 && tm2.factor && tm2.factor > 1.0001){
            window.setTurboFactor(tm2.factor, 'TM‑1 detected');
            startTurboKeepAlive();
            if (window.announceIO) window.announceIO(`Turbo enabled — TM‑1 reports x${tm2.factor.toFixed(2)}.`);
            return { ok:true, factor:tm2.factor, speedVal: res.speedVal, source:'negotiated+tm1' };
          }

          // If we can't confirm via TM‑1, only enable best-effort for non‑TM‑1 interfaces.
          if (!hasTM1){
            window.setTurboFactor(res.factor, 'TurboMIDI enabled');
            startTurboKeepAlive();
            if (window.announceIO) window.announceIO(`Turbo enabled — using x${res.factor.toFixed(2)}.`);
            return res;
          }

          // TM‑1 present but we couldn't confirm it switched — stay safe at x1.00.
          window.setTurboFactor(1.0, 'TM‑1 not enabled');
          stopTurboKeepAlive();
          if (window.announceIO) window.announceIO('Turbo negotiation succeeded but TM‑1 did not switch speeds — staying at normal speed.');
          return { ok:false, factor:1.0, error:'TM‑1 did not switch', negotiated:res };
        }

        window.setTurboFactor(1.0, 'not detected');
        stopTurboKeepAlive();
        if (window.announceIO) window.announceIO('Turbo not detected — using normal speed.');
        return res || { ok:false, factor:1.0 };
      }catch(err){
        window.setTurboFactor(1.0, 'not detected');
        stopTurboKeepAlive();
        if (window.announceIO) window.announceIO('Turbo not detected — using normal speed.');
        console.warn('Turbo negotiation failed:', err);
        return { ok:false, factor:1.0, error: String(err && err.message ? err.message : err) };
      }finally{
        window._turboToggleBusy = false;
      }
    };


  // Public: set an explicit Turbo speed value (1..8).
  // - 1 disables Turbo (normal MIDI speed)
  // - 2..8 enables Turbo at that speed value (mapped to x2..x10)
  //
  // This is the hook the UI slider should call.
  window.setTurboSpeedVal = async function(targetSpeedVal){
    const desired = _clampInt(targetSpeedVal, 1, 8);

    // Remember the last non-1 speed as the preferred future enable speed.
    if (desired > 1){
      window.turboPreferredSpeedVal = desired;
      saveTurboPreferredSpeedVal(desired);
    }

    // Share the same lock as toggleTurbo to avoid races.
    if (window._turboToggleBusy){
      return { ok:false, factor: window.currentTurboFactor || 1.0, speedVal: desired, error:'busy' };
    }
    window._turboToggleBusy = true;

    const prevFactor = Number(window.currentTurboFactor) || 1.0;
    const prevSource = window.turboFactorSource || ((prevFactor > 1.0001) ? 'detected' : 'not detected');

    try{
      if (!window.selectedMidiOut || !window.selectedMidiIn){
        throw new Error('Select MIDI In and MIDI Out first.');
      }

      // Probe TM‑1 (if present we can set speed directly like C6 does).
      const tmProbe = await queryTM1SpeedOnce(300).catch(()=>null);
      const hasTM1 = !!(tmProbe && typeof tmProbe.idx === 'number');

      // Desired = 1 => OFF
      if (desired === 1){
        if (hasTM1){
          await setTM1SpeedOnce(1, 650).catch(()=>null);
        }

        window.setTurboFactor(1.0, 'not detected');
        stopTurboKeepAlive();

        // If TM‑1 still reports Turbo, follow it (don’t lie in UI).
        const tm = hasTM1 ? await queryTM1SpeedOnce(420).catch(()=>null) : null;
        if (tm && tm.factor && tm.factor > 1.0001){
          window.setTurboFactor(tm.factor, 'TM‑1 detected');
          startTurboKeepAlive();
          if (window.announceIO) window.announceIO(`Turbo still active (TM‑1 reports x${tm.factor.toFixed(2)}).`);
          return { ok:true, factor:tm.factor, speedVal:tm.idx, source:'tm1' };
        }

        if (window.announceIO) window.announceIO('Turbo disabled — using normal speed.');
        return { ok:true, factor:1.0, speedVal:1, source: hasTM1 ? 'tm1' : 'none' };
      }

      // Desired > 1:
      // TM‑1 present: set speed directly (C6-style vendor set) and trust the TM‑1 reply.
      if (hasTM1){
        const res = await setTM1SpeedOnce(desired, 900).catch(()=>null);
        const tm = await queryTM1SpeedOnce(700).catch(()=>res);

        if (tm && tm.factor){
          window.setTurboFactor(tm.factor, 'TM‑1 detected');
          if (tm.factor > 1.0001) startTurboKeepAlive(); else stopTurboKeepAlive();
          if (window.announceIO) window.announceIO(`Turbo set — TM‑1 reports x${tm.factor.toFixed(2)}.`);
          return { ok:true, factor:tm.factor, speedVal:tm.idx, source:'tm1' };
        }

        // Could not confirm: keep previous setting.
        window.setTurboFactor(prevFactor, prevSource);
        if (prevFactor > 1.0001) startTurboKeepAlive(); else stopTurboKeepAlive();
        if (window.announceIO) window.announceIO('Could not confirm Turbo speed — leaving current setting unchanged.');
        return { ok:false, factor:prevFactor, speedVal:desired, error:'No TM‑1 reply' };
      }

      // No TM‑1: negotiate TurboMIDI up to the requested speed.
      if (window.announceIO) window.announceIO('Trying to negotiate Turbo speed…');
      const res = await negotiateTurboOnce({ timeoutMs: 900, maxSpeedVal: desired });

      if (res && res.ok){
        window.setTurboFactor(res.factor, 'TurboMIDI enabled');
        startTurboKeepAlive();
        if (window.announceIO) window.announceIO(`Turbo enabled — using x${res.factor.toFixed(2)}.`);
        return res;
      }

      // Negotiation failed — keep previous setting (more robust than falling back to x1).
      window.setTurboFactor(prevFactor, prevSource);
      if (prevFactor > 1.0001) startTurboKeepAlive(); else stopTurboKeepAlive();
      if (window.announceIO) window.announceIO('Turbo speed change failed — leaving current setting unchanged.');
      return res || { ok:false, factor:prevFactor, speedVal:desired, error:'Turbo not detected' };
    }catch(err){
      // Restore previous setting on errors.
      window.setTurboFactor(prevFactor, prevSource);
      if (prevFactor > 1.0001) startTurboKeepAlive(); else stopTurboKeepAlive();
      console.warn('Set Turbo speed failed:', err);
      return { ok:false, factor:prevFactor, speedVal:desired, error: String(err && err.message ? err.message : err) };
    }finally{
      window._turboToggleBusy = false;
      try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){ }
    }
  };

  // Called when ports change.
  window.maybeSyncTurbo = function(){
    // Called when ports change. We reset to x1.00 then (optionally) query a TM‑1 to learn the
    // actual current Turbo speed so our pacing stays correct.
    try{
      stopTurboKeepAlive();
      window.setTurboFactor(1.0, 'not detected');
    }catch(_){}

    // Fire-and-forget (avoid unhandled rejections).
    (async ()=>{
      try{
        const tm = await queryTM1SpeedOnce(350).catch(()=>null);
        if (tm && tm.factor && tm.factor > 1.0001){
          window.setTurboFactor(tm.factor, 'TM‑1 detected');
          startTurboKeepAlive();
        }
      }catch(_){}
    })();
  };

  // -----------------------------
  // Inbound SysEx -> MMDT + listeners
  // -----------------------------
  let _silentReceiveUntil = 0;
  let _partialWarned = false;

  // Make stats always inspectable from the console, even if no recovery path
  // is triggered during a session.
  window.__mmSysexStats = window.__mmSysexStats || {};

  function guardedReceive(u8){
    if (!window.MMDT || typeof window.MMDT.receive !== 'function') return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now < _silentReceiveUntil){
      if (!_partialWarned){
        _partialWarned = true;
        console.warn('MMDT.receive suppressed briefly (traffic burst).');
        setTimeout(()=>{ _partialWarned = false; }, 1200);
      }
      return;
    }
    window.MMDT.receive(u8);
  }

  // ------------------------------------------------------
  // DigiPRO 0x5D "framed fragment" joiner
  // ------------------------------------------------------
  // Some MIDI stacks (and/or Turbo paths) will occasionally deliver a long SysEx
  // as *multiple* SysEx messages, each wrapped with its own F0...F7 framing.
  // The first frame contains the Elektron header (so it looks like a DigiPRO dump)
  // but is shorter than 7027 bytes, and the remaining frames do NOT look like
  // Elektron SysEx (so downstream code ignores them).
  //
  // Result: the app logs "Captured DigiPRO dump truncated: 3958 < 7027" and the
  // slot stays empty (most noticeably on the *final* slot in a passive Send-All,
  // because that's where some stacks do their worst flushing/fragmenting).
  //
  // This joiner reconstructs fixed-size DigiPRO wave dumps by buffering the first
  // truncated 0x5D frame and concatenating subsequent non-Elektron SysEx frames
  // (stripping their F0/F7 wrappers) until the expected length is reached.
  const __dpJoin = {
    active: false,
    expectedLen: 0,
    slot: -1,
    buf: null,
    fill: 0,
    startedAt: 0,
    lastAt: 0,
  };

  function __nowMs(){
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function __dpExpectedLen(){
    const need = (window.MMDT_DigiPRO && window.MMDT_DigiPRO.MSG_SIZE_BYTES)
      ? (window.MMDT_DigiPRO.MSG_SIZE_BYTES|0)
      : 7027;
    return (need > 0) ? need : 7027;
  }

  function __isDPWaveDump(u8){
    // Wave dump: Elektron header + product 0x03 + msgId 0x5D
    return !!(u8 && u8.length >= 15 &&
      u8[0]===0xF0 && u8[u8.length-1]===0xF7 &&
      u8[1]===0x00 && u8[2]===0x20 && u8[3]===0x3C &&
      ((u8[4] & 0x7F)===0x03) &&
      ((u8[6] & 0x7F)===0x5D));
  }

  function __dpReset(reason){
    if (__dpJoin.active){
      try{
        window.__mmSysexStats = window.__mmSysexStats || {};
        window.__mmSysexStats.digiproJoinResets = (window.__mmSysexStats.digiproJoinResets||0) + 1;
        if (reason){
          const k = `digiproJoinReset_${String(reason).slice(0,40)}`;
          window.__mmSysexStats[k] = (window.__mmSysexStats[k]||0) + 1;
        }
      }catch(_){ }
    }

    if (window.mmDebugSysex && __dpJoin.active){
      try{ console.warn('[digipro-join] reset', reason || '(no reason)', { fill: __dpJoin.fill, expectedLen: __dpJoin.expectedLen, slot: __dpJoin.slot }); }catch(_){ }
    }
    __dpJoin.active = false;
    __dpJoin.expectedLen = 0;
    __dpJoin.slot = -1;
    __dpJoin.buf = null;
    __dpJoin.fill = 0;
    __dpJoin.startedAt = 0;
    __dpJoin.lastAt = 0;

    // Expose a simple flag so other code (e.g. request fallbacks) can avoid
    // sending SysEx while we're still assembling a fragmented dump.
    try{ window.__mmDigiproJoinActive = false; }catch(_){ }
  }

  function __dpStaleMs(){
    // Tunable for debugging.
    const v = window.mmDigiproJoinStaleMs;
    if (typeof v === 'number' && isFinite(v)){
      return Math.max(200, Math.min(8000, Math.round(v)));
    }
    // Default derived from on‑wire time, but with a **generous minimum**.
    //
    // Why so high?
    // Some WebMIDI stacks (especially at Turbo rates) deliver a large SysEx as
    // two framed SysEx messages with a noticeable gap between them. The *last*
    // fragment in a burst can arrive ~1s+ later due to driver/buffer flushing,
    // and that delay does **not** reliably scale down with the Turbo factor.
    //
    // If we time out too aggressively (e.g. ~700ms at x10), we drop the join
    // right before the continuation arrives — leaving slot 64 blank.
    // IMPORTANT: RX doesn't reliably scale with Turbo on all rigs.
    // Treat the receive side as ~normal MIDI speed for timeout purposes.
    // (Users can still override via window.mmDigiproJoinStaleMs.)
    const f = Number(window.currentTurboFactor) || 1.0;
    const rxF = Math.min(1.0, Math.max(0.1, f));
    const bps = 3125 * rxF;
    const onWireMs = (__dpExpectedLen() / bps) * 1000;
    const derived = Math.round(onWireMs*2 + 250);
    return Math.max(2000, Math.min(8000, derived));
  }

  function __dpAppendInner(frameU8){
    if (!__dpJoin.active || !__dpJoin.buf) return null;
    const need = (__dpJoin.expectedLen|0);
    if (need <= 8) return null;

    // Strip wrapper F0 ... F7
    const inner = (frameU8 && frameU8.length > 2)
      ? frameU8.subarray(1, frameU8.length-1)
      : null;

    if (!inner || !inner.length) return null;

    // Copy as much as we still need, but only 7-bit data bytes.
    let remaining = (need - 1) - (__dpJoin.fill|0);
    if (remaining <= 0) return null;

    let wrote = 0;
    for (let i=0;i<inner.length && remaining>0;i++){
      const b = inner[i] & 0xFF;
      if (b >= 0x80) continue; // ignore any stray status bytes
      __dpJoin.buf[__dpJoin.fill++] = b;
      remaining--;
      wrote++;
    }
    return wrote;
  }

  // Returns:
  //  - Uint8Array (a complete reconstructed DigiPRO dump) OR
  //  - null (consumed/held fragment; nothing to emit) OR
  //  - the original u8 (passthrough)
  function __dpMaybeJoin(u8){
    const now = __nowMs();

    // If the user has not enabled passive capture AND there are no DigiPRO dump
    // requests in-flight, we don't want to enter (or stay in) join mode.
    // This prevents unsolicited/truncated dumps from swallowing unrelated SysEx.
    try{
      const wantsAny = !!window.dpPassiveCaptureEnabled || (!!window.__digiproRequestsInFlight && window.__digiproRequestsInFlight.size > 0);
      if (__dpJoin.active && !wantsAny){
        __dpReset('notWanted');
      }
    }catch(_){ }

    // If we're holding a partial dump and we've waited too long for continuation,
    // drop it so we don't accidentally swallow unrelated SysEx.
    if (__dpJoin.active && __dpJoin.lastAt && (now - __dpJoin.lastAt) > __dpStaleMs()){
      __dpReset('stale');
    }
    __dpJoin.lastAt = now;

    const needLen = __dpExpectedLen();

    if (__isDPWaveDump(u8)){
      // Full dump? passthrough (but abort any pending join).
      if (u8.length === needLen){
        if (__dpJoin.active) __dpReset('newFull');
        return u8;
      }

      // Truncated framed fragment: start buffering and consume it.
      if (u8.length < needLen){
        const slot = (u8.length > 9) ? (u8[9] & 0x3F) : -1;

        // Only bother joining a fragmented dump if we actually asked for it
        // (or if the user has explicitly enabled passive capture).
        // Otherwise: passthrough the fragment to avoid holding state that can
        // eat unrelated SysEx messages.
        try{
          const wanted = !!window.dpPassiveCaptureEnabled || (!!window.__digiproRequestsInFlight && window.__digiproRequestsInFlight.has(slot));
          if (!wanted) return u8;
        }catch(_){ }

        if (__dpJoin.active) __dpReset('restart');

        __dpJoin.active = true;

        try{ window.__mmDigiproJoinActive = true; }catch(_){ }
        __dpJoin.expectedLen = needLen;
        __dpJoin.slot = slot;
        __dpJoin.buf = new Uint8Array(needLen);
        __dpJoin.fill = 0;
        __dpJoin.startedAt = now;

        // Copy everything except the trailing wrapper F7.
        const body = u8.subarray(0, Math.max(0, u8.length-1));
        __dpJoin.buf.set(body, 0);
        __dpJoin.fill = body.length;

        if (window.mmDebugSysex){
          try{ console.log('[digipro-join] buffering first frame', { len: u8.length, slot, expectedLen: needLen }); }catch(_){ }
        }

        try{
          window.__mmSysexStats = window.__mmSysexStats || {};
          window.__mmSysexStats.digiproFragmentsBuffered = (window.__mmSysexStats.digiproFragmentsBuffered||0) + 1;
          window.__mmSysexStats.digiproLastFragLen = u8.length;
        }catch(_){ }

        return null; // hold until we have the rest
      }

      // Longer than expected is unexpected; pass through unchanged.
      if (__dpJoin.active) __dpReset('oversize');
      return u8;
    }

    // Not a DigiPRO wave dump.
    if (!__dpJoin.active) return u8;

    // If this looks like *any* Elektron SysEx, do NOT treat it as continuation.
    // (TM‑1 turbo status, etc. can arrive interleaved and must be handled normally.)
    if (isElektron(u8)){
      return u8;
    }

    // Treat non-Elektron framed SysEx as continuation payload.
    const wrote = __dpAppendInner(u8) || 0;
    if (wrote){
      try{
        window.__mmSysexStats = window.__mmSysexStats || {};
        window.__mmSysexStats.digiproContinuationChunks = (window.__mmSysexStats.digiproContinuationChunks||0) + 1;
      }catch(_){ }

      if (window.mmDebugSysex){
        try{ console.log('[digipro-join] appended continuation', { wrote, fill: __dpJoin.fill, expectedLen: __dpJoin.expectedLen }); }catch(_){ }
      }
    }

    const need = (__dpJoin.expectedLen|0);
    if (__dpJoin.fill >= (need - 1)){
      // Finalize.
      __dpJoin.buf[need - 1] = 0xF7;
      const out = __dpJoin.buf.slice(0, need);
      const slot = __dpJoin.slot;
      __dpReset('complete');
      try{
        window.__mmSysexStats = window.__mmSysexStats || {};
        window.__mmSysexStats.joinedDigiproFragments = (window.__mmSysexStats.joinedDigiproFragments||0) + 1;
        if (slot >= 0) window.__mmSysexStats.joinedDigiproLastSlot = slot;
      }catch(_){ }

      if (window.mmDebugSysex){
        try{ console.log('[digipro-join] complete', { slot, bytes: out.length }); }catch(_){ }
      }
      return out;
    }

    // Still waiting for more continuation.
    return null;
  }

  function handleCompleteSysex(u8){
    try{
      maybeLearnDeviceId(u8);
      maybeHandleTurbo(u8);
    }catch(_){ }

    // Repair "framed fragmentation" of DigiPRO 0x5D dumps.
    // If a large 0x5D arrives as multiple smaller SysEx messages, the first frame
    // looks like a valid dump but is shorter than 7027 bytes (e.g. 3958). We buffer
    // it and concatenate the following non‑Elektron framed SysEx chunks until we
    // reach the fixed expected length.
    try{
      const joined = __dpMaybeJoin(u8);
      if (!joined) return;
      u8 = joined;
    }catch(_){ }

    // Pass Monomachine dumps etc into MMDT receiver.
    try{
      if (isSysex(u8) && isElektron(u8) && ((u8[4] & 0x7F) === 0x03)){
        guardedReceive(u8);
      }
    }catch(_){}

    emitCompleteSysex(u8);
  }

  const _reassembler = new SysExReassembler(handleCompleteSysex);

  // Debug/testing hook: allows injecting raw MIDI bytes into the SysEx reassembler
  // without requiring WebMIDI hardware.
  // Usage (console): window.__mmSysexFeed(new Uint8Array([0xF0,...]));
  // Node tests also use this.
  window.__mmSysexFeed = function(u8){
    try{ _reassembler.feed(u8); }catch(_){ }
  };
  window.__mmSysexReset = function(){
    try{ _reassembler.reset(); }catch(_){ }
  };

  function onMidiMessage(ev){
    try{
      // WebMIDI provides a Uint8Array already. Avoid copying at Turbo rates.
      const data = (ev && ev.data instanceof Uint8Array) ? ev.data : new Uint8Array((ev && ev.data) || []);
      if (!data.length) return;
      // Ignore standalone MIDI real-time messages (active sensing, clock, start/stop...).
      // (If real-time bytes are coalesced into a larger chunk, SysExReassembler will
      // strip them.)
      if (data.length === 1 && data[0] >= 0xF8) return;
      _reassembler.feed(data);
    }catch(e){
      console.warn('MIDI message handling error:', e);
    }
  }

  // Debug/testing hook: feed raw MIDI bytes into the SysEx reassembler.
  // This lets us simulate chunky Turbo input (including missing EOX) without hardware.
  window.mmSysexFeedBytes = function(u8){
    try{
      const data = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8 || []);
      _reassembler.feed(data);
    }catch(e){ console.warn('mmSysexFeedBytes error:', e); }
  };

  // -----------------------------
  // Dump request helper (used by DigiPRO download)
  // -----------------------------
  function requestDumpAsync(expectedMsgId, requestId, slot, slotMask, abortSignal){
  return new Promise((resolve, reject) => {
    if (abortSignal && abortSignal.aborted) return reject(new Error('Aborted'));
    if (!window.selectedMidiOut || !window.selectedMidiIn){
      alert('Choose MIDI In/Out first.');
      return reject(new Error('No MIDI I/O'));
    }

    // Match the working multi-file MMDT build:
    // - default SysEx header uses device ID 0x00 (Monomachine default)
    // - request helper tries preferred ID first, then falls back to broadcast (0x7F)
    const baseHeader = (window.MM_SYSEX_HEADER && Array.isArray(window.MM_SYSEX_HEADER))
      ? window.MM_SYSEX_HEADER.slice()
      : [0xF0,0x00,0x20,0x3C,0x03,0x00]; // default dev=0

    const preferId = ((typeof window.mmGetSysexDeviceId === 'function')
      ? window.mmGetSysexDeviceId()
      : (window.mmSysexDeviceId ?? baseHeader[5])) & 0x7F;

    const candidates = (preferId === 0x7F)
      ? [0x00, 0x7F]          // if unknown, still try dev=0 first, then broadcast
      : [preferId, 0x7F];     // prefer learned/override, then broadcast

    function sendOnce(devId){
      const header = baseHeader.slice();
      header[5] = devId & 0x7F;

      const bytes = new Uint8Array(header.length + 3);
      bytes.set(header, 0);
      bytes[header.length + 0] = requestId & 0x7F;
      bytes[header.length + 1] = slot & slotMask;
      bytes[header.length + 2] = 0xF7;

      try { (window.sendBytes ? window.sendBytes(bytes) : window.selectedMidiOut.send(bytes)); } catch(_) {}
    }

    let fallbackTimer = null;
    let unsubBus = null;

    function calcFallbackDelayMs(expId){
      // Allow field override / experimentation.
      // Example: window.mmSysexFallbackDelayMs = 2500
      const ov = window.mmSysexFallbackDelayMs;
      if (typeof ov === 'number' && isFinite(ov)){
        return Math.max(50, Math.min(8000, Math.round(ov)));
      }

      // DigiPRO wave dumps are *large* (7027 bytes). Sending a second request too
      // early can interrupt the device mid‑dump on some stacks/interfaces.
      //
      // IMPORTANT nuance:
      // Some WebMIDI implementations only dispatch the SysEx event once the
      // entire message is complete. In that case __mmSysexRxInProgress cannot
      // protect us from mid‑dump fallbacks.
      //
      // So, for 0x5D, we use a conservative fallback delay based on **normal MIDI**
      // wire time (do NOT assume Turbo RX), plus a small margin.
      if ((expId & 0x7F) === 0x5D){
        const needLen = (window.MMDT_DigiPRO && window.MMDT_DigiPRO.MSG_SIZE_BYTES)
          ? (window.MMDT_DigiPRO.MSG_SIZE_BYTES|0)
          : 7027;
        const bps = 3125; // bytes/sec at standard MIDI (31.25 kbps)
        const wireMs = (needLen / Math.max(1, bps)) * 1000;
        return Math.max(600, Math.min(6000, Math.round(wireMs + 500)));
      }

      // Default (small dumps): quick fallback keeps UX snappy.
      return 180;
    }

    function cleanup(){
      try { if (unsubBus) unsubBus(); } catch(_) {}
      unsubBus = null;

      // Back-compat / fallback if the central bus isn't present
      try { window.selectedMidiIn.removeEventListener('midimessage', onMessage); } catch(_) {}

      if (fallbackTimer){ try { clearTimeout(fallbackTimer); } catch(_) {} fallbackTimer = null; }

      try { abortSignal?.removeEventListener('abort', onAbort); } catch(_) {}
      try { if ((expectedMsgId & 0x7F) === 0x5D) window.__digiproRequestsInFlight.delete(slot & 0x3F); } catch(_) {}
    }

    function onAbort(){ cleanup(); reject(new Error('Aborted')); }

    function handleBytes(u8){
      const bytes = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8 || []);
      if (!isSysex(bytes)) return;

      const isMM = (bytes.length >= 8 && bytes[1]===0x00 && bytes[2]===0x20 && bytes[3]===0x3C && bytes[4]===0x03);
      if (!isMM){ try{ maybeHandleTurbo(bytes); }catch(_){} return; }

      const expId = (expectedMsgId & 0x7F);
      if ((bytes[6] & 0x7F) === expId){
        // DigiPRO 0x5D dumps are fixed-size. If we accept a truncated message (still ending
        // in 0xF7), downstream decode will fail and the UI will mark the slot red.
        // At high Turbo rates this can happen if the link is disturbed mid-dump.
        if (expId === 0x5D){
          const needLen = (window.MMDT_DigiPRO && window.MMDT_DigiPRO.MSG_SIZE_BYTES)
            ? (window.MMDT_DigiPRO.MSG_SIZE_BYTES|0)
            : 7027;
          if (bytes.length !== needLen) return;
        }

        // IMPORTANT: filter by slot for DigiPRO wave dumps so concurrent requests can't
        // accidentally resolve on the wrong message.
        if (expId === 0x5D && bytes.length > 9){
          const gotSlot = bytes[9] & 0x3F;
          const wantSlot = slot & 0x3F;
          if (gotSlot !== wantSlot) return;
        }
        cleanup();
        // Keep back-compat with existing call sites/tests that expect a plain Array.
        resolve(Array.from(bytes));
      }
    }

    function onMessage(ev){
      try { handleBytes(new Uint8Array(ev.data || [])); } catch(_) {}
    }

    try{
      // Prefer the central "complete SysEx" bus if available (robust to chunked input)
      if (typeof window.mmAddSysexListener === 'function'){
        unsubBus = window.mmAddSysexListener(handleBytes);
      } else {
        window.selectedMidiIn.addEventListener('midimessage', onMessage);
      }

      if ((expectedMsgId & 0x7F) === 0x5D){
        try { window.__digiproRequestsInFlight.add(slot & 0x3F); } catch(_) {}
      }
      abortSignal?.addEventListener('abort', onAbort, { once:true });

      // Send after listeners are armed
      sendOnce(candidates[0]);
      if (candidates.length > 1){
        // Fallback to broadcast ID only if the preferred-ID request doesn't produce a response.
        // Crucially: do NOT send the fallback request while an inbound SysEx is currently
        // being received, otherwise we risk injecting a new SysEx mid-dump (especially
        // noticeable with Turbo MIDI) which can corrupt/truncate the dump.
        const tryFallback = ()=>{
          // Also gate on DigiPRO fragment-join state: on some stacks the dump is
          // delivered as multiple framed SysEx messages, meaning __mmSysexRxInProgress
          // can briefly drop between frames even though the dump is still in flight.
          if (window.__mmSysexRxInProgress || window.__mmDigiproJoinActive){
            fallbackTimer = setTimeout(tryFallback, 25);
            return;
          }
          // We have waited long enough and RX does not appear busy — attempt the
          // broadcast request.
          try{
            window.__mmSysexStats = window.__mmSysexStats || {};
            window.__mmSysexStats.sysexBroadcastFallbackSent = (window.__mmSysexStats.sysexBroadcastFallbackSent||0) + 1;
            if (((expectedMsgId & 0x7F) === 0x5D)){
              window.__mmSysexStats.digiproBroadcastFallbackSent = (window.__mmSysexStats.digiproBroadcastFallbackSent||0) + 1;
            }
          }catch(_){ }

          if (window.mmDebugSysex){
            try{ console.log('[sysex-request] sending broadcast fallback', { expId: (expectedMsgId & 0x7F), slot: (slot & 0x3F) }); }catch(_){ }
          }

          sendOnce(candidates[1]);
        };
        const fbDelay = calcFallbackDelayMs(expectedMsgId & 0x7F);
        if (window.mmDebugSysex){
          try{ console.log('[sysex-request] scheduling broadcast fallback', { expId: (expectedMsgId & 0x7F), slot: (slot & 0x3F), delayMs: fbDelay }); }catch(_){ }
        }
        fallbackTimer = setTimeout(tryFallback, fbDelay);
      }
    }catch(e){
      cleanup();
      reject(e);
    }
  });
}
window.requestDumpAsync = requestDumpAsync;
// Convenience wrappers
  window.requestDigiPRODumpAsync = function(slot, signal){
    // DigiPRO waveform dump is 0x5D; request is 0x5E (matches the panel scripts).
    return window.requestDumpAsync(0x5D, 0x5E, slot & 0x3F, 0x3F, signal);
  };

  // -----------------------------
  // WebMIDI init / port selection
  // -----------------------------
  let midiAccess = null;

  function listPorts(){
    const ins = [];
    const outs = [];
    if (!midiAccess) return {ins, outs};

    for (const input of midiAccess.inputs.values()){
      ins.push(input);
    }
    for (const output of midiAccess.outputs.values()){
      outs.push(output);
    }
    return {ins, outs};
  }

  // -----------------------------
  // Port persistence (remember selected devices across reloads)
  // -----------------------------
  const LS_MIDI_PORTS_KEY = 'digipro_midi_ports_v1';

  function _normStr(s){
    return String(s || '').trim().toLowerCase();
  }

  function loadMidiPortPrefs(){
    try{
      const ls = window.localStorage;
      if (!ls) return null;
      const raw = ls.getItem(LS_MIDI_PORTS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    }catch(_){
      return null;
    }
  }

  function saveMidiPortPrefs(){
    try{
      const ls = window.localStorage;
      if (!ls) return;
      const inP  = window.selectedMidiIn;
      const outP = window.selectedMidiOut;
      const obj = {
        in: inP ? { id: inP.id || null, name: inP.name || null, manufacturer: inP.manufacturer || null } : null,
        out: outP ? { id: outP.id || null, name: outP.name || null, manufacturer: outP.manufacturer || null } : null
      };
      ls.setItem(LS_MIDI_PORTS_KEY, JSON.stringify(obj));
    }catch(_){}
  }

  function matchPortByPref(list, pref){
    if (!pref || !list || !list.length) return null;

    // 1) Stable ID match (works in Chromium; may change across sessions in Firefox).
    if (pref.id){
      const byId = list.find(p => p && p.id === pref.id);
      if (byId) return byId;
    }

    // 2) Name/manufacturer match (fallback for Firefox/Windows, privacy-randomized IDs, etc.)
    const wantName = _normStr(pref.name);
    const wantMan  = _normStr(pref.manufacturer);

    if (!wantName && !wantMan) return null;

    let best = null;
    let bestScore = -1;

    for (const p of list){
      if (!p) continue;
      const pn = _normStr(p.name);
      const pm = _normStr(p.manufacturer);

      let score = 0;

      if (wantName && pn === wantName) score += 10;
      else if (wantName && pn && pn.includes(wantName)) score += 6;
      else if (wantName && pn && wantName.includes(pn)) score += 3;

      if (wantMan && pm === wantMan) score += 6;
      else if (wantMan && pm && pm.includes(wantMan)) score += 3;
      else if (wantMan && pm && wantMan.includes(pm)) score += 2;

      const wantLabel = (wantMan + ' ' + wantName).trim();
      const gotLabel  = (pm + ' ' + pn).trim();
      if (wantLabel && gotLabel && gotLabel === wantLabel) score += 8;

      if (score > bestScore){
        bestScore = score;
        best = p;
      }
    }

    return (bestScore > 0) ? best : null;
  }

  function restorePortsFromStorage(){
    if (!midiAccess) return false;
    const prefs = loadMidiPortPrefs();
    if (!prefs) return false;

    const ports = listPorts();
    let did = false;

    // Only override if nothing is selected or the selected port is disconnected.
    const inNeeds = !window.selectedMidiIn || (window.selectedMidiIn && window.selectedMidiIn.state !== 'connected');
    if (inNeeds && prefs.in){
      const p = matchPortByPref(ports.ins, prefs.in);
      if (p){
        const inSel = document.getElementById('midiInSelect');
        if (inSel) inSel.value = p.id;
        selectInById(p.id);
        did = true;
      }
    }

    const outNeeds = !window.selectedMidiOut || (window.selectedMidiOut && window.selectedMidiOut.state !== 'connected');
    if (outNeeds && prefs.out){
      const p = matchPortByPref(ports.outs, prefs.out);
      if (p){
        const outSel = document.getElementById('midiOutSelect');
        if (outSel) outSel.value = p.id;
        selectOutById(p.id);
        did = true;
      }
    }

    return did;
  }

  // -----------------------------
  // MIDI status pill (top-left)
  // -----------------------------
  function portLabel(p){
    if (!p) return '(none)';
    const parts = [];
    if (p.manufacturer) parts.push(p.manufacturer);
    if (p.name) parts.push(p.name);
    const s = parts.join(' ').trim();
    return s || p.id || '(unknown)';
  }

  function setPillState(el, cls){
    if (!el) return;
    el.classList.remove('midi-ok','midi-warn','midi-bad');
    if (cls) el.classList.add(cls);
  }

  function updateMidiStatusPill(){
    const el = document.getElementById('midiStatusPill');
    if (!el) return;

    let text = 'MIDI: disabled';
    let title = 'MIDI status';

    try{
      if (!navigator.requestMIDIAccess){
        text = 'MIDI: unsupported';
        title = 'WebMIDI is not available in this browser.';
        setPillState(el, 'midi-bad');
      } else if (!midiAccess){
        text = 'MIDI: disabled';
        title = 'WebMIDI not enabled yet. Click “MIDI I/O” → “Enable WebMIDI”.';
        setPillState(el, 'midi-warn');
      } else {
        const {ins, outs} = listPorts();
        const selIn = window.selectedMidiIn;
        const selOut = window.selectedMidiOut;

        const connectedIns = ins.filter(p=>p && p.state === 'connected');
        const connectedOuts = outs.filter(p=>p && p.state === 'connected');

        const selInConnected = !!(selIn && selIn.state === 'connected');
        const selOutConnected = !!(selOut && selOut.state === 'connected');

        if (selInConnected || selOutConnected){
          if (selInConnected && selOutConnected) text = 'MIDI: connected';
          else if (selInConnected) text = 'MIDI: IN connected';
          else text = 'MIDI: OUT connected';

          title = `In: ${selInConnected ? portLabel(selIn) : '(none)'} • Out: ${selOutConnected ? portLabel(selOut) : '(none)'}`;
          setPillState(el, 'midi-ok');
        } else if (selIn || selOut){
          text = 'MIDI: disconnected';
          const inState  = selIn  ? `${portLabel(selIn)} (${selIn.state}/${selIn.connection||'?'})` : '(none)';
          const outState = selOut ? `${portLabel(selOut)} (${selOut.state}/${selOut.connection||'?'})` : '(none)';
          title = `Selected: In: ${inState} • Out: ${outState}`;
          setPillState(el, 'midi-bad');
        } else if (connectedIns.length || connectedOuts.length){
          text = 'MIDI: ports available';
          title = `${connectedIns.length} input(s), ${connectedOuts.length} output(s) detected. Choose ports in “MIDI I/O”.`;
          setPillState(el, 'midi-warn');
        } else if (ins.length || outs.length){
          text = 'MIDI: no active ports';
          title = 'WebMIDI enabled, but no ports are currently connected.';
          setPillState(el, 'midi-bad');
        } else {
          text = 'MIDI: no devices';
          title = 'WebMIDI enabled, but no MIDI devices were found.';
          setPillState(el, 'midi-bad');
        }
      }
    }catch(_){
      text = 'MIDI: status error';
      title = 'Error while checking MIDI status.';
      setPillState(el, 'midi-bad');
    }

    el.textContent = text;
    el.title = title;
  }

  window.updateMidiStatusPill = updateMidiStatusPill;
  window.updateMidiStatus = updateMidiStatusPill;


  function populateSelect(sel, ports, placeholder){
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = placeholder || '(none)';
    sel.appendChild(opt0);
    for (const p of ports){
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      sel.appendChild(opt);
    }
    // Restore previous if present
    if (cur){
      const exists = Array.from(sel.options).some(o=>o.value===cur);
      if (exists) sel.value = cur;
    }
  }

  function selectInById(id){
    const {ins} = listPorts();
    const port = ins.find(p=>p.id===id) || null;
    if (window.selectedMidiIn && window.selectedMidiIn !== port){
      try{ window.selectedMidiIn.onmidimessage = null; }catch(_){}
    }
    window.selectedMidiIn = port;
    if (port){
      try{ port.onmidimessage = onMidiMessage; }catch(_){}
    }
    try{ window.maybeSyncTurbo && window.maybeSyncTurbo(); }catch(_){}
    try{ window.rebindDigiproCaptureHandler && window.rebindDigiproCaptureHandler(); }catch(_){}
    try{ saveMidiPortPrefs(); }catch(_){ }
    try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}
  }

  function selectOutById(id){
    const {outs} = listPorts();
    const port = outs.find(p=>p.id===id) || null;
    window.selectedMidiOut = port;
    try{ window.maybeSyncTurbo && window.maybeSyncTurbo(); }catch(_){}
    try{ saveMidiPortPrefs(); }catch(_){ }
    try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}
  }

  window.refreshPorts = function(){
    if (!midiAccess){
      try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}
      return;
    }
    const {ins, outs} = listPorts();
    const inSel  = document.getElementById('midiInSelect');
    const outSel = document.getElementById('midiOutSelect');
    populateSelect(inSel, ins, '(select MIDI In)');
    populateSelect(outSel, outs, '(select MIDI Out)');
    try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}
  };

  window.initWebMIDI = async function(){
    if (!navigator.requestMIDIAccess){
      throw new Error('WebMIDI not supported in this browser.');
    }
    midiAccess = await navigator.requestMIDIAccess({ sysex: true });

    const inSel  = document.getElementById('midiInSelect');
    const outSel = document.getElementById('midiOutSelect');

    window.refreshPorts();

    if (inSel){
      inSel.onchange = ()=>{ selectInById(inSel.value); };
    }
    if (outSel){
      outSel.onchange = ()=>{ selectOutById(outSel.value); };
    }

    // Restore previous port selection (persisted in localStorage).
    try{ restorePortsFromStorage(); }catch(_){ }

    // Auto-select first available if none picked.
    const ports = listPorts();
    if (!window.selectedMidiIn && ports.ins.length){
      if (inSel) inSel.value = ports.ins[0].id;
      selectInById(ports.ins[0].id);
    }
    if (!window.selectedMidiOut && ports.outs.length){
      if (outSel) outSel.value = ports.outs[0].id;
      selectOutById(ports.outs[0].id);
    }

    // Update previews/UI
    try{ if (window.updateSysexPreview) window.updateSysexPreview(); }catch(_){}
    try{ if (window.updateTurboUI) window.updateTurboUI(); }catch(_){}

    // Watch for hot-plug changes.
    midiAccess.onstatechange = ()=>{
      try{ window.refreshPorts(); }catch(_){ }
      try{ restorePortsFromStorage(); }catch(_){ }
    };

    return midiAccess;
  };

  // -----------------------------
  // UI updaters (safe no-ops if modal not present)
  // -----------------------------
  window.updateTurboUI = function(){
    const f = Number(window.currentTurboFactor) || 1.0;
    const btn = document.getElementById('turboButton');
    const pill = document.getElementById('turboSpeedLabel');
    const topPill = document.getElementById('turboTopPill');
    const line = document.getElementById('turboStatusLine');
    const slider = document.getElementById('turboSpeedSlider');

    const pretty = 'x' + f.toFixed(2);

    if (pill) pill.textContent = pretty;
    if (topPill){
      // Top-bar preview for the currently detected Turbo factor.
      // (Also hints the preferred "Enable" speed via the tooltip.)
      const prefV = _clampInt(window.turboPreferredSpeedVal || 8, 1, 8);
      const prefF = speedValueToFactor(prefV);
      const src = window.turboFactorSource || ((f > 1.0001) ? 'detected' : 'not detected');
      topPill.textContent = `Turbo: ${pretty}`;
      topPill.title = (f > 1.0001)
        ? `Turbo active (${src}). Preferred: x${prefF.toFixed(2)}.`
        : `Turbo off. Preferred enable target: x${prefF.toFixed(2)}.`;
    }
    if (btn){
      btn.classList.toggle('active', f > 1.0001);
      btn.setAttribute('aria-pressed', (f > 1.0001) ? 'true' : 'false');

      // Match the MMDT semantics in the modal (clear on/off action)
      btn.textContent = (f > 1.0001) ? 'Disable' : 'Enable';
    }

    // Keep the speed slider in sync.
    // - If Turbo is active, reflect the *actual* detected factor.
    // - If Turbo is off, reflect the user's preferred target speed.
    // (Don’t clobber while the user is dragging.)
    if (slider){
      let bestV = 1;
      if (f <= 1.0001){
        // Prefer showing the last-used turbo speed (so Enable will match the visible value).
        bestV = _clampInt(window.turboPreferredSpeedVal || 8, 1, 8);
        if (bestV <= 1) bestV = 8;
      } else {
        let bestDiff = Infinity;
        for (let v = 1; v <= 8; v++){
          const ff = speedValueToFactor(v);
          const d = Math.abs(ff - f);
          if (d < bestDiff){ bestDiff = d; bestV = v; }
        }
      }
      if (document.activeElement !== slider){
        slider.value = String(bestV);
      }
    }

    if (line){
      const src = window.turboFactorSource || ((f > 1.0001) ? 'detected' : 'not detected');
      line.textContent = (f > 1.0001)
        ? `Turbo: ${pretty} (${src})`
        : `Turbo: ${pretty} (not detected)`;
    }
  };

  window.updateSysexPreview = function(){
    const dev = (window.mmGetSysexDeviceId ? window.mmGetSysexDeviceId() : 0x7F) & 0x7F;
    const header = `F0 00 20 3C 03 ${dev.toString(16).toUpperCase().padStart(2,'0')} … F7`;
    const el = document.getElementById('sysexHeaderPreview');
    if (el) el.textContent = header;

    const learnedLine = document.getElementById('sysexDeviceLearnedLine');
    if (learnedLine){
      if (window.mmLearnedSysexDeviceId != null && window.mmLearnedSysexDeviceId !== 0x7F){
        const d = window.mmLearnedSysexDeviceId & 0x7F;
        learnedLine.textContent = `SysEx Device ID: learned (${d} / 0x${d.toString(16).toUpperCase().padStart(2,'0')})`;
      } else {
        learnedLine.textContent = 'SysEx Device ID: default (0 / 0x00)';
      }
    }
  };

  // Try to init automatically (may still require a user gesture in some browsers).
  window.addEventListener('DOMContentLoaded', ()=>{
    try{ window.updateSysexPreview && window.updateSysexPreview(); }catch(_){}
    try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){}
    try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}

    // Attempt auto-init. Handle async rejection to avoid unhandled Promise warnings.
    try{
      const p = window.initWebMIDI && window.initWebMIDI();
      if (p && typeof p.then === 'function'){
        p.then(()=>{ try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}; })
         .catch(()=>{ try{ window.updateMidiStatusPill && window.updateMidiStatusPill(); }catch(_){}; });
      }
    }catch(_){}
  });

})();
