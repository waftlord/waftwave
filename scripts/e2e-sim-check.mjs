#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const failures = [];
let passCount = 0;

function ok(name){
  passCount += 1;
  console.log(`PASS  ${name}`);
}

function fail(name, err){
  failures.push(name);
  const detail = err && err.stack ? err.stack : String(err);
  console.error(`FAIL  ${name}`);
  console.error(`      ${detail.split('\n').join('\n      ')}`);
}

function expect(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

function expectEq(actual, expected, msg){
  if (actual !== expected){
    throw new Error(`${msg || 'values differ'}: expected ${expected}, got ${actual}`);
  }
}

function expectTypedArrayEq(a, b, msg){
  expect(a && b, `${msg || 'arrays differ'}: missing array`);
  expectEq(a.length, b.length, `${msg || 'arrays differ'}: length mismatch`);
  for (let i = 0; i < a.length; i += 1){
    if (a[i] !== b[i]){
      throw new Error(`${msg || 'arrays differ'} at index ${i}: expected ${b[i]}, got ${a[i]}`);
    }
  }
}

async function test(name, fn){
  try{
    await fn();
    ok(name);
  }catch(err){
    fail(name, err);
  }
}

function createStorage(){
  const map = new Map();
  return {
    get length(){ return map.size; },
    key(i){ return Array.from(map.keys())[i] ?? null; },
    getItem(k){
      const key = String(k);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(k, v){ map.set(String(k), String(v)); },
    removeItem(k){ map.delete(String(k)); },
    clear(){ map.clear(); }
  };
}

function createMockElement(tagName = 'div'){
  const el = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    children: [],
    append(...nodes){ this.children.push(...nodes); },
    appendChild(node){ this.children.push(node); return node; },
    remove(){},
    focus(){},
    click(){},
    setAttribute(){},
    getAttribute(){ return null; },
    removeAttribute(){},
    addEventListener(){},
    removeEventListener(){},
    dispatchEvent(){ return true; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    classList: {
      add(){},
      remove(){},
      toggle(){ return false; },
      contains(){ return false; }
    }
  };

  if (el.tagName === 'CANVAS'){
    el.getContext = () => ({
      clearRect(){},
      beginPath(){},
      moveTo(){},
      lineTo(){},
      stroke(){},
      fill(){},
      closePath(){},
      arc(){},
      fillRect(){},
      strokeRect(){},
      drawImage(){},
      save(){},
      restore(){},
      translate(){},
      scale(){},
      rotate(){},
      setLineDash(){},
      measureText(){ return { width: 0 }; },
      createLinearGradient(){ return { addColorStop(){} }; },
      createRadialGradient(){ return { addColorStop(){} }; }
    });
  }

  return el;
}

function createHarness(){
  const document = {
    readyState: 'loading',
    body: createMockElement('body'),
    documentElement: createMockElement('html'),
    createElement(tag){ return createMockElement(tag); },
    createTextNode(text){ return { nodeType: 3, textContent: String(text ?? '') }; },
    addEventListener(){},
    removeEventListener(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    getElementById(){ return null; }
  };

  const win = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    document,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    navigator: {
      userAgent: 'node-e2e-sim',
      requestMIDIAccess: async () => ({
        inputs: new Map(),
        outputs: new Map(),
        addEventListener(){},
        removeEventListener(){}
      })
    },
    location: {
      href: 'http://localhost:8000/index.html',
      origin: 'http://localhost:8000'
    },
    addEventListener(){},
    removeEventListener(){},
    dispatchEvent(){ return true; },
    matchMedia: () => ({
      matches: false,
      media: '',
      addEventListener(){},
      removeEventListener(){},
      addListener(){},
      removeListener(){}
    }),
    alert(){},
    confirm(){ return true; },
    prompt(){ return null; },
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    MutationObserver: class {
      observe(){}
      disconnect(){}
      takeRecords(){ return []; }
    },
    ResizeObserver: class {
      observe(){}
      unobserve(){}
      disconnect(){}
    },
    IntersectionObserver: class {
      observe(){}
      unobserve(){}
      disconnect(){}
    },
    EventTarget,
    Event,
    CustomEvent: globalThis.CustomEvent || class {
      constructor(type, init = {}){
        this.type = type;
        this.detail = init.detail;
      }
    },
    AbortController,
    AbortSignal,
    crypto: globalThis.crypto
  };

  if (typeof win.URL.createObjectURL !== 'function') win.URL.createObjectURL = () => 'blob:mock';
  if (typeof win.URL.revokeObjectURL !== 'function') win.URL.revokeObjectURL = () => {};

  win.window = win;
  win.self = win;
  win.globalThis = win;
  document.defaultView = win;

  const context = vm.createContext(win);

  return {
    context,
    async runFile(relPath){
      const abs = path.join(ROOT, relPath);
      const code = await fs.readFile(abs, 'utf8');
      vm.runInContext(code, context, { filename: relPath });
    }
  };
}

function buildTables(samplesPerTable){
  const t0 = new Int16Array(samplesPerTable);
  const t1 = new Int16Array(samplesPerTable);
  const t2 = new Int16Array(samplesPerTable);
  for (let i = 0; i < samplesPerTable; i += 1){
    t0[i] = ((i * 31) % 65536) - 32768;
    t1[i] = ((i * 17) % 65536) - 32768;
    t2[i] = ((i * 7) % 65536) - 32768;
  }
  return { t0, t1, t2 };
}

function meanAbsDiff(a, b){
  expectEq(a.length, b.length, 'diff arrays length mismatch');
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] | 0) - (b[i] | 0));
  return sum / a.length;
}

