// special-functions.js — math/fft/resample + waveform FX helpers (no DOM)
/* Extracted from the DigiPRO panel code in index_patched_v2.html */
(function(){
  'use strict';
  const root = window;

  if (root.__dpSpecialFunctionsInitOnce) return;
  root.__dpSpecialFunctionsInitOnce = true;

  const DP_FX = root.DP_FX = root.DP_FX || {};

  function _export(name, value){
    if (DP_FX[name] == null) DP_FX[name] = value;
    if (root[name] == null) root[name] = value;
  }

  // Shared clamps (copied verbatim from the original panel where possible)
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
  root._clamp01 = _clamp01;
  root._clampInt = _clampInt;

  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n|0));
  root.clamp = clamp;

  // ---------------------------------------------------------------------------
  // Extracted pure-ish helpers / DSP / naming / FX
  // ---------------------------------------------------------------------------

  function isPow2(n){ return n>0 && (n & (n-1))===0; }

function fftRadix2(re, im, inverse){
    const N = re.length|0;
    if (!isPow2(N) || im.length !== N) throw new Error('fftRadix2: length must be power-of-two');

    // Bit-reversal permutation
    for (let i=1, j=0; i<N; i++){
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j){
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }

    for (let len=2; len<=N; len<<=1){
      const ang = 2*Math.PI/len * (inverse ? 1 : -1);
      const wlenRe = Math.cos(ang);
      const wlenIm = Math.sin(ang);
      const half = len >> 1;
      for (let i=0; i<N; i+=len){
        let wRe = 1, wIm = 0;
        for (let j=0; j<half; j++){
          const uRe = re[i+j], uIm = im[i+j];
          const vRe = re[i+j+half]*wRe - im[i+j+half]*wIm;
          const vIm = re[i+j+half]*wIm + im[i+j+half]*wRe;
          re[i+j] = uRe + vRe;
          im[i+j] = uIm + vIm;
          re[i+j+half] = uRe - vRe;
          im[i+j+half] = uIm - vIm;

          const nwRe = wRe*wlenRe - wIm*wlenIm;
          const nwIm = wRe*wlenIm + wIm*wlenRe;
          wRe = nwRe; wIm = nwIm;
        }
      }
    }

    if (inverse){
      for (let i=0;i<N;i++){ re[i] /= N; im[i] /= N; }
    }
  }

function normalizeFloatArray(src){
    const a = (src instanceof Float32Array || src instanceof Float64Array) ? src : new Float32Array(src||[]);
    const N = a.length|0;
    if (!N) return new Float32Array(0);
    let mean = 0;
    for (let i=0;i<N;i++) mean += a[i];
    mean /= N;
    const out = new Float32Array(N);
    let peak = 0;
    for (let i=0;i<N;i++){
      const v = a[i] - mean;
      out[i] = v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
    }
    if (!isFinite(peak) || peak < 1e-9) peak = 1;
    const inv = 1/peak;
    for (let i=0;i<N;i++) out[i] *= inv;
    return out;
  }

function resampleFloatToU8_AA(srcF, targetLen, taps=16){
    const src = (srcF instanceof Float32Array || srcF instanceof Float64Array) ? srcF : new Float32Array(srcF||[]);
    const N = src.length|0;
    const M = targetLen|0;
    const out = new Uint8Array(M > 0 ? M : 0);
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
      const v = acc / taps; // expected ≈ [-1..1]
      out[i] = clamp(Math.round(v*127 + 128), 0, 255);
    }
    return out;
  }

function dftRealU8(u8){
  const N = u8.length;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let k=0;k<N;k++){
    let rk = 0, ik = 0;
    for (let n=0;n<N;n++){
      const x = ((u8[n]|0) - 128) / 127;               // [-1..1]
      const ang = 2*Math.PI*k*n/N;
      rk += x * Math.cos(ang);
      ik -= x * Math.sin(ang);                          // e^{-iθ}
    }
    re[k]=rk; im[k]=ik;
  }
  return { re, im };
}

function idftToU8(re, im){
  const N = re.length;
  const outF = new Float64Array(N);
  for (let n=0;n<N;n++){
    let x = 0;
    for (let k=0;k<N;k++){
      const ang = 2*Math.PI*k*n/N;
      x +=  re[k]*Math.cos(ang) - im[k]*Math.sin(ang);  // e^{+iθ}
    }
    outF[n] = x / N;
  }
  // normalize: remove DC, scale to full range
  let mean=0; for (let i=0;i<N;i++) mean+=outF[i]; mean/=N;
  let peak=0; for (let i=0;i<N;i++){ const a=Math.abs(outF[i]-mean); if(a>peak) peak=a; }
  if (peak < 1e-9) peak = 1;
  const out = new Uint8Array(N);
  for (let i=0;i<N;i++){
    const y = (outF[i]-mean)/peak;                      // [-1..1]
    out[i] = Math.max(0, Math.min(255, Math.round(y*127 + 128)));
  }
  return out;
}

// Fourier-series periodic resampling (single-cycle safe)
//
// This treats the input buffer as one period of a periodic signal and evaluates
// its Fourier series on a new grid of `targetLen` samples. This avoids
// endpoint/interpolation artifacts that commonly cause loop clicks when
// resampling naive single-cycle waves.
//
// Notes:
// - This is intentionally written to work with non power-of-two lengths (e.g. 96).
// - For downsampling (targetLen < srcLen) we band-limit by truncating harmonics
//   beyond Nyquist of the target grid.
function dftRealFloat(srcF){
  const src = (srcF instanceof Float32Array || srcF instanceof Float64Array) ? srcF : new Float32Array(srcF||[]);
  const N = src.length|0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  if (!N) return { re, im };
  for (let k=0;k<N;k++){
    let rk = 0, ik = 0;
    for (let n=0;n<N;n++){
      const x = Number(src[n]);
      const ang = 2*Math.PI*k*n/N;
      rk += x * Math.cos(ang);
      ik -= x * Math.sin(ang); // e^{-iθ}
    }
    re[k]=rk; im[k]=ik;
  }
  return { re, im };
}

function periodicResampleFloatFFT(srcF, targetLen){
  const src = (srcF instanceof Float32Array || srcF instanceof Float64Array) ? srcF : new Float32Array(srcF||[]);
  const N = src.length|0;
  const M = targetLen|0;
  if (!N || M <= 0) return new Float32Array(0);
  if (M === N){
    return (src instanceof Float32Array) ? new Float32Array(src) : Float32Array.from(src);
  }

  const { re, im } = dftRealFloat(src);

  // Band-limit when downsampling to prevent harmonic foldover.
  const Hsrc = Math.floor(N/2);
  const Hdst = Math.floor(M/2);
  const H = Math.min(Hsrc, Hdst);

  const out = new Float32Array(M);
  for (let m=0;m<M;m++){
    let x = 0;
    for (let k=0;k<N;k++){
      const harm = (k <= Hsrc) ? k : (k - N);
      if (Math.abs(harm) > H) continue;
      const ang = 2*Math.PI*harm*m/M;
      x += re[k]*Math.cos(ang) - im[k]*Math.sin(ang);
    }
    out[m] = x / N;
  }
  return out;
}

function enforceConjugateSym(re, im){
  const N=re.length, H=N>>1;
  im[0]=0;
  if ((N&1)===0) im[H]=0;                               // Nyquist bin real
  for (let k=1;k<H;k++){                                // copy positive side → negative
    re[N-k] =  re[k];
    im[N-k] = -im[k];
  }
}

function spectralApplyU8(srcU8, mutator){
  // Same as spectralApply, but operates on an explicit u8 cycle (does not touch EDIT).
  const { re, im } = dftRealU8(srcU8);
  const N = re.length, H=N>>1;
  mutator(re, im, N, H);
  enforceConjugateSym(re, im);
  return idftToU8(re, im);
}

function dpBlendU8(a, b, t){
      const N = a.length|0;
      const out = new Uint8Array(N);
      const w = _clamp01(Number(t||0));
      const iw = 1 - w;
      for (let i=0;i<N;i++){
        out[i] = clamp(Math.round((a[i]*iw) + (b[i]*w)), 0, 255);
      }
      return out;
    }

function dpCloneU8(src){
      return (src instanceof Uint8Array) ? new Uint8Array(src) : new Uint8Array(src||[]);
    }

function dpU8ToNormFloat(srcU8){
      const src = (srcU8 instanceof Uint8Array) ? srcU8 : new Uint8Array(srcU8||[]);
      const N = src.length|0;
      const out = new Float32Array(N);
      for (let i=0;i<N;i++) out[i] = ((src[i]|0) - 128) / 127;
      return out;
    }

function dpNormFloatToU8(srcF){
      const src = (srcF instanceof Float32Array || srcF instanceof Float64Array) ? srcF : new Float32Array(srcF||[]);
      const N = src.length|0;
      const out = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const v = Math.max(-1, Math.min(1, Number(src[i]) || 0));
        out[i] = clamp(Math.round(v * 127 + 128), 0, 255);
      }
      return out;
    }

function dpSamplePeriodicFloat(srcF, phase){
      const src = (srcF instanceof Float32Array || srcF instanceof Float64Array) ? srcF : new Float32Array(srcF||[]);
      const N = src.length|0;
      if (!N) return 0;
      let p = Number(phase) || 0;
      p = p - Math.floor(p);
      let x = p * N;
      if (x >= N) x = 0;
      const i0 = x|0;
      const i1 = (i0 + 1) % N;
      const frac = x - i0;
      return src[i0] * (1 - frac) + src[i1] * frac;
    }

function dpSimpleWavefoldU8(srcU8, amount){
      const src = (srcU8 instanceof Uint8Array) ? srcU8 : new Uint8Array(srcU8||[]);
      const N = src.length|0;
      const amt = _clamp01(Number(amount||0));
      if (!N || amt <= 1e-6) return dpCloneU8(src);

      const drive = 1 + amt * 4.6;
      const thr = 0.92 - amt * 0.54;
      const clipDrive = 1 + amt * 0.55;
      const clipNorm = Math.tanh(clipDrive) || 1;
      const out = new Uint8Array(N);

      function fold(x){
        let y = x * drive;
        while (y > thr || y < -thr){
          y = (y > thr) ? (2 * thr - y) : (-2 * thr - y);
        }
        return Math.tanh(y * clipDrive) / clipNorm;
      }

      for (let i=0;i<N;i++){
        const s = ((src[i]|0) - 128) / 127;
        out[i] = clamp(Math.round(fold(s) * 127 + 128), 0, 255);
      }
      return out;
    }

function dpSimpleSkewU8(srcU8, amount){
      const src = (srcU8 instanceof Uint8Array) ? srcU8 : new Uint8Array(srcU8||[]);
      const N = src.length|0;
      const amt = Math.max(-1, Math.min(1, Number(amount||0)));
      if (!N || Math.abs(amt) <= 1e-6) return dpCloneU8(src);

      const curve = 1 + Math.abs(amt) * 2.4;
      const srcF = dpU8ToNormFloat(src);
      const outF = new Float32Array(N);
      for (let i=0;i<N;i++){
        const t = i / Math.max(1, N);
        const q = (amt < 0)
          ? Math.pow(t, curve)
          : (1 - Math.pow(1 - t, curve));
        outF[i] = dpSamplePeriodicFloat(srcF, q);
      }
      return dpNormFloatToU8(outF);
    }

function dpSimpleSaturateU8(srcU8, amount){
      const src = (srcU8 instanceof Uint8Array) ? srcU8 : new Uint8Array(srcU8||[]);
      const N = src.length|0;
      const amt = _clamp01(Number(amount||0));
      if (!N || amt <= 1e-6) return dpCloneU8(src);

      const drive = 1 + amt * 8.5;
      const norm = Math.tanh(drive) || 1;
      const out = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const s = ((src[i]|0) - 128) / 127;
        const y = Math.tanh(s * drive) / norm;
        out[i] = clamp(Math.round(y * 127 + 128), 0, 255);
      }
      return out;
    }

function dpSimpleCrushU8(srcU8, amount){
      const src = (srcU8 instanceof Uint8Array) ? srcU8 : new Uint8Array(srcU8||[]);
      const N = src.length|0;
      const amt = _clamp01(Number(amount||0));
      if (!N || amt <= 1e-6) return dpCloneU8(src);

      const bits = Math.max(2, Math.round(8 - (amt * 6)));
      const levels = 1 << bits;
      const mix = amt;
      const out = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const dry = src[i]|0;
        const s = dry / 255;
        const q = Math.round(s * (levels - 1)) / (levels - 1);
        const wet = Math.round(q * 255);
        out[i] = clamp(Math.round((dry * (1 - mix)) + (wet * mix)), 0, 255);
      }
      return out;
    }

function dpSimpleToneU8(srcU8, amount){
      const src = (srcU8 instanceof Uint8Array) ? srcU8 : new Uint8Array(srcU8||[]);
      const amt = Math.max(-1, Math.min(1, Number(amount||0)));
      if (!src.length || Math.abs(amt) <= 1e-6) return dpCloneU8(src);
      return spectralApplyU8(src, (re, im, N, H)=>specTilt(re, im, N, H, amt * 0.42));
    }

function dpAngleLerp(a, b, t){
      const mix = _clamp01(Number(t||0));
      const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
      return a + (d * mix);
    }

function dpSimpleSpectralBlendCoreU8(baseU8, targetU8, amount, opts){
      const base = (baseU8 instanceof Uint8Array) ? baseU8 : new Uint8Array(baseU8||[]);
      const target = (targetU8 instanceof Uint8Array) ? targetU8 : new Uint8Array(targetU8||[]);
      const mix = _clamp01(Number(amount||0));
      if (!base.length || !target.length || base.length !== target.length) return dpCloneU8(target);
      if (mix <= 1e-6) return dpCloneU8(target);

      const cfg = (opts && typeof opts === 'object') ? opts : {};
      const A = dftRealU8(base);
      const B = dftRealU8(target);
      const N = A.re.length|0;
      const H = N >> 1;
      const re = new Float64Array(N);
      const im = new Float64Array(N);

      const magMix = _clamp01((typeof cfg.magMix === 'function') ? cfg.magMix(mix) : (cfg.magMix == null ? mix : cfg.magMix));
      const phaseMix = _clamp01((typeof cfg.phaseMix === 'function') ? cfg.phaseMix(mix) : (cfg.phaseMix == null ? mix : cfg.phaseMix));
      const dcMix = _clamp01((typeof cfg.dcMix === 'function') ? cfg.dcMix(mix) : (cfg.dcMix == null ? magMix : cfg.dcMix));
      const nyquistMix = _clamp01((typeof cfg.nyquistMix === 'function') ? cfg.nyquistMix(mix) : (cfg.nyquistMix == null ? magMix : cfg.nyquistMix));

      re[0] = (A.re[0] * (1 - dcMix)) + (B.re[0] * dcMix);
      im[0] = 0;
      if ((N & 1) === 0){
        re[H] = (A.re[H] * (1 - nyquistMix)) + (B.re[H] * nyquistMix);
        im[H] = 0;
      }

      for (let k=1;k<H;k++){
        const ma = Math.hypot(A.re[k], A.im[k]);
        const mb = Math.hypot(B.re[k], B.im[k]);
        const pa = Math.atan2(A.im[k], A.re[k]);
        const pb = Math.atan2(B.im[k], B.re[k]);
        const mag = (ma * (1 - magMix)) + (mb * magMix);
        const ph = dpAngleLerp(pa, pb, phaseMix);
        re[k] = mag * Math.cos(ph);
        im[k] = mag * Math.sin(ph);
      }

      enforceConjugateSym(re, im);
      return idftToU8(re, im);
    }

function dpSimpleSpectralMorphU8(baseU8, targetU8, amount){
      return dpSimpleSpectralBlendCoreU8(baseU8, targetU8, amount, {
        magMix: (mix)=>0.58 + (mix * 0.42),
        phaseMix: (mix)=>0.18 + (mix * 0.52),
        dcMix: (mix)=>mix,
        nyquistMix: (mix)=>mix
      });
    }

function dpSimpleEqualPowerMorphU8(baseU8, targetU8, amount){
      const base = (baseU8 instanceof Uint8Array) ? baseU8 : new Uint8Array(baseU8||[]);
      const target = (targetU8 instanceof Uint8Array) ? targetU8 : new Uint8Array(targetU8||[]);
      const mix = _clamp01(Number(amount||0));
      if (!base.length || !target.length || base.length !== target.length) return dpCloneU8(target);
      if (mix <= 1e-6) return dpCloneU8(target);

      const N = base.length|0;
      const baseF = dpU8ToNormFloat(base);
      const targetF = dpU8ToNormFloat(target);
      const theta = mix * Math.PI * 0.5;
      const dry = Math.cos(theta);
      const wet = Math.sin(theta);
      const outF = new Float32Array(N);
      let peak = 0;

      for (let i=0;i<N;i++){
        const y = (baseF[i] * dry) + (targetF[i] * wet);
        outF[i] = y;
        const ay = Math.abs(y);
        if (ay > peak) peak = ay;
      }
      if (peak > 1.000001){
        const inv = 1 / peak;
        for (let i=0;i<N;i++) outF[i] *= inv;
      }
      return dpNormFloatToU8(outF);
    }

function dpSimpleMagnitudeOnlyMorphU8(baseU8, targetU8, amount){
      return dpSimpleSpectralBlendCoreU8(baseU8, targetU8, amount, {
        magMix: (mix)=>mix,
        phaseMix: 0,
        dcMix: (mix)=>mix,
        nyquistMix: (mix)=>mix
      });
    }

function dpSimplePhaseOnlyMorphU8(baseU8, targetU8, amount){
      return dpSimpleSpectralBlendCoreU8(baseU8, targetU8, amount, {
        magMix: 0,
        phaseMix: (mix)=>mix,
        dcMix: 0,
        nyquistMix: 0
      });
    }

