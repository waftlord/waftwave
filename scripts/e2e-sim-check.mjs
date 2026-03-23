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

const indexHtml = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const cssRefs = [...indexHtml.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
const scriptRefs = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

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

console.log('');
console.log(`Checks complete: ${passCount} passed, ${failures.length} failed.`);

if (failures.length){
  process.exitCode = 1;
}