function waitMs(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const indexHtml = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const cssRefs = [...indexHtml.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
const scriptRefs = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

async function runAllScripts(harness){
  for (const relPath of scriptRefs){
    await harness.runFile(relPath);
  }
}

function cloneWave(u8){
  const out = new Uint8Array(u8);
  try{
    if (u8 && u8.displayRot !== undefined) out.displayRot = u8.displayRot | 0;
  }catch(_){ }
  return out;
}

function typedArraysEqual(a, b){
  if (!a || !b) return false;
  if ((a.length | 0) !== (b.length | 0)) return false;
  for (let i = 0; i < a.length; i += 1){
    if ((a[i] | 0) !== (b[i] | 0)) return false;
  }
  return true;
}

function buildRichWave(length = 96, phase = 0, tilt = 0){
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1){
    const t = i / length;
    const y =
      128
      + 58 * Math.sin((Math.PI * 2 * t) + phase)
      + 31 * Math.sin((Math.PI * 4 * t) + (phase * 0.7))
      + 17 * Math.cos((Math.PI * 6 * t) + tilt)
      + 9 * Math.sin((Math.PI * 10 * t) + (phase * 1.3));
    out[i] = Math.max(0, Math.min(255, Math.round(y)));
  }
  return out;
}

function makeSimpleControlModes(overrides){
  const out = {
    fold: 'lock',
    skew: 'lock',
    sat: 'lock',
    crush: 'lock',
    pwm: 'lock',
    pd: 'lock',
    tone: 'lock',
    smear: 'lock'
  };
  if (overrides && typeof overrides === 'object'){
    for (const key of Object.keys(overrides)){
      if (Object.prototype.hasOwnProperty.call(out, key)){
        out[key] = (String(overrides[key]) === 'excite') ? 'excite' : 'lock';
      }
    }
  }
  return out;
}

function makeSimpleState(controlId, value, modeOverrides){
  return {
    mode: 'simple',
    morph: 'linear',
    controlModes: makeSimpleControlModes(modeOverrides),
    fold: 0,
    skew: 0,
    sat: 0,
    crush: 0,
    pwm: 0,
    pd: 0,
    tone: 0,
    smear: 0,
    [controlId]: value
  };
}

await test('index.html contains stylesheet and script references', async () => {
  expect(cssRefs.length > 0, 'no stylesheet refs found');
  expect(scriptRefs.length > 0, 'no script refs found');
});

await test('All referenced CSS/JS assets exist', async () => {
  const refs = [...cssRefs, ...scriptRefs];
  for (const ref of refs){
    await fs.access(path.join(ROOT, ref));
  }
});

await test('Vertical slider styling uses the standard writing-mode path', async () => {
  const css = await fs.readFile(path.join(ROOT, 'assets/css/main.css'), 'utf8');
  expect(css.includes('writing-mode: vertical-lr;'), 'vertical slider should use writing-mode');
  expect(css.includes('direction: rtl;'), 'vertical slider should use rtl direction for range orientation');
  expect(!css.includes('slider-vertical'), 'deprecated slider-vertical appearance should not be present');
});

await test('Focused range sliders do not block command-style grid shortcuts', async () => {
  const src = await fs.readFile(path.join(ROOT, 'assets/js/ui-grid.js'), 'utf8');
  expect(src.includes('const allowShortcutFromRange = !!rangeInput;'), 'range shortcut allowance missing');
  expect(/if \(isTextEntry && !allowShortcutFromRange\) return;\s*selectAllSlots\(\);/.test(src), 'Cmd/Ctrl+A should stay available from a focused range slider');
  expect(/if \(isTextEntry && !allowShortcutFromRange\) return;\s*copySlotsToClipboard\(\);/.test(src), 'Cmd/Ctrl+C should stay available from a focused range slider');
  expect(/if \(isTextEntry && !allowShortcutFromRange\) return;\s*cutSlotsToClipboard\(\);/.test(src), 'Cmd/Ctrl+X should stay available from a focused range slider');
  expect(/if \(isTextEntry && !allowShortcutFromRange\) return;\s*promptPasteSpecialMenu\(\);/.test(src), 'Cmd/Ctrl+Shift+V should stay available from a focused range slider');
  expect(/if \(isTextEntry && !allowShortcutFromRange\) return;\s*pasteClipboardToActive\(\);/.test(src), 'Cmd/Ctrl+V should stay available from a focused range slider');
});

await test('Critical script order dependencies are correct', async () => {
  const mustExist = [
    'assets/js/boot.js',
    'assets/js/digipro-sysex.js',
    'assets/js/midi.js',
    'assets/js/import-export.js',
    'assets/js/ui-init.js'
  ];
  for (const name of mustExist){
    expect(scriptRefs.includes(name), `missing required script reference: ${name}`);
  }

  const before = (a, b) => {
    const ia = scriptRefs.indexOf(a);
    const ib = scriptRefs.indexOf(b);
    expect(ia >= 0 && ib >= 0, `missing order target: ${a} or ${b}`);
    expect(ia < ib, `script order invalid: ${a} must load before ${b}`);
  };

  before('assets/js/boot.js', 'assets/js/midi.js');
  before('assets/js/digipro-sysex.js', 'assets/js/import-export.js');
  before('assets/js/digipro-sysex.js', 'assets/js/ui-init.js');
  before('assets/js/ui-core.js', 'assets/js/ui-editor.js');
  before('assets/js/ui-init.js', 'assets/js/ui-midi-modal.js');
});

await test('All referenced scripts compile (syntax check)', async () => {
  for (const relPath of scriptRefs){
    const code = await fs.readFile(path.join(ROOT, relPath), 'utf8');
    // Parse-only check across every shipped script.
    // eslint-disable-next-line no-new
    new vm.Script(code, { filename: relPath });
  }
});

await test('All scripts execute in mocked browser runtime', async () => {
  const harness = createHarness();
  for (const relPath of scriptRefs){
    await harness.runFile(relPath);
  }
});

await test('Audio preview only attempts unlock during an active user gesture', async () => {
  const harness = createHarness();
  const root = harness.context;
  let resumeCount = 0;

  class FakeAudioContext {
    constructor(){
      this.state = 'suspended';
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = {};
    }
    resume(){
      resumeCount += 1;
      this.state = 'running';
      return Promise.resolve();
    }
    createBuffer(_channels, length){
      return {
        getChannelData(){
          return new Float32Array(length);
        }
      };
    }
    createBufferSource(){
      return {
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        connect(node){ return node; },
        start(){},
        stop(){}
      };
    }
    createGain(){
      return {
        gain: {
          value: 0,
          setValueAtTime(v){ this.value = v; },
          linearRampToValueAtTime(v){ this.value = v; },
          cancelScheduledValues(){}
        },
        connect(node){ return node; }
      };
    }
  }

  root.AudioContext = FakeAudioContext;
  root.webkitAudioContext = FakeAudioContext;
  root.navigator.userActivation = { isActive: false };

  await runAllScripts(harness);

  expect(typeof root.requestAudioUnlock === 'function', 'requestAudioUnlock should be exposed');
  expect(typeof root.startPreview === 'function', 'startPreview should be available');
  expect(typeof root.stopPreview === 'function', 'stopPreview should be available');

  const wave = buildRichWave(96, 0.25, 0.1);

  root.startPreview(wave, 60);
  expectEq(resumeCount, 0, 'startPreview should stay quiet when user activation is not active');
  root.stopPreview();

  root.navigator.userActivation.isActive = true;
  root.startPreview(wave, 60);
  expectEq(resumeCount, 1, 'startPreview should resume audio once during an active gesture');
  root.stopPreview();
});

await test('Bank undo/redo restores Simple Mode state for Simple Mode actions', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/undo-redo.js');

  const root = harness.context;
  const LIB = {
    waves: Array.from({ length: 64 }, () => null),
    dirty: new Set()
  };
  const SELECTED = new Set();
  const EDIT = {
    slot: 0,
    name: 'WAVE',
    _dpHeat: 1,
    dataU8: new Uint8Array([128, 160, 96, 144])
  };

  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array(EDIT.dataU8), user: true };

  root.__digiproSimpleModeState = {
    mode: 'simple',
    tableInteraction: 'classic',
    morph: 'linear',
    controlModes: makeSimpleControlModes(),
    fold: 25,
    skew: 0,
    sat: 0,
    crush: 0,
    pwm: 0,
    pd: 0,
    tone: 0,
    smear: 0
  };

  const appliedStates = [];
  root.__digiproCaptureSimpleModeState = () => JSON.parse(JSON.stringify(root.__digiproSimpleModeState));
  root.__digiproApplySimpleModeState = (next) => {
    const clone = JSON.parse(JSON.stringify(next));
    appliedStates.push(clone);
    root.__digiproSimpleModeState = clone;
  };

  root.DP_Undo.init(() => ({
    LIB,
    EDIT,
    SELECTED,
    getSelectAnchor: () => null,
    setSelectAnchor: () => {},
    getActiveIdx: () => 0,
    setActiveIdx: () => {}
  }));

  const before = root.captureBankState([0], { includeSimpleMode: true });

  root.__digiproSimpleModeState.fold = 80;
  root.__digiproSimpleModeState.controlModes.fold = 'excite';
  root.__digiproSimpleModeState.tableInteraction = 'anchor';
  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array([128, 192, 64, 160]), user: true };
  EDIT.dataU8 = new Uint8Array([128, 192, 64, 160]);
  const after = root.captureBankState([0], { includeSimpleMode: true });

  root.bankPush({ label: 'Simple Fold', before, after });

  root.bankUndo();
  expectEq(root.__digiproSimpleModeState.fold, 25, 'bank undo should restore previous Simple Mode slider state');
  expectEq(root.__digiproSimpleModeState.controlModes.fold, 'lock', 'bank undo should restore previous Simple Mode control mode');
  expectEq(root.__digiproSimpleModeState.tableInteraction, 'classic', 'bank undo should restore the previous Table Mode interaction');
  expectTypedArrayEq(LIB.waves[0].dataU8, before.waves[0].dataU8, 'bank undo should restore previous bank waveform');

  root.bankRedo();
  expectEq(root.__digiproSimpleModeState.fold, 80, 'bank redo should restore later Simple Mode slider state');
  expectEq(root.__digiproSimpleModeState.controlModes.fold, 'excite', 'bank redo should restore later Simple Mode control mode');
  expectEq(root.__digiproSimpleModeState.tableInteraction, 'anchor', 'bank redo should restore the later Table Mode interaction');
  expectTypedArrayEq(LIB.waves[0].dataU8, after.waves[0].dataU8, 'bank redo should restore later bank waveform');
  expect(appliedStates.length >= 2, 'expected Simple Mode apply hook to run during undo/redo');
});

await test('Table Mode control modes default to Lock for legacy state and survive persistence/helper history paths', async () => {
  const legacyHarness = createHarness();
  legacyHarness.context.localStorage.setItem('mm_dp_simple_mode_v1', JSON.stringify({
    mode: 'simple',
    morph: 'linear',
    fold: 41
  }));
  await runAllScripts(legacyHarness);

  const legacyRoot = legacyHarness.context;
  expectEq(legacyRoot.__digiproSimpleModeState.tableInteraction, 'classic', 'legacy simple mode state should default to Preserve Sources');
  for (const id of Object.keys(makeSimpleControlModes())){
    expectEq(legacyRoot.dpSimpleGetControlMode(legacyRoot.__digiproSimpleModeState, id), 'lock', `legacy ${id} mode should default to Lock`);
  }

  const harness = createHarness();
  harness.context.localStorage.setItem('mm_dp_simple_mode_v1', JSON.stringify({
    mode: 'simple',
    tableInteraction: 'anchor',
    morph: 'linear',
    fold: 41,
    controlModes: makeSimpleControlModes({ fold: 'excite', tone: 'excite' })
  }));
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpSimpleToggleControlMode === 'function', 'dpSimpleToggleControlMode missing');
  expectEq(root.__digiproSimpleModeState.tableInteraction, 'anchor', 'persisted Reactive Anchors mode should reload');
  expectEq(root.dpSimpleGetControlMode(root.__digiproSimpleModeState, 'fold'), 'excite', 'persisted fold mode should reload as Excite');
  expectEq(root.dpSimpleGetControlMode(root.__digiproSimpleModeState, 'tone'), 'excite', 'persisted tone mode should reload as Excite');

  const restored = makeSimpleState('fold', 41, { fold: 'excite', tone: 'excite' });
  restored.tableInteraction = 'anchor';
  root.__digiproApplySimpleModeState(restored, { fromHistory: true });
  expectEq(root.__digiproSimpleModeState.tableInteraction, 'anchor', 'history restore should keep Reactive Anchors mode');
  expectEq(root.dpSimpleGetControlMode(root.__digiproSimpleModeState, 'fold'), 'excite', 'history restore should keep fold mode');
  expectEq(root.dpSimpleGetControlMode(root.__digiproSimpleModeState, 'tone'), 'excite', 'history restore should keep tone mode');

  const toggled = root.dpSimpleToggleControlMode(root.__digiproSimpleModeState, 'fold');
  expectEq(root.dpSimpleGetControlMode(toggled, 'fold'), 'lock', 'toggle helper should flip fold mode back to Lock');
  expectEq(root.dpSimpleGetControlMode(toggled, 'tone'), 'excite', 'toggle helper should preserve other control modes');
});