function dpSimplePhaseWarpMorphU8(baseU8, targetU8, amount){
      const base = (baseU8 instanceof Uint8Array) ? baseU8 : new Uint8Array(baseU8||[]);
      const target = (targetU8 instanceof Uint8Array) ? targetU8 : new Uint8Array(targetU8||[]);
      const mix = _clamp01(Number(amount||0));
      if (!base.length || !target.length || base.length !== target.length) return dpCloneU8(target);
      if (mix <= 1e-6) return dpCloneU8(target);

      const N = base.length|0;
      const baseF = dpU8ToNormFloat(base);
      const targetF = dpU8ToNormFloat(target);
      const warpGuide = new Float32Array(N);
      for (let i=0;i<N;i++){
        warpGuide[i] = (
          targetF[(i - 1 + N) % N] +
          targetF[i] +
          targetF[(i + 1) % N]
        ) / 3;
      }

      const depth = 0.018 + (mix * 0.11);
      const warpBlend = 0.22 + (mix * 0.58);
      const out = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const p = i / Math.max(1, N);
        const warped = dpSamplePeriodicFloat(baseF, p + (warpGuide[i] * depth));
        const y = (targetF[i] * (1 - warpBlend)) + (warped * warpBlend);
        out[i] = clamp(Math.round(Math.max(-1, Math.min(1, y)) * 127 + 128), 0, 255);
      }
      return out;
    }


// ---------------------------------------------------------------------------
// Phase / seam helpers (for clickless chain playback)
// ---------------------------------------------------------------------------

function dpRotateU8(u8, shift){
  // Circularly rotate a single-cycle u8 buffer so output[0] = input[shift].
  const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
  const N = a.length|0;
  if (!N) return new Uint8Array(0);
  let s = shift|0;
  s = ((s % N) + N) % N;
  if (s === 0) return new Uint8Array(a);
  const out = new Uint8Array(N);
  for (let i=0;i<N;i++) out[i] = a[(i + s) % N];
  return out;
}

function dpFindBestRisingZCIndexU8(u8, opts){
  // Find a good "rising zero-cross" cut point (prev <= baseline && cur > baseline),
  // picking the crossing with the smallest absolute distance to the baseline.
  // If none exists, fall back to the sample closest to the baseline.
  const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
  const N = a.length|0;
  if (N < 2) return 0;

  opts = opts || {};
  const baselineMode = (opts.baseline === '128') ? '128' : 'mean';

  let base = 128;
  if (baselineMode === 'mean'){
    let m = 0;
    for (let i=0;i<N;i++) m += (a[i]|0);
    base = m / N;
  }

  let bestI = 0;
  let bestScore = Infinity;
  for (let i=0;i<N;i++){
    const p = (a[(i - 1 + N) % N] - base);
    const c = (a[i] - base);
    if (p <= 0 && c > 0){
      // Prefer the crossing that happens closest to the baseline (smallest magnitude either side).
      const s = Math.max(Math.abs(p), Math.abs(c));
      if (s < bestScore){
        bestScore = s;
        bestI = i;
      }
    }
  }
  if (bestScore < Infinity) return bestI|0;

  // Fallback: no rising cross (e.g. unipolar wave). Choose the sample closest to baseline.
  bestI = 0;
  bestScore = Infinity;
  for (let i=0;i<N;i++){
    const d = Math.abs((a[i]|0) - base);
    if (d < bestScore){
      bestScore = d;
      bestI = i;
    }
  }
  return bestI|0;
}

function dpRotateToRisingZC_U8(u8, opts){
  const idx = dpFindBestRisingZCIndexU8(u8, opts);
  return dpRotateU8(u8, idx);
}

function dpSeamMatchRotationsU8(list, opts){
  // Compute per-cycle circular rotations to minimize boundary discontinuities
  // between consecutive cycles in a "packed chain" playback.
  //
  // Returns an Int32Array of rotations r[i] where rotation means:
  //   out[i][0] = in[i][r[i]]
  //
  // Options:
  //   loop: include last->first boundary in optimization (treat as cyclic chain)
  //   slope: 0..1 weight for matching boundary slope in addition to boundary value (default 0)
  const waves = Array.isArray(list) ? list : [];
  const K = waves.length|0;
  if (K <= 0) return new Int32Array(0);
  if (K === 1) return new Int32Array([0]);

  opts = opts || {};
  const loop = !!opts.loop;
  let slopeW = Number(opts.slope);
  if (!isFinite(slopeW) || slopeW < 0) slopeW = 0;
  if (slopeW > 1) slopeW = 1;
  const SLOPE_SCALE = 0.25; // keep slope as a "secondary" preference

  // Precompute boundary lookup tables per wave for fast scoring.
  const meta = new Array(K);
  for (let i=0;i<K;i++){
    let u8 = waves[i];
    u8 = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
    const N = u8.length|0;
    if (N <= 0){
      meta[i] = { N:0, start:null, end:null, startSlope:null, endSlope:null };
      continue;
    }
    const start = new Uint16Array(N);
    const end = new Uint16Array(N);
    const startSlope = new Int16Array(N);
    const endSlope = new Int16Array(N);
    for (let r=0;r<N;r++){
      const i0 = r;
      const i1 = (r + 1) % N;
      const im1 = (r - 1 + N) % N;
      const im2 = (r - 2 + N) % N;
      const v0 = (u8[i0]|0);
      const v1 = (u8[i1]|0);
      const vm1 = (u8[im1]|0);
      const vm2 = (u8[im2]|0);
      start[r] = v0;
      end[r] = vm1;
      startSlope[r] = (v1 - v0);
      endSlope[r] = (vm1 - vm2);
    }
    meta[i] = { N, start, end, startSlope, endSlope };
  }

  // Helper: transition cost from prev wave rotation rp -> cur wave rotation rc
  function edgeCost(iPrev, rp, iCur, rc){
    const A = meta[iPrev], B = meta[iCur];
    let c = Math.abs((A.end[rp]|0) - (B.start[rc]|0));
    if (slopeW > 0){
      c += (slopeW * SLOPE_SCALE) * Math.abs((A.endSlope[rp]|0) - (B.startSlope[rc]|0));
    }
    return c;
  }

  // Non-looping Viterbi/DP.
  function solveForward(fixedR0){
    // fixedR0: if number, constrain wave0 rotation to that value (others free)
    const back = new Array(K);

    // init
    let dpPrev = new Float64Array(meta[0].N || 1);
    if (typeof fixedR0 === 'number'){
      const N0 = meta[0].N|0;
      dpPrev = new Float64Array(N0 || 1);
      for (let r=0;r<N0;r++) dpPrev[r] = (r === (fixedR0|0)) ? 0 : Infinity;
    } else {
      // Unconstrained start: cost 0 for all rotations
      for (let r=0;r<dpPrev.length;r++) dpPrev[r] = 0;
    }

    // forward
    for (let i=1;i<K;i++){
      const Nprev = meta[i-1].N|0;
      const Ncur  = meta[i].N|0;
      const dpCur = new Float64Array(Ncur || 1);
      const bptr = new Int32Array(Ncur || 1);

      for (let rc=0; rc<Ncur; rc++){
        let best = Infinity;
        let bestRp = 0;
        for (let rp=0; rp<Nprev; rp++){
          const v = dpPrev[rp] + edgeCost(i-1, rp, i, rc);
          if (v < best){
            best = v;
            bestRp = rp;
          }
        }
        dpCur[rc] = best;
        bptr[rc] = bestRp|0;
      }
      back[i] = bptr;
      dpPrev = dpCur;
    }

    // pick best end rotation
    let endR = 0;
    let bestEnd = Infinity;
    for (let r=0;r<dpPrev.length;r++){
      const v = dpPrev[r];
      if (v < bestEnd){
        bestEnd = v;
        endR = r;
      }
    }

    // backtrack
    const rots = new Int32Array(K);
    rots[K-1] = endR|0;
    for (let i=K-1;i>=1;i--){
      const bptr = back[i];
      rots[i-1] = (bptr && bptr.length) ? (bptr[rots[i]]|0) : 0;
    }
    // enforce fixed start (if requested)
    if (typeof fixedR0 === 'number') rots[0] = fixedR0|0;

    return { rots, cost: bestEnd };
  }

  // Loop-safe solve: brute-force the start state (N0<=96 typical).
  if (loop && (meta[0].N|0) > 0){
    const N0 = meta[0].N|0;
    let bestTotal = Infinity;
    let bestRots = null;

    for (let r0=0; r0<N0; r0++){
      const sol = solveForward(r0);
      const rots = sol.rots;
      // Close the loop: cost from last->first.
      const last = K-1;
      const close = edgeCost(last, rots[last], 0, rots[0]);
      const total = sol.cost + close;
      if (total < bestTotal){
        bestTotal = total;
        bestRots = rots;
      }
    }
    return bestRots || new Int32Array(K);
  }

  // Non-loop: unconstrained start
  return solveForward(null).rots;
}

function dpCosSim(a,b){
      const L = Math.min(a.length, b.length);
      let dot=0;
      for (let i=0;i<L;i++) dot += a[i]*b[i];
      return dot;
    }

