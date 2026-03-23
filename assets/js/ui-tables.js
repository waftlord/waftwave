// DigiPRO UI split: table builder / gain / heat helpers

'use strict';

  // -------------- DigiPRO C6-style table builder (float cycle -> 0x5D slot tables) --------------
  // IMPORTANT: The 0x5D payload is NOT 3 contiguous tables.
  //
  // After 7‑bit decode, the payload is 6132 bytes = 1022 blocks × 6 bytes.
  // Each block contains 3× int16 words (big-endian), with a split middle word:
  //   A0_hi, A0_lo,  B_hi,  A1_hi, A1_lo,  B_lo
  //
  // Our UI/codec represent that as three Int16Array(1022) streams:
  //   t0[i] = A0 (main stream, even samples)
  //   t1[i] = A1 (main stream, odd samples)
  //   t2[i] = B  (secondary stream; 512..4 mip levels + 2 zero terminators)
  //
  // Encoder overview (matches the structure of Elektron C6; coefficient table is optional):
  //   1) DC removal (mean subtraction)
  //   2) resample to 1024 samples
  //   3) FFT(1024), apply C6 quadratic rolloff on bins 351..511, IFFT for peak
  //   4) normalize spectrum by (peak * maxCoeff)
  //   5) build 9 mip levels (1024..4):
  //        - A uses the level spectrum (cropped) with coeff weighting
  //        - B_full uses extra low-pass (bins >= N/4 => 0)
  //        - time-domain scaling by (N/1024)
  //   6) quantize with trunc toward zero: trunc(sample * 32767)
  //
  // If you have extracted the real 1024-entry C6 coefficient table, inject it via:
  //   window.MMDT_DigiPRO.setC6CoeffTable(Float64Array(1024))
  // and this builder will automatically use it.

  const DP_BASE_N = 1024;
  const DP_LEVEL_SIZES = [1024,512,256,128,64,32,16,8,4];

  let _coeffCache = null;
  let _coeffMaxCache = 1;
  function getC6CoeffTable(){
    const dig = window.MMDT_DigiPRO;
    const tbl = dig && dig.C6_COEFF_TABLE;
    if (tbl && tbl.length === 1024){
      if (tbl !== _coeffCache){
        _coeffCache = tbl;
        // Use dig.C6_COEFF_MAX if present, else compute.
        const m = (typeof dig.C6_COEFF_MAX === 'number' && isFinite(dig.C6_COEFF_MAX) && dig.C6_COEFF_MAX>0)
          ? dig.C6_COEFF_MAX
          : (()=>{ let mm=0; for(let i=0;i<1024;i++){ const v=Math.abs(tbl[i]); if(v>mm) mm=v; } return mm||1; })();
        _coeffMaxCache = m;
      }
      return tbl;
    }
    // Default: flat coefficients (≈ “no extra weighting”)
    if (!_coeffCache || _coeffCache.length !== 1024){
      const ones = new Float64Array(1024);
      for (let i=0;i<1024;i++) ones[i]=1;
      _coeffCache = ones;
    }

    // IMPORTANT:
    // C6 normalizes by the *maximum* of its coefficient table (≈9.14025). Even if we don't have the
    // exact per-bin coeff table available, keeping the same max provides the same headroom and
    // prevents “too loud / clipping” uploads compared to C6.
    const fallbackMax = (dig && typeof dig.C6_COEFF_MAX === 'number' && isFinite(dig.C6_COEFF_MAX) && dig.C6_COEFF_MAX > 0)
      ? dig.C6_COEFF_MAX
      : 9.14025;
    _coeffMaxCache = fallbackMax;

    return _coeffCache;
  }
  function getC6CoeffMax(){ getC6CoeffTable(); return _coeffMaxCache || 1; }



  // In-place radix-2 FFT (complex). re/im are Float64Array length power-of-two.


  // Periodic resample of a single-cycle buffer to N samples (t = i/N, wrap-around).
  function resampleCycleFloat(src, N){
    const a = Array.from(src||[]).map(v => +v || 0);
    const M = a.length|0;
    const out = new Float64Array(N);
    if (!M) return out;
    for (let i=0;i<N;i++){
      const x = (i * M) / N;           // [0..M)
      const i0 = Math.floor(x) % M;
      const i1 = (i0 + 1) % M;
      const t  = x - Math.floor(x);
      out[i] = a[i0]*(1-t) + a[i1]*t;
    }
    return out;
  }

  function truncTowardZeroInt16(x){
    const v = Math.max(-1, Math.min(1, x));
    let q = Math.trunc(v * 32767);
    if (q >  32767) q =  32767;
    if (q < -32767) q = -32767;
    return q;
  }

  // Render DigiPRO (0x5D) tables from one cycle.
  //
  // mode:
  //   'c6'   -> C6 parity (normalizes away input amplitude; waves end up same peak)
  //   'clip' -> "Hot" legacy/clip (preserves input amplitude; intended for louder waves)
  //
  // NOTE: clip mode can overload/clip on-device for very loud input.
  // We hard-cap the effective peak used for scaling in clip mode (defaults to 40%),
  // so “hot” uploads can't exceed that level unless you override window.DP_CLIP_MAX_INPEAK.
  function renderTablesFromSingleCycleFloat(cycleF32, mode){
    mode = (String(mode||'c6') === 'clip') ? 'clip' : 'c6';
    // cycleF32: Float32Array or Array of -1..+1 values representing one cycle
    const f = Array.from(cycleF32||[]).map(v => +v || 0);
    if (!f.length){
      const z = new Int16Array(DP_SAMPLES_PER_TABLE);
      return { t0:z, t1:z, t2:z };
    }

    // 1) DC removal (C6 does this before everything else)
    let mean = 0;
    for (let i=0;i<f.length;i++) mean += f[i];
    mean /= f.length || 1;
    for (let i=0;i<f.length;i++) f[i] -= mean;

    // 2) Resample to 1024 (periodic)
    const time = resampleCycleFloat(f, DP_BASE_N);

    // Track input peak (post DC-removal) so we can preserve level through the C6 rolloff.
    let inPeak = 0;
    for (let i=0;i<DP_BASE_N;i++) inPeak = Math.max(inPeak, Math.abs(time[i]));

    // 3) FFT(1024)
    const re = new Float64Array(DP_BASE_N);
    const im = new Float64Array(DP_BASE_N);
    for (let i=0;i<DP_BASE_N;i++) re[i] = time[i];
    fftRadix2(re, im, false);

    // 3b) Quadratic rolloff (C6): bins 351..511 (and symmetric negative bins)
    for (let k=351; k<=511; k++){
      const w = (512 - k) / 162;
      const g = w*w;
      re[k] *= g; im[k] *= g;
      const kn = DP_BASE_N - k;
      re[kn] *= g; im[kn] *= g;
    }
    // Nyquist bin (512) to 0
    re[512] = 0; im[512] = 0;


    // 4) Normalize / level behaviour (this is the piece that controls “C6 parity” vs “hot”).
    //
    // C6 parity:
    //   div = maxabs(postRolloffTime) * coeffMax
    //   => removes input loudness differences; all waves land at the same peak.
    //
    // Hot/clip:
    //   div = (maxabs(postRolloffTime) / inPeak) * coeffMax
    //   => preserves input loudness differences, while keeping C6 headroom at this stage.
    //   A later post-gain (dpGainForMode('clip') == coeffMax) can remove that headroom.
    //
    // Both modes share the same “tiny” guard as C6 (avoid huge amplification for silence).

    const tmpRe = new Float64Array(re);
    const tmpIm = new Float64Array(im);
    fftRadix2(tmpRe, tmpIm, true);
    let peak = 0;
    for (let i=0;i<DP_BASE_N;i++) peak = Math.max(peak, Math.abs(tmpRe[i]));

    const tiny = 1/65536;
    const coeffMax = getC6CoeffMax();

    let div = 1.0;
    if (!isFinite(peak) || peak < tiny){
      // C6: if maxabs is tiny, do not normalize (prevents blowing up near-silence).
      div = 1.0;
    } else if (mode === 'c6'){
      // True C6 parity: removes loudness differences between waves.
      div = peak * coeffMax;
    } else {
      // Hot/clip: preserve loudness differences (so editor normalize amount affects the device).
      // We optionally cap the effective input peak, because in clip mode we later multiply by
      // coeffMax, which can cause audible clipping on-device when the source is too loud.
      let inPeakUsed = inPeak;
      if (!isFinite(inPeakUsed) || inPeakUsed < tiny) inPeakUsed = 0; // keep stable; peak guard above covers silence

      // Default cap (empirical): 40% matches your current observation. Override at runtime:
      //   window.DP_CLIP_MAX_INPEAK = 0.40
      const cap = Number(root.DP_CLIP_MAX_INPEAK);
      const maxInPeak = (isFinite(cap) && cap > 0) ? Math.min(1, cap) : 0.40;
      if (isFinite(inPeakUsed) && inPeakUsed > maxInPeak) inPeakUsed = maxInPeak;

      // peakUnit = post-rolloff peak for a unit-amplitude wave.
      const peakUnit = (inPeakUsed > tiny) ? (peak / inPeakUsed) : 1.0;
      div = peakUnit * coeffMax;
    }
    if (!isFinite(div) || div <= 0) div = 1.0;
    for (let i=0;i<DP_BASE_N;i++){ re[i] /= div; im[i] /= div; }

// 5) Build 9 mip levels into A and B_full
    const coeff = getC6CoeffTable();
    const A = new Float64Array(2044);
    const B = new Float64Array(2044);
    let off = 0;

    for (let li=0; li<DP_LEVEL_SIZES.length; li++){
      const N = DP_LEVEL_SIZES[li]|0;
      const half = N >> 1;
      const divisor = (2048 / N) | 0;      // 2,4,8,...,512
      const scale = N / 1024;              // 1.0, 0.5, ...

      // ---- A level ----
      const lr = new Float64Array(N);
      const lii = new Float64Array(N);
      // DC
      lr[0] = re[0] * coeff[0];
      lii[0]= im[0] * coeff[0];

      for (let k=1; k<half; k++){
        const c = coeff[k * divisor] || 0;
        lr[k] = re[k] * c;
        lii[k]= im[k] * c;
        const bk = DP_BASE_N - k;
        lr[N-k] = re[bk] * c;
        lii[N-k]= im[bk] * c;
      }
      lr[half] = 0; lii[half] = 0; // Nyquist
      fftRadix2(lr, lii, true);
      for (let i=0;i<N;i++) A[off+i] = lr[i] * scale;

      // ---- B_full level (extra low-pass: bins >= N/4 -> 0) ----
      const br = new Float64Array(N);
      const bii = new Float64Array(N);
      br[0] = re[0] * coeff[0];
      bii[0]= im[0] * coeff[0];
      const cutoff = N >> 2;
      for (let k=1; k<half; k++){
        if (k >= cutoff) continue;
        const c = coeff[k * divisor] || 0;
        br[k] = re[k] * c;
        bii[k]= im[k] * c;
        const bk = DP_BASE_N - k;
        br[N-k] = re[bk] * c;
        bii[N-k]= im[bk] * c;
      }
      br[half] = 0; bii[half] = 0;
      fftRadix2(br, bii, true);
      for (let i=0;i<N;i++) B[off+i] = br[i] * scale;

      off += N;
    }

    // 6) Quantize & pack into the 3×1022 streams (A-even, A-odd, B-stream)
    const t0 = new Int16Array(DP_SAMPLES_PER_TABLE);
    const t1 = new Int16Array(DP_SAMPLES_PER_TABLE);
    const t2 = new Int16Array(DP_SAMPLES_PER_TABLE);

    for (let i=0;i<DP_SAMPLES_PER_TABLE;i++){
      const a0 = A[2*i]   || 0;
      const a1 = A[2*i+1] || 0;
      t0[i] = truncTowardZeroInt16(a0);
      t1[i] = truncTowardZeroInt16(a1);

      // transmitted B is B_full[1024..2043] (1020 samples) then 2 zero terminators
      if (i <= 1019){
        t2[i] = truncTowardZeroInt16(B[1024 + i] || 0);
      } else {
        t2[i] = 0;
      }
    }

    return { t0, t1, t2 };
  }