await test('Reactive Anchors rebases from the latest committed table and uses circular anchor segments', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpBuildReactiveSimpleCapture === 'function', 'dpBuildReactiveSimpleCapture missing');
  expect(typeof root.dpRenderReactiveSimpleSlot === 'function', 'dpRenderReactiveSimpleSlot missing');

  const original = buildRichWave(96, 0.27, 0.11);
  const startState = makeSimpleState('fold', 0);
  startState.tableInteraction = 'anchor';
  const firstCapture = root.dpBuildReactiveSimpleCapture({
    targets: [0],
    liveBySlot: {
      0: { slot: 0, name: 'BAS0', heat: 1, dataU8: cloneWave(original) }
    },
    anchorSlots: [],
    startState
  });
  expectTypedArrayEq(firstCapture.bySlot[0].referenceU8, original, 'first reactive gesture should capture the live table as its reference');

  const foldState = makeSimpleState('fold', 72);
  foldState.tableInteraction = 'anchor';
  const firstOut = root.dpRenderReactiveSimpleSlot(firstCapture, 0, foldState);
  expect(firstOut && firstOut.length, 'first reactive preview should produce a wave');

  const secondStart = makeSimpleState('fold', 72);
  secondStart.tableInteraction = 'anchor';
  const secondCapture = root.dpBuildReactiveSimpleCapture({
    targets: [0],
    liveBySlot: {
      0: { slot: 0, name: 'BAS0', heat: 1, dataU8: cloneWave(firstOut) }
    },
    anchorSlots: [],
    startState: secondStart
  });
  expectTypedArrayEq(secondCapture.bySlot[0].referenceU8, firstOut, 'next reactive gesture should rebase to the latest committed wave');

  const skewState = makeSimpleState('skew', 48);
  skewState.tableInteraction = 'anchor';
  skewState.fold = 72;
  const rebasedOut = root.dpRenderReactiveSimpleSlot(secondCapture, 0, skewState);
  const staleOut = root.dpRenderReactiveSimpleSlot(firstCapture, 0, skewState);
  expect(!typedArraysEqual(rebasedOut, staleOut), 'reactive follow-up gestures should diverge from stale pre-commit references');

  const wrapTargets = [0, 12, 24, 48, 63];
  const wrapLiveBySlot = {
    0: { slot: 0, name: 'W00', heat: 1, dataU8: buildRichWave(96, 0.12, 0.06) },
    12: { slot: 12, name: 'W12', heat: 1, dataU8: buildRichWave(96, 0.68, 0.14) },
    24: { slot: 24, name: 'W24', heat: 1, dataU8: buildRichWave(96, 1.16, 0.26) },
    48: { slot: 48, name: 'W48', heat: 1, dataU8: buildRichWave(96, 1.92, 0.42) },
    63: { slot: 63, name: 'W63', heat: 1, dataU8: buildRichWave(96, 2.47, 0.59) }
  };
  const wrapState = makeSimpleState('tone', 0);
  wrapState.tableInteraction = 'anchor';
  const wrapCapture = root.dpBuildReactiveSimpleCapture({
    targets: wrapTargets,
    liveBySlot: wrapLiveBySlot,
    anchorSlots: [12, 63],
    startState: wrapState
  });

  expectEq(wrapCapture.bySlot[0].prevAnchorSlot, 63, 'wrap-around segment should treat the last anchor as the previous anchor');
  expectEq(wrapCapture.bySlot[0].nextAnchorSlot, 12, 'wrap-around segment should wrap back to the first anchor');
  expect(wrapCapture.bySlot[0].t > 0 && wrapCapture.bySlot[0].t < 1, 'wrap-around segment should assign an interior normalized position');
});

await test('Reactive Anchors applies endpoint table state to selected anchors while reshaping intermediate slots', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  const targets = [0, 1, 2, 3];
  const liveBySlot = {
    0: { slot: 0, name: 'A000', heat: 1, dataU8: buildRichWave(96, 0.10, 0.04) },
    1: { slot: 1, name: 'A001', heat: 1, dataU8: buildRichWave(96, 0.57, 0.13) },
    2: { slot: 2, name: 'A002', heat: 1, dataU8: buildRichWave(96, 1.03, 0.22) },
    3: { slot: 3, name: 'A003', heat: 1, dataU8: buildRichWave(96, 1.61, 0.31) }
  };

  const gestures = [
    ['fold', 84],
    ['skew', 58],
    ['tone', -52],
    ['pwm', 74],
    ['pd', 68]
  ];

  for (const [controlId, controlValue] of gestures){
    const startState = makeSimpleState(controlId, 0);
    startState.tableInteraction = 'anchor';
    const currentState = makeSimpleState(controlId, controlValue);
    currentState.tableInteraction = 'anchor';
    const capture = root.dpBuildReactiveSimpleCapture({
      targets,
      liveBySlot,
      anchorSlots: [0, 3],
      startState
    });

    const endpointState = root.dpSimpleStateFromPositionalAmount(currentState, 0);
    const leftAnchor = root.dpRenderReactiveSimpleSlot(capture, 0, currentState);
    const rightAnchor = root.dpRenderReactiveSimpleSlot(capture, 3, currentState);
    expectTypedArrayEq(
      leftAnchor,
      root.dpApplySimpleModeStateU8(liveBySlot[0].dataU8, endpointState),
      `${controlId} should render the first anchor with the endpoint table state`
    );
    expectTypedArrayEq(
      rightAnchor,
      root.dpApplySimpleModeStateU8(liveBySlot[3].dataU8, endpointState),
      `${controlId} should render the last anchor with the endpoint table state`
    );

    const middleA = root.dpRenderReactiveSimpleSlot(capture, 1, currentState);
    const middleB = root.dpRenderReactiveSimpleSlot(capture, 2, currentState);
    expect(
      !typedArraysEqual(middleA, liveBySlot[1].dataU8) || !typedArraysEqual(middleB, liveBySlot[2].dataU8),
      `${controlId} should reshape at least one intermediate slot`
    );
  }
});

await test('Reactive Anchors can use a standout in-between wave as a soft guidepost', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpSimpleInterpolateReferenceU8 === 'function', 'dpSimpleInterpolateReferenceU8 missing');

  const anchorA = buildRichWave(96, 0.05, 0.02);
  const anchorB = buildRichWave(96, 0.11, 0.04);
  const standout = new Uint8Array(96);
  for (let i = 0; i < standout.length; i += 1){
    const phase = i / standout.length;
    standout[i] = (phase < 0.28 || (phase > 0.56 && phase < 0.8)) ? 228 : 34;
  }

  const liveBySlot = {
    0: { slot: 0, name: 'G000', heat: 1, dataU8: anchorA },
    1: { slot: 1, name: 'G001', heat: 1, dataU8: root.dpSimpleInterpolateReferenceU8(anchorA, standout, 0.5, 'linear') },
    2: { slot: 2, name: 'G002', heat: 1, dataU8: standout },
    3: { slot: 3, name: 'G003', heat: 1, dataU8: root.dpSimpleInterpolateReferenceU8(standout, anchorB, 0.5, 'linear') },
    4: { slot: 4, name: 'G004', heat: 1, dataU8: anchorB }
  };

  const startState = makeSimpleState('fold', 0);
  startState.tableInteraction = 'anchor';
  const capture = root.dpBuildReactiveSimpleCapture({
    targets: [0, 1, 2, 3, 4],
    liveBySlot,
    anchorSlots: [0, 4],
    startState
  });

  expectEq(capture.guideSlots.length, 1, 'reactive guide detection should find one standout guide in this segment');
  expectEq(capture.guideSlots[0], 2, 'reactive guide detection should use the standout middle slot');
  expectEq(capture.bySlot[1].segmentGuideSlot, 2, 'slot before the standout wave should reference the soft guide');
  expectEq(capture.bySlot[3].segmentGuideSlot, 2, 'slot after the standout wave should reference the soft guide');
  expectEq(capture.bySlot[2].guide, true, 'the standout slot should be marked as a soft guide');
  expectTypedArrayEq(capture.bySlot[2].referenceU8, standout, 'soft guide reference should use the standout waveform itself');

  const straight1 = root.dpSimpleInterpolateReferenceU8(anchorA, anchorB, 0.25, 'linear');
  const straight3 = root.dpSimpleInterpolateReferenceU8(anchorA, anchorB, 0.75, 'linear');
  expect(!typedArraysEqual(capture.bySlot[1].referenceU8, straight1), 'slot 1 should no longer use the straight anchor-to-anchor reference');
  expect(!typedArraysEqual(capture.bySlot[3].referenceU8, straight3), 'slot 3 should no longer use the straight anchor-to-anchor reference');
  expect(
    meanAbsDiff(capture.bySlot[1].referenceU8, liveBySlot[1].dataU8) < meanAbsDiff(straight1, liveBySlot[1].dataU8),
    'slot 1 reference should lean toward the local standout-guided section shape'
  );
  expect(
    meanAbsDiff(capture.bySlot[3].referenceU8, liveBySlot[3].dataU8) < meanAbsDiff(straight3, liveBySlot[3].dataU8),
    'slot 3 reference should lean toward the local standout-guided section shape'
  );

  const currentState = makeSimpleState('fold', 78);
  currentState.tableInteraction = 'anchor';
  const movedGuide = root.dpRenderReactiveSimpleSlot(capture, 2, currentState);
  const movedNearLeft = root.dpRenderReactiveSimpleSlot(capture, 1, currentState);
  const movedNearRight = root.dpRenderReactiveSimpleSlot(capture, 3, currentState);
  const renderCache = capture.renderCache;
  expect(renderCache && renderCache.segmentPoints, 'reactive render cache should be populated after rendering');
  const segPoints = renderCache.segmentPoints[capture.bySlot[1].segmentId|0] || [];
  const guidePoint = segPoints.find((point)=>point.slot === 2);
  expect(guidePoint && guidePoint.wave, 'reactive segment cache should contain the moved guide point');
  expectTypedArrayEq(guidePoint.wave, movedGuide, 'reactive segment interpolation should use the moved guide waveform');
  expect(!typedArraysEqual(movedGuide, standout), 'soft guide slots should still move with the gesture unless explicitly anchored');
  const leftMeta = capture.bySlot[1];
  const rightMeta = capture.bySlot[3];
  const leftState = root.dpSimpleStateFromPositionalAmount(currentState, leftMeta.influence);
  const rightState = root.dpSimpleStateFromPositionalAmount(currentState, rightMeta.influence);
  const leftResidualWeight = root.dpSimpleReactiveResidualWeight(leftMeta, renderCache.motionAmt, 0.12);
  const rightResidualWeight = root.dpSimpleReactiveResidualWeight(rightMeta, renderCache.motionAmt, 0.12);
  const staticLeft = root.dpSimpleApplyResidualU8(
    root.dpApplySimpleModeStateU8(leftMeta.referenceU8, leftState),
    leftMeta.residual,
    leftResidualWeight,
    leftMeta.liveU8
  );
  const staticRight = root.dpSimpleApplyResidualU8(
    root.dpApplySimpleModeStateU8(rightMeta.referenceU8, rightState),
    rightMeta.residual,
    rightResidualWeight,
    rightMeta.liveU8
  );
  expect(!typedArraysEqual(movedNearLeft, staticLeft), 'slot before the standout wave should render differently when the guide itself moves');
  expect(!typedArraysEqual(movedNearRight, staticRight), 'slot after the standout wave should also respond to the moved guide');
});