function dpMorphGenerate(aU8, bU8, t, modeId){
      // Generates a single in-between cycle from wave A → wave B.
      const tt = _clamp01(Number(t||0));
      const ease = (x)=>{ x=_clamp01(x); return x*x*(3-2*x); };
      const w = ease(tt);

      const a = (aU8 instanceof Uint8Array) ? aU8 : new Uint8Array(aU8||[]);
      let b = (bU8 instanceof Uint8Array) ? bU8 : new Uint8Array(bU8||[]);
      const N = a.length|0;
      if (!N) return new Uint8Array(0);
      // Resample B to A's length when needed.
      if (b.length !== N){
        if (typeof resampleU8_AA === 'function'){
          b = resampleU8_AA(b, N, 16);
        } else {
          const tmp = new Uint8Array(N);
          const M = (b.length|0) || 1;
          for (let i=0;i<N;i++) tmp[i] = b[Math.floor(i*M/N)] || 128;
          b = tmp;
        }
      }
      // If the resampler couldn't produce the expected length (e.g. empty input), fall back to a flat cycle.
      if (b.length !== N){
        const tmp = new Uint8Array(N);
        tmp.fill(128);
        b = tmp;
      }

      modeId = String(modeId || '');

      // Ensure exact endpoints for all modes.
      // (Important for band-sweep / overlay modes that aren't a pure linear blend.)
      if (tt <= 0) return new Uint8Array(a);
      if (tt >= 1) return new Uint8Array(b);

      // Alias: treat a direct 'pm' request as a plain crossfade. (Caller usually handles PM separately.)
      if (modeId === 'pm') modeId = 'xfade';

      // Recipe-based morph modes: reuse the single-wave Evolve recipes as *mid-series* shaping
      // layered on top of a standard time crossfade.
      // This keeps the ends close to the endpoints while still giving lots of extra "morph flavors".
      const _morphRecipeIds = {
        smoothfold:1,
        spectral:1,
        specsmear:1,
        combform:1,
        oddeven:1,
        amsweep:1,
        unison:1,
        pwm:1,
        phasewarp:1,
        phasecoil:1,
        phasewarp_asym:1,
        phasewarp_odd:1,
        phasefold:1,
        phasequant:1,
        formant:1,
        formantdrift:1,
        phasespray:1,
        binswap:1,
        harmswap:1,
        altdensity:1,
        pdwarp:1,
        pdint:1,
        cheby:1,
        asymbend:1,
        harmrotate:1,
        gatescan:1,
        hardsync:1,
        hardsync2:1,
        harmwarp:1,
        harmstretch:1,
        phasestep:1,
        seeded:1,
      };
      if (_morphRecipeIds[modeId]){
        const base = dpBlendU8(a, b, w);
        // Triangle 0..1..0 (max at midpoint), then smooth.
        let mid = 1 - Math.abs(2*tt - 1);
        mid = ease(mid);
        const shaped = dpEvolveGenerate(base, mid, modeId);
        return dpBlendU8(base, shaped, mid);
      }

      if (modeId === 'xfade'){
        return dpBlendU8(a, b, w);
      }

      // Time-domain waveshaper morph: use B as a transfer curve to shape A,
      // then blend shaped(A,B) toward B so endpoints remain exact.
      if (modeId === 'waveshape' || modeId === 'wshape'){
        const shaped = new Uint8Array(N);
        const NN1 = Math.max(1, N - 1);
        for (let i=0;i<N;i++){
          // Map amplitude (0..255) into curve index (0..N-1).
          const x = (a[i] / 255) * NN1;
          const i0 = x | 0;
          const frac = x - i0;
          const i1 = (i0 + 1 <= NN1) ? (i0 + 1) : NN1;
          const y = (b[i0] * (1 - frac)) + (b[i1] * frac);
          shaped[i] = clamp(Math.round(y), 0, 255);
        }
        if (tt < 0.5){
          const u = ease(tt * 2);
          return dpBlendU8(a, shaped, u);
        }
        const u = ease((tt - 0.5) * 2);
        return dpBlendU8(shaped, b, u);
      }

      // Ring modulation morph: multiply A and B (around zero), peak at midpoint.
      // Uses a 2-stage path so endpoints remain exact.
      if (modeId === 'ring'){
        const ringF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const aa = (a[i]-128)/127;
          const bb = (b[i]-128)/127;
          const y = aa*bb;
          ringF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);
        let peak = 0;
        for (let i=0;i<N;i++){
          ringF[i] -= mean;
          peak = Math.max(peak, Math.abs(ringF[i]));
        }
        const inv = (peak > 1e-9) ? (1/peak) : 0;
        const ring = new Uint8Array(N);
        for (let i=0;i<N;i++){
          ring[i] = clamp(Math.round((ringF[i]*inv)*127 + 128), 0, 255);
        }

        if (tt < 0.5){
          const u = ease(tt * 2);
          return dpBlendU8(a, ring, u);
        }
        const u = ease((tt - 0.5) * 2);
        return dpBlendU8(ring, b, u);
      }

      // Ring-derived warp (NOT plain multiply): use the ring product (A×B) as a *phase/time*
      // modulator around the midpoint:
      //   φ′ = φ + (A×B)·depth
      // This tends to feel smoother/more “intentional” than straight ring-mod while still
      // producing rich upper partial motion.
      if (modeId === 'ringwarp'){
        // Base crossfade (fast). We then warp its phase using the ring product as a modulator.
        const base = dpBlendU8(a, b, w);

        // Midpoint strength: 0 at ends, 1 at midpoint.
        let mid = 1 - Math.abs(2*tt - 1);
        mid = ease(mid);

        // Build a normalized ring modulator in [-1..1].
        const modF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const aa = (a[i]-128)/127;
          const bb = (b[i]-128)/127;
          const y = aa*bb;
          modF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);
        let peak = 0;
        for (let i=0;i<N;i++){
          modF[i] -= mean;
          peak = Math.max(peak, Math.abs(modF[i]));
        }
        const inv = (peak > 1e-9) ? (1/peak) : 0;

        // Depth in *cycles*. Clamp to avoid unstable/aliasy extremes in small tables.
        const depth = Math.min(0.28, 0.10 + 0.18*mid);

        // Sample base with phase modulation.
        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = (base[i]-128)/127;
        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const warpedF = new Float32Array(N);
        let wMean = 0;
        for (let i=0;i<N;i++){
          const p = i / N;
          const m = modF[i] * inv;
          const q = (p + depth * m) % 1;
          const y = sample(q);
          warpedF[i] = y;
          wMean += y;
        }
        wMean /= Math.max(1, N);
        let wPeak = 0;
        for (let i=0;i<N;i++) wPeak = Math.max(wPeak, Math.abs(warpedF[i] - wMean));

        // If the warp collapsed (very rare), fall back to the base crossfade.
        if (!(wPeak > 1e-9)){
          try{ return fxNormalizeTo(base, 100); }catch(_){ return base; }
        }

        const sc = 0.98 / wPeak;
        const warped = new Uint8Array(N);
        for (let i=0;i<N;i++){
          const y = (warpedF[i] - wMean) * sc;
          warped[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }

        // Blend in the warp around the midpoint, then DC-correct + peak-normalize.
        let out = dpBlendU8(base, warped, mid);
        try{ out = fxNormalizeTo(out, 100); }catch(_){ }
        return out;
      }

      // Bitwise morph flavors: XOR/AND/OR.
      // Uses a 2-stage path so endpoints remain exact.
      if (modeId === 'xor' || modeId === 'and' || modeId === 'or'){
        let mid = new Uint8Array(N);
        for (let i=0;i<N;i++){
          const aa = a[i] | 0;
          const bb = b[i] | 0;
          let v = 0;
          if (modeId === 'xor') v = aa ^ bb;
          else if (modeId === 'and') v = aa & bb;
          else v = aa | bb;
          mid[i] = v & 255;
        }
        // Normalize midpoint to keep DC/level sane.
        try{ mid = fxNormalizeTo(mid, 100); }catch(_){ }

        if (tt < 0.5){
          const u = ease(tt * 2);
          return dpBlendU8(a, mid, u);
        }
        const u = ease((tt - 0.5) * 2);
        return dpBlendU8(mid, b, u);
      }

      // FFT-backed modes (N=96 => cheap enough to do in JS).
      const dA = dftRealU8(a);
      const dB = dftRealU8(b);
      const re = new Float64Array(dA.re.length);
      const im = new Float64Array(dA.im.length);
      const NN = re.length, H = NN>>1;

      if (modeId === 'magA_phaseB' || modeId === 'magB_phaseA')
      {
        // Spectral cross-synthesis: swap magnitude/phase, using a 2-stage path so
        // t=0 returns A and t=1 returns B exactly.
        const wrapPi = (x)=>{
          x = (x + Math.PI) % (2*Math.PI);
          if (x < 0) x += 2*Math.PI;
          return x - Math.PI;
        };
        const lerpPhase = (pa, pb, t)=>{
          const d = wrapPi(pb - pa);
          return pa + d * t;
        };

        // DC + Nyquist: standard blend to avoid mean jumps.
        re[0] = dA.re[0]*(1-w) + dB.re[0]*w;
        im[0] = 0;
        re[H] = dA.re[H]*(1-w) + dB.re[H]*w;
        im[H] = 0;

        if (modeId === 'magA_phaseB'){
          if (tt < 0.5){
            const u = ease(tt*2);
            for (let k=1;k<H;k++){
              const magA = Math.hypot(dA.re[k], dA.im[k]);
              const phA  = Math.atan2(dA.im[k], dA.re[k]);
              const phB  = Math.atan2(dB.im[k], dB.re[k]);
              const ph   = lerpPhase(phA, phB, u);
              re[k] = magA * Math.cos(ph);
              im[k] = magA * Math.sin(ph);
            }
          } else {
            const u = ease((tt-0.5)*2);
            for (let k=1;k<H;k++){
              const magA = Math.hypot(dA.re[k], dA.im[k]);
              const magB = Math.hypot(dB.re[k], dB.im[k]);
              const phB  = Math.atan2(dB.im[k], dB.re[k]);
              const mag  = magA*(1-u) + magB*u;
              re[k] = mag * Math.cos(phB);
              im[k] = mag * Math.sin(phB);
            }
          }
        } else { // magB_phaseA
          if (tt < 0.5){
            const u = ease(tt*2);
            for (let k=1;k<H;k++){
              const magA = Math.hypot(dA.re[k], dA.im[k]);
              const magB = Math.hypot(dB.re[k], dB.im[k]);
              const phA  = Math.atan2(dA.im[k], dA.re[k]);
              const mag  = magA*(1-u) + magB*u;
              re[k] = mag * Math.cos(phA);
              im[k] = mag * Math.sin(phA);
            }
          } else {
            const u = ease((tt-0.5)*2);
            for (let k=1;k<H;k++){
              const magB = Math.hypot(dB.re[k], dB.im[k]);
              const phA  = Math.atan2(dA.im[k], dA.re[k]);
              const phB  = Math.atan2(dB.im[k], dB.re[k]);
              const ph   = lerpPhase(phA, phB, u);
              re[k] = magB * Math.cos(ph);
              im[k] = magB * Math.sin(ph);
            }
          }
        }

      } else if (modeId === 'envxfer'){
        // Envelope transfer morph:
        // A → (A with B's smoothed spectral envelope) → B.
        // Keeps endpoints exact, while giving a "cross-synth body transfer" midpoint.
        const wrapPi = (x)=>{
          x = (x + Math.PI) % (2*Math.PI);
          if (x < 0) x += 2*Math.PI;
          return x - Math.PI;
        };
        const lerpPhase = (pa, pb, t)=>{
          const d = wrapPi(pb - pa);
          return pa + d * t;
        };

        const eps = 1e-12;
        const smoothLogEnv = (srcRe, srcIm)=>{
          const out = new Float64Array(H);
          const radius = Math.max(1, Math.min(5, Math.floor((H-1)/14) || 2));
          for (let k=1;k<H;k++){
            let sum = 0, wsum = 0;
            for (let j=-radius;j<=radius;j++){
              const kk = Math.max(1, Math.min(H-1, k + j));
              const ww = (radius + 1) - Math.abs(j);
              const mag = Math.hypot(srcRe[kk], srcIm[kk]);
              sum += Math.log(mag + eps) * ww;
              wsum += ww;
            }
            out[k] = (wsum > 1e-12) ? (sum / wsum) : Math.log(eps);
          }
          return out;
        };

        const envA = smoothLogEnv(dA.re, dA.im);
        const envB = smoothLogEnv(dB.re, dB.im);

        // DC + Nyquist: blend to avoid mean jumps.
        re[0] = dA.re[0]*(1-w) + dB.re[0]*w;
        im[0] = 0;
        re[H] = dA.re[H]*(1-w) + dB.re[H]*w;
        im[H] = 0;

        if (tt < 0.5){
          const u = ease(tt*2);
          for (let k=1;k<H;k++){
            const magA = Math.hypot(dA.re[k], dA.im[k]);
            const phA  = Math.atan2(dA.im[k], dA.re[k]);
            const phB  = Math.atan2(dB.im[k], dB.re[k]);
            let ratio  = Math.exp((envB[k] - envA[k]) * u);
            ratio = Math.max(0.20, Math.min(5.0, ratio));
            const mag = magA * ratio;
            const ph  = lerpPhase(phA, phB, 0.30*u);
            re[k] = mag * Math.cos(ph);
            im[k] = mag * Math.sin(ph);
          }
        } else {
          const u = ease((tt-0.5)*2);
          for (let k=1;k<H;k++){
            const magA = Math.hypot(dA.re[k], dA.im[k]);
            const magB = Math.hypot(dB.re[k], dB.im[k]);
            const phA  = Math.atan2(dA.im[k], dA.re[k]);
            const phB  = Math.atan2(dB.im[k], dB.re[k]);
            let ratio  = Math.exp(envB[k] - envA[k]);
            ratio = Math.max(0.20, Math.min(5.0, ratio));
            const magMid = magA * ratio;
            const mag = magMid*(1-u) + magB*u;
            const ph  = lerpPhase(phA, phB, 0.30 + 0.70*u);
            re[k] = mag * Math.cos(ph);
            im[k] = mag * Math.sin(ph);
          }
        }

      } else if (modeId === 'spectilt'){
        // Spectral tilt morph: adjust A's spectral *slope* toward B, then morph into B.
        // 2-stage path:
        //   A → (A tilted toward B, phase moves toward B) → B
        // Stage 2 preserves B phase for a smoother, more “intentional” timbral blend.
        const wrapPi = (x)=>{
          x = (x + Math.PI) % (2*Math.PI);
          if (x < 0) x += 2*Math.PI;
          return x - Math.PI;
        };
        const lerpPhase = (pa, pb, t)=>{
          const d = wrapPi(pb - pa);
          return pa + d * t;
        };

        // Estimate a simple power-law tilt difference between A and B:
        //   magB(k)/magA(k) ≈ k^alpha   (anchored so k=1 stays stable)
        const eps = 1e-12;
        const magA1 = Math.hypot(dA.re[1], dA.im[1]) + eps;
        const magB1 = Math.hypot(dB.re[1], dB.im[1]) + eps;
        let num = 0, den = 0;
        for (let k=2;k<H;k++){
          const ma = Math.hypot(dA.re[k], dA.im[k]);
          const mb = Math.hypot(dB.re[k], dB.im[k]);
          if (!(ma > 1e-9) || !(mb > 1e-9)) continue;
          const x = Math.log(k);
          const y = Math.log((mb + eps)/magB1) - Math.log((ma + eps)/magA1);
          const wt = Math.sqrt(ma * mb);
          num += x * y * wt;
          den += x * x * wt;
        }
        let alpha = (den > 1e-12) ? (num / den) : 0;
        alpha = Math.max(-0.75, Math.min(0.75, alpha));

        // DC + Nyquist: blend to avoid mean jumps.
        re[0] = dA.re[0]*(1-w) + dB.re[0]*w;
        im[0] = 0;
        re[H] = dA.re[H]*(1-w) + dB.re[H]*w;
        im[H] = 0;

        if (tt < 0.5){
          const u = ease(tt*2);
          for (let k=1;k<H;k++){
            const ma = Math.hypot(dA.re[k], dA.im[k]);
            const phA = Math.atan2(dA.im[k], dA.re[k]);
            const phB = Math.atan2(dB.im[k], dB.re[k]);

            // Gradually tilt A magnitude toward B's slope.
            const tilt = Math.exp(alpha * u * Math.log(k)); // k^(alpha*u)
            const mag = ma * tilt;
            const ph  = lerpPhase(phA, phB, u);
            re[k] = mag * Math.cos(ph);
            im[k] = mag * Math.sin(ph);
          }
        } else {
          const u = ease((tt - 0.5)*2);
          for (let k=1;k<H;k++){
            const ma = Math.hypot(dA.re[k], dA.im[k]);
            const mb = Math.hypot(dB.re[k], dB.im[k]);
            const phB = Math.atan2(dB.im[k], dB.re[k]);

            const tilt = Math.exp(alpha * Math.log(k)); // k^alpha
            const m0 = ma * tilt;
            const mag = m0*(1-u) + mb*u;
            // Preserve the target phase in stage 2.
            re[k] = mag * Math.cos(phB);
            im[k] = mag * Math.sin(phB);
          }
        }

      } else if (modeId === 'harmxover'){
        // Harmonic crossover: low harmonics from A, high harmonics from B.
        // The crossover point sweeps with t (stable “body → brightness” control).
        const width = Math.max(1, Math.min(6, Math.floor((H-1)/16) || 2));
        const k0 = Math.round((1 - w) * (H - 1));

        // DC + Nyquist: blend to avoid clicks / mean jumps.
        re[0] = dA.re[0]*(1-w) + dB.re[0]*w;
        im[0] = 0;
        re[H] = dA.re[H]*(1-w) + dB.re[H]*w;
        im[H] = 0;

        for (let k=1;k<H;k++){
          let wk = (k - k0 + width) / (2*width);
          wk = _clamp01(wk);
          wk = wk*wk*(3-2*wk);
          re[k] = dA.re[k]*(1-wk) + dB.re[k]*wk;
          im[k] = dA.im[k]*(1-wk) + dB.im[k]*wk;
        }
      } else if (modeId === 'harmweave'){
        // Blend, but with an alternating group bias in the middle of the morph.
        const groupSize = Math.max(2, Math.min(6, Math.floor((H-1) / 8) || 3));
        const mid = 1 - Math.abs(2*w - 1); // 0 at ends, 1 at midpoint
        const off = 0.35 * mid;            // max per-group mix offset

        for (let k=0;k<NN;k++){
          re[k] = dA.re[k]*(1-w) + dB.re[k]*w;
          im[k] = dA.im[k]*(1-w) + dB.im[k]*w;
        }

        for (let k=1;k<H;k++){
          const g = Math.floor((k-1)/groupSize);
          const gw = _clamp01(w + ((g & 1) ? -off : off));
          re[k] = dA.re[k]*(1-gw) + dB.re[k]*gw;
          im[k] = dA.im[k]*(1-gw) + dB.im[k]*gw;
        }
      } else if (modeId === 'specsweep'){
        // Spectral band sweep: progressively swaps harmonic bands from A→B.
        // High harmonics transition first, then the sweep moves downward.
        // (Unlike a normal spectral crossfade where everything blends at once.)
        const width = Math.max(1, Math.min(10, Math.floor((H-1)/12) || 3));
        const front = (1 - w) * (H + width); // starts above Nyquist-ish → moves to 0

        // DC: standard blend.
        re[0] = dA.re[0]*(1-w) + dB.re[0]*w;
        im[0] = 0;
        // Nyquist (real)
        re[H] = dA.re[H]*(1-w) + dB.re[H]*w;
        im[H] = 0;

        for (let k=1;k<H;k++){
          let wk = _clamp01((k - front) / width);
          wk = wk*wk*(3-2*wk);
          re[k] = dA.re[k]*(1-wk) + dB.re[k]*wk;
          im[k] = dA.im[k]*(1-wk) + dB.im[k]*wk;
        }
      } else {
        // Default: complex crossfade
        for (let k=0;k<NN;k++){
          re[k] = dA.re[k]*(1-w) + dB.re[k]*w;
          im[k] = dA.im[k]*(1-w) + dB.im[k]*w;
        }

        if (modeId === 'specblur'){
          // Blur the magnitude mid-way; ends remain exact A/B.
          const mid = 1 - Math.abs(2*w - 1); // 0 at ends, 1 at midpoint
          const maxR = Math.max(1, Math.min(10, Math.floor((H-1)/3)));
          const r = Math.round(mid * maxR);

          if (r > 0){
            const mag = new Float64Array(H);
            const ph  = new Float64Array(H);
            for (let k=1;k<H;k++){
              mag[k] = Math.hypot(re[k], im[k]);
              ph[k]  = Math.atan2(im[k], re[k]);
            }
            for (let k=1;k<H;k++){
              let sum=0, wsum=0;
              for (let j=-r;j<=r;j++){
                const kk = Math.max(1, Math.min(H-1, k + j));
                const ww = (r + 1) - Math.abs(j); // triangular window
                sum  += mag[kk] * ww;
                wsum += ww;
              }
              const m = (wsum > 1e-12) ? (sum / wsum) : mag[k];
              re[k] = m * Math.cos(ph[k]);
              im[k] = m * Math.sin(ph[k]);
            }
          }
        }
      }

      enforceConjugateSym(re, im);
      return idftToU8(re, im);
    }

    function dpPhaseModGenerate(carrierU8, modulatorU8, index){
      // Phase modulation (FM/PM-style) for single-cycle waves.
      // `index` is the maximum phase deviation in *cycles* (e.g. 0.10 = ±10% of cycle).
      const car = (carrierU8 instanceof Uint8Array) ? carrierU8 : new Uint8Array(carrierU8||[]);
      let mod = (modulatorU8 instanceof Uint8Array) ? modulatorU8 : new Uint8Array(modulatorU8||[]);
      const N = car.length|0;
      if (!N) return new Uint8Array(0);

      // Resample modulator to carrier length when needed.
      if (mod.length !== N){
        if (typeof resampleU8_AA === 'function'){
          mod = resampleU8_AA(mod, N, 16);
        } else {
          const tmp = new Uint8Array(N);
          const M = (mod.length|0) || 1;
          for (let i=0;i<N;i++) tmp[i] = mod[Math.floor(i*M/N)] || 128;
          mod = tmp;
        }
      }

      const idx = Number(index||0);
      if (!isFinite(idx) || Math.abs(idx) < 1e-12) return new Uint8Array(car);

      const carF = new Float64Array(N);
      for (let i=0;i<N;i++) carF[i] = (car[i] - 128) / 127;
      const out = new Uint8Array(N);

      for (let i=0;i<N;i++){
        const p = i / N;                 // base phase [0..1)
        const m = (mod[i] - 128) / 127;  // mod [-1..1]
        let q = p + (idx * m);
        q = q - Math.floor(q);           // wrap to [0..1)

        const x = q * N;
        const i0 = x | 0;
        const frac = x - i0;
        const a = carF[i0];
        const b = carF[(i0 + 1) % N];
        const y = a + (b - a) * frac;

        out[i] = clamp(Math.round(y * 127 + 128), 0, 255);
      }
      return out;
    }