// --- Helpers for strict DigiPRO uploads (always 3×1022 streams) ---
  function u8ToCycleFloat(u8){
    const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    const f = new Float32Array(a.length);
    for (let i=0;i<a.length;i++) f[i] = ((a[i]|0) - 128) / 127;
    return f;
  }
  function ensureTables6132(rec, mode){
    // mode:
    //   'c6'   -> C6 parity tables (normalizes away input amplitude)
    //   'clip' -> "hot" legacy tables (preserve input amplitude; used with post-gain)
    mode = (String(mode||'c6') === 'clip') ? 'clip' : 'c6';
    if (!rec) return null;

    // For parity mode, prefer any device-authentic cached tables.
    if (mode === 'c6'){
      const Td = rec._tables6132;
      if (Td && Td.t0 && Td.t1 && Td.t2 && Td.t0.length === DP_SAMPLES_PER_TABLE){
        return Td;
      }
    }

    const cacheKey = (mode === 'clip') ? '_tables6132_clip' : '_tables6132';
    const T = rec[cacheKey];
    if (T && T.t0 && T.t1 && T.t2 && T.t0.length === DP_SAMPLES_PER_TABLE){
      return T;
    }

    try{
      const src = rec.dataU8 || new Uint8Array(96).fill(128);
      const floats = (rec._srcFloat && rec._srcFloat.length)
        ? (rec._srcFloat instanceof Float32Array ? rec._srcFloat : new Float32Array(rec._srcFloat))
        : u8ToCycleFloat(src);
      const t = renderTablesFromSingleCycleFloat(floats, mode);
      const packed = { t0: t.t0, t1: t.t1, t2: t.t2 }; // Int16Arrays
      rec[cacheKey] = packed;
      return packed;
    }catch(_){
      return null;
    }
  }

  // Tables for DigiPRO *upload*.
  //
  // Why this exists:
  // - For "C6 parity" uploads we want the *normalised* C6-style rendering, even if the
  //   wave was downloaded from a device that currently has "hot"/non-parity table scaling.
  // - For "Hot/clip" uploads we want the legacy loudness-preserving behaviour.
  //
  // We therefore keep a separate cache for upload-normalised tables so we don't
  // accidentally re-send device tables "as-is" when the user expects C6 normalise.
  function dpTables6132ForUpload(rec, mode){
    mode = (String(mode||'c6') === 'clip') ? 'clip' : 'c6';
    if (!rec) return null;

    // Hot/clip uses the legacy builder (preserves input amplitude), then upload applies
    // a post-gain (dpGainForMode) at send time.
    if (mode === 'clip') return ensureTables6132(rec, 'clip');

    // C6 parity uploads should always use a normalised render. Keep a separate cache key.
    const cacheKey = '_tables6132_norm';
    const T = rec[cacheKey];
    if (T && T.t0 && T.t1 && T.t2 && T.t0.length === DP_SAMPLES_PER_TABLE){
      return T;
    }

    try{
      let floats = null;

      // Prefer any higher-resolution import source if present.
      if (rec._srcFloat && rec._srcFloat.length){
        floats = (rec._srcFloat instanceof Float32Array) ? rec._srcFloat : new Float32Array(rec._srcFloat);
      }

      // If the wave came from a device dump we may have full tables; derive a 1024-sample
      // base wave from those tables for better fidelity than the 96-point preview.
      if (!floats && rec._tables6132 && rec._tables6132.t0 && rec._tables6132.t1 && rec._tables6132.t0.length === DP_SAMPLES_PER_TABLE){
        const baseI16 = dpBaseWaveInt16FromTables(rec._tables6132);
        if (baseI16 && baseI16.length === DP_BASE_N){
          floats = new Float32Array(DP_BASE_N);
          for (let i=0;i<DP_BASE_N;i++){
            const v = baseI16[i] || 0;
            // Map int16 to approx [-1,1], clamp for safety.
            let f = v / 32767;
            if (!isFinite(f)) f = 0;
            if (f < -1) f = -1;
            if (f > 1)  f = 1;
            floats[i] = f;
          }
        }
      }

      // Fall back to the editor's 96-point cycle data.
      if (!floats){
        const src = rec.dataU8 || new Uint8Array(96).fill(128);
        floats = u8ToCycleFloat(src);
      }

      const t = renderTablesFromSingleCycleFloat(floats, 'c6');
      const packed = { t0: t.t0, t1: t.t1, t2: t.t2 };
      rec[cacheKey] = packed;
      return packed;
    }catch(_){
      return null;
    }
  }

	// --- DigiPRO gain modes (C6 normalize vs legacy clipping) ---
	//
	// The table builder applies the same headroom behaviour as Elektron C6 by default.
	// We removed the old per-wave "HOT" toggle (Shift+Normalize) because it was easy to
	// lose track of and made the UI confusing.
	//
	// Instead, Shift+Upload and Shift+Export DP-WAV now prompt for a gain mode:
	//   • C6 normalize (safe/headroom)
	//   • Legacy clip (loud; can hard-clip)
	//
	// Keep dpHeatOf() for compatibility with older saved banks, but it is now disabled.
	function dpHeatOf(_rec){ return 1; }

	function dpGainModeLabel(mode){
	  return (mode === 'clip')
	    ? 'Hot / clip (preserve loudness; may clip)'
	    : 'DigiPro format';
	}
	function dpGainForMode(mode){
	  return (mode === 'clip') ? getC6CoeffMax() : 1;
	}
	function dpPromptGainMode(actionLabel, defaultMode){
	  // Returns Promise<'c6'|'clip'|null>
	  actionLabel = String(actionLabel || 'Action');
	  defaultMode = (defaultMode === 'c6' || defaultMode === 'clip') ? defaultMode : 'clip';
	  return new Promise((resolve)=>{
	    const overlay = el('div','mm-digi-guard');
	    const dlg = el('div','dlg');
	    const h = el('h4');
	    h.textContent = `${actionLabel}: gain mode`;

	    const p = el('div','mm-small');
	    p.textContent = 'Choose how DigiPRO tables are scaled for this action:';

	    const p2 = el('div','mm-small');
	    p2.textContent = '• DigiPro format · • Hot/clip (preserve loudness; may clip).';

	    const btns = el('div','btns');
	    const bC6 = el('button');
	    bC6.textContent = 'DigiPro format';
	    const bClip = el('button');
	    bClip.textContent = 'Hot / clip';
	    const bCancel = el('button');
	    bCancel.textContent = 'Cancel';
        bCancel.title = 'Close without changing settings.';

	    if (defaultMode === 'c6') bC6.dataset.default = '1';
	    else bClip.dataset.default = '1';

	    function done(v){ try{ overlay.remove(); }catch(_){} resolve(v); }
	    bC6.onclick = ()=>done('c6');
	    bClip.onclick = ()=>done('clip');
	    bCancel.onclick = ()=>done(null);

	    // Click outside the dialog cancels.
	    overlay.addEventListener('click', (e)=>{ if (e && e.target === overlay) done(null); });

	    btns.append(bC6, bClip, bCancel);
	    dlg.append(h, p, p2, btns);
	    overlay.append(dlg);
	    document.body.appendChild(overlay);
	  });
	}
	function dpScaleInt16(v, g){
	  // Trunc-toward-zero scaling in int16 domain, with hard clip.
	  const x = (v|0) * g;
	  let n = (x >= 0) ? Math.floor(x) : Math.ceil(x);
	  if (n > 32767) n = 32767;
	  if (n < -32768) n = -32768;
	  return n;
	}
	function dpApplyHeatToTables(T, g){
	  if (!T || !T.t0 || !T.t1 || !T.t2) return null;
	  g = +g || 1;
	  if (!isFinite(g) || g <= 0 || Math.abs(g - 1) < 1e-12) return T;
	  const t0 = new Int16Array(T.t0.length);
	  const t1 = new Int16Array(T.t1.length);
	  const t2 = new Int16Array(T.t2.length);
	  for (let i=0;i<t0.length;i++) t0[i] = dpScaleInt16(T.t0[i], g);
	  for (let i=0;i<t1.length;i++) t1[i] = dpScaleInt16(T.t1[i], g);
	  for (let i=0;i<t2.length;i++) t2[i] = dpScaleInt16(T.t2[i], g);
	  return { t0, t1, t2 };
	}


  // ---------------------------------------------------------------------------
  // WAV export helpers
  //
  // We support two different WAV export meanings:
  //   • Plain/UI WAV   — what you see in the editor (best for other samplers/devices)
  //   • Device/parity  — derived from DigiPRO 0x5D tables (best for round‑trip + MonoMachine parity)
  //
  // Plain/UI WAV must NOT be built from the C6‑headroom tables (those are intentionally attenuated),
  // otherwise exports can legitimately look/sound “quiet” compared to the editor display.
  // ---------------------------------------------------------------------------

  function dpPlainWavBytesFromU8(u8, sampleRate){
    // SAFE / purist single-cycle export:
    // - No resampling (points-per-cycle is locked to the buffer length)
    // - No processing (no DC removal, no phase tricks, no smoothing)
    // - Writes a standard WAV 'smpl' loop chunk: start=0, end=N-1
    try{
      const sr = (sampleRate|0) || 44100;
      const bytes = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
      const N = bytes.length|0;
      const extras = (typeof buildSmplLoopChunk === 'function')
        ? [{ id:'smpl', bytes: buildSmplLoopChunk(0, N, sr) }]
        : null;

      if (typeof pcm16WavFromU8 === 'function'){
        return pcm16WavFromU8(bytes, sr, extras);
      }

      // Fallback: convert to int16 and write PCM16 WAV.
      if (typeof pcm16WavFromInt16 === 'function'){
        const pcm = new Int16Array(N);
        for (let i=0;i<N;i++){
          const s = (bytes[i]-128)/127;
          const v = Math.max(-1, Math.min(1, s));
          pcm[i] = Math.round(v * 32767);
        }
        return pcm16WavFromInt16(pcm, sr, extras);
      }
    }catch(_){ }
    return null;
  }

  function dpWavFilenameForSlotMode(slotIdx, name4, deviceParity, clipMode){
    const base = (typeof wavFilenameForSlot === 'function')
      ? wavFilenameForSlot(slotIdx, name4)
      : (`MM-WAVE-${String((slotIdx|0)+1).padStart(2,'0')}-${_alnum4(name4||'WAVE')}.wav`);
    if (!deviceParity) return base;
    return base.replace(/\.wav$/i, clipMode ? '-DP-CLIP.wav' : '-DP.wav');
  }

	function dpBaseWaveInt16FromTables(T){
	  if (!T || !T.t0 || !T.t1 || T.t0.length < 512 || T.t1.length < 512) return null;
	  const out = new Int16Array(1024);
	  for (let i=0;i<512;i++){
	    out[2*i] = T.t0[i]|0;
	    out[2*i+1] = T.t1[i]|0;
	  }
	  return out;
	}

	function dpToggleHotHeatValue(cur){
	  // "HOT" mode intentionally bypasses the C6-style headroom (legacy behaviour).
	  // This can clip, which is the point for users who want extra bite.
	  const hot = getC6CoeffMax();
	  const v = (typeof cur === 'number' && isFinite(cur) && cur > 0) ? cur : 1;
	  return (Math.abs(v - hot) < 1e-6) ? 1 : hot;
	}

	function dpToggleHotOnSelectionOrActive(){
	  const sel = getSelectedSlots();
	  if (sel && sel.length){
	    const before = captureBankState(sel);
	    let changed = 0;
	    for (const s of sel){
	      const w = LIB.waves[s];
	      if (!w && (s !== (EDIT.slot|0))) continue;
	      if (w){
	        w._dpHeat = dpToggleHotHeatValue(w._dpHeat);
	        changed++;
	        if (s === (EDIT.slot|0)) EDIT._dpHeat = w._dpHeat;
	      }else{
	        EDIT._dpHeat = dpToggleHotHeatValue(EDIT._dpHeat);
	        changed++;
	      }
	      paintGridCell(s);
	    }
	    const after = captureBankState(sel);
	    bankPush({ label: 'Toggle HOT gain', before, after });
	    announceIO(`HOT upload gain toggled for ${changed} slot(s). ${changed ? '(Shift+Normalize)' : ''}`);
	    // If the editor slot was affected, refresh the header so the 🔥 indicator updates.
	    try{ if (sel.includes(EDIT.slot|0)) renderEditorBar(); }catch(_){ }
	    updateButtonsState();
	    return;
	  }
	  // No selection: toggle for active slot
	  snapshot('Toggle HOT gain', {force:true});
	  EDIT._dpHeat = dpToggleHotHeatValue(EDIT._dpHeat);
	  if (LIB.waves[EDIT.slot|0]){
	    LIB.waves[EDIT.slot|0]._dpHeat = EDIT._dpHeat;
	    paintGridCell(EDIT.slot|0);
	  }
	  try{ renderEditorBar(); }catch(_){ }
	  announceIO(EDIT._dpHeat > 1 ? 'HOT upload gain enabled (legacy mode; may clip).' : 'HOT upload gain disabled.');
	  updateButtonsState();
	}