await test('Reactive Anchors treats interior selected slots as moving guides instead of frozen anchors', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpResolveReactiveSelectionPlan === 'function', 'reactive selection planner missing');

  const targets = [0, 1, 2, 3, 4];
  const selectedSquare = new Uint8Array(96);
  for (let i = 0; i < selectedSquare.length; i += 1){
    selectedSquare[i] = (i < selectedSquare.length * 0.55) ? 224 : 36;
  }
  const liveBySlot = {
    0: { slot: 0, name: 'S000', heat: 1, dataU8: buildRichWave(96, 0.08, 0.03) },
    1: { slot: 1, name: 'S001', heat: 1, dataU8: buildRichWave(96, 0.36, 0.11) },
    2: { slot: 2, name: 'S002', heat: 1, dataU8: selectedSquare },
    3: { slot: 3, name: 'S003', heat: 1, dataU8: buildRichWave(96, 1.21, 0.27) },
    4: { slot: 4, name: 'S004', heat: 1, dataU8: buildRichWave(96, 1.63, 0.35) }
  };

  const selectionPlan = root.dpResolveReactiveSelectionPlan([0, 2, 4], liveBySlot);
  expectEq(selectionPlan.anchorSlots.join(','), '0,4', 'only the outer selected slots should stay as hard anchors');
  expectEq(selectionPlan.guideSlots.join(','), '2', 'interior selected slots should be promoted to moving guides');

  const startState = makeSimpleState('fold', 0);
  startState.tableInteraction = 'anchor';
  const currentState = makeSimpleState('fold', 86);
  currentState.tableInteraction = 'anchor';
  const capture = root.dpBuildReactiveSimpleCapture({
    targets,
    liveBySlot,
    anchorSlots: selectionPlan.anchorSlots,
    guideSlots: selectionPlan.guideSlots,
    startState
  });

  expectEq(capture.selectedGuideSlots.join(','), '2', 'reactive capture should remember selected moving guides');
  expectEq(capture.bySlot[2].guide, true, 'interior selected slot should be flagged as a guide');
  expectEq(capture.bySlot[2].selectedGuide, true, 'interior selected slot should be marked as a selected guide');
  const straightGuide = root.dpSimpleInterpolateReferenceU8(liveBySlot[0].dataU8, liveBySlot[4].dataU8, 0.5, 'linear');
  expect(
    meanAbsDiff(capture.bySlot[2].referenceU8, straightGuide) < meanAbsDiff(liveBySlot[2].dataU8, straightGuide),
    'selected interior guide reference should be softened toward the surrounding anchor flow'
  );

  const leftAnchor = root.dpRenderReactiveSimpleSlot(capture, 0, currentState);
  const middleGuide = root.dpRenderReactiveSimpleSlot(capture, 2, currentState);
  const rightAnchor = root.dpRenderReactiveSimpleSlot(capture, 4, currentState);
  const endpointState = root.dpSimpleStateFromPositionalAmount(currentState, 0);
  expectTypedArrayEq(
    leftAnchor,
    root.dpApplySimpleModeStateU8(liveBySlot[0].dataU8, endpointState),
    'first selected slot should follow the endpoint table state'
  );
  expectTypedArrayEq(
    rightAnchor,
    root.dpApplySimpleModeStateU8(liveBySlot[4].dataU8, endpointState),
    'last selected slot should follow the endpoint table state'
  );
  expect(!typedArraysEqual(middleGuide, liveBySlot[2].dataU8), 'interior selected slot should move with the reactive morph');
  const guideState = root.dpSimpleStateFromPositionalAmount(currentState, capture.bySlot[2].influence);
  const softenedGuideTarget = root.dpApplySimpleModeStateU8(capture.bySlot[2].referenceU8, guideState);
  const rawGuideTarget = root.dpApplySimpleModeStateU8(liveBySlot[2].dataU8, guideState);
  expect(
    meanAbsDiff(middleGuide, softenedGuideTarget) < meanAbsDiff(middleGuide, rawGuideTarget),
    'selected interior guide render should lean toward the softened transition target rather than the raw square wave'
  );

  const foldMidState = makeSimpleState('fold', 50);
  foldMidState.tableInteraction = 'anchor';
  const slot2Mid = root.dpRenderReactiveSimpleSlot(capture, 2, foldMidState);
  const softenedFoldMidTarget = root.dpApplySimpleModeStateU8(
    capture.bySlot[2].referenceU8,
    root.dpSimpleStateFromPositionalAmount(foldMidState, capture.bySlot[2].influence)
  );
  const rawSquareFoldMid = root.dpApplySimpleModeStateU8(
    liveBySlot[2].dataU8,
    root.dpSimpleStateFromPositionalAmount(foldMidState, capture.bySlot[2].influence)
  );
  expect(
    meanAbsDiff(slot2Mid, softenedFoldMidTarget) < meanAbsDiff(slot2Mid, rawSquareFoldMid),
    'at fold=50, the selected interior guide should stay closer to the softened transition target than to a raw folded square wave'
  );

  const renderCache = capture.renderCache;
  expect(renderCache && renderCache.segmentPoints, 'selected-guide render should populate the reactive segment cache');
  const segPoints = renderCache.segmentPoints[capture.bySlot[1].segmentId|0] || [];
  const guidePoint = segPoints.find((point)=>point.slot === 2);
  expect(guidePoint && guidePoint.guide, 'segment interpolation should include the moving interior guide');
  expectTypedArrayEq(guidePoint.wave, slot2Mid, 'segment interpolation should reuse the rendered interior guide wave for the current state');
});