function dpEvolveGenerate(baseU8, t, recipeId, opts){
      const tRaw = Number(t||0);
      const tt = _clamp01(tRaw);
      const ease = (x)=>{ x=_clamp01(x); return x*x*(3-2*x); };

      // Alt-skew support (optional): treat `t` as a *scan position* where 0.5 is neutral,
      // and derive:
      //  - altW: 0..1 intensity from neutral (0 at 0.5, 1 at edges)
      //  - altSign: direction (− for <0.5, + for >=0.5)
      const altSkew = !!(opts && opts.altSkew);
      const w01 = ease(tt);
      let altSign = 1;
      let altW = w01;
      if (altSkew){
        const u = (tt - 0.5) * 2; // -1..+1
        altSign = (u >= 0) ? 1 : -1;
        altW = ease(Math.abs(u));
      }

      // Deterministic helpers (so the same seed wave always yields the same evolution)
      const hashU8 = (u8)=>{
        let h = 2166136261>>>0;
        for (let i=0;i<u8.length;i++) h = Math.imul(h ^ u8[i], 16777619);
        return h>>>0;
      };
      const mulberry32 = (seed)=>{
        let a = seed>>>0;
        return function(){
          a |= 0; a = (a + 0x6D2B79F5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      };
      const baseSeed = (hashU8(baseU8) ^ 0xA5A5A5A5) >>> 0;

      if (recipeId === 'smoothfold'){
        const w1 = fxSmooth(baseU8);
        const w2 = fxSmooth(w1);
        const w3 = fxSmooth(w2);
        const fold = fxFold(baseU8);
        const clip = fxSoftClip(baseU8);
        const a = dpBlendU8(baseU8, w3, ease(Math.min(1, tt*2)));
        const b = dpBlendU8(fold, clip, ease(tt));
        const c = dpBlendU8(a, b, ease(Math.max(0, (tt-0.5)*2)));
        return c;
      }

      if (recipeId === 'spectral'){
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          // In Alt-skew mode, treat t=0.5 as neutral:
          //  - tilt direction flips per-slot (±)
          //  - crush amount follows |t-0.5|
          const power = altSkew
            ? (altSign * altW * 0.35)
            : ((tt*2 - 1) * 0.35); // -0.35..+0.35
          const keepT = altSkew ? altW : tt;
          const keep = _clampInt(Math.round((H-1) - keepT*(H*0.65)), 2, H-1);
          specTilt(re,im,N,H,power);
          specCrush(re,im,N,H,keep);
        });
      }

      if (recipeId === 'specsmear'){
        // Spectral diffusion / smear: gradually blur magnitudes across neighboring bins,
        // while keeping phase mostly stable. This moves sharp/buzzy → smoother/organ‑like.
        const w = altSkew ? altW : w01;
        const N = baseU8.length|0;
        if (!N) return new Uint8Array(0);
        const H = N>>1;
        const maxR = Math.max(1, Math.min(12, Math.floor((H-1)/3)));
        const r = Math.round(w * maxR);
        if (r <= 0) return new Uint8Array(baseU8);

        return spectralApplyU8(baseU8, (re,im,NN,HH)=>{
          const mag = new Float64Array(HH);
          const ph  = new Float64Array(HH);
          for (let k=1;k<HH;k++){
            mag[k] = Math.hypot(re[k], im[k]);
            ph[k]  = Math.atan2(im[k], re[k]);
          }
          const magBlur = new Float64Array(HH);
          for (let k=1;k<HH;k++){
            let sum=0, wsum=0;
            for (let j=-r;j<=r;j++){
              const kk = Math.max(1, Math.min(HH-1, k + j));
              const ww = (r + 1) - Math.abs(j); // triangular window
              sum  += mag[kk] * ww;
              wsum += ww;
            }
            magBlur[k] = (wsum > 1e-12) ? (sum / wsum) : mag[k];
          }
          for (let k=1;k<HH;k++){
            const m = mag[k]*(1-w) + magBlur[k]*w;
            re[k] = m * Math.cos(ph[k]);
            im[k] = m * Math.sin(ph[k]);
          }
        });
      }

      if (recipeId === 'oddeven'){
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          const gOdd = Math.cos(tt * Math.PI * 0.5);
          const gEven = Math.sin(tt * Math.PI * 0.5);
          for (let k=1;k<H;k++){
            const g = (k % 2 === 0) ? gEven : gOdd;
            re[k] *= g; im[k] *= g;
            re[N-k] *= g; im[N-k] *= g;
          }
        });
      }

      if (recipeId === 'amsweep'){
        // Amplitude modulation with a mod rate that moves low→high over the bank.
        // Works best with a sine seed, but is interesting for any seed.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);

        const rng = mulberry32(baseSeed ^ 0x13579BDF);
        const ph0 = rng() * Math.PI * 2;

        // IMPORTANT: keep this monotonic across slots (no 0→1→0 bounce), so a 64-slot
        // evolve pass can be ping‑ponged later via palindromic pack.
        const w = altSkew ? altW : w01;
        const rate = _clampInt(Math.round(1 + w*15), 1, 32); // integer cycles per waveform
        const depth = _clamp01(0.20 + 0.80*w);               // 0.2..1.0
        const drive = 1.0 + 1.4*w;

        for (let i=0;i<N;i++){
          const s = ((baseU8[i]|0) - 128) / 127;               // [-1..1]
          const ph = (i/N) * Math.PI*2;
          const mod = Math.sin(ph*rate + ph0 + tt*Math.PI*2*0.25); // periodic (rate integer)
          // AM factor: 1 + depth*mod  (never negative if depth<=1)
          let y = s * (1 + depth*mod);
          // soft saturation to mimic "compressed/aliased" edge
          y = Math.tanh(y*drive) / Math.tanh(drive);
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'unison'){
        // Add a pitched-up copy (2→3→4 octaves) in unison with the seed.
        // This matches the “WHI2/WHI3/WHI4” style idea: base + (+2/+3/+4 oct).
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        function sampleMul(mul, i){
          let p = (i / N) * mul;
          p -= Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        }

        // Crossfades around 0.5 (2→3 oct) and 0.9 (3→4 oct), so t=1/3,2/3,1 map nicely.
        const b1 = 0.50, b2 = 0.90, w = 0.08;
        const sstep = (x)=>{ x=_clamp01(x); return x*x*(3-2*x); };

        let w2 = 0, w3 = 0, w4 = 0;
        if (tt <= (b1 - w)){
          w2 = 1;
        } else if (tt < (b1 + w)){
          const u = (tt - (b1 - w)) / (2*w);
          w3 = sstep(u);
          w2 = 1 - w3;
        } else if (tt <= (b2 - w)){
          w3 = 1;
        } else if (tt < (b2 + w)){
          const u = (tt - (b2 - w)) / (2*w);
          w4 = sstep(u);
          w3 = 1 - w4;
        } else {
          w4 = 1;
        }

        const g2 = 0.70, g3 = 0.55, g4 = 0.45; // roll-off for higher octaves
        const layer = 0.95;
        const drive = 1.15 + 1.10*ease(tt);

        for (let i=0;i<N;i++){
          const fund = baseF[i];
          const o2 = sampleMul(4, i);   // +2 oct (×4)
          const o3 = sampleMul(8, i);   // +3 oct (×8)
          const o4 = sampleMul(16, i);  // +4 oct (×16)

          let uni = (w2*g2*o2) + (w3*g3*o3) + (w4*g4*o4);
          let y = fund + layer * uni;
          y = Math.tanh(y*drive) / Math.tanh(drive);
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'pwm'){
        // PWM scan via phase warping around a "middle" zero crossing.
        //
        // Steps:
        // 1) Find the zero-crossing closest to the cycle midpoint (not necessarily exactly at 0.5).
        // 2) Warp time so that this pivot crossing moves left/right (duty cycle), stretching one side
        //    and compressing the other. This is similar to PWM on a pulse, but works for any single-cycle.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){
          out.set(baseU8);
          return out;
        }

        // Find pivot crossing near mid-cycle.
        let pivot = 0.5;
        {
          let bestDist = 1e9;
          let bestSlope = 0;
          for (let i=0;i<N;i++){
            const a = ((baseU8[i]|0) - 128) / 127;
            const b = ((baseU8[(i+1)%N]|0) - 128) / 127;
            // Crossing if sign changes or hits exactly 0.
            const a0 = (a === 0);
            const b0 = (b === 0);
            if (!(a0 || b0 || (a < 0 && b > 0) || (a > 0 && b < 0))) continue;
            let frac = 0;
            if (!a0 && !b0 && (a !== b)){
              frac = (-a) / (b - a); // 0..1
              if (!isFinite(frac)) frac = 0;
              frac = _clamp01(frac);
            } else if (a0){
              frac = 0;
            } else {
              frac = 1;
            }
            const pos = (i + frac) / N;
            const dist = Math.abs(pos - 0.5);
            const slope = Math.abs(b - a);
            if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && slope > bestSlope)){
              bestDist = dist;
              bestSlope = slope;
              pivot = pos;
            }
          }
          // Avoid pathological endpoints.
          pivot = Math.min(0.999, Math.max(0.001, pivot));
        }

        // Duty sweep (clamped to avoid degenerate warp).
        const dutyMin = 0.05;
        const dutyMax = 0.95;
        // If the detected pivot is too close to an edge (rare but possible), clamp it so we
        // still have a sane warp range.
        pivot = Math.min(dutyMax, Math.max(dutyMin, pivot));
        const span = Math.max(0, Math.min(0.45, pivot - dutyMin, dutyMax - pivot));
        const duty = (pivot - span) + (2*span)*tt; // sweeps pivot-span → pivot → pivot+span
        const d = Math.min(dutyMax, Math.max(dutyMin, duty));

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;
        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        // Piecewise linear phase mapping around pivot.
        for (let i=0;i<N;i++){
          const p = i / N;
          let q;
          if (p < d){
            q = (p / d) * pivot;
          } else {
            q = pivot + ((p - d) / (1 - d)) * (1 - pivot);
          }
          const y = sample(q);
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'phaseshift' || recipeId === 'phaseshift_plus'){
        // Phase Shift:
        // - phaseshift: pure circular rotation (shape-preserving)
        // - phaseshift_plus: rotation + gentle phase-warp drift + subtle spectral tilt
        const N = baseU8.length|0;
        if (!N) return new Uint8Array(0);

        const w = altSkew ? altW : w01;
        const dir = altSkew ? altSign : 1;
        // One-way/pingpong can scan nearly a full cycle. Alt-skew is centered, so keep
        // range to ±half cycle to avoid wrapping back to near-zero shift at extremes.
        const maxShift = altSkew
          ? Math.max(1, Math.floor(N * 0.5))
          : Math.max(1, N - 1);
        const shift = Math.round((altSkew ? (dir * w) : w) * maxShift);

        const shifted = (typeof dpRotateU8 === 'function')
          ? dpRotateU8(baseU8, shift|0)
          : new Uint8Array(baseU8);

        if (recipeId === 'phaseshift') return shifted;

        // "Plus" variant: keep phase motion central, but add light timbral animation.
        const bend = altSkew
          ? dpEvolveGenerate(shifted, tt, 'phasewarp', { altSkew:true })
          : dpEvolveGenerate(shifted, tt, 'phasewarp');

        const blendAmt = _clamp01(0.10 + 0.55*w);
        const mixed = dpBlendU8(shifted, bend, blendAmt);

        const tilt = altSkew
          ? (dir * w * 0.10)
          : ((w*2 - 1) * 0.10);

        const colored = spectralApplyU8(mixed, (re,im,NN,HH)=>{
          specTilt(re, im, NN, HH, tilt);
        });

        try{ return fxNormalizeTo(colored, 100); }catch(_){ return colored; }
      }

      if (recipeId === 'phase_dispersion'){
        // Harmonic phase dispersion:
        // apply a frequency-dependent phase curve (magnitude unchanged).
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          if (H <= 2) return;
          const TAU = Math.PI * 2;
          const w = altSkew ? altW : w01;
          const dir = altSkew ? altSign : 1;
          const denom = Math.max(1, H - 1);

          // Depth in radians, with nonlinear term so this is not "just a delay".
          const curvePow = 0.65 + 2.60*w;
          const depth = dir * (Math.PI * (0.20 + 1.55*w));
          const rippleRate = 2 + ((baseSeed >>> 7) % 6); // 2..7
          const ripplePhase = (((baseSeed >>> 13) & 2047) / 2047) * TAU;
          const rippleAmt = 0.10 + 0.22*w;

          for (let k=1;k<H;k++){
            const mag = Math.hypot(re[k], im[k]);
            if (mag < 1e-12){ re[k] = 0; im[k] = 0; continue; }
            const ph = Math.atan2(im[k], re[k]);
            const kn = k / denom;

            // Remove linear component so the effect is dispersion, not pure time shift.
            let disp = Math.pow(kn, curvePow) - kn;
            const env = kn * (1 - kn);
            disp += rippleAmt * env * Math.sin((TAU * rippleRate * kn) + ripplePhase);

            // Keep lowest bins steadier for better pitch center.
            if (k <= 2) disp *= 0.18;

            const ph2 = ph + depth * disp;
            re[k] = mag * Math.cos(ph2);
            im[k] = mag * Math.sin(ph2);
          }
        });
      }

      if (recipeId === 'band_phase_rotate'){
        // Split spectrum into low/mid/high regions and rotate phase per band.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          if (H <= 2) return;
          const TAU = Math.PI * 2;
          const w = altSkew ? altW : w01;
          const dir = altSkew ? altSign : 1;
          const denom = Math.max(1, H - 1);
          const sstep = (x)=>{ x=_clamp01(x); return x*x*(3-2*x); };

          // Band boundaries can drift slightly over t.
          let splitL = altSkew ? (0.30 + dir * 0.08 * w) : (0.24 + 0.14*w);
          let splitH = altSkew ? (0.68 + dir * 0.06 * w) : (0.62 + 0.14*w);
          splitL = Math.max(0.12, Math.min(0.50, splitL));
          splitH = Math.max(splitL + 0.12, Math.min(0.90, splitH));
          const edge = 0.10; // crossfade width around band boundaries

          const angLow  = dir * (Math.PI * (0.10 + 0.90*w));
          const angMid  = -dir * (Math.PI * (0.08 + 0.65*w));
          const angHigh = dir * (Math.PI * (0.14 + 1.25*w));

          const center = altSkew ? (0.5 + dir * (0.32*w)) : (0.16 + 0.68*w);
          const scanAmt = Math.PI * (0.04 + 0.35*w);

          for (let k=1;k<H;k++){
            const mag = Math.hypot(re[k], im[k]);
            if (mag < 1e-12){ re[k] = 0; im[k] = 0; continue; }
            const ph = Math.atan2(im[k], re[k]);
            const kn = k / denom;

            // Soft low/mid/high weights.
            let wLow  = 1 - sstep((kn - (splitL - edge)) / (2*edge));
            let wHigh = sstep((kn - (splitH - edge)) / (2*edge));
            wLow = _clamp01(wLow);
            wHigh = _clamp01(wHigh);
            let wMid = Math.max(0, 1 - wLow - wHigh);

            const wSum = wLow + wMid + wHigh;
            if (wSum > 1e-9){
              wLow /= wSum; wMid /= wSum; wHigh /= wSum;
            } else {
              wLow = 0; wMid = 1; wHigh = 0;
            }

            const scan = scanAmt * Math.sin(TAU * (kn - center));
            let off = (wLow * angLow) + (wMid * angMid) + (wHigh * angHigh);
            off += scan * (0.30 + 0.70*wMid);

            // Keep fundamental region less disturbed.
            if (k <= 2) off *= 0.22;

            const ph2 = ph + off;
            re[k] = mag * Math.cos(ph2);
            im[k] = mag * Math.sin(ph2);
          }
        });
      }

      if (recipeId === 'phase_entropy'){
        // Deterministic phase random-walk with low harmonics pinned for pitch stability.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          if (H <= 2) return;
          const w = altSkew ? altW : w01;
          const dir = altSkew ? altSign : 1;
          const rng = mulberry32((baseSeed ^ 0x5EEDFACE) >>> 0);
          const denom = Math.max(1, H - 1);

          // Correlated per-bin walk across harmonic index.
          const walk = new Float64Array(H);
          let acc = 0;
          let minW = 0, maxW = 0;
          for (let k=1;k<H;k++){
            const step = (rng() + rng() + rng()) - 1.5;
            acc += step;
            walk[k] = acc;
            if (acc < minW) minW = acc;
            if (acc > maxW) maxW = acc;
          }
          const span = maxW - minW;
          const invSpan = (span > 1e-9) ? (2 / span) : 0;
          const center = 0.5 * (maxW + minW);

          const spread = Math.PI * (0.20 + 1.70*w);
          const microAmt = 0.18 * w;

          for (let k=1;k<H;k++){
            const mag = Math.hypot(re[k], im[k]);
            if (mag < 1e-12){ re[k] = 0; im[k] = 0; continue; }
            const ph0 = Math.atan2(im[k], re[k]);
            const kn = k / denom;

            const pin = ease(_clamp01((kn - 0.06) / 0.26)); // low bins mostly pinned
            const highBias = Math.pow(kn, 0.72);
            const amount = pin * highBias * w;

            const wn = invSpan ? ((walk[k] - center) * invSpan) : 0;
            const micro = microAmt * (rng() - 0.5) * (0.35 + 0.65*kn);
            const target = ph0 + dir * spread * (wn + micro);

            // Wrap-safe interpolation toward target.
            const d = Math.atan2(Math.sin(target - ph0), Math.cos(target - ph0));
            const ph = ph0 + amount * d;

            re[k] = mag * Math.cos(ph);
            im[k] = mag * Math.sin(ph);
          }
        });
      }

      if (recipeId === 'phase_reset_scan'){
        // Moving phase reset point (sync-like), but phase-domain only.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){ out.set(baseU8); return out; }

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const w = altSkew ? altW : w01;
        const dir = altSkew ? altSign : 1;

        const r = altSkew
          ? (0.5 + dir * (0.42*w))
          : (0.08 + 0.84*w);
        const reset = Math.max(0.03, Math.min(0.97, r));

        const maxCycles = 6 + ((baseSeed >>> 10) % 5); // 6..10
        const preCycles = 1;
        const postCycles = _clampInt(1 + Math.round(w * (maxCycles - 1)), 1, maxCycles);
        const mix = 0.16 + 0.84*w;

        const outF = new Float32Array(N);
        for (let i=0;i<N;i++){
          const p = i / N;
          let q;
          if (p < reset){
            const u = p / reset;
            q = u * preCycles;
          } else {
            const u = (p - reset) / (1 - reset);
            const us = ease(u);
            q = us * postCycles;
          }
          const ySync = sample(q);
          const y = baseF[i] * (1 - mix) + ySync * mix;
          outF[i] = y;
        }

        // Optional soften at high cycle counts.
        const soften = _clamp01((postCycles - 4) / 6) * 0.55;
        if (soften > 1e-6){
          const tmp = new Float32Array(N);
          for (let i=0;i<N;i++){
            const prev = outF[(i - 1 + N) % N];
            const next = outF[(i + 1) % N];
            const sm = (prev + 2*outF[i] + next) * 0.25;
            tmp[i] = outF[i] * (1 - soften) + sm * soften;
          }
          outF.set(tmp);
        }

        // Remove DC + normalize.
        let mean = 0;
        for (let i=0;i<N;i++) mean += outF[i];
        mean /= Math.max(1, N);
        let peak = 0;
        for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i] - mean));
        if (!(peak > 1e-9)){
          out.set(baseU8);
          return out;
        }
        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = (outF[i] - mean) * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'phasewarp' || recipeId === 'phasewarp_asym' || recipeId === 'phasewarp_odd'){
        // Phase Warp (continuous bend)
        //   φ′ = φ + amount * sin(2πφ * harmonics)
        // Variants:
        //  - phasewarp: gentle
        //  - phasewarp_asym: asymmetric curvature
        //  - phasewarp_odd: odd-harmonic only warp
        //
        // Notes:
        // - This is a *time/phase-domain* bend (amplitude shape is preserved, partial timing moves).
        // - Deterministic harmonics are derived from the seed wave hash.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){ out.set(baseU8); return out; }

        const TAU = Math.PI * 2;
        const w = altSkew ? altW : w01;
        const dir = altSkew ? altSign : 1;

        // Pick a small harmonic count (low CPU, musically stable).
        let harm = 2 + ((baseSeed >>> 6) % 4); // 2..5
        if (recipeId === 'phasewarp_asym') harm = 1 + ((baseSeed >>> 9) % 4); // 1..4
        // For odd-only, choose an odd base harmonic (1/3/5).
        const harmOdd = 1 + 2 * (((baseSeed >>> 12) % 3) | 0);

        // Amount is in *cycles* (phase units). Keep it modest to avoid brutal fold-like behavior.
        let amount = 0;
        if (recipeId === 'phasewarp'){
          amount = dir * w * (0.085 / Math.max(1, harm));
        } else if (recipeId === 'phasewarp_asym'){
          amount = dir * w * (0.11 / Math.max(1, harm));
        } else {
          amount = dir * w * (0.095 / Math.max(1, harmOdd));
        }

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;
        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const outF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const phi = i / N;
          let s = 0;
          if (recipeId === 'phasewarp'){
            s = Math.sin(TAU * phi * harm);
          } else if (recipeId === 'phasewarp_asym'){
            s = Math.sin(TAU * phi * harm);
            // Asymmetric shaping: bend positive/negative arcs differently.
            const a = Math.abs(s);
            if (s >= 0) s = Math.pow(a, 0.65);
            else s = -0.85 * Math.pow(a, 1.35);
          } else {
            // Odd-only harmonic series (normalized).
            const h1 = harmOdd;
            s = (
              Math.sin(TAU * phi * h1) +
              0.5 * Math.sin(TAU * phi * (h1*3)) +
              0.25 * Math.sin(TAU * phi * (h1*5))
            ) / 1.75;
          }
          const q = (phi + amount * s);
          const y = sample(q);
          outF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);

        let peak = 0;
        for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i] - mean));
        if (!(peak > 1e-9)){
          out.set(baseU8);
          return out;
        }
        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = (outF[i] - mean) * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'phasecoil'){
        // Localized phase swirl:
        // a moving "coil" region twists local phase while leaving the rest more intact.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){ out.set(baseU8); return out; }

        const TAU = Math.PI * 2;
        const w = altSkew ? altW : w01;
        const dir = altSkew ? altSign : 1;

        const harmA = 2 + ((baseSeed >>> 8) % 4);   // 2..5
        const harmB = harmA + 1 + ((baseSeed >>> 12) % 3); // +1..+3
        const phA = (((baseSeed >>> 1) & 1023) / 1023) * TAU;
        const phB = (((baseSeed >>> 11) & 1023) / 1023) * TAU;

        const center = altSkew
          ? (0.5 + dir * (0.34 * w))
          : (0.14 + 0.72 * w);
        const sigma = Math.max(0.06, 0.22 - 0.14*w);
        const depth = (0.015 + 0.23*w) * dir;
        const mix = 0.20 + 0.80*w;

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;
        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const outF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const p = i / N;
          let d = p - center;
          d -= Math.round(d); // shortest wrapped distance in [-0.5, +0.5]

          const env = Math.exp(-0.5 * (d/sigma) * (d/sigma));
          const coil = (
            Math.sin(TAU * d * harmA + phA) +
            0.55 * Math.sin(TAU * d * harmB + phB)
          ) / 1.55;

          const q = p + depth * env * coil;
          const yWarp = sample(q);
          const yBase = baseF[i];
          const y = yBase * (1 - mix) + yWarp * mix;

          outF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);

        let peak = 0;
        for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i] - mean));
        if (!(peak > 1e-9)){ out.set(baseU8); return out; }

        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = (outF[i] - mean) * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'phasefold'){
        // Phase Fold (wrap distortion)
        // Push phase past 0..1 with wrap; richer harmonics than a gentle warp, but without brutal
        // amplitude clipping.
        // Soft-clamps “fold count” (effective wrap depth) ≤ 4.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){ out.set(baseU8); return out; }

        const TAU = Math.PI * 2;
        const w = altSkew ? altW : w01;
        const dir = altSkew ? altSign : 1;
        const harm = 1 + ((baseSeed >>> 7) % 3); // 1..3
        const folds = 1 + Math.floor(w * 3.999); // 1..4
        // Depth in cycles (phase units). Clamp to <= 4 as required.
        const depth = dir * Math.min(4, w * (0.75 + folds * 0.95));

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;
        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const outF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const phi = i / N;
          // A slightly complex modulator keeps this musical without random noise.
          let s = Math.sin(TAU * phi * harm) + 0.35 * Math.sin(TAU * phi * (harm * 2));
          s *= (1 / 1.35);
          const q = phi + depth * s;
          const y = sample(q);
          outF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);

        let peak = 0;
        for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i] - mean));
        if (!(peak > 1e-9)){
          out.set(baseU8);
          return out;
        }
        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = (outF[i] - mean) * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'phasequant'){
        // Phase Quantize / Staircase (hard)
        // Quantizes *phase* (time axis), not amplitude. Steps decrease with t: smooth → stepped.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){ out.set(baseU8); return out; }

        const w = altSkew ? altW : w01;
        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;
        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const maxSteps = Math.max(8, Math.min(96, N));
        const minSteps = Math.max(2, Math.min(8, N));
        const steps = _clampInt(Math.round(maxSteps - w*(maxSteps - minSteps)), minSteps, maxSteps);

        const outF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const p = i / N;
          const q = Math.floor(p * steps) / steps; // hard staircase
          const yq = sample(q);
          const y = baseF[i] * (1 - w) + yq * w;
          outF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);
        let peak = 0;
        for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i] - mean));
        if (!(peak > 1e-9)){
          out.set(baseU8);
          return out;
        }
        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = (outF[i] - mean) * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'formant'){
        // Deterministic "vowel-ish" sweep: a moving spectral bump + gentle tilt.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          // IMPORTANT: keep this monotonic across slots (no 0→1→0 bounce), so a 64-slot
          // evolve pass can be ping‑ponged later via palindromic pack.
          const w = ease(tt);
          const k0 = _clampInt(Math.round(2 + w*(H-4)), 2, Math.max(2, H-2));
          const sigma = Math.max(1, H/9);
          const bump = 0.35 + 1.65*w; // strength

          // Subtle bright/warm tilt that follows the sweep.
          const tilt = (w*2 - 1) * 0.20;
          specTilt(re, im, N, H, tilt);

          for (let k=1;k<H;k++){
            const d = (k - k0) / sigma;
            const g = 0.55 + bump * Math.exp(-0.5*d*d);
            re[k] *= g;
            im[k] *= g;
          }
        });
      }

      if (recipeId === 'formantdrift'){
        // Formant Drift: slow, pad-friendly motion by emphasizing moving spectral bands.
        // Compared to `formant`, this drifts over a narrower range with gentler gain.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          const w = ease(tt);

          // Choose a vowel-ish band center deterministically from the seed and table size.
          const span = Math.max(3, Math.min(H-3, Math.floor(H * 0.25) || 6));
          const baseC = 3 + (((baseSeed >>> 4) % span) | 0); // 3..~H*0.25
          const drift = Math.max(1, Math.floor(H * 0.12));
          let c = baseC + (w - 0.5) * 2 * drift;
          c = Math.max(2, Math.min(H-2, c));

          const bw = Math.max(1.1, (H / 14) + 1.2 + 2.2*w);
          const bump = 0.18 + 0.85*w;

          // A secondary, weaker band helps keep it “vocal” instead of “EQ sweep”.
          const c2 = Math.max(2, Math.min(H-2, c * 1.8));
          const bw2 = bw * 1.45;

          // Subtle tilt that follows the drift.
          const tilt = (w - 0.5) * 0.14;
          specTilt(re, im, N, H, tilt);

          for (let k=1;k<H;k++){
            const d1 = (k - c) / bw;
            const d2 = (k - c2) / bw2;
            const g1 = Math.exp(-0.5 * d1 * d1);
            const g2 = Math.exp(-0.5 * d2 * d2);
            const g = 0.62 + bump * (0.95*g1 + 0.35*g2);
            re[k] *= g;
            im[k] *= g;
          }
        });
      }

      if (recipeId === 'combform'){
        // Comb + Formant weave:
        // moving harmonic comb notches/peaks plus a drifting spectral bump.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          if (H <= 2) return;

          const w = altSkew ? altW : w01;
          const dir = altSkew ? altSign : 1;
          const travel = altSkew ? (0.5 + 0.5*dir*w) : w;

          // Deterministic comb period from seed (3..8 bins).
          const period = _clampInt(3 + ((baseSeed >>> 6) % 6), 3, 8);
          const shift = travel * period;

          const cLo = 2;
          const cHi = Math.max(cLo + 1, H - 2);
          const center = cLo + travel * (cHi - cLo);
          const bw = Math.max(1.1, (H / 14) + (1 - w) * 2.2);

          const combDepth = 0.08 + 0.72*w;
          const formDepth = 0.18 + 1.30*w;
          const tilt = (altSkew ? (dir*w) : (w*2 - 1)) * 0.10;

          specTilt(re, im, N, H, tilt);

          for (let k=1;k<H;k++){
            const d = (k - center) / bw;
            const form = Math.exp(-0.5 * d * d);
            const comb = Math.cos((2 * Math.PI * (k + shift)) / period);
            let g = (1 + combDepth * comb) * (1 + formDepth * form);
            g = Math.max(0.15, Math.min(4.5, g));
            re[k] *= g;
            im[k] *= g;
          }
        });
      }

      if (recipeId === 'phasespray'){
        // Keep magnitudes but drift phases toward a deterministic random set.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          const rng = mulberry32((baseSeed ^ 0xC0FFEE) >>> 0);
          const w = ease(tt);

          for (let k=1;k<H;k++){
            const mag = Math.hypot(re[k], im[k]);
            if (mag < 1e-12){ re[k]=0; im[k]=0; continue; }

            const ox = re[k] / mag;
            const oy = im[k] / mag;

            const phi = rng() * Math.PI * 2;
            const rx = Math.cos(phi);
            const ry = Math.sin(phi);

            // Interpolate on the unit circle (avoid phase wrap weirdness).
            let mx = ox*(1-w) + rx*w;
            let my = oy*(1-w) + ry*w;
            const m = Math.hypot(mx, my);
            if (m > 1e-12){ mx /= m; my /= m; } else { mx = rx; my = ry; }

            re[k] = mag * mx;
            im[k] = mag * my;
          }
        });
      }


      if (recipeId === 'binswap'){
        // Time-bin permutation: divide the cycle into bins, deterministically shuffle bins,
        // and morph from original→shuffled over t. Great for "bin switching" ideas.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const rng = mulberry32((baseSeed ^ 0xB175B17B) >>> 0);

        // Fixed bin count keeps things smooth across slots.
        const B = 16;
        const perm = new Int32Array(B);
        for (let i=0;i<B;i++) perm[i]=i;

        // Fisher–Yates shuffle (deterministic via baseSeed).
        for (let i=B-1;i>0;i--){
          const j = Math.floor(rng() * (i + 1));
          const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
        }

        const w = ease(tt);
        for (let i=0;i<N;i++){
          const p = i / N;
          const b = Math.min(B-1, Math.floor(p * B));
          const f = p * B - b;
          const p2 = (perm[b] + f) / B;

          const y = sample(p) * (1 - w) + sample(p2) * w;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'harmswap'){
        // Harmonic Bin Swap: swap groups of harmonic bins progressively (spectral analogue of time-bin shuffler).
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          // Group size chosen relative to spectrum size (96-sample waves => H=48).
          const groupSize = Math.max(2, Math.min(6, Math.floor((H-1) / 8) || 3));
          const nGroups = Math.floor((H-1) / groupSize);
          if (nGroups < 2) return;

          const srcRe = new Float64Array(H);
          const srcIm = new Float64Array(H);
          for (let k=0;k<H;k++){ srcRe[k]=re[k]; srcIm[k]=im[k]; }

          // IMPORTANT: keep this monotonic across slots (no 0→1→0 bounce), so a 64-slot
          // evolve pass can be ping‑ponged later via palindromic pack.
          const w = ease(tt);

          const mapK = (k)=>{
            if (k<=0) return k;
            const gi = Math.floor((k-1)/groupSize);
            if (gi < 0 || gi >= nGroups) return k;
            const pair = (gi ^ 1); // swap 0<->1, 2<->3, ...
            if (pair < 0 || pair >= nGroups) return k; // last unpaired group stays
            const inG = (k-1) - gi*groupSize;
            return 1 + pair*groupSize + inG;
          };

          for (let k=1;k<H;k++){
            const kk = mapK(k);
            const aRe = srcRe[k], aIm = srcIm[k];
            const bRe = srcRe[kk], bIm = srcIm[kk];
            re[k] = aRe*(1-w) + bRe*w;
            im[k] = aIm*(1-w) + bIm*w;
          }
        });
      }



      if (recipeId === 'altdensity'){
        // Alternating density across the cycle: even bins become sample&hold ("sparse"),
        // odd bins get a nonlinear time warp ("dense"). Morph amount follows t.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const B = 16;
        const w = ease(tt);

        // How "blocky" the sparse bins get (2..32 steps per bin).
        const q = _clampInt(Math.round(2 + w*30), 2, 32);

        // Warp exponent for dense bins (1 → 0.25 as w increases).
        const exp = 1 / (1 + 3*w);

        for (let i=0;i<N;i++){
          const p = i / N;
          const b = Math.min(B-1, Math.floor(p * B));
          let f = p * B - b;

          let p2 = p;
          let amp = 1;

          if ((b & 1) === 0){
            // Sparse (even): quantized phase within bin (sample & hold).
            f = Math.floor(f * q) / q;
            p2 = (b + f) / B;
            amp = 1 - 0.55*w; // mild per-bin "mute" for contrast
          } else {
            // Dense (odd): smooth warp within bin (keeps continuity, increases local detail).
            f = Math.pow(f, exp);
            p2 = (b + f) / B;
          }

          const y0 = sample(p);
          const y1 = sample(p2) * amp;
          const y = y0*(1-w) + y1*w;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'pdwarp'){
        // Phase Distortion sweep (time-axis warp). Classic PD-style timbre changes,
        // but derived from the seed wave (not a sine).
        const N = baseU8.length|0;
        const out = new Uint8Array(N);

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        // Default path: monotonic across slots (so the bank can be ping‑ponged later if desired).
        // Alt-skew path: treat t=0.5 as neutral and move the breakpoint left/right (±)
        // while increasing depth.
        let w = w01;
        let bp = 0.18 + 0.64*w;               // breakpoint (0.18..0.82)
        let e  = 1.0 + 5.0*w;                 // curve exponent (1..6)
        if (altSkew){
          w = altW;
          bp = 0.5 + altSign * (0.32 * altW); // symmetric: 0.18..0.82
          e  = 1.0 + 5.0 * altW;
        }

        const pd = (p)=>{
          p = p - Math.floor(p);
          if (p < bp){
            const u = p / bp;
            // ease-in on the first segment
            return Math.pow(u, e) * bp;
          } else {
            const u = (p - bp) / (1 - bp);
            // ease-out on the second segment (keeps end anchored at 1)
            return bp + (1 - Math.pow(1 - u, e)) * (1 - bp);
          }
        };

        for (let i=0;i<N;i++){
          const p = i / N;
          const p2 = pd(p);
          const y = sample(p) * (1 - w) + sample(p2) * w;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'pdint'){
        // Integrated phase-distortion: build a monotonic phase map from the seed wave's
        // dynamics (abs value + slope), then warp the seed by that map.
        // Compared to simple PD warps, this tends to sweep more smoothly/stably.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (!N) return out;

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const w = altSkew ? altW : w01;

        // Build positive weights (monotonic cumulative map).
        const weights = new Float64Array(N);
        let sumW = 0;
        for (let i=0;i<N;i++){
          const s0 = baseF[i];
          const s1 = baseF[(i+1)%N];
          const d  = Math.abs(s1 - s0);   // edge strength
          const a  = Math.abs(s0);        // energy
          // Blend slope + amplitude, ensure >0.
          const ww = 0.10 + 0.90*(0.65*d + 0.35*a);
          weights[i] = ww;
          sumW += ww;
        }
        if (!(sumW > 1e-12)) sumW = 1;

        // Cumulative (0..1). Using the cumulative *before* adding current weight
        // keeps phi[0]=0 and phi monotonic.
        const phi = new Float64Array(N);
        let acc = 0;
        for (let i=0;i<N;i++){
          phi[i] = acc / sumW;
          acc += weights[i];
        }

        // Alt-skew direction: use the inverse phase-map for the “negative” direction.
        let phiUse = phi;
        if (altSkew && altSign < 0){
          const invPhi = new Float64Array(N);
          let j = 0;
          for (let i=0;i<N;i++){
            const p = i / N;
            while (j < (N-1) && phi[j+1] < p) j++;
            const a = phi[j];
            const b = (j < (N-1)) ? phi[j+1] : 1;
            let frac = (b - a) > 1e-12 ? ((p - a) / (b - a)) : 0;
            if (!isFinite(frac)) frac = 0;
            frac = _clamp01(frac);
            invPhi[i] = (j + frac) / N;
          }
          phiUse = invPhi;
        }

        for (let i=0;i<N;i++){
          const p  = i / N;
          const p2 = phiUse[i];
          const y  = sample(p) * (1 - w) + sample(p2) * w;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'cheby'){
        // Chebyshev waveshaping sweep: T_n(x) = cos(n arccos(x)).
        // Smoothly crossfades between orders as t increases.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        const w = ease(tt);

        // 2 → 12-ish (fractional order via crossfade)
        const nFloat = 2 + tt*10;
        const n0 = Math.max(1, Math.floor(nFloat));
        const n1 = Math.max(1, n0 + 1);
        const frac = nFloat - n0;

        const drive = 1.0 + 1.6*w;
        const tanhNorm = Math.tanh(drive);

        for (let i=0;i<N;i++){
          let x = ((baseU8[i]|0) - 128) / 127;
          // Protect acos from tiny out-of-range due to rounding.
          x = Math.max(-1, Math.min(1, x));

          const a = Math.acos(x);
          const y0 = Math.cos(n0 * a);
          const y1 = Math.cos(n1 * a);
          let y = y0*(1-frac) + y1*frac;

          // Blend with original so it starts "seed-like".
          y = x*(1-w) + y*w;

          // Gentle saturation to keep edge cases under control.
          y = Math.tanh(y*drive) / tanhNorm;

          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'asymbend'){
        // Asymmetric Bend: bend positive/negative halves with different curves.
        // This is a classic "alive" motion recipe for pads/basses, and it stays deterministic
        // and CPU-light.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (N <= 1){ out.set(baseU8); return out; }

        const w = altSkew ? altW : w01;

        // Deterministic left/right assignment from the seed.
        // In Alt-skew mode, flip direction on “negative” scans so consecutive slots
        // alternate which half is bent more.
        let flip = ((baseSeed >>> 3) & 1) ? 1 : 0;
        if (altSkew && altSign < 0) flip ^= 1;

        // Exponent <1 expands near 0 (more "nasal"/forward), >1 compresses (smoother).
        let gPos = 1 - 0.55*w;
        let gNeg = 1 + 0.85*w;
        if (flip){ const tmp = gPos; gPos = gNeg; gNeg = tmp; }

        const outF = new Float32Array(N);
        let mean = 0;
        for (let i=0;i<N;i++){
          const s = ((baseU8[i]|0) - 128) / 127;
          let y;
          if (s >= 0){
            y = Math.pow(s, gPos);
          } else {
            y = -Math.pow(-s, gNeg);
          }
          // Blend the nonlinearity in gradually.
          y = s*(1-w) + y*w;
          outF[i] = y;
          mean += y;
        }
        mean /= Math.max(1, N);
        let peak = 0;
        for (let i=0;i<N;i++) peak = Math.max(peak, Math.abs(outF[i] - mean));
        if (!(peak > 1e-9)){
          out.set(baseU8);
          return out;
        }
        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = (outF[i] - mean) * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'harmrotate'){
        // Harmonic-bin rotate: rotates the spectrum by a (fractional) bin offset.
        // Similar spirit to specShift, but continuous over t.
        return spectralApplyU8(baseU8, (re,im,N,H)=>{
          const maxShift = Math.max(1, Math.min(24, H-2));
          // Alt-skew: rotate left/right (±) around neutral.
          const sFloat = (altSkew ? (altSign * altW) : tt) * maxShift;
          const s0 = Math.floor(sFloat);
          const s1 = (s0 < maxShift) ? (s0 + 1) : maxShift;
          const frac = sFloat - s0;

          const posRe = new Float64Array(H);
          const posIm = new Float64Array(H);
          for (let k=0;k<H;k++){ posRe[k]=re[k]; posIm[k]=im[k]; }

          const wrap = (k, s)=>{
            // wrap in 1..H-1 domain
            return ((k - s - 1) % (H-1) + (H-1)) % (H-1) + 1;
          };

          for (let k=1;k<H;k++){
            const a = wrap(k, s0);
            const b = wrap(k, s1);
            re[k] = posRe[a]*(1-frac) + posRe[b]*frac;
            im[k] = posIm[a]*(1-frac) + posIm[b]*frac;
          }
        });
      }

      if (recipeId === 'gatescan'){
        // Moving mute window(s): deterministically scans a "notch" around the cycle.
        // This creates evolving silence/holes while keeping the rest intact.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const w = altSkew ? altW : w01;
        const rng = mulberry32((baseSeed ^ 0xD00DFEED) >>> 0);
        const phase = rng(); // fixed per seed wave

        // Scan almost a full cycle but *not* exactly 1.0, to avoid ending on the same
        // notch position it started with when tt=1.
        // Using 63/64 is deliberate: common “full bank” size and keeps the scan smooth.
        const scan = 63/64;
        // Default: scan forward. Alt-skew: scan left/right (±) around the seed phase.
        let c1 = phase + (altSkew ? (altSign * altW * (scan * 0.5)) : (tt * scan));
        c1 = c1 - Math.floor(c1);
        const c2 = (c1 + 0.5) % 1;

        const depth1 = 0.15 + 0.85*w;
        const depth2 = 0.05 + 0.45*w;
        const sigma  = 0.10 - 0.06*w; // wide → tighter

        for (let i=0;i<N;i++){
          const p = i / N;

          let d1 = Math.abs(p - c1); d1 = Math.min(d1, 1 - d1);
          let d2 = Math.abs(p - c2); d2 = Math.min(d2, 1 - d2);

          // Gaussian notches (multiplicative)
          const g1 = 1 - depth1 * Math.exp(-0.5 * (d1/sigma) * (d1/sigma));
          const g2 = 1 - depth2 * Math.exp(-0.5 * (d2/(sigma*0.75)) * (d2/(sigma*0.75)));

          let y = baseF[i] * g1 * g2;

          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'hardsync'){
        // Hard‑Sync sweep (single-wave): resample the seed with an increasing phase rate (wrap),
        // emulating classic oscillator hard-sync harmonics.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (!N) return out;

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const w = ease(tt);
        const maxRatio = 8; // 1..8
        const ratio = 1 + w * (maxRatio - 1);

        const outF = new Float32Array(N);
        for (let i=0;i<N;i++){
          const p = i / N;
          const q = (p * ratio) % 1;
          const ySync = sample(q);
          const yBase = baseF[i];
          outF[i] = yBase * (1 - w) + ySync * w;
        }

        // DC remove + peak normalize (keeps output usable across ratios).
        let mean = 0;
        for (let i=0;i<N;i++) mean += outF[i];
        mean /= Math.max(1, N);

        let peak = 0;
        for (let i=0;i<N;i++){
          outF[i] -= mean;
          peak = Math.max(peak, Math.abs(outF[i]));
        }
        const tgt = 0.98;
        const sc = (peak > 1e-9) ? (tgt / peak) : 0;

        for (let i=0;i<N;i++){
          const y = outF[i] * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'hardsync2'){
        // Hard‑Sync Sweep+ (enhanced)
        // - Higher range than `hardsync` (virtual sync sweep)
        // - Optional soften at high ratios (circular smoothing)
        // - Fundamental stabilization (keeps the 1st harmonic from “falling out”)
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (!N) return out;

        const TAU = Math.PI * 2;
        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const w = ease(tt);
        const maxRatio = 12; // 1..12
        const ratio = 1 + w * (maxRatio - 1);

        const outF = new Float32Array(N);
        for (let i=0;i<N;i++){
          const p = i / N;
          const q = (p * ratio) % 1;
          const ySync = sample(q);
          const yBase = baseF[i];
          outF[i] = yBase * (1 - w) + ySync * w;
        }

        // Soften high ratios (reduces harsh edge at extreme sync).
        const soften = _clamp01((ratio - 4) / (maxRatio - 4));
        if (soften > 1e-6){
          const tmp = new Float32Array(N);
          const s = 0.85 * soften;
          for (let i=0;i<N;i++){
            const prev = outF[(i - 1 + N) % N];
            const next = outF[(i + 1) % N];
            const smooth = (prev + 2*outF[i] + next) * 0.25;
            tmp[i] = outF[i] * (1 - s) + smooth * s;
          }
          outF.set(tmp);
        }

        // Fundamental stabilization (k=1): match A's fundamental complex coefficient.
        let reA1 = 0, imA1 = 0, reB1 = 0, imB1 = 0;
        for (let i=0;i<N;i++){
          const ang = TAU * (i / N);
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const a = baseF[i];
          const b = outF[i];
          reA1 += a * c;
          imA1 -= a * s;
          reB1 += b * c;
          imB1 -= b * s;
        }
        const dRe = reA1 - reB1;
        const dIm = imA1 - imB1;
        const fundMix = 0.90;
        if ((Math.abs(dRe) + Math.abs(dIm)) > 1e-9){
          const k = (2 / N) * fundMix;
          for (let i=0;i<N;i++){
            const ang = TAU * (i / N);
            outF[i] += k * (dRe * Math.cos(ang) - dIm * Math.sin(ang));
          }
        }

        // DC remove + peak normalize.
        let mean = 0;
        for (let i=0;i<N;i++) mean += outF[i];
        mean /= Math.max(1, N);
        let peak = 0;
        for (let i=0;i<N;i++){
          outF[i] -= mean;
          peak = Math.max(peak, Math.abs(outF[i]));
        }
        if (!(peak > 1e-9)){
          out.set(baseU8);
          return out;
        }
        const sc = 0.98 / peak;
        for (let i=0;i<N;i++){
          const y = outF[i] * sc;
          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }

      if (recipeId === 'harmwarp'){
        // Harmonic stretch/compress: spectral remap (frequency warp) that starts subtle
        // and becomes more pronounced as t increases.
        //
        // p < 1 => "stretch" (pulls energy upward), p > 1 => "compress" (pushes energy downward)
        // We bias toward compress at the end, but keep early steps near the seed.
        const amount = 0.45;
        // Default: a one-way sweep that drifts from mild stretch to mild compress.
        // Alt-skew: treat t=0.5 as neutral and alternate stretch/compress (±) with increasing depth.
        const w = altSkew ? altW : w01;
        const p = altSkew
          ? (1 + (altSign * amount * w))
          : (1 + amount * (w * (2*w - 1)));

        const warped = spectralApplyU8(baseU8, (re,im,N,H)=>{
          // Copy the positive-frequency bins (0..H) so we can sample from the original spectrum.
          const srcRe = new Float64Array(H + 1);
          const srcIm = new Float64Array(H + 1);
          for (let k=0;k<=H;k++){ srcRe[k]=re[k]; srcIm[k]=im[k]; }

          // Preserve DC + Nyquist exactly (stability).
          re[0] = srcRe[0]; im[0] = 0;
          re[H] = srcRe[H]; im[H] = 0;

          if (H <= 3) return;

          const maxK = H - 1;
          const span = Math.max(1, maxK - 1); // H-2
          for (let k=1;k<=maxK;k++){
            const x = (k - 1) / span; // 0..1
            const x2 = Math.pow(x, p);
            const src = 1 + x2 * span; // 1..maxK
            const k0 = Math.floor(src);
            const k1 = Math.min(maxK, k0 + 1);
            const frac = src - k0;

            re[k] = srcRe[k0] * (1 - frac) + srcRe[k1] * frac;
            im[k] = srcIm[k0] * (1 - frac) + srcIm[k1] * frac;
          }
        });

        // Normalize (remove DC + match peak) so the warp doesn't collapse level.
        try{ return fxNormalizeTo(warped, 100); }catch(_){ return warped; }
      }

      if (recipeId === 'harmstretch'){
        // Harmonic Stretch / Compress (FFT-light)
        // Power remap of harmonic bin positions with low-harmonic anchors.
        // Roughly follows: k' = floor(k^p) (on a normalized axis), with p ramping across t.
        // Keeps the lowest bins stable, while the upper spectrum widens/narrows.
        // Default: one-way sweep (w is eased t).
        // Alt-skew: treat t=0.5 as neutral and alternate stretch/compress (±) with intensity = |t-0.5|.
        const w = altSkew ? altW : w01;
        const p = altSkew
          ? (1 + altSign * (0.4 * w)) // 0.6..1.4
          : (1 + (w - 0.5) * 0.8);

        const warped = spectralApplyU8(baseU8, (re,im,N,H)=>{
          const maxK = (H|0) - 1;
          if (maxK <= 2) return;

          // Copy source spectrum (positive side only).
          const srcRe = new Float64Array(H + 1);
          const srcIm = new Float64Array(H + 1);
          for (let k=0;k<=H;k++){ srcRe[k]=re[k]; srcIm[k]=im[k]; }

          // Clear (positive side) then rebuild.
          for (let k=0;k<=H;k++){ re[k]=0; im[k]=0; }

          // Preserve DC + Nyquist.
          re[0] = srcRe[0]; im[0] = 0;
          re[H] = srcRe[H]; im[H] = 0;

          // Anchor lowest harmonics.
          const keepK = Math.min(4, maxK);
          for (let k=1;k<=keepK;k++){ re[k]=srcRe[k]; im[k]=srcIm[k]; }

          const span = Math.max(1, maxK - keepK);
          const accRe = new Float64Array(H + 1);
          const accIm = new Float64Array(H + 1);
          const count = new Uint16Array(H + 1);

          // Map upper harmonics into new bins.
          for (let k=keepK+1;k<=maxK;k++){
            const u = (k - keepK) / span; // 0..1
            const u2 = Math.pow(u, p);
            let dst = keepK + Math.floor(u2 * span + 1e-9);
            dst = Math.max(keepK+1, Math.min(maxK, dst));
            accRe[dst] += srcRe[k];
            accIm[dst] += srcIm[k];
            count[dst] += 1;
          }

          for (let k=keepK+1;k<=maxK;k++){
            if (count[k]){
              re[k] = accRe[k] / count[k];
              im[k] = accIm[k] / count[k];
            }
          }

          // Light smoothing to avoid sparse "holes" in the upper spectrum.
          const s = 0.35;
          const tmpRe = new Float64Array(re);
          const tmpIm = new Float64Array(im);
          for (let k=keepK+1;k<maxK;k++){
            tmpRe[k] = re[k]*(1-s) + 0.5*s*(re[k-1] + re[k+1]);
            tmpIm[k] = im[k]*(1-s) + 0.5*s*(im[k-1] + im[k+1]);
          }
          for (let k=keepK+1;k<maxK;k++){
            re[k] = tmpRe[k];
            im[k] = tmpIm[k];
          }
        });

        // Blend so the earliest slots stay seed-like, then normalize/DC-correct.
        const mixed = dpBlendU8(baseU8, warped, w);
        try{ return fxNormalizeTo(mixed, 100); }catch(_){ return mixed; }
      }

      if (recipeId === 'phasestep'){
        // Phase staircase: quantize the phase/time domain into steps (not amplitude).
        // Creates stepped motion without the "bitcrush amplitude" signature.
        const N = baseU8.length|0;
        const out = new Uint8Array(N);
        if (!N) return out;

        const baseF = new Float32Array(N);
        for (let i=0;i<N;i++) baseF[i] = ((baseU8[i]|0) - 128) / 127;

        const sample = (p)=>{
          p = p - Math.floor(p);
          let x = p * N;
          if (x >= N) x = 0;
          const i0 = x|0;
          const i1 = (i0 + 1) % N;
          const f = x - i0;
          return baseF[i0] * (1 - f) + baseF[i1] * f;
        };

        const w = ease(tt);
        const maxSteps = Math.max(4, Math.min(N, 64));
        const minSteps = Math.max(2, Math.min(N, 4));
        const steps = _clampInt(Math.round(maxSteps - w * (maxSteps - minSteps)), minSteps, maxSteps);

        for (let i=0;i<N;i++){
          const p = i / N;

          // Staircase phase mapping with a small smooth ramp to the next step.
          const x = p * steps;
          const k = Math.floor(x);
          const f = x - k;
          const q0 = (k / steps);
          const q1 = ((k + 1) / steps); // wraps naturally in sample()

          const s = ease(f);
          const q = q0 * (1 - s) + q1 * s;

          const yQ = sample(q);
          const yB = baseF[i];
          const y = yB * (1 - w) + yQ * w;

          out[i] = clamp(Math.round(y*127 + 128), 0, 255);
        }
        return out;
      }


      // Seeded drift (deterministic, but diverse)
      const rng = mulberry32(baseSeed);
      const pool = [
        (a)=>fxSmooth(a),
        (a)=>fxMedian(a),
        (a)=>fxTilt(a),
        (a)=>fxSharpen(a),
        (a)=>fxHighpass(a),
        (a)=>fxSoftClip(a),
        (a)=>fxFold(a),
        (a)=>fxGamma05(a),
        (a)=>fxSkewLeft(a),
        (a)=>fxSkewRight(a),
        (a)=>fxSymOdd(a),
        (a)=>spectralApplyU8(a,(re,im,N,H)=>specWarm(re,im,N,H)),
        (a)=>spectralApplyU8(a,(re,im,N,H)=>specBright(re,im,N,H)),
        (a)=>spectralApplyU8(a,(re,im,N,H)=>specCrush(re,im,N,H, Math.max(4, Math.floor(H*0.35)))),
        (a)=>spectralApplyU8(a,(re,im,N,H)=>specShift(re,im,N,H, 2)),

        // Spicy extras (still deterministic + safe)
        (a)=>{
          // Self ring-mod with a fixed phase offset.
          const N = a.length|0;
          if (!N) return new Uint8Array(0);
          const shift = Math.max(1, Math.floor(N/4));
          const f = new Float32Array(N);
          let mean = 0;
          for (let i=0;i<N;i++){
            const aa = ((a[i]|0) - 128) / 127;
            const bb = ((a[(i+shift)%N]|0) - 128) / 127;
            const y = aa * bb;
            f[i] = y;
            mean += y;
          }
          mean /= Math.max(1, N);
          let peak = 0;
          for (let i=0;i<N;i++){
            f[i] -= mean;
            peak = Math.max(peak, Math.abs(f[i]));
          }
          const sc = (peak > 1e-9) ? (0.98 / peak) : 0;
          const out = new Uint8Array(N);
          for (let i=0;i<N;i++){
            out[i] = clamp(Math.round((f[i]*sc)*127 + 128), 0, 255);
          }
          return out;
        },
        (a)=>{
          // Bitwise XOR with a rotated copy (glitchy digital drift).
          const N = a.length|0;
          const out = new Uint8Array(N);
          if (!N) return out;
          const shift = Math.max(1, Math.floor(N/7));
          for (let i=0;i<N;i++){
            out[i] = ((a[i]|0) ^ (a[(i+shift)%N]|0)) & 255;
          }
          try{ return fxNormalizeTo(out, 100); }catch(_){ return out; }
        },
        (a)=>dpEvolveGenerate(a, 0.85, 'phasestep'),
        (a)=>dpEvolveGenerate(a, 0.80, 'phasewarp'),
        (a)=>dpEvolveGenerate(a, 0.78, 'phasecoil'),
        (a)=>dpEvolveGenerate(a, 0.82, 'phasefold'),
        (a)=>dpEvolveGenerate(a, 0.74, 'combform'),
        (a)=>dpEvolveGenerate(a, 0.78, 'harmstretch'),
        (a)=>dpEvolveGenerate(a, 0.75, 'asymbend'),
        (a)=>dpEvolveGenerate(a, 0.70, 'formantdrift'),
      ];

      const pick = ()=> pool[Math.floor(rng() * pool.length)];
      const f1 = pick(), f2 = pick(), f3 = pick();
      const w0 = baseU8;
      const w1 = f1(w0);
      const w2 = f2(w1);
      const w3 = f3(w2);
      const states = [w0,w1,w2,w3];
      const p = tt * (states.length - 1);
      const idx = Math.floor(p);
      const frac = p - idx;
      const a = states[Math.max(0, Math.min(states.length-1, idx))];
      const b = states[Math.max(0, Math.min(states.length-1, idx+1))];
      return dpBlendU8(a, b, ease(frac));
    }

function _lettersOnly(s){ return (s||'').toUpperCase().replace(/[^A-Z]/g,''); }

function _alnum4(s){ return (s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').padEnd(4,'X').slice(0,4); }

function dpSanitizeWaveNameToken(s){
      return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    }

function dpMake4Name(tag, numStr, placement){
      const t = dpSanitizeWaveNameToken(tag);
      const digits = String(numStr||'').replace(/[^0-9]/g,'');
      // Ensure exactly 4 chars: [tagPart][digits] or [digits][tagPart]
      const tagLen = Math.max(0, 4 - digits.length);
      const tagPart = (t || '').slice(0, tagLen).padEnd(tagLen, '0');
      const dPart = digits.slice(-Math.min(4, digits.length)).padStart(4-tagLen, '0');
      let nm = (placement === 'prefix') ? (dPart + tagPart) : (tagPart + dPart);
      nm = nm.slice(0,4).padEnd(4,'0');
      return nm;
    }

function derive4FromFilename(filename){
    // Strip extension and derive a stable 4‑char token from the *start* of the filename.
    // Example: "MyWave-01.wav" -> "MYWA"
    const stem = String(filename||'').replace(/\.[^.]+$/,'');
    const tok  = dpSanitizeWaveNameToken(stem);
    return _alnum4(tok || 'WAVE');
  }

function fileToken4(s){ return _alnum4(s || 'WAVE'); }

function ensureUnique4(base4, used){
    let nm = _alnum4(base4 || 'WAVE');
    if (!used.has(nm)){ used.add(nm); return nm; }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    // bump last char
    for (let i=0;i<alphabet.length;i++){
      const cand = nm.slice(0,3) + alphabet[i];
      if (!used.has(cand)){ used.add(cand); return cand; }
    }
    // bump last two
    for (let a=0;a<alphabet.length;a++){
      for (let b=0;b<alphabet.length;b++){
        const cand = nm.slice(0,2) + alphabet[a] + alphabet[b];
        if (!used.has(cand)){ used.add(cand); return cand; }
      }
    }
    // fallback random
    for (let k=0;k<256;k++){
      const cand = Array.from({length:4},()=>alphabet[(Math.random()*alphabet.length)|0]).join('');
      if (!used.has(cand)){ used.add(cand); return cand; }
    }
    return nm; // give up
  }

function parseSlotNameFromFilename(filename){
    const stem = String(filename||'').replace(/\.[^.]+$/,'');
    const parseSlotFrom4 = (tok4)=>{
      const t = _alnum4(tok4 || '').toUpperCase();
      if (t.length !== 4) return null;
      let m;
      // AB01 / 01AB
      m = t.match(/^[A-Z0-9]{2}(\d{2})$/);
      if (m){
        const n = parseInt(m[1],10);
        if (isFinite(n) && n >= 1 && n <= 64) return n-1;
      }
      m = t.match(/^(\d{2})[A-Z0-9]{2}$/);
      if (m){
        const n = parseInt(m[1],10);
        if (isFinite(n) && n >= 1 && n <= 64) return n-1;
      }
      // A001 / 001A
      m = t.match(/^[A-Z0-9](\d{3})$/);
      if (m){
        const n = parseInt(m[1],10);
        if (isFinite(n) && n >= 1 && n <= 64) return n-1;
      }
      m = t.match(/^(\d{3})[A-Z0-9]$/);
      if (m){
        const n = parseInt(m[1],10);
        if (isFinite(n) && n >= 1 && n <= 64) return n-1;
      }
      return null;
    };
    const reList = [
      /MM[-_ ]?WAVE[-_ ]?(?:SLOT[-_ ]?)?(\d{1,2})(?:[-_ ]+([A-Za-z0-9]{4}))?/i,
      /MM[-_ ]?DIGIPRO[-_ ]?(?:WAVE|SLOT)?[-_ ]?(\d{1,2})(?:[-_ ]+([A-Za-z0-9]{4}))?/i,
      /(?:^|[-_ ])S(?:LOT)?[-_ ]?(\d{1,2})(?:[-_ ]+([A-Za-z0-9]{4}))?/i,
    ];
    for (const re of reList){
      const m = stem.match(re);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (!isFinite(n) || n < 1 || n > 64) continue;
      const nm = m[2] ? m[2].toUpperCase().slice(0,4) : null;
      const fromExport = /MM[-_ ]?(WAVE|DIGIPRO)/i.test(stem);
      return { slot: n-1, name: nm, fromExport };
    }
    // Extra robust fallback: allow a slot to be derived from a 4-char name token
    // containing a 2- or 3-digit 1..64 suffix/prefix, e.g. AB01.wav or A001.wav.
    const mTok = stem.match(/(^|[-_ ]|\b)([A-Za-z0-9]{4})(?=$|[-_ ]|\b)/);
    if (mTok){
      const tok4 = mTok[2].toUpperCase();
      const slot = parseSlotFrom4(tok4);
      if (slot !== null) return { slot, name: tok4, fromExport:false, fromToken:true };
    }
    return null;
  }

function specCrush(re, im, N, H, keep){
  for (let k=keep;k<H;k++){ re[k]=0; im[k]=0; }
}

function specFormant(re, im, N, H){
  // Gaussian bump at random center (3..H/1.5), width ~ H/8
  const k0 = Math.max(3, Math.min(H - 1, Math.round(3 + Math.random() * (H / 1.5 - 3))));
  const sigma = Math.max(1, H / 8);
  for (let k = 1; k < H; k++){
    const g = 0.25 + 1.2 * Math.exp(-0.5 * ((k - k0) / sigma) ** 2);
    re[k] *= g;
    im[k] *= g;
  }
}

function specMorph(re, im, N, H){
  // NOTE: findMorphTarget is provided by ui.js at runtime (clipboard/nearest slot).
  // Use typeof guards to avoid ReferenceError if this file is used standalone.
  const target = (typeof findMorphTarget === 'function') ? findMorphTarget() : null;
  if (!target || target.length!==N){
    if (typeof announceIO === 'function') announceIO('SpecMorph needs a CLIP or another filled slot.', true);
    return;
  }
  const { re:re2, im:im2 } = dftRealU8(target);
  for (let k=1;k<H;k++){
    const m1 = Math.hypot(re[k], im[k]);
    const m2 = Math.hypot(re2[k], im2[k]);
    const phi = Math.atan2(im[k], re[k]);               // keep current phase for punch
    const m  = (m1 + m2) * 0.5;
    re[k] = m*Math.cos(phi); im[k] = m*Math.sin(phi);
  }
  // DC: average and drop imag
  re[0] = 0; im[0]=0;
}

function specRandPhase(re, im, N, H){
  for (let k=1;k<H;k++){
    const mag = Math.hypot(re[k], im[k]);
    const phi = Math.random()*2*Math.PI;
    re[k] = mag*Math.cos(phi);
    im[k] = mag*Math.sin(phi);
  }
}

function specShift(re, im, N, H, s){
  const posRe = new Float64Array(H), posIm = new Float64Array(H);
  for (let k=0;k<H;k++){ posRe[k]=re[k]; posIm[k]=im[k]; }
  for (let k=1;k<H;k++){
    const kk = ((k + s - 1) % (H-1) + (H-1)) % (H-1) + 1; // wrap 1..H-1
    re[kk] = posRe[k];
    im[kk] = posIm[k];
  }
  re[0]=posRe[0]; im[0]=0;
}

function specTilt(re, im, N, H, power){                // power > 0 brightens, < 0 warms
  for (let k=1;k<H;k++){
    const g = Math.pow(1 + k, power);
    re[k]*=g; im[k]*=g;
  }
}

function specWarm(re, im, N, H){
  // Gentle high‑frequency roll‑off.
  // Implemented as a small negative spectral tilt (see specTilt).
  specTilt(re, im, N, H, -0.08);
}

function specBright(re, im, N, H){
  // Gentle high‑frequency lift.
  // Implemented as a small positive spectral tilt (see specTilt).
  specTilt(re, im, N, H, 0.08);
}

function specZeroParity(re, im, N, H, keepOdd){
  for (let k=1;k<H;k++){
    const keep = keepOdd ? (k&1)===1 : (k&1)===0;
    if (!keep){ re[k]=0; im[k]=0; }
  }
}

function fxAsymClip(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const s=(a[i]-128)/127;
        const y = s>=0 ? Math.tanh(s*2)*0.7 : Math.tanh(s*0.9)*1.0;
        b[i]=clamp(Math.round(y*127+128),0,255);
      }
      return b;
    }

function fxBitFlip5(a){
      const N=a.length, b=new Uint8Array(N), mask=1<<5;
      for (let i=0;i<N;i++) b[i]=(a[i]^mask)&0xFF;
      return b;
    }

function fxBtnTitle(label, hint){
      let t = String(label || 'FX');
      if (hint) t += ' — ' + hint;
      t += '\nClick: apply';
      t += '\nShift‑click: random 5–10 FX chain';
      return t;
    }

function fxChaos(a){
  let cur = new Uint8Array(a);
  const ops = [fxJitter, fxCrush, fxFold, fxTilt, fxDownsample, fxSharpen, fxSoftClip, fxGamma05, fxPhaseShift, fxPhaseMinus90, fxScramble];
  const num = 2 + ((Math.random()*3)|0);
  for (let i=0;i<num;i++){
    const f = ops[(Math.random()*ops.length)|0];
    cur = f(cur);
  }
  return cur;
}

function fxCrush(a){
      const N=a.length, out=new Uint8Array(N);
      const levels = 8; // 3-bit
      for (let i=0;i<N;i++){
        const s = a[i]/255;
        const q = Math.round(s*(levels-1))/(levels-1);
        out[i] = clamp(Math.round(q*255), 0, 255);
      }
      return out;
    }

function fxDifferentiate(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const d = a[i] - a[(i-1+N)%N];
        b[i]=clamp(Math.round(128 + d*0.5), 0, 255);
      }
      return b;
    }

function fxDoubleFreq(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++) b[i]=a[(i*2)%N];
      return b;
    }

function fxDownsample(a){
      const N=a.length, out=new Uint8Array(N);
      const factor = 2;
      for (let i=0;i<N;i++){
        const j = Math.floor(i/factor)*factor;
        out[i] = a[Math.min(j, N-1)];
      }
      return out;
    }

function fxFold(a){
      const N=a.length, out=new Uint8Array(N);
      const T = 0.5; // threshold in [-1..1]
      function fold(x){ // x in [-1..1]
        let y = x;
        while (Math.abs(y) > T){
          y = (y>0) ? (2*T - y) : (-2*T - y);
        }
        return y;
      }
      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127;
        const y = fold(s);
        out[i] = clamp(Math.round(y*127 + 128), 0, 255);
      }
      return out;
    }

function fxGamma05(a){
      const N=a.length, b=new Uint8Array(N), g=0.5;
      for (let i=0;i<N;i++){
        const s=(a[i]-128)/127, y=Math.sign(s)*Math.pow(Math.abs(s), g);
        b[i]=clamp(Math.round(y*127+128),0,255);
      }
      return b;
    }

function fxHalfFreq(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++) b[i]=a[Math.floor(i/2)%N];
      return b;
    }

function fxHardClip(a){
      const N=a.length, b=new Uint8Array(N), thr=0.65;
      for (let i=0;i<N;i++){
        let s=(a[i]-128)/127;
        s = Math.max(-thr, Math.min(thr, s));
        b[i]=clamp(Math.round(s*127+128),0,255);
      }
      return b;
    }

function fxHarmonicBed(a, amt=0.55){
      const N=a.length, b=new Uint8Array(N);
      const mix = Math.max(0, Math.min(1, amt));
      // Integer harmonics keep the waveform periodic.
      const harmonics = [2,3,4,5,6,7];
      const phases = harmonics.map(()=>Math.random()*Math.PI*2);
      const weights = harmonics.map(h=>1/h);
      const wSum = weights.reduce((s,v)=>s+v, 0) || 1;

      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127;
        let bed=0;
        const ph = (i/N) * Math.PI*2;
        for (let k=0;k<harmonics.length;k++){
          bed += weights[k] * Math.sin(ph*harmonics[k] + phases[k]);
        }
        bed /= wSum;

        let v = s + mix*bed;
        // Gentle soft-clip
        v = Math.tanh(v*1.2);
        b[i] = clamp(Math.round(128 + v*127), 0, 255);
      }
      return fxNormalize(b);
    }

function fxHighpass(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const m = (a[(i-1+N)%N] + a[i] + a[(i+1)%N]) / 3;
        b[i] = clamp(Math.round(128 + (a[i] - m)), 0, 255);
      }
      return b;
    }

function fxIntegrate(a){
      const N=a.length, b=new Uint8Array(N);
      let y=0, leak=0.85, mix=0.15, peak=0;
      const tmp=new Float32Array(N);
      for (let i=0;i<N;i++){
        const s=(a[i]-128)/127;
        y = y*leak + s*mix;
        tmp[i]=y; peak=Math.max(peak, Math.abs(y));
      }
      if (peak<1e-6) peak=1;
      for (let i=0;i<N;i++) b[i]=clamp(Math.round((tmp[i]/peak)*127+128),0,255);
      return b;
    }

function fxInvert(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127; // [-1..1]
        const s2 = -s;
        b[i] = clamp(Math.round(s2*127 + 128), 0, 255);
      }
      return b;
    }

