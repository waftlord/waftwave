/**
 * mmdt-digipro-sysex.js — Elektron Monomachine DigiPRO Waveform (0x5D)
 *
 * Implements the on‑wire SysEx format used by Elektron C6 for “Draw / send DigiPRO waveform”.
 *
 * Key facts (0x5D):
 *  - 7008 bytes of 7‑bit encoded wavedata inside the SysEx
 *  - 7‑bit decode → 6132 raw bytes
 *  - 6132 raw bytes are NOT RLE; they are 1022 blocks × 6 bytes.
 *
 * Raw block layout (block i, offset o = 6*i):
 *   raw[o+0]=A0_hi
 *   raw[o+1]=A0_lo
 *   raw[o+2]=B_hi
 *   raw[o+3]=A1_hi
 *   raw[o+4]=A1_lo
 *   raw[o+5]=B_lo
 *
 * Where A0/A1 are consecutive int16 samples from the main (A) stream.
 * B is an int16 sample from the secondary (B) stream.
 *
 * For convenience, this codec exposes the 6132 payload as three Int16 arrays of length 1022:
 *   tables.t0[i] = A0
 *   tables.t1[i] = A1
 *   tables.t2[i] = B
 *
 * Public API: window.MMDT_DigiPRO
 */
(function(root){
  'use strict';
  if (root.MMDT_DigiPRO) return;

  const VERSION = '5.0.2-c6-0x5d-blocks-aa-preview';

  const ID_DUMP = 0x5D; // DigiPRO waveform dump
  // NOTE: The Monomachine DigiPRO waveform request used by C6 is 0x5E.
  // (0x5C is used by other DigiPRO-related operations in some docs/builds.)
  const ID_REQ  = 0x5E; // DigiPRO waveform request

  // Header bytes (Monomachine): F0 00 20 3C 03 <deviceId>
  // We match only the first 5 bytes for robustness; byte[5] is the device ID.
  const ELEKTRON_HEADER_5 = new Uint8Array([0xF0,0x00,0x20,0x3C,0x03]);
  const ELEKTRON_HEADER_6 = new Uint8Array([0xF0,0x00,0x20,0x3C,0x03,0x00]);

  // Offsets (relative to 0xF0)
  const OFF_TYPE    = 0x06;
  const OFF_VER     = 0x07;
  const OFF_REV     = 0x08;
  const OFF_SLOT    = 0x09;
  const OFF_NAME    = 0x0A;
  const OFF_PAYLOAD = 0x0E;

  const ENCODED_PAYLOAD_SIZE = 7008;
  const DECODED_PAYLOAD_SIZE = 6132;

  // 6132 bytes == 1022 blocks × 6 bytes
  const SAMPLES_PER_TABLE = 1022;
  const TABLE_SIZE_BYTES  = 2044; // 1022 * 2

  const OFF_CHK_HI = OFF_PAYLOAD + ENCODED_PAYLOAD_SIZE; // 0x1B6E
  const OFF_CHK_LO = OFF_CHK_HI + 1;
  const OFF_LEN_HI = OFF_CHK_HI + 2;
  const OFF_LEN_LO = OFF_CHK_HI + 3;
  const OFF_END    = OFF_CHK_HI + 4;

  const MSG_SIZE_BYTES = OFF_END + 1; // 7027

  // ----------------- small helpers -----------------
  function seqEq(a, ai, b, bi, n){
    for (let i=0;i<n;i++) if (a[ai+i] !== b[bi+i]) return false;
    return true;
  }
  function toAscii4(name){
    const s = (name == null ? '' : String(name)).toUpperCase();
    const out = new Uint8Array(4);
    for (let i=0;i<4;i++){
      const c = s.charCodeAt(i) || 0x20; // space
      out[i] = c & 0x7F;
    }
    return out;
  }

  function fromAscii4(u8, off){
    let s='';
    for (let i=0;i<4;i++) s += String.fromCharCode(u8[off+i] & 0x7F);
    return s;
  }

  // Elektron 7‑bit pack/unpack (7 raw bytes -> 8 sysex bytes)
  function sevenBitEncode(raw){
    const src = (raw instanceof Uint8Array) ? raw : new Uint8Array(raw||[]);
    const n = src.length;
    if (n % 7 !== 0) throw new Error('sevenBitEncode: length must be multiple of 7');
    const out = new Uint8Array((n/7)*8);
    let si=0, oi=0;
    while (si < n){
      let msb = 0;
      for (let k=0;k<7;k++){
        if (src[si+k] & 0x80) msb |= (1 << (6-k));
      }
      out[oi++] = msb;
      for (let k=0;k<7;k++) out[oi++] = src[si+k] & 0x7F;
      si += 7;
    }
    return out;
  }

  function sevenBitDecode(enc){
    const src = (enc instanceof Uint8Array) ? enc : new Uint8Array(enc||[]);
    const n = src.length;
    if (n % 8 !== 0) throw new Error('sevenBitDecode: length must be multiple of 8');
    const out = new Uint8Array((n/8)*7);
    let si=0, oi=0;
    while (si < n){
      const msb = src[si++];
      for (let k=0;k<7;k++){
        const low = src[si++] & 0x7F;
        const bit = (msb >> (6-k)) & 1;
        out[oi++] = low | (bit << 7);
      }
    }
    return out;
  }

  function checksum14(bytes){
    const src = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes||[]);
    let sum = 0;
    for (let i=0;i<src.length;i++) sum = (sum + (src[i] & 0x7F)) & 0x3FFF;
    return sum;
  }

  function int16FromHiLo(hi, lo){
    const u = ((hi & 0xFF) << 8) | (lo & 0xFF);
    return (u & 0x8000) ? (u - 0x10000) : u;
  }

  function hiByte(i16){ return (i16 >> 8) & 0xFF; }
  function loByte(i16){ return i16 & 0xFF; }

  // Anti-aliased periodic resample for UI previews (reduces aliasing/noise when shrinking 1024 → 96).
  function resampleU8_AA(u8, targetLen, taps=16){
    const src = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    const N = src.length|0;
    const M = targetLen|0;
    if (!N || !M || N === M) return new Uint8Array(src);
    taps = Math.max(1, taps|0);
    const out = new Uint8Array(M);
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
      out[i] = Math.max(0, Math.min(255, Math.round(acc / taps)));
    }
    return out;
  }

  function int16Base1024ToU8(t0, t1){
    // Reconstruct A[0..1023] from the first 512 blocks (t0/t1) and convert to a U8 cycle.
    // NOTE: We intentionally do NOT peak-normalize here, so relative waveform levels are preserved.
    const N = 1024;
    const tmp = new Float64Array(N);
    let mean = 0;
    for (let i=0;i<512;i++){
      const a0 = t0[i] || 0;
      const a1 = t1[i] || 0;
      tmp[2*i]   = a0;
      tmp[2*i+1] = a1;
      mean += a0 + a1;
    }
    mean /= N;

    // Map Int16-ish range to [-1..1] using fixed scale (not peak-based).
    const denom = 32768;
    const out = new Uint8Array(N);
    for (let i=0;i<N;i++){
      const y = (tmp[i] - mean) / denom;
      const v = Math.max(-1, Math.min(1, y));
      out[i] = Math.max(0, Math.min(255, Math.round(v*127 + 128)));
    }
    return out;
  }

  // ----------------- raw 6132 block packing -----------------
  function unpackRaw6132(raw6132){
    const raw = (raw6132 instanceof Uint8Array) ? raw6132 : new Uint8Array(raw6132||[]);
    if (raw.length !== DECODED_PAYLOAD_SIZE) throw new Error('Expected 6132 raw bytes');

    const t0 = new Int16Array(SAMPLES_PER_TABLE);
    const t1 = new Int16Array(SAMPLES_PER_TABLE);
    const t2 = new Int16Array(SAMPLES_PER_TABLE);

    for (let i=0;i<SAMPLES_PER_TABLE;i++){
      const o = 6*i;
      const a0 = int16FromHiLo(raw[o+0], raw[o+1]);
      const b  = int16FromHiLo(raw[o+2], raw[o+5]);
      const a1 = int16FromHiLo(raw[o+3], raw[o+4]);
      t0[i] = a0;
      t1[i] = a1;
      t2[i] = b;
    }
    return { t0, t1, t2 };
  }

  function packRaw6132(tables){
    if (!tables || tables.t0 == null || tables.t1 == null || tables.t2 == null) throw new Error('Missing tables');
    const t0 = (tables.t0 instanceof Int16Array) ? tables.t0 : new Int16Array(tables.t0);
    const t1 = (tables.t1 instanceof Int16Array) ? tables.t1 : new Int16Array(tables.t1);
    const t2 = (tables.t2 instanceof Int16Array) ? tables.t2 : new Int16Array(tables.t2);
    if (t0.length !== SAMPLES_PER_TABLE || t1.length !== SAMPLES_PER_TABLE || t2.length !== SAMPLES_PER_TABLE){
      throw new Error(`Tables must be Int16Array(${SAMPLES_PER_TABLE})`);
    }

    const raw = new Uint8Array(DECODED_PAYLOAD_SIZE);
    for (let i=0;i<SAMPLES_PER_TABLE;i++){
      const o = 6*i;
      const a0 = t0[i] | 0;
      const a1 = t1[i] | 0;
      const b  = t2[i] | 0;
      raw[o+0] = hiByte(a0);
      raw[o+1] = loByte(a0);
      raw[o+2] = hiByte(b);
      raw[o+3] = hiByte(a1);
      raw[o+4] = loByte(a1);
      raw[o+5] = loByte(b);
    }
    return raw;
  }

  // ----------------- decode / encode -----------------
  function decode(u8){
    const msg = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    if (msg.length < MSG_SIZE_BYTES) throw new Error('SysEx too short');
    if (!seqEq(msg, 0, ELEKTRON_HEADER_5, 0, 5)) throw new Error('Not an Elektron/Monomachine SysEx');
    if (msg[OFF_TYPE] !== ID_DUMP) throw new Error('Not a DigiPRO (0x5D) dump');

    const slot = msg[OFF_SLOT] & 0x3F;
    const name = fromAscii4(msg, OFF_NAME);

    const enc = msg.slice(OFF_PAYLOAD, OFF_PAYLOAD + ENCODED_PAYLOAD_SIZE);
    const raw = sevenBitDecode(enc);
    if (raw.length !== DECODED_PAYLOAD_SIZE) throw new Error('Bad 7-bit payload length');

    const tables = unpackRaw6132(raw);

    // Checksum (C6 behavior): sum(name + wavedata), lower 14 bits, stored as two 7-bit bytes.
    const chkBody = new Uint8Array(4 + ENCODED_PAYLOAD_SIZE);
    chkBody.set(msg.slice(OFF_NAME, OFF_NAME+4), 0);
    chkBody.set(enc, 4);
    const chk = checksum14(chkBody);
    const chkHi = (chk >> 7) & 0x7F;
    const chkLo = chk & 0x7F;
    const chkOk = ((msg[OFF_CHK_HI] & 0x7F) === chkHi) && ((msg[OFF_CHK_LO] & 0x7F) === chkLo);

    // UI-friendly preview: use the 1024-sample base A-table, downsample to 96.
    const base1024 = int16Base1024ToU8(tables.t0, tables.t1);
    const dataU8 = resampleU8_AA(base1024, 96, 16);

    return {
      id: ID_DUMP,
      slot,
      name,
      kind: 'slot6132',
      dataU8,
      tables,
      checksumOk: chkOk
    };
  }

  function encodeSlot6132({slot, name, tables, deviceId=0}){
    const pos = (slot|0) & 0x3F;
    const dev = (deviceId|0) & 0x7F;

    const nameBytes = toAscii4(name);

    const raw = packRaw6132(tables);
    const enc = sevenBitEncode(raw);
    if (enc.length !== ENCODED_PAYLOAD_SIZE) throw new Error('Internal error: bad encoded payload length');

    const msg = new Uint8Array(MSG_SIZE_BYTES);
    msg.set(ELEKTRON_HEADER_6, 0);
    msg[0x05] = dev;
    msg[OFF_TYPE] = ID_DUMP;
    msg[OFF_VER]  = 0x01;
    msg[OFF_REV]  = 0x01;
    msg[OFF_SLOT] = pos;
    msg.set(nameBytes, OFF_NAME);
    msg.set(enc, OFF_PAYLOAD);

    // checksum over name + wavedata
    const chkBody = new Uint8Array(4 + ENCODED_PAYLOAD_SIZE);
    chkBody.set(nameBytes, 0);
    chkBody.set(enc, 4);
    const chk = checksum14(chkBody);
    msg[OFF_CHK_HI] = (chk >> 7) & 0x7F;
    msg[OFF_CHK_LO] = chk & 0x7F;

    // length is fixed for this message type: 7017 (0x1B69) stored as 14-bit hi/lo 7-bit
    const len14 = 2 + 1 + 4 + ENCODED_PAYLOAD_SIZE + 2; // ver+rev + pos + name + data + checksum
    msg[OFF_LEN_HI] = (len14 >> 7) & 0x7F;
    msg[OFF_LEN_LO] = len14 & 0x7F;

    msg[OFF_END] = 0xF7;
    return msg;
  }

  function isWaveDump(u8){
    const msg = (u8 instanceof Uint8Array) ? u8 : null;
    if (!msg || msg.length < 15) return false;
    if (!seqEq(msg, 0, ELEKTRON_HEADER_5, 0, 5)) return false;
    return msg[OFF_TYPE] === ID_DUMP;
  }

  function decodeMany(buf){
    const u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf||[]);
    const out = [];
    const n = u8.length;
    for (let i=0;i<=n-6;i++){
      if (!seqEq(u8, i, ELEKTRON_HEADER_5, 0, 5)) continue;
      // C6 0x5D dumps are fixed size; but we'll still guard by checking for F7.
      if (i + MSG_SIZE_BYTES <= n && u8[i + OFF_END] === 0xF7 && u8[i + OFF_TYPE] === ID_DUMP){
        try { out.push(decode(u8.slice(i, i + MSG_SIZE_BYTES))); } catch(_){ /* ignore */ }
        i += MSG_SIZE_BYTES - 1;
      }
    }
    return out;
  }

  function buildRequest(slot, deviceId=0){
    const pos = (slot|0) & 0x3F;
    const dev = (deviceId|0) & 0x7F;
    // Structure used by Elektron: F0 00 20 3C 03 <dev> 5C 01 01 <pos> 00 00 00 00 00 00 F7
    const msg = new Uint8Array([
      0xF0,0x00,0x20,0x3C,0x03,dev,
      ID_REQ,
      0x01,0x01,
      pos,
      0x00,0x00,0x00,0x00,0x00,0x00,
      0xF7
    ]);
    return msg;
  }

  // Optional: coefficient table hook (for exact C6 encoder implementations elsewhere).
  // This codec itself does not use it, but exposing it here is convenient for UI code.
  let C6_COEFF_TABLE = null;
  let C6_COEFF_MAX = 9.14025;
  function setC6CoeffTable(arr){
    const a = (arr instanceof Float64Array) ? arr : new Float64Array(arr||[]);
    if (a.length !== 1024) throw new Error('C6 coeff table must have 1024 entries');
    C6_COEFF_TABLE = new Float64Array(a);
    let m = 0;
    for (let i=0;i<1024;i++){
      const v = Math.abs(C6_COEFF_TABLE[i]);
      if (v > m) m = v;
    }
    C6_COEFF_MAX = m || 1;
    return { max: C6_COEFF_MAX };
  }

  
  // Expose resampler for other modules that call it as a global helper.
  // (ui.js / special-functions.js use resampleU8_AA for length-mismatch safety.)
  if (root.resampleU8_AA == null) root.resampleU8_AA = resampleU8_AA;
root.MMDT_DigiPRO = {
    VERSION,
    ID_DUMP,
    ID_REQ,
    SAMPLES_PER_TABLE,
    TABLE_SIZE_BYTES,
    ENCODED_PAYLOAD_SIZE,
    DECODED_PAYLOAD_SIZE,
    MSG_SIZE_BYTES,

    decode,
    decodeMany,
    encodeSlot6132,
    isWaveDump,

    sevenBitEncode,
    sevenBitDecode,
    buildRequest,

    // raw helpers (useful for tests)
    _unpackRaw6132: unpackRaw6132,
    _packRaw6132: packRaw6132,

    // optional C6 coefficient table store
    setC6CoeffTable,
    get C6_COEFF_TABLE(){ return C6_COEFF_TABLE; },
    get C6_COEFF_MAX(){ return C6_COEFF_MAX; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