await test('Smooth Flow only creates anchors from explicit selection and otherwise falls back to normal target scope', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpResolveReactiveTargetPlan === 'function', 'reactive target planner missing');

  const liveBySlot = {
    0: { slot: 0, name: 'T000', heat: 1, dataU8: buildRichWave(96, 0.08, 0.03) },
    1: { slot: 1, name: 'T001', heat: 1, dataU8: buildRichWave(96, 0.42, 0.09) },
    2: { slot: 2, name: 'T002', heat: 1, dataU8: buildRichWave(96, 0.91, 0.18) },
    3: { slot: 3, name: 'T003', heat: 1, dataU8: buildRichWave(96, 1.34, 0.27) },
    4: { slot: 4, name: 'T004', heat: 1, dataU8: buildRichWave(96, 1.79, 0.36) }
  };

  const noSelectionPlan = root.dpResolveReactiveTargetPlan([], liveBySlot);
  expectEq(noSelectionPlan.scope, 'wavetable', 'no selection should keep Smooth Flow on the filled table');
  expectEq(noSelectionPlan.targets.join(','), '0,1,2,3,4', 'no selection should target every filled slot');
  expectEq(noSelectionPlan.anchorSlots.length, 0, 'no selection should not invent endpoint anchors');

  const selectedFallbackPlan = root.dpResolveReactiveTargetPlan([0], liveBySlot);
  expectEq(selectedFallbackPlan.scope, 'selected', 'a non-anchor selection should stay scoped to the selected slots');
  expectEq(selectedFallbackPlan.targets.join(','), '0', 'single-slot selection should not fan across the whole table');
  expectEq(selectedFallbackPlan.anchorSlots.length, 0, 'single-slot selection should not invent a partner anchor');

  const explicitAnchorPlan = root.dpResolveReactiveTargetPlan([0, 4], liveBySlot);
  expectEq(explicitAnchorPlan.scope, 'anchors', 'explicit endpoint selection should engage anchor flow');
  expectEq(explicitAnchorPlan.targets.join(','), '0,1,2,3,4', 'explicit anchors should still guide the whole filled table');
  expectEq(explicitAnchorPlan.anchorSlots.join(','), '0,4', 'only explicitly selected endpoints should become anchors');

  const fullSelectionPlan = root.dpResolveReactiveTargetPlan([0, 1, 2, 3, 4], liveBySlot);
  expectEq(fullSelectionPlan.scope, 'selected', 'selecting the whole table should stay on preserve-style selected scope');
  expectEq(fullSelectionPlan.targets.join(','), '0,1,2,3,4', 'full-table selection should still target every selected slot');
  expectEq(fullSelectionPlan.anchorSlots.length, 0, 'full-table selection should not force endpoint anchors');

  const startState = makeSimpleState('fold', 0);
  startState.tableInteraction = 'anchor';
  const currentState = makeSimpleState('fold', 78);
  currentState.tableInteraction = 'anchor';
  const noSelectionCapture = root.dpBuildReactiveSimpleCapture({
    targets: noSelectionPlan.targets,
    liveBySlot,
    anchorSlots: noSelectionPlan.anchorSlots,
    guideSlots: noSelectionPlan.guideSlots,
    startState
  });
  expectEq(noSelectionCapture.anchored, false, 'no explicit anchors should keep the reactive capture in unanchored mode');

  const firstOut = root.dpRenderReactiveSimpleSlot(noSelectionCapture, 0, currentState);
  const middleOut = root.dpRenderReactiveSimpleSlot(noSelectionCapture, 2, currentState);
  expectTypedArrayEq(
    firstOut,
    root.dpApplySimpleModeStateU8(liveBySlot[0].dataU8, root.dpSimpleFanoutState(currentState, 0, noSelectionPlan.targets.length)),
    'without explicit anchors the first slot should use the normal fanout state'
  );
  expectTypedArrayEq(
    middleOut,
    root.dpApplySimpleModeStateU8(liveBySlot[2].dataU8, root.dpSimpleFanoutState(currentState, 2, noSelectionPlan.targets.length)),
    'without explicit anchors interior slots should also stay on the normal fanout path'
  );

  const fullSelectionCapture = root.dpBuildReactiveSimpleCapture({
    targets: fullSelectionPlan.targets,
    liveBySlot,
    anchorSlots: fullSelectionPlan.anchorSlots,
    guideSlots: fullSelectionPlan.guideSlots,
    startState
  });
  expectEq(fullSelectionCapture.anchored, false, 'selecting the whole table should keep Smooth Flow on the unanchored preserve-style path');
  expectTypedArrayEq(
    root.dpRenderReactiveSimpleSlot(fullSelectionCapture, 0, currentState),
    root.dpApplySimpleModeStateU8(liveBySlot[0].dataU8, root.dpSimpleFanoutState(currentState, 0, fullSelectionPlan.targets.length)),
    'full-table selection should not special-case the first slot'
  );
  expectTypedArrayEq(
    root.dpRenderReactiveSimpleSlot(fullSelectionCapture, 4, currentState),
    root.dpApplySimpleModeStateU8(liveBySlot[4].dataU8, root.dpSimpleFanoutState(currentState, 4, fullSelectionPlan.targets.length)),
    'full-table selection should not special-case the last slot'
  );
});

await test('Reactive Anchors invalidates stale captures on selection changes, bank changes, and history restores', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  const runtime = root.__digiproSimpleModeRuntime;
  expect(runtime, 'simple mode runtime missing');
  expect(typeof root.__digiproHandleSimpleModeSelectionChange === 'function', 'selection invalidation hook missing');
  expect(typeof root.__digiproUndoOnChange === 'function', 'bank hook missing');
  expect(typeof root.__digiproApplySimpleModeState === 'function', 'history apply hook missing');

  runtime.reactive.capture = { demo: true };
  runtime.reactive.selectionSignature = '1,2';
  runtime.reactive.anchorSignature = '1,2';

  root.__digiproHandleSimpleModeSelectionChange({
    selectedSlots: [2, 4],
    anchorSlots: [2, 4]
  });

  expectEq(runtime.reactive.capture, null, 'selection changes should clear the reactive capture');
  expectEq(runtime.reactive.selectionSignature, '2,4', 'selection changes should update the cached selection signature');
  expectEq(runtime.reactive.anchorSignature, '2,4', 'selection changes should update the cached anchor signature');

  runtime.reactive.capture = { demo: true };
  root.__digiproUndoOnChange({ domain: 'bank', op: 'push', touched: [2, 4] });
  expectEq(runtime.reactive.capture, null, 'external bank changes should clear the reactive capture');

  runtime.reactive.capture = { demo: true };
  root.__digiproUndoOnChange({
    domain: 'bank',
    op: 'push',
    touched: [2, 4],
    preserveSimpleModeSources: true
  });
  expectEq(runtime.reactive.capture, null, 'reactive self-commits should still clear the reactive capture');

  runtime.reactive.capture = { demo: true };
  const restored = makeSimpleState('fold', 33, { fold: 'excite' });
  restored.tableInteraction = 'anchor';
  root.__digiproApplySimpleModeState(restored, { fromHistory: true });
  expectEq(runtime.reactive.capture, null, 'history restore should clear the reactive capture');
  expectEq(root.__digiproSimpleModeState.tableInteraction, 'anchor', 'history restore should keep the restored reactive mode');
});

await test('undoAny runs pending-history hook before navigating history', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/undo-redo.js');

  const root = harness.context;
  const LIB = {
    waves: Array.from({ length: 64 }, () => null),
    dirty: new Set()
  };
  const SELECTED = new Set();
  const EDIT = {
    slot: 0,
    name: 'WAVE',
    _dpHeat: 1,
    dataU8: new Uint8Array([128, 160, 96, 144])
  };

  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array(EDIT.dataU8), user: true };

  root.DP_Undo.init(() => ({
    LIB,
    EDIT,
    SELECTED,
    getSelectAnchor: () => null,
    setSelectAnchor: () => {},
    getActiveIdx: () => 0,
    setActiveIdx: () => {}
  }));

  const before = root.captureBankState([0]);
  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array([128, 192, 64, 160]), user: true };
  const after = root.captureBankState([0]);
  root.bankPush({ label: 'History Hook', before, after });

  let hookRuns = 0;
  root.__digiproBeforeUndoRedo = () => { hookRuns += 1; };

  root.undoAny();

  expectEq(hookRuns, 1, 'undoAny should call the pre-history hook once');
  expectTypedArrayEq(LIB.waves[0].dataU8, before.waves[0].dataU8, 'undoAny should still apply bank undo after the hook');
});

await test('Fresh editor edits invalidate stale bank redo tails', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/undo-redo.js');

  const root = harness.context;
  const LIB = {
    waves: Array.from({ length: 64 }, () => null),
    dirty: new Set()
  };
  const SELECTED = new Set();
  const EDIT = {
    slot: 0,
    name: 'WAVE',
    _dpHeat: 1,
    dataU8: new Uint8Array([1, 2, 3, 4])
  };

  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array(EDIT.dataU8), user: true };

  root.DP_Undo.init(() => ({
    LIB,
    EDIT,
    SELECTED,
    getSelectAnchor: () => null,
    setSelectAnchor: () => {},
    getActiveIdx: () => 0,
    setActiveIdx: () => {}
  }));

  root.initUndo();

  const before = root.captureBankState([0]);
  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array([9, 9, 9, 9]), user: true };
  EDIT.dataU8 = new Uint8Array([9, 9, 9, 9]);
  const after = root.captureBankState([0]);
  root.bankPush({ label: 'bank change', before, after });

  root.undoAny();
  expect(root.bankCanRedo(), 'bank redo tail should exist immediately after bank undo');

  EDIT.dataU8 = new Uint8Array([5, 5, 5, 5]);
  root.snapshot('editor change');

  expect(!root.bankCanRedo(), 'fresh editor edit should invalidate stale bank redo tail');

  root.redoAny();
  expectTypedArrayEq(LIB.waves[0].dataU8, before.waves[0].dataU8, 'redoAny should not replay the stale bank action after a newer editor edit');
  expectTypedArrayEq(EDIT.dataU8, new Uint8Array([5, 5, 5, 5]), 'redoAny should preserve the newer editor edit');
});