function fxJitter(a){
      const N=a.length, out=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const v = a[i] + Math.floor((Math.random()*7)-3); // ±3
        out[i] = clamp(v, 0, 255);
      }
      return out;
    }

function fxMedian(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const p=a[(i-1+N)%N], q=a[i], r=a[(i+1)%N];
        const arr=[p,q,r].sort((x,y)=>x-y);
        b[i]=arr[1];
      }
      return b;
    }

function fxMirror(a){
      const N=a.length, out=new Uint8Array(N);
      const half = Math.floor(N/2);
      for (let i=0;i<half;i++) out[i] = a[i];
      for (let i=0;i<N-half;i++) out[half+i] = a[half-1 - (i % half)];
      return out;
    }

function fxMorph(a){
      // ui.js provides findMorphTarget at runtime. Guard for standalone usage.
      const b = (typeof findMorphTarget === 'function') ? findMorphTarget() : null;
      if (!b){
        if (typeof announceIO === 'function') announceIO('Morph needs a CLIP (copy) or any other filled slot.', true);
        return null;
      }
      const N=a.length, out=new Uint8Array(N);
      for (let i=0;i<N;i++){ out[i] = clamp(Math.round((a[i] + b[i]) * 0.5), 0, 255); }
      return out;
    }

function fxWaveShape(a){
      // Use CLIP (or nearest filled slot) as a transfer curve to shape the current wave.
      // Requires findMorphTarget() from the UI; safe no-op in standalone usage.
      const curve = (typeof findMorphTarget === 'function') ? findMorphTarget() : null;
      if (!curve){
        if (typeof announceIO === 'function') announceIO('WaveShape needs a CLIP (copy) or any other filled slot.', true);
        return null;
      }
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      const N = src.length|0;
      if (!N) return new Uint8Array(0);

      let b = (curve instanceof Uint8Array) ? curve : new Uint8Array(curve||[]);
      if (b.length !== N){
        if (typeof resampleU8_AA === 'function'){
          b = resampleU8_AA(b, N, 16);
        } else {
          const tmp = new Uint8Array(N);
          const M = (b.length|0) || 1;
          for (let i=0;i<N;i++) tmp[i] = b[Math.floor(i*M/N)] || 128;
          b = tmp;
        }
      }
      if (b.length !== N){
        const tmp = new Uint8Array(N);
        tmp.fill(128);
        b = tmp;
      }

      const out = new Uint8Array(N);
      const NN1 = Math.max(1, N - 1);
      for (let i=0;i<N;i++){
        const x = (src[i] / 255) * NN1;
        const i0 = x | 0;
        const frac = x - i0;
        const i1 = (i0 + 1 <= NN1) ? (i0 + 1) : NN1;
        const y = (b[i0] * (1 - frac)) + (b[i1] * frac);
        out[i] = clamp(Math.round(y), 0, 255);
      }
      return fxNormalize(out);
    }



