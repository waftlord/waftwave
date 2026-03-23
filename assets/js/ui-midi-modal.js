// DigiPRO UI split: MIDI modal wiring

'use strict';

(function(){
  'use strict';


  // -----------------------------
  // MIDI modal wiring (simplified)
  // -----------------------------
  const openBtn = document.getElementById('openMidiModalBtn');
  const modal   = document.getElementById('midiModal');
  const enableBtn  = document.getElementById('enableMidiBtn');
  const refreshBtn = document.getElementById('refreshPortsBtn');
  const testBtn    = document.getElementById('testRequestBtn');

  const midiInSelect = document.getElementById('midiInSelect');
  const midiOutSelect = document.getElementById('midiOutSelect');

  const turboBtn   = document.getElementById('turboButton');
  const turboSlider = document.getElementById('turboSpeedSlider');

  // Inter-slot processing gap override (field debugging / reliability)
  const gapEnable = document.getElementById('dpInterSlotDelayEnable');
  const gapSlider = document.getElementById('dpInterSlotDelaySlider');
  const gapLabel  = document.getElementById('dpInterSlotDelayLabel');

  const LS_INTERSLOT_DELAY_KEY = 'digipro_inter_slot_delay_ms_v1';

  function clampInt(n, lo, hi){
    n = Number(n);
    if (!isFinite(n)) n = lo;
    n = Math.round(n);
    return Math.max(lo, Math.min(hi, n));
  }

  function computeAutoGapMs(){
    try{
      const f = (typeof dpTurboFactor === 'function') ? dpTurboFactor() : (Number(window.currentTurboFactor)||1.0);
      if (!isFinite(f) || f <= 1.0001) return 200;
      const d = Math.round(200 / f);
      return Math.max(10, Math.min(80, d));
    }catch(_){
      return 200;
    }
  }

  function loadInterSlotDelayPref(){
    try{
      const ls = window.localStorage;
      if (!ls) return null;
      const raw = ls.getItem(LS_INTERSLOT_DELAY_KEY);
      if (raw == null || raw === '') return null;
      const v = Number(raw);
      if (!isFinite(v) || v < 0) return null;
      return clampInt(v, 0, 2000);
    }catch(_){
      return null;
    }
  }

  function saveInterSlotDelayPref(v){
    try{
      const ls = window.localStorage;
      if (!ls) return;
      if (v == null){
        ls.removeItem(LS_INTERSLOT_DELAY_KEY);
      } else {
        ls.setItem(LS_INTERSLOT_DELAY_KEY, String(v));
      }
    }catch(_){ }
  }

  function isInterSlotOverrideEnabled(){
    return (typeof window.digiproInterSlotDelayMs === 'number' && isFinite(window.digiproInterSlotDelayMs) && window.digiproInterSlotDelayMs >= 0);
  }

  function getInterSlotDelayMs(){
    if (!isInterSlotOverrideEnabled()) return null;
    return clampInt(window.digiproInterSlotDelayMs, 0, 2000);
  }

  function setInterSlotOverride(msOrNull){
    if (msOrNull == null){
      try{ delete window.digiproInterSlotDelayMs; }catch(_){ window.digiproInterSlotDelayMs = undefined; }
      saveInterSlotDelayPref(null);
      return;
    }
    const v = clampInt(msOrNull, 0, 2000);
    window.digiproInterSlotDelayMs = v;
    saveInterSlotDelayPref(v);
  }

  function syncInterSlotUi(){
    const enabled = isInterSlotOverrideEnabled();
    const v = enabled ? getInterSlotDelayMs() : null;

    if (gapEnable) gapEnable.checked = enabled;

    if (gapSlider){
      gapSlider.disabled = !enabled;
      if (enabled && v != null){
        gapSlider.value = String(clampInt(v, 0, 2000));
      } else {
        // Show the computed auto delay as a visual reference.
        gapSlider.value = String(clampInt(computeAutoGapMs(), 0, 2000));
      }
    }

    if (gapLabel){
      gapLabel.textContent = enabled ? (v + ' ms') : ('Auto (' + computeAutoGapMs() + ' ms)');
    }

    // Transfer safety lock overrides any other enabled/disabled state.
    if (midiUiLocked){
      if (gapEnable) gapEnable.disabled = true;
      if (gapSlider) gapSlider.disabled = true;
    }
  }

  // Restore persisted value early (before user opens the modal).
  (function restoreInterSlotDelayOnLoad(){
    const v = loadInterSlotDelayPref();
    if (v != null){
      window.digiproInterSlotDelayMs = v;
    }
  })();

  function setTurboUiBusy(b){
    const dis = !!b || midiUiLocked;
    if (turboBtn) turboBtn.disabled = dis;
    if (turboSlider) turboSlider.disabled = dis;
  }

  function toast(msg, isError=false){
    try{
      if (typeof window.announceIO === 'function'){
        window.announceIO(msg, !!isError);
      } else {
        (isError ? console.warn : console.log)(msg);
      }
    }catch(_){}
  }



  // --- Transfer safety: lock MIDI configuration while a MIDI transfer job is running ---
  let midiUiLocked = false;

  function setMidiUiLocked(locked){
    midiUiLocked = !!locked;

    // Lock any control that could change MIDI routing / timing mid-transfer.
    const dis = midiUiLocked;
    if (midiInSelect) midiInSelect.disabled = dis;
    if (midiOutSelect) midiOutSelect.disabled = dis;
    if (enableBtn) enableBtn.disabled = dis;
    if (refreshBtn) refreshBtn.disabled = dis;
    if (testBtn) testBtn.disabled = dis;

    // Turbo and gap controls are also configuration.
    // (Busy state is handled separately, but lock must always win.)
    if (turboBtn) turboBtn.disabled = dis;
    if (turboSlider) turboSlider.disabled = dis;
    if (gapEnable) gapEnable.disabled = dis;
    if (gapSlider) gapSlider.disabled = dis;

    try{ syncInterSlotUi && syncInterSlotUi(); }catch(_){ }
    try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){ }
  }

  function refreshMidiUiLockFromJob(){
    try{
      const J = window.DP_UI && window.DP_UI.state && window.DP_UI.state.JOB;
      const locked = !!(J && J.running && J.lockMidi);
      setMidiUiLocked(locked);
    }catch(_){ }
  }

  // Listen for job state changes (emitted from ui-core.js)
  window.addEventListener('dp-job-state', (ev)=>{
    const d = (ev && ev.detail) ? ev.detail : {};
    setMidiUiLocked(!!(d.running && d.lockMidi));
  });

  function openModal(){
    if (!modal) return;
    modal.classList.remove('hidden');
    try{ refreshMidiUiLockFromJob && refreshMidiUiLockFromJob(); }catch(_){ }
    try{ window.updateSysexPreview && window.updateSysexPreview(); }catch(_){}
    try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){}
    try{ syncInterSlotUi && syncInterSlotUi(); }catch(_){}
  }

  function closeModal(){
    if (!modal) return;
    modal.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);

  if (modal){
    modal.addEventListener('click', (e)=>{
      const t = e.target;
      if (t && t.matches && t.matches('[data-close-modal]')) closeModal();
    });
  }

  window.addEventListener('keydown', (e)=>{
    if (!modal) return;
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeModal();
  });

  if (enableBtn){
    enableBtn.addEventListener('click', async ()=>{
      try{
        await window.initWebMIDI();
        toast('MIDI enabled.');
        try{ window.updateSysexPreview && window.updateSysexPreview(); }catch(_){}
        try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){}
    try{ syncInterSlotUi && syncInterSlotUi(); }catch(_){}
      }catch(err){
        toast('Enable MIDI failed: ' + (err && err.message ? err.message : String(err)), true);
      }
    });
  }

  if (refreshBtn){
    refreshBtn.addEventListener('click', ()=>{
      try{
        window.refreshPorts && window.refreshPorts();
        toast('Ports refreshed.');
      }catch(err){
        toast('Refresh ports failed: ' + (err && err.message ? err.message : String(err)), true);
      }
    });
  }

  if (testBtn){
    testBtn.addEventListener('click', async ()=>{
      try{
        if (!window.requestDigiPRODumpAsync) throw new Error('requestDigiPRODumpAsync not available');
        const ac = new AbortController();
        const timeoutMs = (typeof window.dpCalcDumpTimeoutMs === 'function') ? window.dpCalcDumpTimeoutMs() : (typeof dpCalcDumpTimeoutMs === 'function' ? dpCalcDumpTimeoutMs() : 3500);
        const t = setTimeout(()=>ac.abort(), timeoutMs);
        const u8 = await window.requestDigiPRODumpAsync(0, ac.signal);
        clearTimeout(t);
        toast('Test request OK (received ' + u8.length + ' bytes).');
      }catch(err){
        toast('Test request failed: ' + (err && err.message ? err.message : String(err)), true);
      }
    });
  }

  if (turboBtn){
    turboBtn.addEventListener('click', async ()=>{
      setTurboUiBusy(true);
      try{
        // If the build supports direct speed control, use it so the button toggles
        // between OFF (x1) and the user's preferred speed.
        if (window.setTurboSpeedVal){
          const target = (window.turboActive ? 1 : (window.turboPreferredSpeedVal || 8));
          await window.setTurboSpeedVal(target);
        } else if (window.toggleTurbo){
          await window.toggleTurbo();
        } else {
          throw new Error('setTurboSpeedVal()/toggleTurbo() not available');
        }
      }catch(err){
        toast('Turbo toggle failed: ' + (err && err.message ? err.message : String(err)), true);
      }finally{
        setTurboUiBusy(false);
        try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){}
    try{ syncInterSlotUi && syncInterSlotUi(); }catch(_){}
      }
    });
  }

  if (turboSlider){
    turboSlider.addEventListener('change', async ()=>{
      const v = parseInt(String(turboSlider.value), 10) || 1;
      if (!window.setTurboSpeedVal){
        toast('Turbo speed control not available in this build.', true);
        return;
      }

      setTurboUiBusy(true);
      try{
        await window.setTurboSpeedVal(v);
      }catch(err){
        toast('Turbo speed failed: ' + (err && err.message ? err.message : String(err)), true);
      }finally{
        setTurboUiBusy(false);
        try{ window.updateTurboUI && window.updateTurboUI(); }catch(_){}
    try{ syncInterSlotUi && syncInterSlotUi(); }catch(_){}
      }
    });
  }


  // Inter-slot gap UI wiring
  if (gapEnable){
    gapEnable.addEventListener('change', ()=>{
      try{
        if (gapEnable.checked){
          const ms = gapSlider ? (parseInt(String(gapSlider.value), 10) || 0) : 0;
          setInterSlotOverride(ms);
        } else {
          setInterSlotOverride(null);
        }
      }catch(_){ }
      syncInterSlotUi();
    });
  }

  if (gapSlider){
    const onMove = ()=>{
      if (gapEnable && !gapEnable.checked) return;
      const ms = parseInt(String(gapSlider.value), 10) || 0;
      setInterSlotOverride(ms);
      syncInterSlotUi();
    };
    gapSlider.addEventListener('input', onMove);
    gapSlider.addEventListener('change', onMove);
  }

  // Initial sync (in case the modal is never opened).
  try{ syncInterSlotUi(); }catch(_){}

  // Capture-all is fed from the central complete-SysEx bus now,
  // so no rebinding is required when ports change.
  window.rebindDigiproCaptureHandler = function(){};


})();