await test('Fresh bank writes invalidate stale editor redo tails', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/undo-redo.js');

  const root = harness.context;
  const LIB = {
    waves: Array.from({ length: 64 }, () => null),
    dirty: new Set()
  };
  const SELECTED = new Set();
  const EDIT = {
    slot: 0,
    name: 'WAVE',
    _dpHeat: 1,
    dataU8: new Uint8Array([1, 2, 3, 4])
  };

  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array(EDIT.dataU8), user: true };

  root.DP_Undo.init(() => ({
    LIB,
    EDIT,
    SELECTED,
    getSelectAnchor: () => null,
    setSelectAnchor: () => {},
    getActiveIdx: () => 0,
    setActiveIdx: () => {}
  }));

  root.initUndo();
  EDIT.dataU8 = new Uint8Array([7, 7, 7, 7]);
  root.snapshot('editor change');
  root.undoAny();
  expect(root.canRedo(), 'editor redo tail should exist immediately after editor undo');

  const before = root.captureBankState([0]);
  LIB.waves[0] = { name: 'WAVE', dataU8: new Uint8Array([9, 9, 9, 9]), user: true };
  const after = root.captureBankState([0]);
  root.bankPush({ label: 'bank change', before, after });

  expect(!root.canRedo(), 'fresh bank write should invalidate stale editor redo tail');

  root.redoAny();
  expectTypedArrayEq(LIB.waves[0].dataU8, after.waves[0].dataU8, 'redoAny should preserve the newer bank write');
  expectTypedArrayEq(EDIT.dataU8, new Uint8Array([1, 2, 3, 4]), 'redoAny should not replay the stale editor redo after a newer bank write');
});

await test('Table Mode keeps sat/crush global while pwm/pd fan out across the table in both modes', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpSimpleFanoutState === 'function', 'dpSimpleFanoutState missing');

  for (const mode of ['lock', 'excite']){
    for (const controlId of ['sat', 'crush']){
      const state = makeSimpleState(controlId, 63, { [controlId]: mode });
      const first = root.dpSimpleFanoutState(state, 0, 8);
      const middle = root.dpSimpleFanoutState(state, 4, 8);
      const last = root.dpSimpleFanoutState(state, 7, 8);

      expectEq(first[controlId], 63, `${controlId} should affect the first slot by the same amount in ${mode}`);
      expectEq(middle[controlId], 63, `${controlId} should affect middle slots by the same amount in ${mode}`);
      expectEq(last[controlId], 63, `${controlId} should affect the last slot by the same amount in ${mode}`);
      expectEq(root.dpSimpleGetControlMode(first, controlId), mode, `${controlId} mode should stay ${mode} on the first slot`);
      expectEq(root.dpSimpleGetControlMode(last, controlId), mode, `${controlId} mode should stay ${mode} on the last slot`);
    }

    for (const controlId of ['pwm', 'pd']){
      const state = makeSimpleState(controlId, 100, { [controlId]: mode });
      const first = root.dpSimpleFanoutState(state, 0, 8);
      const middle = root.dpSimpleFanoutState(state, 4, 8);
      const last = root.dpSimpleFanoutState(state, 7, 8);

      expectEq(first[controlId], 0, `${controlId} should leave the first slot unchanged in ${mode}`);
      expect(middle[controlId] > 0 && middle[controlId] < 100, `${controlId} should ramp through intermediate slots in ${mode}`);
      expectEq(last[controlId], 100, `${controlId} should reach full strength at the end of the table in ${mode}`);
      expectEq(root.dpSimpleGetControlMode(middle, controlId), mode, `${controlId} mode should stay ${mode} through the fanout state`);
    }
  }
});

await test('Table Mode crush excite adds deterministic hiss while keeping zero as exact bypass', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  const base = buildRichWave(96, 0.31, 0.14);
  const zeroState = makeSimpleState('crush', 0, { crush: 'excite' });
  const zeroOut = root.dpApplySimpleModeStateU8(base, zeroState);
  expectTypedArrayEq(zeroOut, base, 'crush excite should still bypass exactly at zero');

  const lockState = makeSimpleState('crush', 58, { crush: 'lock' });
  const exciteState = makeSimpleState('crush', 58, { crush: 'excite' });
  const lockOut = root.dpApplySimpleModeStateU8(base, lockState);
  const exciteA = root.dpApplySimpleModeStateU8(base, exciteState);
  const exciteB = root.dpApplySimpleModeStateU8(base, exciteState);

  expectTypedArrayEq(exciteA, exciteB, 'crush excite hiss should be deterministic for the same source/state');
  expect(!typedArraysEqual(lockOut, exciteA), 'crush excite should differ from crush lock at the same amount');
  expect(meanAbsDiff(lockOut, exciteA) > 0.1, 'crush excite hiss should be audible enough to register against crush lock');
});

await test('Table Mode invalidates cached bases on external bank changes but keeps its own commits warm', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  const runtime = root.__digiproSimpleModeRuntime;
  expect(runtime, 'simple mode runtime missing');
  expect(typeof root.__digiproUndoOnChange === 'function', 'Table Mode bank hook missing');

  const canceled = [];
  root.cancelAnimationFrame = (id) => { canceled.push(id); };

  runtime.sources = {
    0: {
      dataU8: new Uint8Array([1, 2, 3, 4]),
      resultU8: new Uint8Array([4, 3, 2, 1])
    }
  };
  runtime.source = { slot: 0, dataU8: new Uint8Array([1, 2, 3, 4]) };
  runtime.gesture = { targets: [0] };
  runtime.raf = 91;
  runtime.pendingPreview = true;
  runtime.pendingBase = { demo: true };
  runtime.pendingPaint = { demo: true };
  runtime.pendingTouch = { demo: true };

  root.__digiproUndoOnChange({ domain: 'bank', op: 'push', touched: [0] });

  expectEq(canceled[0], 91, 'external bank push should cancel pending preview frame');
  expectEq(runtime.gesture, null, 'external bank push should clear any live table gesture');
  expectEq(runtime.pendingPreview, false, 'external bank push should clear pending preview flag');
  expectEq(Object.keys(runtime.sources).length, 0, 'external bank push should clear cached Table Mode sources');

  runtime.sources = {
    7: {
      dataU8: new Uint8Array([7, 7, 7, 7]),
      resultU8: new Uint8Array([8, 8, 8, 8])
    }
  };
  runtime.gesture = { targets: [7] };
  runtime.pendingPreview = true;

  root.__digiproUndoOnChange({
    domain: 'bank',
    op: 'push',
    touched: [7],
    preserveSimpleModeSources: true
  });

  expectEq(runtime.gesture.targets[0], 7, 'Table Mode self-commit should not drop the in-session gesture context');
  expectEq(runtime.pendingPreview, true, 'Table Mode self-commit should leave preview state intact');
  expectEq(Object.keys(runtime.sources).length, 1, 'Table Mode self-commit should preserve cached sources');
});

await test('Table Mode preserved session bases let a slider return to zero without changing the table shape in both modes', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpSimpleCaptureBaseFromRuntime === 'function', 'dpSimpleCaptureBaseFromRuntime missing');
  expect(typeof root.dpApplySimpleModeStateU8 === 'function', 'dpApplySimpleModeStateU8 missing');

  const runtime = {
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

  const original = buildRichWave(96, 0.37, 0.19);
  for (const foldMode of ['lock', 'excite']){
    for (const skewMode of ['lock', 'excite']){
      runtime.source = null;
      runtime.sources = Object.create(null);

      const foldState = makeSimpleState('fold', 88, { fold: foldMode, skew: skewMode });
      const foldedBase = root.dpSimpleCaptureBaseFromRuntime(runtime, {
        slot: 0,
        name: 'BASE',
        heat: 1,
        dataU8: cloneWave(original)
      }, foldState, 0, 1);
      expect(foldedBase, `fold base capture missing for ${foldMode}/${skewMode}`);

      const foldedWave = root.dpApplySimpleModeStateU8(foldedBase.dataU8, foldState);
      runtime.sources[0].resultU8 = cloneWave(foldedWave);

      const skewState = makeSimpleState('skew', -1, { fold: foldMode, skew: skewMode });
      skewState.fold = 88;
      const preservedBase = root.dpSimpleCaptureBaseFromRuntime(runtime, {
        slot: 0,
        name: 'FOLD',
        heat: 1,
        dataU8: cloneWave(foldedWave)
      }, skewState, 0, 1);

      expectTypedArrayEq(
        preservedBase.dataU8,
        original,
        `next control should keep using the preserved pre-fold source wave for ${foldMode}/${skewMode}`
      );

      const zeroState = makeSimpleState('skew', 0, { fold: foldMode, skew: skewMode });
      zeroState.fold = 88;
      const zeroWave = root.dpApplySimpleModeStateU8(preservedBase.dataU8, zeroState);
      expectTypedArrayEq(
        zeroWave,
        foldedWave,
        `bringing the second control back to zero should restore the prior table shape for ${foldMode}/${skewMode}`
      );
    }
  }
});

