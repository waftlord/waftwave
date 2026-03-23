// import-export.js — WAV/SYX/JSON import + ZIP/WAV export + download helpers (no DOM)
// Extracted from the merged DigiPRO panel in index_patched_v2.html, adapted to use callbacks.
(function(){
  'use strict';
  const root = window;

  if (root.__dpImportExportInitOnce) return;
  root.__dpImportExportInitOnce = true;

  const DP_IO = root.DP_IO = root.DP_IO || {};

  // ------------------------
  // Shared I/O settings
  // ------------------------
  // NOTE:
  // This file loads *before* ui.js (see index.html). Any import-time defaults that
  // are referenced here must therefore live on a shared global (DP_IO.settings)
  // rather than as `const` inside ui.js.
  //
  // Policy: default is to preserve the source file level (no auto-normalize).
  // Users can run Normalize manually if desired.
  const SETTINGS = DP_IO.settings = DP_IO.settings || {};
  if (SETTINGS.wavImportNormalize == null) SETTINGS.wavImportNormalize = false;
  // Remove DC is generally beneficial for wavetables; keep enabled by default.
  if (SETTINGS.wavImportRemoveDC == null) SETTINGS.wavImportRemoveDC = true;
  // Clip protection keeps “as-saved” imports from hard-clipping if the source
  // contains overs > 0 dBFS (common with float WAVs).
  if (SETTINGS.wavImportClipProtect == null) SETTINGS.wavImportClipProtect = true;

  // Wiring (provided by ui.js)
  DP_IO._cb = DP_IO._cb || {};

  DP_IO.init = function(callbacks){
    DP_IO._cb = callbacks || {};
  };


  // ---------- lightweight helpers (kept local to avoid cross-file globals) ----------

  function collectUsedNamesFromLib(LIB){
    const used = new Set();
    try{
      const waves = (LIB && Array.isArray(LIB.waves)) ? LIB.waves : [];
      for (const w of waves){
        if (w && w.name) used.add(String(w.name).toUpperCase());
      }
      }catch(_){ }
    return used;
  }

  // Local helper: avoid depending on ui.js-private helpers.
  function findNextFreeSlotInLib(LIB){
    try{
      const waves = (LIB && Array.isArray(LIB.waves)) ? LIB.waves : [];
      for (let i=0;i<64;i++) if (!waves[i]) return i;
    }catch(_){ }
    return -1;
  }

  // Match the UI's thumbnail 'nice looking' rotation: first rising 128 crossing, else biggest positive slope.
  function findDisplayAnchor(u8){
    const N = (u8 && u8.length) ? (u8.length|0) : 0;
    if (!N) return 0;

    // Prefer first rising zero-crossing (<=128 -> >128)
    for (let i=0;i<N;i++){
      const a = u8[i]|0, b = u8[(i+1)%N]|0;
      if (a <= 128 && b > 128) return (i+1)%N;
    }

    // Fallback: steepest upward edge
    let bestI = 0, bestD = -1e9;
    for (let i=0;i<N;i++){
      const d = (u8[(i+1)%N]|0) - (u8[i]|0);
      if (d > bestD){ bestD = d; bestI = (i+1)%N; }
    }
    return bestI;
  }

  function attachDisplayRot(rec, fromDevice=false){
    try{
      const u8 = rec && rec.dataU8;
      if (u8){
        // Prefer the shared UI helper when available (keeps import/export thumbnails consistent).
        const anchorFn = (typeof root.findDisplayAnchor === 'function') ? root.findDisplayAnchor : findDisplayAnchor;
        const rot = fromDevice ? 0 : anchorFn(u8);
        u8.displayRot = rot|0;
      }
    }catch(_){ }
    return rec;
  }
  function _export(name, value){
    if (DP_IO[name] == null) DP_IO[name] = value;
    if (root[name] == null) root[name] = value;
  }

  // ---------------------------------------------------------------------------
  // Extracted file helpers / encoders / zippers
  // ---------------------------------------------------------------------------

  function parseWavToU8(buffer){
    // Returns 8-bit Uint8Array (0..255) of 96 samples, DC corrected & normalized
    const dv = new DataView(buffer);
    function str(o,l){ let s=''; for(let i=0;i<l;i++) s+=String.fromCharCode(dv.getUint8(o+i)); return s; }
    if (str(0,4) !== 'RIFF' || str(8,4) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
    let off = 12;
    let fmt = null, dataOff = -1, dataLen = 0;
    while (off + 8 <= dv.byteLength){
      const id = str(off,4); const len = dv.getUint32(off+4, true); off += 8;
      if (id === 'fmt '){
        let audioFormat     = dv.getUint16(off+0, true);
        const numChannels   = dv.getUint16(off+2, true);
        const sampleRate    = dv.getUint32(off+4, true);
        const bitsPerSample = dv.getUint16(off+14, true);

        // Handle WAVE_FORMAT_EXTENSIBLE (0xFFFE). Many DAWs export float WAVs this way.
        // The SubFormat GUID begins at offset 24 of the fmt chunk and its first DWORD
        // contains the underlying format tag (1 = PCM, 3 = IEEE float).
        if (audioFormat === 0xFFFE && len >= 40){
          const sub = dv.getUint32(off+24, true);
          if (sub === 1 || sub === 3) audioFormat = sub;
        }

        fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
      } else if (id === 'data'){
        dataOff = off; dataLen = len;
      }
      off += len + (len%2); // chunks are word-aligned
    }
    if (!fmt || dataOff<0) throw new Error('Missing fmt/data');
    const bytes = new Uint8Array(buffer, dataOff, dataLen);
    // decode PCM8/16/24/32 (int), or float32/float64 (format 3)
    let floats = [];
    if (fmt.audioFormat === 3 && (fmt.bitsPerSample === 32 || fmt.bitsPerSample === 64)){
      const bytesPerSample = fmt.bitsPerSample/8;
      const frames = Math.floor(dataLen / (bytesPerSample * fmt.numChannels));
      for (let f=0; f<frames; f++){
        let sum = 0;
        for (let ch=0; ch<fmt.numChannels; ch++){
          const base = dataOff + (f*fmt.numChannels + ch)*bytesPerSample;
          let v = (bytesPerSample === 8) ? dv.getFloat64(base, true) : dv.getFloat32(base, true);
          if (!isFinite(v)) v = 0;
          sum += v;
        }
        floats.push(sum / fmt.numChannels);
      }
    } else {
      // integer PCM path
      const bytesPerSample = fmt.bitsPerSample/8;
      const frames = Math.floor(dataLen / (bytesPerSample * fmt.numChannels));
      for (let f=0; f<frames; f++){
        let sum = 0;
        for (let ch=0; ch<fmt.numChannels; ch++){
          const base = dataOff + (f*fmt.numChannels + ch)*bytesPerSample;
          let v = 0;
          if (bytesPerSample === 1){
            v = (dv.getUint8(base) - 128) / 128; // unsigned
          } else if (bytesPerSample === 2){
            v = dv.getInt16(base, true) / 32768;
          } else if (bytesPerSample === 3){
            // 24-bit little endian
            const b0 = dv.getUint8(base+0), b1 = dv.getUint8(base+1), b2 = dv.getUint8(base+2);
            let n = (b2<<16)|(b1<<8)|b0; if (n & 0x800000) n |= ~0xFFFFFF; // sign extend
            v = n / 8388608;
          } else if (bytesPerSample === 4){
            v = dv.getInt32(base, true) / 2147483648;
          } else {
            v = 0;
          }
          sum += v;
        }
        floats.push(sum / fmt.numChannels);
      }
    }
    // Sanitize non-finite samples (prevents NaNs from poisoning normalization).
    for (let i=0;i<floats.length;i++){
      const v = floats[i];
      if (!isFinite(v)) floats[i] = 0;
    }
    if (!floats.length) throw new Error('No audio frames');

    // Normalize & remove DC
    let mean=0; for (let i=0;i<floats.length;i++) mean += floats[i]; mean/=floats.length;
    for (let i=0;i<floats.length;i++) floats[i] -= mean;
    let peak = 0; for (let i=0;i<floats.length;i++){ const a=Math.abs(floats[i]); if (a>peak) peak=a; }
    if (peak < 1e-6) peak = 1;
    for (let i=0;i<floats.length;i++) floats[i] = floats[i]/peak;
    // Resample to 96 samples, assuming a single cycle across the whole buffer
    const N = 96;
    const out = new Uint8Array(N);
    for (let i=0;i<N;i++){
      const t = i / N; // [0..1)
      const idx = t * floats.length;
      const i0 = Math.floor(idx) % floats.length;
      const i1 = (i0 + 1) % floats.length;
      const frac = idx - Math.floor(idx);
      const v = floats[i0]*(1-frac) + floats[i1]*frac;
      out[i] = Math.max(0, Math.min(255, Math.round((v*0.5 + 0.5)*255)));
    }
    return out;
  }

function parseWavToCycleFloat(buffer, opts){
    // Decode WAV/AIFF-like PCM (RIFF/WAVE only here), return mono float array of one cycle.
    // This mirrors parseWavToU8 but returns high-resolution float data (no decimation).
    const dv = new DataView(buffer);
    function str(o,l){ let s=''; for(let i=0;i<l;i++) s+=String.fromCharCode(dv.getUint8(o+i)); return s; }
    if (str(0,4) !== 'RIFF' || str(8,4) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
    let off = 12;
    let fmt = null, dataOff = -1, dataLen = 0, loopStart = -1, loopEnd = -1;
    while (off + 8 <= dv.byteLength){
      const id = str(off,4); const len = dv.getUint32(off+4, true); off += 8;
      if (id === 'fmt '){
        let audioFormat     = dv.getUint16(off+0, true);
        const numChannels   = dv.getUint16(off+2, true);
        const sampleRate    = dv.getUint32(off+4, true);
        const bitsPerSample = dv.getUint16(off+14, true);

        // Handle WAVE_FORMAT_EXTENSIBLE (0xFFFE) → use SubFormat GUID when present.
        if (audioFormat === 0xFFFE && len >= 40){
          const sub = dv.getUint32(off+24, true);
          if (sub === 1 || sub === 3) audioFormat = sub;
        }

        fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
      } else if (id === 'data'){
        dataOff = off; dataLen = len;
      }
      off += len + (len & 1);
    }
    if (!fmt || dataOff<0) throw new Error('Missing fmt/data');
    const bytes = new Uint8Array(buffer, dataOff, dataLen);
    let floats = [];
    if (fmt.audioFormat === 3 && (fmt.bitsPerSample === 32 || fmt.bitsPerSample === 64)){
      // float32/float64 path
      const bytesPerSample = fmt.bitsPerSample/8;
      const frames = Math.floor(dataLen / (bytesPerSample * fmt.numChannels));
      for (let f=0; f<frames; f++){
        let sum = 0;
        for (let ch=0; ch<fmt.numChannels; ch++){
          const base = dataOff + (f*fmt.numChannels + ch)*bytesPerSample;
          let v = (bytesPerSample === 8) ? dv.getFloat64(base, true) : dv.getFloat32(base, true);
          if (!isFinite(v)) v = 0;
          sum += v;
        }
        floats.push(sum / fmt.numChannels);
      }
    } else {
      const bytesPerSample = fmt.bitsPerSample/8;
      const frames = Math.floor(dataLen / (bytesPerSample * fmt.numChannels));
      for (let f=0; f<frames; f++){
        let sum = 0;
        for (let ch=0; ch<fmt.numChannels; ch++){
          const base = dataOff + (f*fmt.numChannels + ch)*bytesPerSample;
          let v = 0;
          if (bytesPerSample === 1){
            v = (dv.getUint8(base) - 128) / 128;
          } else if (bytesPerSample === 2){
            v = dv.getInt16(base, true) / 32768;
          } else if (bytesPerSample === 3){
            const b0 = dv.getUint8(base+0), b1 = dv.getUint8(base+1), b2 = dv.getUint8(base+2);
            let n = (b2<<16)|(b1<<8)|b0; if (n & 0x800000) n |= ~0xFFFFFF;
            v = n / 8388608;
          } else if (bytesPerSample === 4){
            v = dv.getInt32(base, true) / 2147483648;
          } else {
            v = 0;
          }
          sum += v;
        }
        floats.push(sum / fmt.numChannels);
      }
    }
    if (!floats.length) throw new Error('No audio frames');

    // Sanitize any non-finite values (can happen with malformed float WAVs).
    for (let i=0;i<floats.length;i++){
      const v = floats[i];
      if (!isFinite(v)) floats[i] = 0;
    }
    // Optional cleanup. Defaults keep previous behavior (DC-remove + normalize).
    opts = opts || {};
    const removeDC = (opts.removeDC !== undefined) ? !!opts.removeDC : true;
    const normalize = (opts.normalize !== undefined) ? !!opts.normalize : true;

    if (removeDC){
      let mean=0; for (let i=0;i<floats.length;i++) mean += floats[i]; mean/=floats.length;
      for (let i=0;i<floats.length;i++) floats[i] -= mean;
    }
    if (normalize){
      let peak=0; for (let i=0;i<floats.length;i++){ const a=Math.abs(floats[i]); if (a>peak) peak=a; }
      if (peak<=1e-9) peak=1; for (let i=0;i<floats.length;i++) floats[i]/=peak;
    }
    // Attach basic metadata for callers that care about source timing (e.g., loop import hints).
    // This is non-invasive: existing code treats the return value as a plain Float32Array.
    const out = new Float32Array(floats);
    try{
      out._sr = (fmt && fmt.sampleRate) ? (fmt.sampleRate|0) : 0;
    }catch(_){ }
    return out;
}

function resampleFloatCycleAA(srcF, targetLen, taps=16){
    // Anti-aliased cycle resample for float arrays (wraps as a single cycle).
    // Used to keep stored _srcFloat buffers bounded for memory/undo smoothness.
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
    // Preserve basic metadata (sample rate) when present.
    try{ if (srcF && srcF._sr !== undefined) out._sr = srcF._sr; }catch(_){ }
    return out;
}

function u8ToBase64(u8){
    const bytes = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    if (!bytes.length) return '';
    let bin = '';
    const CHUNK = 0x8000;
    for (let i=0;i<bytes.length;i+=CHUNK){
      const sub = bytes.subarray(i, i+CHUNK);
      bin += String.fromCharCode.apply(null, sub);
    }
    return btoa(bin);
  }

function base64ToU8(b64){
    const bin = atob(String(b64||''));
    const out = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i) & 0xFF;
    return out;
  }

function pcm16Int16FromU8(u8){
    const bytes = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    const N = bytes.length|0;
    const out = new Int16Array(N);
    for (let i=0;i<N;i++){
      const s = (bytes[i]-128)/127; // nominal -1..1
      const v = Math.max(-1, Math.min(1, s));
      out[i] = Math.round(v * 32767);
    }
    return out;
  }

function pcm16WavFromU8(u8, sampleRate, extraChunks){
    // u8: 0..255 => -1..1 then int16
    // Optional: extraChunks = [{ id:'smpl'|'dp5d'|..., bytes:Uint8Array }, ...]
    const pcm = pcm16Int16FromU8(u8);
    const sr = (sampleRate|0) || 44100;
    return pcm16WavFromInt16(pcm, sr, extraChunks || null);
  }

  // ---------------------------------------------------------------------------
  // WAV extras: embed/restore DigiPRO SysEx inside a WAV container
  //
  // Motivation: round‑trip parity.
  // - Exported WAVs can carry a lossless DigiPRO 0x5D SysEx message in a custom
  //   RIFF chunk so re‑importing the WAV can restore the exact same tables.
  // - Audio editors/DAWs will ignore unknown chunks and still play the audio.
  //
  // Chunk format (chunk id: "dp5d"):
  //   0..3   ASCII "MMDP" (magic)
  //   4      version (1)
  //   5      payload type (1 = SysEx bytes)
  //   6..7   reserved
  //   8..11  uint32 little‑endian payload length (N)
  //   12..   payload bytes (SysEx)
  // ---------------------------------------------------------------------------

  function _riffStr4(dv, off){
    if (off + 4 > dv.byteLength) return '';
    return String.fromCharCode(
      dv.getUint8(off+0),
      dv.getUint8(off+1),
      dv.getUint8(off+2),
      dv.getUint8(off+3)
    );
  }

  function buildDp5dChunk(syxBytes){
    const syx = (syxBytes instanceof Uint8Array) ? syxBytes : new Uint8Array(syxBytes||[]);
    const hdr = 12;
    const out = new Uint8Array(hdr + syx.length);
    // "MMDP"
    out[0]=0x4D; out[1]=0x4D; out[2]=0x44; out[3]=0x50;
    out[4]=1;   // version
    out[5]=1;   // type: sysex bytes
    out[6]=0; out[7]=0;
    // length
    (new DataView(out.buffer)).setUint32(8, syx.length>>>0, true);
    out.set(syx, hdr);
    return out;
  }

  function wavExtractDp5dSyx(arrayBuffer){
    try{
      const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : (arrayBuffer && arrayBuffer.buffer);
      if (!buf) return null;
      const dv = new DataView(buf);
      if (_riffStr4(dv,0) !== 'RIFF') return null;
      if (_riffStr4(dv,8) !== 'WAVE') return null;
      let off = 12;
      while (off + 8 <= dv.byteLength){
        const id = _riffStr4(dv, off);
        const len = dv.getUint32(off+4, true);
        const dataOff = off + 8;
        if (dataOff + len > dv.byteLength) break;
        if (id.toLowerCase() === 'dp5d'){
          const chunk = new Uint8Array(buf, dataOff, len);
          if (chunk.length < 12) return null;
          if (String.fromCharCode(chunk[0],chunk[1],chunk[2],chunk[3]) !== 'MMDP') return null;
          const ver = chunk[4]|0;
          const typ = chunk[5]|0;
          if (ver !== 1 || typ !== 1) return null;
          const n = (new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)).getUint32(8, true)>>>0;
          if (12 + n > chunk.length) return null;
          const syx = chunk.subarray(12, 12 + n);
          return new Uint8Array(syx); // copy
        }
        off = dataOff + len + (len & 1);
      }
    }catch(_){ }
    return null;
  }

  // ---------------------------------------------------------------------------
  // WAV extras: embed a RIFF "smpl" loop chunk
  //
  // This is a standard way to declare loop points in WAV files.
  // Many samplers will auto-loop using these markers.
  //
  // Semantics:
  // - loopStart is a sample index (0-based)
  // - loopEndExclusive is *exclusive* (like Array.slice end)
  // - the WAV 'smpl' spec stores loop end as an *inclusive* index, so we write:
  //     endInclusive = loopEndExclusive - 1
  //
  // For a single-cycle WAV of N samples, use:
  //   loopStart = 0
  //   loopEndExclusive = N
  // which yields endInclusive = N-1.
  // ---------------------------------------------------------------------------

  function buildSmplLoopChunk(loopStart, loopEndExclusive, sampleRate, opts){
    opts = (opts && typeof opts === 'object') ? opts : {};
    const noLoop = !!opts.noLoop;
    const sr = Math.max(1, sampleRate|0);
    const start = Math.max(0, loopStart|0);
    let endEx = (loopEndExclusive|0);
    if (!isFinite(endEx) || endEx <= start) endEx = start + 1;
    const endInc = Math.max(start, endEx - 1);

    // Optional WAV "smpl" fields:
    // - midiUnityNote: root/unity note (0..127). Many samplers ignore it, but when
    //   they honor it, it makes tuned single-cycle exports much nicer.
    // - loopType: 0=forward, 1=alternating/ping-pong, 2=backward (sampler support varies).
    let midiUnityNote = (opts.midiUnityNote == null) ? 60 : (opts.midiUnityNote|0);
    if (!isFinite(midiUnityNote)) midiUnityNote = 60;
    midiUnityNote = Math.max(0, Math.min(127, midiUnityNote|0));

    let loopType = (opts.loopType == null) ? 0 : (opts.loopType|0);
    if (!isFinite(loopType)) loopType = 0;
    loopType = Math.max(0, Math.min(2, loopType|0));

    // smpl header (36) + one loop (24) = 60 bytes
    // When noLoop is true, we still emit the header (for e.g. midiUnityNote),
    // but with numSampleLoops=0 and without any loop structs.
    const out = new Uint8Array(36 + (noLoop ? 0 : 24));
    const dv = new DataView(out.buffer);

    const WAV_CLOCK = 1000000000; // 1e9 Hz clock for samplePeriod (nanoseconds)
    const samplePeriod = Math.round(WAV_CLOCK / sr);

    // smpl header
    dv.setUint32(0, 0, true);                  // manufacturer
    dv.setUint32(4, 0, true);                  // product
    dv.setUint32(8, samplePeriod >>> 0, true); // samplePeriod (ns)
    dv.setUint32(12, midiUnityNote >>> 0, true); // midiUnityNote (default: middle C)
    dv.setUint32(16, 0, true);                 // midiPitchFraction
    dv.setUint32(20, 0, true);                 // smpteFormat
    dv.setUint32(24, 0, true);                 // smpteOffset
    dv.setUint32(28, noLoop ? 0 : 1, true);    // numSampleLoops
    dv.setUint32(32, 0, true);                 // samplerData

    if (!noLoop){
      // loop (24 bytes)
      const o = 36;
      dv.setUint32(o+0,  0, true);               // cuePointId
      dv.setUint32(o+4,  loopType >>> 0, true);  // type (0=forward, 1=ping-pong, 2=backward)
      dv.setUint32(o+8,  start >>> 0, true);     // start
      dv.setUint32(o+12, endInc >>> 0, true);    // end (inclusive)
      dv.setUint32(o+16, 0, true);               // fraction
      dv.setUint32(o+20, 0, true);               // playCount (0=infinite)
    }

    return out;
  }


  function pcm16WavFromInt16(i16, sampleRate, extraChunks){
    const samples = (i16 instanceof Int16Array) ? i16 : new Int16Array(i16||[]);
    const N = samples.length|0;
    const numChannels = 1, bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample/8);
    const blockAlign = numChannels * (bitsPerSample/8);
    const dataBytes = N * 2;

    // Extra RIFF chunks (optional)
    const extras = Array.isArray(extraChunks) ? extraChunks : [];
    let extraBytes = 0;
    for (const ch of extras){
      if (!ch || !ch.id || !ch.bytes) continue;
      const b = (ch.bytes instanceof Uint8Array) ? ch.bytes : new Uint8Array(ch.bytes||[]);
      const len = b.length|0;
      extraBytes += 8 + len + (len & 1);
    }

    const totalBytes = 44 + dataBytes + extraBytes;
    const buf = new ArrayBuffer(totalBytes);
    const dv = new DataView(buf);
    let o = 0;
    function W(s){ for (let i=0;i<s.length;i++) dv.setUint8(o++, s.charCodeAt(i)); }
    function U32(v){ dv.setUint32(o, v>>>0, true); o+=4; }
    function U16(v){ dv.setUint16(o, v>>>0, true); o+=2; }

    // RIFF header
    W('RIFF'); U32(totalBytes - 8); W('WAVE');
    // fmt chunk
    W('fmt '); U32(16); U16(1); U16(numChannels); U32(sampleRate); U32(byteRate); U16(blockAlign); U16(bitsPerSample);
    // data chunk
    W('data'); U32(dataBytes);
    for (let i=0;i<N;i++){ dv.setInt16(o, samples[i], true); o+=2; }

    // Extra chunks
    for (const ch of extras){
      if (!ch || !ch.id || !ch.bytes) continue;
      const id = String(ch.id).slice(0,4).padEnd(4,' ');
      const b = (ch.bytes instanceof Uint8Array) ? ch.bytes : new Uint8Array(ch.bytes||[]);
      W(id);
      U32(b.length|0);
      new Uint8Array(buf, o, b.length).set(b);
      o += b.length;
      if (b.length & 1){ dv.setUint8(o++, 0); }
    }

    return new Uint8Array(buf);
  }

function crc32(bytes){
    let c = ~0 >>> 0;
    for (let i=0;i<bytes.length;i++){
      c ^= bytes[i];
      for (let k=0;k<8;k++){
        c = (c>>>1) ^ (0xEDB88320 & -(c & 1));
      }
    }
    return (~c) >>> 0;
  }

function zipFiles(files){
    // files: [{name, bytes:Uint8Array}]
    const chunks = [];
    const cd = [];
    let offset = 0;
    function pushU8(arr){ chunks.push(arr); offset += arr.length; }
    function strBytes(s){ const a = new Uint8Array(s.length); for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a; }

    for (const f of files){
      const nameBytes = strBytes(f.name);
      const crc = crc32(f.bytes);
      const comp = f.bytes; // store
      const compSize = comp.length;
      const unCompSize = f.bytes.length;
      const modTime = 0, modDate = 0; // ignore
      // local header
      const hdr = new Uint8Array(30);
      const dv = new DataView(hdr.buffer);
      dv.setUint32(0, 0x04034b50, true); // local file header sig
      dv.setUint16(4, 20, true); // ver needed
      dv.setUint16(6, 0, true);  // flags
      dv.setUint16(8, 0, true);  // method 0 store
      dv.setUint16(10, modTime, true);
      dv.setUint16(12, modDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, compSize, true);
      dv.setUint32(22, unCompSize, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true); // extra len
      pushU8(hdr); pushU8(nameBytes); pushU8(comp);
      // central dir entry
      const cdrec = new Uint8Array(46);
      const dv2 = new DataView(cdrec.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true); // ver made by
      dv2.setUint16(6, 20, true); // ver needed
      dv2.setUint16(8, 0, true);  // flags
      dv2.setUint16(10, 0, true); // method
      dv2.setUint16(12, modTime, true);
      dv2.setUint16(14, modDate, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, compSize, true);
      dv2.setUint32(24, unCompSize, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true); // extra len
      dv2.setUint16(32, 0, true); // comment len
      dv2.setUint16(34, 0, true); // disk start
      dv2.setUint16(36, 0, true); // int attrs
      dv2.setUint32(38, 0, true); // ext attrs
      dv2.setUint32(42, offset - (30 + nameBytes.length + compSize), true); // rel offset of local header
      cd.push(cdrec, nameBytes);
    }
    // central directory
    const cdBytes = new Uint8Array(cd.reduce((n,a)=>n+a.length,0));
    let p=0; for(const b of cd){ cdBytes.set(b,p); p+=b.length; }
    const cdStart = offset;
    pushU8(cdBytes);
    const cdSize = cdBytes.length;
    const eocd = new Uint8Array(22);
    const dv3 = new DataView(eocd.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(4, 0, true); // disk
    dv3.setUint16(6, 0, true); // cd start disk
    const fileCount = files.length;
    dv3.setUint16(8, fileCount, true);
    dv3.setUint16(10, fileCount, true);
    dv3.setUint32(12, cdSize, true);
    dv3.setUint32(16, cdStart, true);
    dv3.setUint16(20, 0, true); // comment len
    pushU8(eocd);
    // concat all chunks
    const totalLen = chunks.reduce((n,a)=>n+a.length,0);
    const out = new Uint8Array(totalLen);
    let q=0; for(const c of chunks){ out.set(c,q); q+=c.length; }
    return out;
  }

function downloadBlob(blob, filename){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download.bin';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  }

function wavFilenameForSlot(slotIdx, name){
    const s = (slotIdx+1).toString().padStart(2,'0');
    const nm = fileToken4(name);
    return `MM-WAVE-${s}-${nm}.wav`;
  }

function syxFilenameForSlot(slotIdx, name){
    const s = (slotIdx+1).toString().padStart(2,'0');
    const nm = fileToken4(name);
    return `MM-DIGIPRO-SLOT-${s}-${nm}.syx`;
  }

async function importFilesIntoLibrary(files, fixedSlot){

    const cb = (root.DP_IO && root.DP_IO._cb) ? root.DP_IO._cb : {};
    const st = (cb.getCurrentState && cb.getCurrentState()) || {};
    const LIB = st.LIB || root.digiWaveLibrary;
    const EDIT = st.EDIT || (root.__digipro_EDIT || null);
    // Optional UI hooks (if present). These must be declared here to avoid ReferenceErrors during import.
    const nameIn = (cb && cb.nameIn) || root.__digipro_nameIn || null;
    const paintEditor = (cb && (cb.repaintEditor || cb.paintEditor)) || root.__digipro_paintEditor || null;

    // Job / cancellation (keeps the original JOB semantics where possible)
    const JOB = cb.job || cb.JOB || (root.DP_IO && root.DP_IO._job) || { running:false, cancelled:false, label:'' };
    if (root.DP_IO) root.DP_IO._job = JOB;

    const beginJob = cb.beginJob || function(label){ JOB.running = true; JOB.cancelled = false; JOB.label = label || ''; };
    const endJob   = cb.endJob   || function(){ JOB.running = false; JOB.label = ''; };

    const announceIO = cb.onProgress ? function(msg, isErr){ 
      try {
        if (isErr && cb.onError) cb.onError(msg);
        else cb.onProgress(msg);
      } catch(e){}
      if (!cb.onError && isErr) console.warn(msg);
      if (!cb.onProgress && !isErr) console.log(msg);
    } : (root.announceIO || function(){});

    const paintGridCell = cb.repaintSlot ? function(slot/*, isActive*/){ try{ cb.repaintSlot(slot|0); }catch(e){} } : function(){};

    // confirm() may be unavailable in some embedded contexts; fall back to auto-accept.
    const askConfirm = (typeof root.confirm === 'function') ? root.confirm.bind(root) : (()=>true);

    // Bank undo capture (one action per import batch).
    const captureBankStateFn = (typeof root.captureBankState === 'function') ? root.captureBankState : null;
    const bankPushFn         = (typeof root.bankPush === 'function') ? root.bankPush : null;
    let bankUndoEnabled      = !!(captureBankStateFn && bankPushFn);
    let bankBeforeMeta       = null;
    if (bankUndoEnabled){
      try{
        bankBeforeMeta = captureBankStateFn([], { preferEditor:true });
      }catch(_){
        // If the undo system is present but not fully initialised, don't let it break imports.
        bankUndoEnabled = false;
        bankBeforeMeta = null;
      }
    }
    const bankBeforeWaves    = {};
    const bankTouched        = new Set();
    function touchUndoSlot(slot){
      if (!bankUndoEnabled) return;
      slot = slot|0;
      if (slot < 0 || slot >= 64) return;
      if (bankTouched.has(slot)) return;
      bankTouched.add(slot);
      try{
        const snap = captureBankStateFn([slot], { preferEditor:true });
        bankBeforeWaves[slot] = (snap && snap.waves) ? (snap.waves[slot] || null) : null;
      }catch(_){
        // Best-effort fallback: shallow clone (should be rare).
        const w = (LIB && LIB.waves) ? (LIB.waves[slot] || null) : null;
        bankBeforeWaves[slot] = w ? {
          name: w.name,
          user: !!w.user,
          dataU8: (w.dataU8 ? new Uint8Array(w.dataU8) : null)
        } : null;
      }
    }

    if (!files || !files.length) return;

    if (JOB.running){
      announceIO('A batch job is already running — cancel/finish it before importing.', true);
      return;
    }

    beginJob(`Import ${files.length} file${files.length===1?'':'s'}`);

    try{
      // Pre-sort files by derived 4-letter code
      const entries = Array.from(files).map(f => ({ file:f, code: derive4FromFilename(f.name) }))
        .sort((a,b)=> a.code.localeCompare(b.code));

      // Track used names so each auto-assigned imported slot gets a unique 4-letter name
      const used = collectUsedNamesFromLib(LIB);

      // Track which slots were touched so we can refresh the editor view if needed
      const touchedSlots = new Set();

      // Preflight: warn once before overwriting slots.
      // - If fixedSlot is provided (drop onto a slot / sequential import), warn for the sequential target range.
      // - Otherwise, warn if filename-restored WAVs (MM-WAVE-##-NAME.wav) will overwrite existing slots.
      if (typeof fixedSlot === 'number'){
        const startSlot = fixedSlot|0;

        // Estimate sequential slot usage: WAV + SYX files consume slots in order; JSON respects internal slots.
        const seqItems = entries.filter(ent => /\.(wav|syx)$/i.test((ent && ent.file && ent.file.name) || ''));
        const estCount = seqItems.length|0;

        if (estCount > 0){
          const overwrites = [];
          for (let k=0; k<estCount; k++){
            const s = startSlot + k;
            if (s < 0 || s >= 64) break;
            if (LIB.waves[s]) overwrites.push(s);
          }
          if (overwrites.length){
            const list = overwrites.slice(0,8).map(s=>`${s+1}`).join(', ');
            const more = overwrites.length>8 ? ` +${overwrites.length-8} more` : '';
            const ok = askConfirm(`Import will overwrite ${overwrites.length} existing slot(s) starting at slot ${startSlot+1} (${list}${more}). Continue?`);
            if (!ok) return;
          }

          if (startSlot + estCount > 64){
            const overflow = (startSlot + estCount) - 64;
            const ok = askConfirm(`Only ${64 - startSlot} slot(s) are available from slot ${startSlot+1}..64. ${overflow} file(s) may not fit. Continue?`);
            if (!ok) return;
          }
        }
      } else {
        const overwrites = [];
        for (const ent of entries){
          const f = ent.file;
          if (!/\.wav$/i.test(f.name)) continue;
          const info = parseSlotNameFromFilename(f.name);
          if (!info || typeof info.slot !== 'number') continue;
          if (LIB.waves[info.slot]) overwrites.push({ slot: info.slot, file: f.name });
        }
        if (overwrites.length){
          const list = overwrites.slice(0,8).map(o=>`${o.slot+1}`).join(', ');
          const more = overwrites.length>8 ? ` +${overwrites.length-8} more` : '';
          const ok = askConfirm(`Import will overwrite ${overwrites.length} existing slot(s) (${list}${more}). Continue?`);
          if (!ok) return;
        }
      }

      // If user dropped files onto a specific slot, import sequentially from there.
      let seqSlot = (typeof fixedSlot === 'number') ? (fixedSlot|0) : null;

      for (let ei=0; ei<entries.length; ei++){
        if (JOB.cancelled) break;

        const ent = entries[ei];
        // Sequential import safety: stop once we run out of slots.
        if (typeof seqSlot === 'number' && seqSlot >= 64 && !/\.json$/i.test((ent && ent.file && ent.file.name) || '')){
          announceIO('Reached end of bank (slot 64). Remaining file(s) were skipped.', true);
          break;
        }
        const f = ent.file;
        const base4 = ent.code;

        announceIO(`Importing ${ei+1}/${entries.length}: ${f.name}`);

        let buf;
        try{
          buf = await f.arrayBuffer(); // ArrayBuffer
        }catch(err){
          announceIO(`Failed to read ${f.name}: ${err && err.message ? err.message : err}`, true);
          continue;
        }

        if (JOB.cancelled) break;

        // --- JSON bank ---
        if (/\.json$/i.test(f.name)){
          try{
            const obj = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));

            if (!(obj && obj.format==='mmdt-digipro-bank' && Array.isArray(obj.waves))){
              announceIO('Unrecognized JSON file (expected mmdt-digipro-bank).', true);
              continue;
            }

            const targets = Array.from(new Set(obj.waves.map(r => r && (r.slot|0)).filter(s => s>=0 && s<64)));

            let applied = 0;
            for (const rec of obj.waves){
              if (JOB.cancelled) break;

              const slot = (rec.slot|0);
              if (slot<0 || slot>=64) continue;

              const nm = String(rec.name||'WAVE').toUpperCase().slice(0,4);

              // Capture pre-import state for bank undo (one action per full batch).
              touchUndoSlot(slot);

                            // JSON should round-trip exactly what the user exported (no C6 parity normalization).
              // Prefer the raw 96-sample slot data when present; only fall back to SysEx when no data exists.
              const heat = (typeof rec._dpHeat === 'number' && isFinite(rec._dpHeat) && rec._dpHeat > 0) ? rec._dpHeat : 1;

              let w = null;

              // Primary: raw 96-sample slot data (UI-accurate)
              const srcArr = (rec.dataU8 && rec.dataU8.length) ? rec.dataU8 : (rec.data || []);
              if (srcArr && srcArr.length){
                let u8 = new Uint8Array(Array.from(srcArr||[], x=>clamp((x|0),0,255)));
                if (u8.length){
                  // Robustness: downstream code assumes 96 samples per slot.
                  // If legacy JSON contains a different length, resample to 96.
                  if (u8.length !== 96){
                    if (typeof root.resampleU8_AA === 'function'){
                      u8 = root.resampleU8_AA(u8, 96, 16);
                    } else {
                      // Fallback: linear wrap resample.
                      const N = u8.length|0;
                      const out = new Uint8Array(96);
                      for (let i=0;i<96;i++){
                        const x = (i * N) / 96;
                        const xi = Math.floor(x);
                        const i0 = ((xi % N) + N) % N;
                        const i1 = (i0 + 1) % N;
                        const frac = x - xi;
                        const v = (u8[i0]*(1-frac) + u8[i1]*frac);
                        out[i] = clamp(Math.round(v), 0, 255);
                      }
                      u8 = out;
                    }
                  }
                  w = attachDisplayRot({ name:nm, dataU8: u8, user:true, _dpHeat: heat }, false);
                }
              } else if (rec.syxB64 && root.MMDT_DigiPRO && root.MMDT_DigiPRO.decode){
                // Fallback: embedded SysEx dump (device-accurate), only when no raw data was provided.
                try{
                  const raw = Uint8Array.from(atob(rec.syxB64), c=>c.charCodeAt(0));
                  const dec = root.MMDT_DigiPRO.decode(raw);

                  w = { name:nm, dataU8: dec.dataU8, user:true, _dpHeat: heat };
                  if (dec && dec.tables && dec.tables.t0 && dec.tables.t1 && dec.tables.t2){
                    w._tables6132 = {
                      t0: new Int16Array(dec.tables.t0),
                      t1: new Int16Array(dec.tables.t1),
                      t2: new Int16Array(dec.tables.t2),
                    };
                  }

                  w = attachDisplayRot(w, true);
                }catch(_){
                  w = null;
                }
              }

              if (!w || !w.dataU8 || !w.dataU8.length) continue;
              LIB.waves[slot] = w;

              LIB.dirty.delete(slot);
              paintGridCell(slot);
              try{ touchedSlots && touchedSlots.add(slot); }catch(_){ }
              applied++;
            }

            // If import touched the open editor slot, sync editor view to the imported wave
            if (targets.includes(EDIT.slot|0)){
              const w = LIB.waves[EDIT.slot|0];
              if (w && w.dataU8){
                EDIT.name = (w.name||'WAVE');
                EDIT.dataU8 = new Uint8Array(w.dataU8);
                if (w.dataU8.displayRot != null) EDIT.dataU8.displayRot = w.dataU8.displayRot|0;
                EDIT._dpHeat = (typeof w._dpHeat === 'number' && isFinite(w._dpHeat) && w._dpHeat > 0) ? w._dpHeat : 1;
                if (nameIn) nameIn.value = EDIT.name;
                if (paintEditor) paintEditor();
                LIB.dirty.delete(EDIT.slot|0);
              }
            }

            announceIO(`Loaded bank JSON (${applied} slot(s)).`);
          }catch(err){
            announceIO(`Could not parse JSON: ${err && err.message ? err.message : err}`, true);
          }
          continue;
        }

// --- DigiPRO SysEx (.syx) ---
        if (/\.syx$/i.test(f.name)){
          try{
            const msgs = root.MMDT_DigiPRO.decodeMany(new Uint8Array(buf));
            if (!msgs.length){ announceIO(`No DigiPRO waves found in ${f.name}.`, true); continue; }

            for (const m of msgs){
              if (JOB.cancelled) break;

              if (m && m.checksumOk===false){
                announceIO(`Skipped corrupt SysEx message (bad checksum) in ${f.name}.`, true);
                continue;
              }

              const slot = (typeof seqSlot === 'number') ? seqSlot : (m.slot|0);
              if (slot<0 || slot>=64) continue;

              // Capture pre-import state for bank undo.
              touchUndoSlot(slot);

              const nm = String((m.name||base4)||'WAVE').toUpperCase().slice(0,4);

              const rec = { name:nm, dataU8: m.dataU8, user:true };
              if (m && m.tables && m.tables.t0 && m.tables.t1 && m.tables.t2){
                rec._tables6132 = {
                  t0: new Int16Array(m.tables.t0),
                  t1: new Int16Array(m.tables.t1),
                  t2: new Int16Array(m.tables.t2),
                };
              }

              LIB.waves[slot] = attachDisplayRot(rec, true);
              LIB.dirty.delete(slot);
              paintGridCell(slot);
              try{ touchedSlots && touchedSlots.add(slot); }catch(_){ }

              if (typeof seqSlot === 'number') seqSlot++;
            }

            announceIO(`Imported SysEx from ${f.name}.`);
          }catch(err){
            announceIO(`Failed to import SysEx: ${err && err.message ? err.message : err}`, true);
          }
          continue;
        }

        // --- WAV single-cycle ---
        if (/\.wav$/i.test(f.name)){
          try{
            // If file looks like our exported naming scheme, restore slot + name from filename.
            const parsed = (typeof seqSlot === 'number') ? null : parseSlotNameFromFilename(f.name);
            const hasParsedSlot = parsed && (typeof parsed.slot === 'number') && parsed.slot>=0 && parsed.slot<64;

            // Lossless parity: if this WAV contains an embedded DigiPRO SysEx payload
            // (custom RIFF chunk id "dp5d"), import the embedded SysEx instead of
            // re-parsing the audio into a new waveform.
            const embeddedSyx = wavExtractDp5dSyx(buf);
            if (embeddedSyx && root.MMDT_DigiPRO && typeof root.MMDT_DigiPRO.decodeMany === 'function'){
              let msgs = null;
              try{ msgs = root.MMDT_DigiPRO.decodeMany(embeddedSyx); }catch(_){ msgs = null; }
              if (msgs && msgs.length){
                for (let mi=0; mi<msgs.length; mi++){
                  if (JOB.cancelled) break;
                  const m = msgs[mi];
                  let target = (typeof seqSlot === 'number')
                    ? seqSlot
                    : (hasParsedSlot ? parsed.slot : (m && typeof m.slot === 'number' ? (m.slot|0) : -1));
                  if (target < 0 || target >= 64) target = findNextFreeSlotInLib(LIB);
                  if (target < 0 || target >= 64){ announceIO('No free slot to import embedded DigiPRO SysEx from WAV.', true); break; }

                  let nm = (parsed && parsed.name) ? _alnum4(parsed.name) : ((m && m.name) ? _alnum4(m.name) : base4);
                  nm = _alnum4(nm || base4);
                  try{
                    if ((!parsed || !parsed.name) && typeof ensureUnique4 === 'function') nm = ensureUnique4(nm, used);
                    else used.add(nm);
                  }catch(_){ }

                  touchUndoSlot(target);
                  const rec = { name:nm, dataU8: (m && m.dataU8) ? m.dataU8 : new Uint8Array(96).fill(128), user:true, _tables6132: (m && m.tables) ? m.tables : null };
                  LIB.waves[target] = attachDisplayRot(rec, true);
                  LIB.dirty.delete(target);
                  paintGridCell(target);
                  try{ touchedSlots && touchedSlots.add(target); }catch(_){ }

                  if (typeof seqSlot === 'number') seqSlot++;
                }

                announceIO(`Imported embedded DigiPRO SysEx from WAV ${f.name}.`);
                continue;
              }
            }

            const target = (typeof seqSlot === 'number')
              ? seqSlot
              : (hasParsedSlot ? parsed.slot : findNextFreeSlotInLib(LIB));

            if (target < 0 || target >= 64){ announceIO('No free slot to import WAV.', true); continue; }

            // Parity mode: when re-importing our own exported WAVs, keep amplitude/DC (no normalize).
            const fromExport = !!(parsed && parsed.fromExport);

            const removeDC  = fromExport ? false : !!SETTINGS.wavImportRemoveDC;
            const normalize = fromExport ? false : !!SETTINGS.wavImportNormalize;
            const clipProtect = fromExport ? false : !!SETTINGS.wavImportClipProtect;

            let floats = parseWavToCycleFloat(buf, { removeDC, normalize });

            // Clip protection: if we're *not* normalizing but the source contains overs
            // (e.g. float WAVs with samples > 1.0), scale down just enough to fit.
            if (clipProtect && !normalize && floats && floats.length){
              let peak = 0;
              for (let i=0;i<floats.length;i++){
                const v = floats[i];
                const a = Math.abs(isFinite(v) ? v : 0);
                if (a > peak) peak = a;
              }
              if (peak > 1){
                const g = 1 / peak;
                for (let i=0;i<floats.length;i++) floats[i] *= g;
              }
            }

            const preview = resampleFloatToU8_AA(floats, 96, 16);

            let nm = (parsed && parsed.name) ? _alnum4(parsed.name) : base4;
            // Ensure unique names for auto-generated names (helps grid readability).
            try{
              if ((!parsed || !parsed.name) && typeof ensureUnique4 === 'function') nm = ensureUnique4(nm, used);
              else used.add(nm);
            }catch(_){ }

            // Capture pre-import state for bank undo.
            touchUndoSlot(target);

            // Memory guard: don't retain arbitrarily long decoded buffers in _srcFloat.
            // Keep a bounded high-res cycle for table renders / exports without runaway RAM.
            let srcKeep = floats;
            try{
              const MAX_SRC = 16384;
              if (srcKeep && srcKeep.length && srcKeep.length > MAX_SRC){
                srcKeep = resampleFloatCycleAA(srcKeep, MAX_SRC, 16);
              }
            }catch(_){ }
            const rec = { name:nm, dataU8: preview, user:true, _srcFloat: srcKeep };
            LIB.waves[target] = attachDisplayRot(rec, false);
            LIB.dirty.delete(target);
            paintGridCell(target);
            try{ touchedSlots && touchedSlots.add(target); }catch(_){ }

            if (hasParsedSlot){
              announceIO(`Imported WAV → slot ${target+1} as “${nm}” (restored from filename).`);
            }else{
              announceIO(`Imported WAV → slot ${target+1} as “${nm}”.`);
            }

            if (typeof seqSlot === 'number') seqSlot++;
          }catch(err){
            announceIO(`Failed to import WAV ${f.name}: ${err && err.message ? err.message : err}`, true);
          }
          continue;
        }

        // Unknown file type
        announceIO(`Unsupported file type: ${f.name}`, true);
      }

      // If import touched the open editor slot, refresh the editor buffer to match the new library content.
      try{
        const curSlot = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : null;
        if (curSlot !== null && touchedSlots && touchedSlots.has(curSlot)){
          const w = LIB.waves[curSlot|0];
          if (w && w.dataU8){
            EDIT.name = (w.name||'WAVE');
            EDIT.dataU8 = new Uint8Array(w.dataU8);
            if (w.dataU8.displayRot != null) EDIT.dataU8.displayRot = w.dataU8.displayRot|0;
            if (nameIn) nameIn.value = EDIT.name;
            if (typeof initUndo === 'function') initUndo();
            if (paintEditor) paintEditor();
            LIB.dirty.delete(curSlot|0);
          }
        }
      }catch(_){}


      // Add a single bank undo step for the whole import batch (if undo/redo is available).
      // This makes WAV / SYX / JSON imports reversible via Ctrl+Z.
      try{
        if (bankUndoEnabled && bankTouched && bankTouched.size){
          const touched = Array.from(bankTouched)
            .map(n=>n|0)
            .filter(n=>n>=0 && n<64)
            .sort((a,b)=>a-b);

          if (touched.length){
            const before = bankBeforeMeta || captureBankStateFn(touched, { preferEditor:true });
            if (before){
              before.touched = touched;
              before.waves = before.waves || {};
              for (const s of touched){
                before.waves[s] = (s in bankBeforeWaves) ? bankBeforeWaves[s] : null;
              }
            }

            const after = captureBankStateFn(touched, { preferEditor:true });
            if (after){
              const label = (files && files.length===1 && files[0] && files[0].name)
                ? `Import ${files[0].name}`
                : `Import ${files.length} files`;
              bankPushFn({ label, before, after });
            }
          }
        }
      }catch(_){ }
    } finally {
      endJob();
    }
  }

  // ---------------------------------------------------------------------------
  // Public exports
  // ---------------------------------------------------------------------------

  _export('parseWavToU8', parseWavToU8);
  _export('parseWavToCycleFloat', parseWavToCycleFloat);
  _export('u8ToBase64', u8ToBase64);
  _export('base64ToU8', base64ToU8);
  _export('pcm16WavFromU8', pcm16WavFromU8);
  _export('buildDp5dChunk', buildDp5dChunk);
  _export('wavExtractDp5dSyx', wavExtractDp5dSyx);
  _export('buildSmplLoopChunk', buildSmplLoopChunk);
  _export('pcm16WavFromInt16', pcm16WavFromInt16);
  _export('crc32', crc32);
  _export('zipFiles', zipFiles);
  _export('downloadBlob', downloadBlob);
  _export('importFilesIntoLibrary', importFilesIntoLibrary);
  _export('wavFilenameForSlot', wavFilenameForSlot);
  _export('syxFilenameForSlot', syxFilenameForSlot);

})();