function fxPhaseMod(a){
      // Phase modulation using CLIP/nearest slot as the modulator (PM-style time warp).
      // Strong but controllable: ±12% of the cycle.
      const b = (typeof findMorphTarget === 'function') ? findMorphTarget() : null;
      if (!b){
        if (typeof announceIO === 'function') announceIO('PhaseMod needs a CLIP (copy) or any other filled slot.', true);
        return null;
      }
      return dpPhaseModGenerate(a, b, 0.12);
    }

function fxPWM(a){
      // PWM-style phase warp around the most "central" zero-crossing.
      // Deterministically biases left/right from the wave content (no global state).
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      const N = src.length|0;
      if (!N) return new Uint8Array(0);

      // FNV-1a-ish hash to pick direction (stable for a given wave).
      let h = 2166136261>>>0;
      for (let i=0;i<N;i++) h = Math.imul(h ^ src[i], 16777619);

      const t = (h & 1) ? 0.75 : 0.25; // duty bias
      return dpEvolveGenerate(src, t, 'pwm');
    }

function fxPDWarp(a){
      // Casio-ish phase distortion warp (time-axis shaping).
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      if (!src.length) return new Uint8Array(0);
      return dpEvolveGenerate(src, 0.60, 'pdwarp');
    }

function fxCheby(a){
      // Chebyshev waveshaper (harmonic generation), blended with the original.
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      if (!src.length) return new Uint8Array(0);
      return dpEvolveGenerate(src, 0.60, 'cheby');
    }