await test('Table Mode cache is also cleared on bank undo/redo and history simple-mode restore', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  const runtime = root.__digiproSimpleModeRuntime;
  expect(runtime, 'simple mode runtime missing');
  expect(typeof root.__digiproUndoOnChange === 'function', 'Table Mode bank hook missing');
  expect(typeof root.__digiproApplySimpleModeState === 'function', 'Table Mode history apply hook missing');

  runtime.sources = {
    1: {
      dataU8: new Uint8Array([10, 20, 30, 40]),
      resultU8: new Uint8Array([40, 30, 20, 10])
    }
  };
  runtime.gesture = { targets: [1] };
  runtime.pendingPreview = true;

  root.__digiproUndoOnChange({ domain: 'bank', op: 'undo', touched: [1] });
  expectEq(runtime.gesture, null, 'bank undo should clear any live Table Mode gesture');
  expectEq(runtime.pendingPreview, false, 'bank undo should clear pending preview state');
  expectEq(Object.keys(runtime.sources).length, 0, 'bank undo should clear cached Table Mode sources');

  runtime.sources = {
    2: {
      dataU8: new Uint8Array([11, 21, 31, 41]),
      resultU8: new Uint8Array([41, 31, 21, 11])
    }
  };
  runtime.gesture = { targets: [2] };
  runtime.pendingPreview = true;

  root.__digiproUndoOnChange({ domain: 'bank', op: 'redo', touched: [2] });
  expectEq(runtime.gesture, null, 'bank redo should clear any live Table Mode gesture');
  expectEq(runtime.pendingPreview, false, 'bank redo should clear pending preview state');
  expectEq(Object.keys(runtime.sources).length, 0, 'bank redo should clear cached Table Mode sources');

  runtime.sources = {
    3: {
      dataU8: new Uint8Array([12, 22, 32, 42]),
      resultU8: new Uint8Array([42, 32, 22, 12])
    }
  };
  runtime.source = { slot: 3, dataU8: new Uint8Array([12, 22, 32, 42]) };

  root.__digiproApplySimpleModeState({
    mode: 'simple',
    morph: 'linear',
    controlModes: makeSimpleControlModes({ fold: 'excite', tone: 'excite' }),
    fold: 33,
    skew: 0,
    sat: 0,
    crush: 0,
    pwm: 0,
    pd: 0,
    tone: 0,
    smear: 0
  }, { fromHistory: true });

  expectEq(Object.keys(runtime.sources).length, 0, 'history restore should clear cached Table Mode sources');
  expectEq(runtime.source, null, 'history restore should clear the remembered Table Mode source');
  expectEq(root.__digiproSimpleModeState.fold, 33, 'history restore should still apply the restored slider state');
  expectEq(root.dpSimpleGetControlMode(root.__digiproSimpleModeState, 'fold'), 'excite', 'history restore should still apply the restored control mode');
  expectEq(root.dpSimpleGetControlMode(root.__digiproSimpleModeState, 'tone'), 'excite', 'history restore should preserve other stored control modes');
});

await test('Table Mode slider cache refreshes to the latest pasted bank state for every slider control', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpSimpleCaptureBaseFromRuntime === 'function', 'dpSimpleCaptureBaseFromRuntime missing');
  expect(typeof root.dpInvalidateSimpleModeSources === 'function', 'dpInvalidateSimpleModeSources missing');
  expect(typeof root.dpApplySimpleModeStateU8 === 'function', 'dpApplySimpleModeStateU8 missing');

  const base = buildRichWave(96, 0.37, 0.19);
  const controls = [
    { id: 'fold', initial: [25, 50, 75] },
    { id: 'skew', initial: [-70, -40, 40, 70] },
    { id: 'sat', initial: [20, 45, 75] },
    { id: 'crush', initial: [25, 55, 80] },
    { id: 'pwm', initial: [20, 50, 80] },
    { id: 'pd', initial: [20, 45, 75] },
    { id: 'tone', initial: [-70, -40, 40, 70] },
    { id: 'smear', initial: [20, 45, 75] }
  ];
  const followUps = [
    ['fold', 68],
    ['skew', -58],
    ['skew', 58],
    ['sat', 72],
    ['crush', 84],
    ['pwm', 72],
    ['pd', 66],
    ['tone', -62],
    ['tone', 62],
    ['smear', 74]
  ];

  for (const control of controls){
    let foundDivergence = false;

    for (const initialValue of control.initial){
      const runtime = {
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
      const firstState = makeSimpleState(control.id, initialValue);
      const liveBase = {
        slot: 0,
        name: 'BASE',
        heat: 1,
        dataU8: cloneWave(base)
      };

      const capturedBase = root.dpSimpleCaptureBaseFromRuntime(runtime, liveBase, firstState, 0, 1);
      expect(capturedBase, `${control.id} initial base capture missing`);
      const rendered = root.dpApplySimpleModeStateU8(capturedBase.dataU8, firstState);
      runtime.sources[0].resultU8 = cloneWave(rendered);

      const pastedLive = {
        slot: 0,
        name: 'PAST',
        heat: 1,
        dataU8: cloneWave(rendered)
      };

      const staleBase = root.dpSimpleCaptureBaseFromRuntime(runtime, pastedLive, firstState, 0, 1);
      expectTypedArrayEq(staleBase.dataU8, base, `${control.id} should reuse the cached pre-paste base before invalidation`);

      root.dpInvalidateSimpleModeSources(runtime, { cancelGesture: true });

      const freshBase = root.dpSimpleCaptureBaseFromRuntime(runtime, pastedLive, firstState, 0, 1);
      expectTypedArrayEq(freshBase.dataU8, rendered, `${control.id} should treat the pasted wave as the new base after invalidation`);

      for (const [followId, followValue] of followUps){
        const nextState = makeSimpleState(control.id, initialValue);
        nextState[followId] = followValue;
        const staleOut = root.dpApplySimpleModeStateU8(staleBase.dataU8, nextState);
        const freshOut = root.dpApplySimpleModeStateU8(freshBase.dataU8, nextState);
        if (!typedArraysEqual(staleOut, freshOut)){
          foundDivergence = true;
          break;
        }
      }

      if (foundDivergence) break;
    }

    expect(foundDivergence, `${control.id} should produce a different follow-up result when stale bases are reused`);
  }
});

await test('Table Mode re-captures the latest reversed slot order before every slider family re-runs', async () => {
  const harness = createHarness();
  await runAllScripts(harness);

  const root = harness.context;
  expect(typeof root.dpSimpleCaptureBaseFromRuntime === 'function', 'dpSimpleCaptureBaseFromRuntime missing');
  expect(typeof root.__digiproUndoOnChange === 'function', 'Table Mode bank hook missing');

  const controls = [
    ['fold', 60],
    ['skew', -55],
    ['sat', 70],
    ['crush', 82],
    ['pwm', 66],
    ['pd', 62],
    ['tone', 58],
    ['smear', 74]
  ];
  const latestLive = [
    buildRichWave(96, 0.11, 0.07),
    buildRichWave(96, 0.89, 0.29),
    buildRichWave(96, 1.67, 0.53),
    buildRichWave(96, 2.41, 0.81)
  ];
  const reversedLive = latestLive.slice().reverse().map(cloneWave);

  for (const [controlId, controlValue] of controls){
    const runtime = root.__digiproSimpleModeRuntime;
    runtime.source = null;
    runtime.sources = Object.create(null);
    runtime.gesture = { targets: [0, 1, 2, 3] };
    runtime.pendingPreview = true;

    for (let slot = 0; slot < latestLive.length; slot += 1){
      runtime.sources[slot] = {
        dataU8: buildRichWave(96, 3.1 + slot, 0.17 + (slot * 0.1)),
        resultU8: cloneWave(latestLive[slot])
      };
    }

    root.__digiproUndoOnChange({ domain: 'bank', op: 'push', touched: [0, 1, 2, 3] });
    expectEq(Object.keys(runtime.sources).length, 0, `${controlId} reverse-flow should clear stale cached slot order`);

    const state = makeSimpleState(controlId, controlValue);
    for (let slot = 0; slot < reversedLive.length; slot += 1){
      const captured = root.dpSimpleCaptureBaseFromRuntime(runtime, {
        slot,
        name: `R${slot}`,
        heat: 1,
        dataU8: cloneWave(reversedLive[slot])
      }, state, slot, reversedLive.length);
      expectTypedArrayEq(captured.dataU8, reversedLive[slot], `${controlId} should capture reversed slot ${slot + 1} as the new live base`);
    }
  }
});

await test('DigiPRO SysEx encode/decode and request flow', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/digipro-sysex.js');
  const dp = harness.context.MMDT_DigiPRO;
  expect(dp, 'MMDT_DigiPRO missing');

  const tables = buildTables(dp.SAMPLES_PER_TABLE);
  const msg = dp.encodeSlot6132({ slot: 11, name: 'E2E1', tables, deviceId: 0x12 });
  expectEq(msg.length, dp.MSG_SIZE_BYTES, 'encoded message length mismatch');
  expectEq(msg[0], 0xF0, 'SysEx must start with 0xF0');
  expectEq(msg[msg.length - 1], 0xF7, 'SysEx must end with 0xF7');

  const decoded = dp.decode(msg);
  expectEq(decoded.slot, 11, 'decoded slot mismatch');
  expectEq(decoded.name, 'E2E1', 'decoded name mismatch');
  expect(decoded.checksumOk, 'checksum should be valid');
  expectTypedArrayEq(decoded.tables.t0, tables.t0, 't0 roundtrip mismatch');
  expectTypedArrayEq(decoded.tables.t1, tables.t1, 't1 roundtrip mismatch');
  expectTypedArrayEq(decoded.tables.t2, tables.t2, 't2 roundtrip mismatch');

  const req = dp.buildRequest(63, 0x22);
  expectEq(req.length, 17, 'request length mismatch');
  expectEq(req[5], 0x22, 'request device ID mismatch');
  expectEq(req[6], dp.ID_REQ, 'request message ID mismatch');
  expectEq(req[9], 63, 'request slot mismatch');
});

await test('DigiPRO decodeMany finds multiple concatenated messages', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/digipro-sysex.js');
  const dp = harness.context.MMDT_DigiPRO;

  const msgA = dp.encodeSlot6132({ slot: 1, name: 'A001', tables: buildTables(dp.SAMPLES_PER_TABLE), deviceId: 0 });
  const msgB = dp.encodeSlot6132({ slot: 2, name: 'B002', tables: buildTables(dp.SAMPLES_PER_TABLE), deviceId: 0 });

  const blob = new Uint8Array(4 + msgA.length + 3 + msgB.length + 2);
  blob.set([0x01, 0x02, 0x03, 0x04], 0);
  blob.set(msgA, 4);
  blob.set([0x11, 0x22, 0x33], 4 + msgA.length);
  blob.set(msgB, 4 + msgA.length + 3);
  blob.set([0x44, 0x55], 4 + msgA.length + 3 + msgB.length);

  const out = dp.decodeMany(blob);
  expectEq(out.length, 2, 'decodeMany should return exactly 2 messages');
  expectEq(out[0].slot, 1, 'first decoded slot mismatch');
  expectEq(out[1].slot, 2, 'second decoded slot mismatch');
});

await test('Import/export WAV, dp5d chunk, and ZIP helpers', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/digipro-sysex.js');
  await harness.runFile('assets/js/import-export.js');

  const root = harness.context;
  const cycle = new Uint8Array(96);
  for (let i = 0; i < cycle.length; i += 1){
    cycle[i] = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.sin((i / cycle.length) * Math.PI * 2))));
  }

  const smpl = root.buildSmplLoopChunk(0, 96, 48000, { midiUnityNote: 60 });
  const wav = root.pcm16WavFromU8(cycle, 48000, [{ id: 'smpl', bytes: smpl }]);
  const parsed = root.parseWavToU8(wav.buffer);

  expectEq(parsed.length, 96, 'parsed WAV cycle length mismatch');
  const mad = meanAbsDiff(parsed, cycle);
  expect(mad <= 30, `WAV roundtrip mean-abs-diff too high: ${mad.toFixed(2)}`);

  const dp = root.MMDT_DigiPRO;
  const syx = dp.encodeSlot6132({ slot: 9, name: 'WAVE', tables: buildTables(dp.SAMPLES_PER_TABLE), deviceId: 0 });
  const dp5d = root.buildDp5dChunk(syx);
  const wavWithChunk = root.pcm16WavFromU8(cycle, 48000, [{ id: 'dp5d', bytes: dp5d }]);
  const recovered = root.wavExtractDp5dSyx(wavWithChunk.buffer);
  // VM contexts produce cross-realm typed arrays, so use ArrayBuffer.isView.
  expect(recovered && ArrayBuffer.isView(recovered), 'embedded dp5d sysex not recovered');
  expectTypedArrayEq(recovered, syx, 'embedded dp5d sysex mismatch');

  const zip = root.zipFiles([
    { name: 'a.txt', bytes: new Uint8Array([1, 2, 3]) },
    { name: 'b.bin', bytes: new Uint8Array([4, 5]) }
  ]);
  expectEq(zip[0], 0x50, 'zip local header magic mismatch (P)');
  expectEq(zip[1], 0x4B, 'zip local header magic mismatch (K)');
  expectEq(zip[zip.length - 22], 0x50, 'zip EOCD magic mismatch (P)');
  expectEq(zip[zip.length - 21], 0x4B, 'zip EOCD magic mismatch (K)');
});

await test('MIDI SysEx fragment reassembly reaches app receiver', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/boot.js');
  await harness.runFile('assets/js/digipro-sysex.js');
  await harness.runFile('assets/js/midi.js');

  const root = harness.context;
  const dp = root.MMDT_DigiPRO;
  const syx = dp.encodeSlot6132({
    slot: 3,
    name: 'MID1',
    tables: buildTables(dp.SAMPLES_PER_TABLE),
    deviceId: 0
  });

  const received = [];
  root.MMDT.receive = (u8) => { received.push(new Uint8Array(u8)); };
  root.dpPassiveCaptureEnabled = true;
  if (typeof root.__mmSysexReset === 'function') root.__mmSysexReset();

  root.__mmSysexFeed(syx.slice(0, 1200));
  root.__mmSysexFeed(syx.slice(1200, 4096));
  root.__mmSysexFeed(syx.slice(4096));

  expectEq(received.length, 1, 'expected one fully reassembled SysEx');
  expectTypedArrayEq(received[0], syx, 'reassembled SysEx payload mismatch');
});

await test('TM-1 detection retries after an initial missed probe and preserves TM-1 Turbo control', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/boot.js');
  await harness.runFile('assets/js/midi.js');

  const root = harness.context;
  root.selectedMidiIn = {};

  let tmIdx = 1;
  let queryCount = 0;
  root.selectedMidiOut = {
    send(bytes){
      const u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes || []);
      // TM-1 query: F0 00 20 3C 04 00 01 F7
      if (u8.length === 8 &&
          u8[0] === 0xF0 && u8[1] === 0x00 && u8[2] === 0x20 && u8[3] === 0x3C &&
          u8[4] === 0x04 && u8[5] === 0x00 && u8[6] === 0x01 && u8[7] === 0xF7){
        queryCount += 1;
        if (queryCount >= 2){
          setTimeout(() => {
            root.__mmSysexFeed(new Uint8Array([0xF0,0x00,0x20,0x3C,0x04,0x00,0x02, tmIdx & 0x7F, 0xF7]));
          }, 0);
        }
        return;
      }
      // TM-1 set: F0 00 20 3C 04 00 03 <idx> F7
      if (u8.length === 9 &&
          u8[0] === 0xF0 && u8[1] === 0x00 && u8[2] === 0x20 && u8[3] === 0x3C &&
          u8[4] === 0x04 && u8[5] === 0x00 && u8[6] === 0x03 && u8[8] === 0xF7){
        tmIdx = u8[7] & 0x7F;
        setTimeout(() => {
          root.__mmSysexFeed(new Uint8Array([0xF0,0x00,0x20,0x3C,0x04,0x00,0x02, tmIdx & 0x7F, 0xF7]));
        }, 0);
      }
    }
  };

  const res = await root.setTurboSpeedVal(8);
  expect(res && res.ok, 'TM-1 speed set should succeed');
  expectEq(res.source, 'tm1', 'TM-1 path should be reported');
  expectEq(res.speedVal, 8, 'TM-1 speed index mismatch');
  expect(queryCount >= 2, 'TM-1 detection should retry after an initial missed probe');
  expectEq(root.turboCapability, 'tm1', 'Turbo capability should remain TM-1');
  expectEq(root.isTurboAvailable(), true, 'TM-1 route should expose Turbo as available');
  expect(Math.abs((Number(root.currentTurboFactor) || 0) - 10.0) < 0.001, 'TM-1 route should reach x10');
});

await test('Non-TM-1 MIDI routes stay locked to x1 and report TM-1 requirement', async () => {
  const harness = createHarness();
  await harness.runFile('assets/js/boot.js');
  await harness.runFile('assets/js/midi.js');

  const root = harness.context;
  root.selectedMidiIn = {};
  root.selectedMidiOut = {
    send(){ /* no TM-1 reply */ }
  };

  const res = await root.setTurboSpeedVal(8);
  expect(res && !res.ok, 'Non-TM-1 route should reject Turbo');
  expectEq(res.error, 'TM-1 required', 'Non-TM-1 rejection reason mismatch');
  expectEq(root.turboCapability, 'blocked', 'Non-TM-1 route should stay blocked');
  expectEq(root.isTurboAvailable(), false, 'Non-TM-1 route should not expose Turbo');
  expectEq(Number(root.currentTurboFactor) || 0, 1, 'Non-TM-1 route should remain at x1');
});

await test('Blocked non-TM-1 routes keep the Turbo button available for TM-1 re-checks', async () => {
  const harness = createHarness();
  const elements = {
    turboButton: createMockElement('button'),
    turboSpeedSlider: createMockElement('input')
  };
  harness.context.document.getElementById = (id) => elements[id] || null;
  harness.context.selectedMidiIn = {};
  harness.context.selectedMidiOut = {};
  harness.context.isTurboAvailable = () => false;

  await harness.runFile('assets/js/ui-midi-modal.js');

  const root = harness.context;
  expect(typeof root.syncTurboControls === 'function', 'syncTurboControls missing');

  root.syncTurboControls();
  expectEq(elements.turboButton.disabled, false, 'Turbo button should stay enabled for TM-1 re-checks');
  expectEq(elements.turboSpeedSlider.disabled, true, 'Turbo speed slider should stay disabled without TM-1');

  root.selectedMidiOut = null;
  root.syncTurboControls();
  expectEq(elements.turboButton.disabled, true, 'Turbo button should disable when MIDI routing is incomplete');
});

console.log('');
console.log(`Checks complete: ${passCount} passed, ${failures.length} failed.`);

if (failures.length){
  process.exitCode = 1;
}