function fxSpecSmear(a){
      // Spectral diffusion: blur magnitudes across neighboring harmonics while keeping phase mostly stable.
      const src = (a instanceof Uint8Array) ? a : new Uint8Array(a||[]);
      if (!src.length) return new Uint8Array(0);
      return dpEvolveGenerate(src, 0.55, 'specsmear');
    }

function fxNormalize(a){
      // Normalize: remove DC offset + scale to full range around 128
      const N = a.length|0;
      if (!N) return new Uint8Array(0);
      const b = new Uint8Array(N);
      let mean = 0;
      for (let i=0;i<N;i++) mean += a[i];
      mean /= N;
      let peak = 0;
      for (let i=0;i<N;i++){
        const d = Math.abs(a[i] - mean);
        if (d > peak) peak = d;
      }
      if (peak <= 1e-9) return new Uint8Array(a);
      const scale = 127 / peak;
      for (let i=0;i<N;i++){
        const y = (a[i] - mean) * scale;
        b[i] = clamp(Math.round(y + 128), 0, 255);
      }
      return b;
    }

function fxNormalizeTo(a, targetPct){
      // Normalize to a target peak level (0..100%). Removes DC and recenters to 128.
      const N = a.length|0;
      if (!N) return new Uint8Array(0);
      const pct = Math.max(0, Math.min(100, Number(targetPct||0)));
      const target = (pct / 100) * 127;
      let mean = 0;
      for (let i=0;i<N;i++) mean += a[i];
      mean /= N;
      let peak = 0;
      for (let i=0;i<N;i++){
        const d = Math.abs(a[i] - mean);
        if (d > peak) peak = d;
      }
      if (peak <= 1e-9) return new Uint8Array(a);
      const scale = target / peak;
      const b = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const y = (a[i] - mean) * scale;
        b[i] = clamp(Math.round(y + 128), 0, 255);
      }
      return b;
    }



function fxGainLinearTo(a, gainPct){
      // Linear gain (0..100% typical). Scales around the signal mean to preserve DC offset.
      // Unlike NormalizeTo, this does NOT match peaks across waves — it preserves relative dynamics/levels.
      const N = a.length|0;
      if (!N) return new Uint8Array(0);
      const pct = Number(gainPct||0);
      const g = isFinite(pct) ? Math.max(0, pct / 100) : 0;

      let mean = 0;
      for (let i=0;i<N;i++) mean += a[i];
      mean /= N;

      const b = new Uint8Array(N);
      for (let i=0;i<N;i++){
        const y = mean + (a[i] - mean) * g;
        b[i] = clamp(Math.round(y), 0, 255);
      }
      return b;
    }



// dB -> linear gain helper (audio convention).
// gain = 10^(dB/20)
function dbToLinearGain(db){
  db = Number(db);
  if (!isFinite(db)) return 1;
  return Math.pow(10, db/20);
}

// Multiply a float buffer by a constant gain factor, with optional clamping.
// Used for high-res cycle sources (_srcFloat) so export/upload paths match UI edits.
function applyGainToFloat(srcFloat, gain, clamp=true){
  const a = (srcFloat instanceof Float32Array) ? srcFloat : new Float32Array(srcFloat||[]);
  const N = a.length|0;
  const g = Number(gain);
  const out = new Float32Array(N);
  if (!N) return out;

  const gg = (isFinite(g) ? g : 1);

  for (let i=0;i<N;i++){
    let v = a[i] * gg;
    if (clamp){
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
    }
    out[i] = v;
  }

  // Preserve sample-rate metadata when present.
  try{
    if (srcFloat && typeof srcFloat._sr === 'number' && isFinite(srcFloat._sr)) out._sr = srcFloat._sr;
  }catch(_){ }

  return out;
}

// Apply a dB gain trim to a Uint8Array wave (unsigned 8-bit centered at 128).
// IMPORTANT: this is a pure multiply around the DC midpoint (128). No normalization.
// Clipping policy: clamp to [0,255].
function fxGainDbTo(u8, db){
  const a = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8||[]);
  const N = a.length|0;
  if (!N) return new Uint8Array(0);

  const g = dbToLinearGain(db);
  const out = new Uint8Array(N);

  for (let i=0;i<N;i++){
    const d = (a[i]|0) - 128;
    let v = 128 + d * g;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    out[i] = v|0;
  }

  // Preserve displayRot hint if present (best-effort).
  try{
    if (typeof u8.displayRot === 'number' && isFinite(u8.displayRot)) out.displayRot = u8.displayRot|0;
  }catch(_){ }

  return out;
}
function fxOctaveLayer(a, amt=0.35){
      const N=a.length, b=new Uint8Array(N);
      const mix = Math.max(0, Math.min(1, amt));
      const d = fxDoubleFreq(a);
      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127;
        const t = (d[i]-128)/127;
        const v = s + mix*t;
        b[i] = clamp(Math.round(128 + v*127), 0, 255);
      }
      return fxNormalize(b);
    }

function fxPhaseMinus90(a){
      const N=a.length, b=new Uint8Array(N), shift=Math.round(N*0.25);
      for (let i=0;i<N;i++) b[i]=a[(i-shift+N)%N];
      return b;
    }

function fxPhaseShift(a){
      const N=a.length, out=new Uint8Array(N);
      const shift = Math.round(N*0.25); // +90°
      for (let i=0;i<N;i++) out[(i+shift)%N] = a[i];
      return out;
    }

function fxPulseify(a){
      const N=a.length, out=new Uint8Array(N);
      // threshold at the median of input to preserve duty-ish
      const vals = Array.from(a); vals.sort((x,y)=>x-y);
      const thr = vals[Math.floor(N/2)] || 128;
      for (let i=0;i<N;i++) out[i] = (a[i] >= thr) ? 255 : 0;
      return out;
    }

function fxRandomize(a){
      const N=a.length, out=new Uint8Array(N);
      for (let i=0;i<N;i++) out[i] = Math.floor(Math.random()*256);
      return out;
    }

function fxRectify(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127;
        const s2 = Math.abs(s);
        b[i] = clamp(Math.round(s2*127 + 128), 0, 255);
      }
      return b;
    }

function fxReverse(a){
      const N=a.length, b=new Uint8Array(N);
      for (let i=0;i<N;i++) b[i] = a[N-1-i];
      return b;
    }

function fxRingMod(a){
      const N=a.length, b=new Uint8Array(N), shift=Math.round(N*0.25);
      for (let i=0;i<N;i++){
        const s=(a[i]-128)/127;
        const t=(a[(i+shift)%N]-128)/127;
        const y=s*t; b[i]=clamp(Math.round(y*127+128),0,255);
      }
      return b;
    }

function fxScramble(a){
      const N=a.length, out=new Uint8Array(N);
      const segs = 8, segLen = Math.floor(N/segs);
      const order = Array.from({length:segs}, (_,i)=>i).sort(()=>Math.random()-0.5);
      for (let s=0;s<segs;s++){
        const src = order[s];
        for (let i=0;i<segLen;i++){
          const di = s*segLen + i; const si = src*segLen + i;
          if (di<N && si<N) out[di] = a[si];
        }
      }
      // leftover tail
      for (let i=segs*segLen;i<N;i++) out[i]=a[i];
      return out;
    }

function fxSegmentize(a){
      const N=a.length, b=new Uint8Array(N), segs=8, len=Math.floor(N/segs);
      for (let s=0;s<segs;s++){
        let sum=0, count=0;
        for (let i=0;i<len;i++){ const idx=s*len+i; if (idx<N){ sum+=a[idx]; count++; } }
        const avg = count? (sum/count)|0 : 128;
        for (let i=0;i<len;i++){ const idx=s*len+i; if (idx<N){ b[idx]=avg; } }
      }
      for (let i=segs*len;i<N;i++) b[i]=a[i];
      return b;
    }

function fxSharpen(a){
      const N=a.length, b=new Uint8Array(N);
      const amt = 0.7;
      for (let i=0;i<N;i++){
        const sm = (a[(i-1+N)%N] + a[i] + a[(i+1)%N]) / 3;
        const v = a[i] + amt*(a[i]-sm);
        b[i] = clamp(Math.round(v), 0, 255);
      }
      return b;
    }

function fxSkewLeft(a){
  const N=a.length, b=new Uint8Array(N);
  for (let i=0;i<N;i++){
    const t = i/(N-1);
    const tt = Math.pow(t, 1.5);
    const j = Math.min(N-1, Math.round(tt*(N-1)));
    b[i] = a[j];
  }
  return b;
}

function fxSkewRight(a){
  const N=a.length, b=new Uint8Array(N);
  for (let i=0;i<N;i++){
    const t = i/(N-1);
    const tt = 1 - Math.pow(1-t, 1.5);
    const j = Math.min(N-1, Math.round(tt*(N-1)));
    b[i] = a[j];
  }
  return b;
}

function fxSmooth(a){
  const N = a.length, b = new Uint8Array(N);
  for (let i=0;i<N;i++){
    const m = (a[(i-1+N)%N] + a[i] + a[(i+1)%N]) / 3;
    b[i] = clamp(Math.round(m), 0, 255);
  }
  return b;
}

function fxSoftClip(a){
      const N=a.length, b=new Uint8Array(N), k=1.5, norm=Math.tanh(k);
      for (let i=0;i<N;i++){
        const s=(a[i]-128)/127;
        const y=Math.tanh(s*k)/norm;
        b[i]=clamp(Math.round(y*127+128),0,255);
      }
      return b;
    }

function fxStack(a){
      // ui.js provides findMorphTarget at runtime. Guard for standalone usage.
      const b = (typeof findMorphTarget === 'function') ? findMorphTarget() : null;
      if (!b){
        if (typeof announceIO === 'function') announceIO('Stack needs a CLIP (copy) or any other filled slot.', true);
        return null;
      }
      const N=a.length, out=new Uint8Array(N);
      const tmp = new Float32Array(N);
      let peak = 0;
      for (let i=0;i<N;i++){
        const s1 = (a[i]-128)/127;
        const s2 = (b[i]-128)/127;
        const y  = s1 + s2; // additive layer
        tmp[i] = y; peak = Math.max(peak, Math.abs(y));
     }
     if (peak < 1e-6) peak = 1;
      const scale = 0.8/peak; // headroom
     for (let i=0;i<N;i++){
       const y = tmp[i]*scale;
       out[i] = clamp(Math.round(y*127 + 128), 0, 255);
     }
     return out;
   }

function fxSubLayer(a, amt=0.35){
      const N=a.length, b=new Uint8Array(N);
      const mix = Math.max(0, Math.min(1, amt));
      const h = fxHalfFreq(a);
      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127;
        const t = (h[i]-128)/127;
        const v = s + mix*t;
        b[i] = clamp(Math.round(128 + v*127), 0, 255);
      }
      return fxNormalize(b);
    }

function fxSymOdd(a){
  const N=a.length, b=new Uint8Array(N);
  const half = Math.floor(N/2);
  for (let i=0;i<half;i++){
    const v = a[i];
    const s = (v-128)/127;
    const inv = Math.round((-s)*127 + 128);
    b[i] = v;
    b[N-1-i] = Math.max(0, Math.min(255, inv));
  }
  if (N%2===1){ b[half]=128; }
  return b;
}

function fxThirdHarmonicLayer(a, amt=0.35){
      const N=a.length, b=new Uint8Array(N);
      const mix = Math.max(0, Math.min(1, amt));
      for (let i=0;i<N;i++){
        const s = (a[i]-128)/127;
        const h3 = Math.sin((i/N) * Math.PI*2*3);
        const v = s + mix*h3;
        b[i] = clamp(Math.round(128 + v*127), 0, 255);
      }
      return fxNormalize(b);
    }

function fxTilt(a){
      const N=a.length, out=new Uint8Array(N);
      for (let i=0;i<N;i++){
        const t = (i/(N-1))*2 - 1; // -1..1
        const v = (a[i]-128) + Math.round(t*24); // ±24 bias across cycle
        out[i] = clamp(v + 128, 0, 255);
      }
      return out;
    }

function fxZero(a){
  const b = new Uint8Array(a.length);
  b.fill(128);
  return b;
}

  // ---------------------------------------------------------------------------
  // Public exports
  // ---------------------------------------------------------------------------

  _export('clamp', clamp);
  _export('_clamp01', _clamp01);
  _export('_clampInt', _clampInt);
  _export('isPow2', isPow2);
  _export('fftRadix2', fftRadix2);
  _export('normalizeFloatArray', normalizeFloatArray);
  _export('resampleFloatToU8_AA', resampleFloatToU8_AA);
  _export('dftRealU8', dftRealU8);
  _export('idftToU8', idftToU8);
  // Periodic Fourier-series resampler used by WAV export (keeps loop closure).
  // NOTE: name kept for backward-compat with earlier FFT-based prototypes.
  _export('periodicResampleFloatFFT', periodicResampleFloatFFT);
  _export('enforceConjugateSym', enforceConjugateSym);
  _export('spectralApplyU8', spectralApplyU8);
  _export('dpBlendU8', dpBlendU8);
  _export('dpSimpleWavefoldU8', dpSimpleWavefoldU8);
  _export('dpSimpleSkewU8', dpSimpleSkewU8);
  _export('dpSimpleSaturateU8', dpSimpleSaturateU8);
  _export('dpSimpleCrushU8', dpSimpleCrushU8);
  _export('dpSimpleToneU8', dpSimpleToneU8);
  _export('dpSimpleSpectralMorphU8', dpSimpleSpectralMorphU8);
  _export('dpSimpleEqualPowerMorphU8', dpSimpleEqualPowerMorphU8);
  _export('dpSimpleMagnitudeOnlyMorphU8', dpSimpleMagnitudeOnlyMorphU8);
  _export('dpSimplePhaseOnlyMorphU8', dpSimplePhaseOnlyMorphU8);
  _export('dpSimplePhaseWarpMorphU8', dpSimplePhaseWarpMorphU8);
  _export('dpRotateU8', dpRotateU8);
  _export('dpFindBestRisingZCIndexU8', dpFindBestRisingZCIndexU8);
  _export('dpRotateToRisingZC_U8', dpRotateToRisingZC_U8);
  _export('dpSeamMatchRotationsU8', dpSeamMatchRotationsU8);
  _export('dpCosSim', dpCosSim);
  _export('dpMorphGenerate', dpMorphGenerate);
  _export('dpPhaseModGenerate', dpPhaseModGenerate);
  _export('dpEvolveGenerate', dpEvolveGenerate);
  _export('_lettersOnly', _lettersOnly);
  _export('_alnum4', _alnum4);
  _export('dpSanitizeWaveNameToken', dpSanitizeWaveNameToken);
  _export('dpMake4Name', dpMake4Name);
  _export('derive4FromFilename', derive4FromFilename);
  _export('fileToken4', fileToken4);
  _export('ensureUnique4', ensureUnique4);
  _export('parseSlotNameFromFilename', parseSlotNameFromFilename);
  _export('specCrush', specCrush);
  _export('specFormant', specFormant);
  _export('specMorph', specMorph);
  _export('specRandPhase', specRandPhase);
  _export('specShift', specShift);
  _export('specTilt', specTilt);
  _export('specWarm', specWarm);
  _export('specBright', specBright);
  _export('specZeroParity', specZeroParity);
  _export('fxAsymClip', fxAsymClip);
  _export('fxBitFlip5', fxBitFlip5);
  _export('fxBtnTitle', fxBtnTitle);
  _export('fxChaos', fxChaos);
  _export('fxCrush', fxCrush);
  _export('fxDifferentiate', fxDifferentiate);
  _export('fxDoubleFreq', fxDoubleFreq);
  _export('fxDownsample', fxDownsample);
  _export('fxFold', fxFold);
  _export('fxGamma05', fxGamma05);
  _export('fxHalfFreq', fxHalfFreq);
  _export('fxHardClip', fxHardClip);
  _export('fxHarmonicBed', fxHarmonicBed);
  _export('fxHighpass', fxHighpass);
  _export('fxIntegrate', fxIntegrate);
  _export('fxInvert', fxInvert);
  _export('fxJitter', fxJitter);
  _export('fxMedian', fxMedian);
  _export('fxMirror', fxMirror);
  _export('fxMorph', fxMorph);
  _export('fxWaveShape', fxWaveShape);
  _export('fxPhaseMod', fxPhaseMod);
  _export('fxPWM', fxPWM);
  _export('fxPDWarp', fxPDWarp);
  _export('fxCheby', fxCheby);
  _export('fxSpecSmear', fxSpecSmear);
  _export('fxNormalize', fxNormalize);
  _export('fxNormalizeTo', fxNormalizeTo);
  _export('fxGainLinearTo', fxGainLinearTo);
  _export('dbToLinearGain', dbToLinearGain);
  _export('applyGainToFloat', applyGainToFloat);
  _export('fxGainDbTo', fxGainDbTo);
  _export('fxOctaveLayer', fxOctaveLayer);
  _export('fxPhaseMinus90', fxPhaseMinus90);
  _export('fxPhaseShift', fxPhaseShift);
  _export('fxPulseify', fxPulseify);
  _export('fxRandomize', fxRandomize);
  _export('fxRectify', fxRectify);
  _export('fxReverse', fxReverse);
  _export('fxRingMod', fxRingMod);
  _export('fxScramble', fxScramble);
  _export('fxSegmentize', fxSegmentize);
  _export('fxSharpen', fxSharpen);
  _export('fxSkewLeft', fxSkewLeft);
  _export('fxSkewRight', fxSkewRight);
  _export('fxSmooth', fxSmooth);
  _export('fxSoftClip', fxSoftClip);
  _export('fxStack', fxStack);
  _export('fxSubLayer', fxSubLayer);
  _export('fxSymOdd', fxSymOdd);
  _export('fxThirdHarmonicLayer', fxThirdHarmonicLayer);
  _export('fxTilt', fxTilt);
  _export('fxZero', fxZero);

})();
