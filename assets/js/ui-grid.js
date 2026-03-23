// DigiPRO UI split: grid, selection, clipboard, keyboard, pads

'use strict';

  function dpWavetablePreviewMidi(baseMidi){
    if (typeof wavetablePreviewMidi === 'function') return wavetablePreviewMidi(baseMidi);
    const base = parseInt(baseMidi, 10) || 60;
    return clamp(base, 0, 127);
  }

  function dpViewRecordForSlot(idx){
    idx = idx|0;
    let wv = LIB.waves[idx] || null;

    // If the active editor slot is dirty, prefer the editor buffer for display.
    // This keeps all overview renders in sync even before the slot is committed to LIB.
    try{
      const editorSlot = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : -1;
      const isDirty = !!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(idx));
      if ((idx|0) === editorSlot && isDirty && EDIT && EDIT.dataU8 && EDIT.dataU8.length){
        const base = wv;
        const disp = base ? Object.assign({}, base) : {};
        disp.name = (EDIT.name || (base && base.name) || '');
        disp.dataU8 = EDIT.dataU8;
        if (base && typeof base.user === 'boolean') disp.user = base.user;
        else disp.user = true;
        if (typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) disp._dpHeat = EDIT._dpHeat;
        wv = disp;
      }
    }catch(_){ }

    return wv;
  }

  function requestWavetableViewportDraw(){
    if (requestWavetableViewportDraw._raf) return;
    requestWavetableViewportDraw._raf = requestAnimationFrame(()=>{
      requestWavetableViewportDraw._raf = 0;
      try{ drawWavetableViewport(); }catch(_){ }
    });
  }

  function drawWavetableViewport(){
    const c = wavetableCanvas;
    if (!c || !c.parentElement) return;

    const rect = c.parentElement.getBoundingClientRect();
    const cssW = Math.max(220, Math.round(rect.width || 0));
    const cssH = Math.max(180, Math.round(rect.height || 0));
    if (!(cssW > 0 && cssH > 0)) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));
    if ((c.width|0) !== pxW) c.width = pxW;
    if ((c.height|0) !== pxH) c.height = pxH;
    c.style.width = '100%';
    c.style.height = '100%';

    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    const bg = ctx.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, '#071712');
    bg.addColorStop(0.55, '#05110d');
    bg.addColorStop(1, '#030907');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const left = 22;
    const top = Math.max(48, Math.round(cssH * 0.12));
    const depthX = Math.min(cssW * 0.26, 180);
    const depthY = Math.min(cssH * 0.58, 220);
    const spanX = Math.max(90, cssW - left - 28 - depthX);
    const amp = Math.max(10, Math.min(cssH * 0.11, 34));
    const editorSlot = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : 0;
    const focusSlotRaw = (previewSlotIdx != null)
      ? (previewSlotIdx|0)
      : ((padsHoverIdx != null) ? (padsHoverIdx|0) : (((typeof activeIdx === 'number') ? (activeIdx|0) : editorSlot)));
    const focusSlot = clamp(focusSlotRaw, 0, 63);

    // Perspective guide rails so the table reads as a single shared viewport.
    ctx.strokeStyle = 'rgba(112, 255, 190, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i=0; i<7; i++){
      const t = i / 6;
      const x0 = left + t * depthX;
      const y0 = top + t * depthY;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + spanX, y0);
    }
    for (let i=0; i<5; i++){
      const t = i / 4;
      ctx.moveTo(left + t * spanX, top);
      ctx.lineTo(left + depthX + t * spanX, top + depthY);
    }
    ctx.stroke();

    const slotLines = [];
    let filledCount = 0;
    for (let idx=0; idx<64; idx++){
      const rec = dpViewRecordForSlot(idx);
      const hasWave = !!(rec && rec.dataU8 && rec.dataU8.length);
      if (hasWave) filledCount++;
      slotLines.push({ idx, rec, hasWave });
    }

    function strokeSlot(line, isFocus){
      const idx = line.idx|0;
      const rec = line.rec;
      const u8 = (rec && rec.dataU8 && rec.dataU8.length)
        ? ((rec.dataU8 instanceof Uint8Array) ? rec.dataU8 : new Uint8Array(rec.dataU8))
        : null;
      const N = (u8 && u8.length) ? (u8.length|0) : 96;
      const tDepth = idx / 63;
      const xShift = tDepth * depthX;
      const yShift = tDepth * depthY;
      const baseY = top + yShift;
      const lineAmp = isFocus ? (amp * 1.24) : (amp * (0.82 + (1 - tDepth) * 0.12));
      const alpha = line.hasWave ? (0.16 + (tDepth * 0.34)) : 0.06;
      const isEditor = idx === editorSlot;
      const isSelected = !!(SELECTED && SELECTED.has && SELECTED.has(idx));

      ctx.save();
      ctx.beginPath();
      for (let s=0; s<N; s++){
        const phase = (N <= 1) ? 0 : (s / (N - 1));
        const x = left + xShift + phase * spanX;
        let v = 0;
        if (u8){
          v = ((u8[s]|0) - 128) / 128;
          if (!isFinite(v)) v = 0;
          if (v > 1) v = 1;
          else if (v < -1) v = -1;
        }
        const y = baseY - (v * lineAmp);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      if (isFocus){
        ctx.strokeStyle = '#b7ffe3';
        ctx.lineWidth = 2.4;
        ctx.shadowBlur = 16;
        ctx.shadowColor = 'rgba(114, 255, 198, 0.45)';
      } else if (isEditor || isSelected){
        ctx.strokeStyle = isSelected ? 'rgba(255, 224, 128, 0.90)' : 'rgba(122, 255, 214, 0.88)';
        ctx.lineWidth = isSelected ? 1.6 : 1.35;
      } else if (line.hasWave){
        ctx.strokeStyle = `rgba(74, 255, 160, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = 'rgba(128, 170, 150, 0.10)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
      ctx.restore();
    }

    for (const line of slotLines){
      if (line.idx === focusSlot) continue;
      strokeSlot(line, false);
    }

    const focusLine = slotLines[focusSlot|0] || null;
    if (focusLine) strokeSlot(focusLine, true);

    ctx.save();
    const focusName = (focusLine && focusLine.rec && focusLine.rec.name) ? String(focusLine.rec.name).toUpperCase() : 'EMPTY';
    const focusLabel = `SLOT ${String((focusSlot|0) + 1).padStart(2, '0')}  ${focusName}`;
    ctx.fillStyle = 'rgba(226, 255, 241, 0.90)';
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(190, 255, 225, 0.98)';
    ctx.fillText(focusLabel, 18, cssH - 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(136, 214, 181, 0.78)';
    ctx.fillText(`${filledCount}/64 FILLED`, cssW - 18, 10);
    ctx.restore();
  }

  function attachWavetableViewportEvents(){
    const c = wavetableCanvas; if (!c) return;
    if (c._boundWavetableViewport) return;
    c._boundWavetableViewport = true;

    function stopViewportScan(){
      try{
        if (typeof stopWavetablePreview === 'function') stopWavetablePreview();
        else stopPreview();
      }catch(_){ }
    }

    function buildViewportScanSequence(startSlot){
      startSlot = clamp(startSlot, 0, 63);
      let basePPC = 0;
      let hasAudible = false;
      const found = [];
      for (let s=startSlot; s<64; s++){
        const rec = dpViewRecordForSlot(s);
        const u8 = (rec && rec.dataU8 && rec.dataU8.length)
          ? ((rec.dataU8 instanceof Uint8Array) ? rec.dataU8 : new Uint8Array(rec.dataU8))
          : null;
        if (u8 && (u8.length|0) > 0){
          if (!(basePPC > 0)) basePPC = u8.length|0;
          if (!hasAudible && !isSilentU8(u8)) hasAudible = true;
        }
        found.push(u8);
      }
      if (!(basePPC > 0)) basePPC = 96;

      const seq = [];
      for (let i=0; i<found.length; i++){
        const u8 = found[i];
        if (!u8){
          const silent = new Uint8Array(basePPC);
          silent.fill(128);
          seq.push(silent);
          continue;
        }
        if ((u8.length|0) !== (basePPC|0)){
          return { error: 'Cannot preview wavetable scan: slot cycle lengths differ.' };
        }
        seq.push(u8);
      }

      if (!hasAudible) return { error: 'Nothing to preview from the current slot.' };
      return { seq, basePPC };
    }

    function startViewportScan(){
      const startSlot = (EDIT && typeof EDIT.slot === 'number')
        ? (EDIT.slot|0)
        : (((typeof activeIdx === 'number') ? (activeIdx|0) : 0));
      const built = buildViewportScanSequence(startSlot);
      if (!built || !Array.isArray(built.seq) || !(built.seq.length|0)){
        if (built && built.error) announceIO(built.error, true);
        else announceIO('Nothing to preview from the current slot.', true);
        return;
      }

      const basePPC = (built.basePPC|0) || 96;
      let pp = null;
      try{
        const prefs = (typeof dpLoadExportWavPrefs === 'function') ? dpLoadExportWavPrefs() : null;
        pp = (typeof dpComputePitchParams === 'function') ? dpComputePitchParams(basePPC, prefs) : null;
      }catch(_){ pp = null; }

      try{
        if (typeof startWavetablePreview === 'function'){
          const auditionMidi = dpWavetablePreviewMidi(DIGIPRO_PREVIEW_MIDI);
          startWavetablePreview(built.seq, {
            loop: false,
            midi: auditionMidi,
            sampleRate: pp ? pp.sampleRate : 44100,
            pointsPerCycle: pp ? pp.pointsPerCycle : basePPC,
            pitchMethod: pp ? pp.pitchMethod : 'sr',
            pitchParams: pp || undefined,
          });
        } else {
          stopViewportScan();
        }
      }catch(err){
        console.error(err);
        announceIO('Could not preview wavetable scan.', true);
      }
    }

    c.addEventListener('click', (ev)=>{
      if (ev && ev.shiftKey){
        toggleKeyboardView();
        return;
      }
      startViewportScan();
    });

    try{ if (window.__mmDPWavetableTriggerCleanup) window.__mmDPWavetableTriggerCleanup(); }catch(_){ }
    const handleWindowBlur = ()=>{ stopViewportScan(); };
    const handleVisibility = ()=>{ if (document.hidden) stopViewportScan(); };
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    window.__mmDPWavetableTriggerCleanup = ()=>{
      stopViewportScan();
      try{ window.removeEventListener('blur', handleWindowBlur); }catch(_){ }
      try{ document.removeEventListener('visibilitychange', handleVisibility); }catch(_){ }
    };
  }

  function paintGridCell(idx){
    const cell = bySel(`.mm-digi-slot[data-idx="${idx}"]`);
    if (!cell) return;

    const wv = dpViewRecordForSlot(idx);

    const hasWave = !!(wv && wv.dataU8 && wv.dataU8.length);

    // HOT indicator: show a flame when this slot has extra upload/export gain enabled
    const heat = dpHeatOf(wv);
    cell.classList.toggle('hot-slot', hasWave && heat > 1.0001);
    if (heat > 1.0001){
      cell.dataset.dpHeat = String(heat);
      cell.title = `HOT gain ×${heat.toFixed(2)}`;
    }else{
      try{ delete cell.dataset.dpHeat; }catch(_){ }
      if (cell.title && cell.title.startsWith('HOT gain')) cell.title = '';
    }

    cell.querySelector('.nm').textContent = (wv?.name || '').toUpperCase();

    // Corner meta: slot number + user/factory indicator
    const idxEl = cell.querySelector('.idx');
    if (idxEl){
      const slotNo = (idx|0) + 1;
      idxEl.textContent = String(slotNo).padStart(2,'0');
      const kind = (!wv) ? 'Empty' : (wv.user ? 'User wave' : 'Factory wave');
      idxEl.title = `Slot ${slotNo} — ${kind}`;
    }

    const usr = cell.querySelector('.usr');
    if (usr){
      usr.textContent = '';
      usr.style.display = 'none';
      usr.title = '';
    }

    const meta = cell.querySelector('.meta');
    if (meta && idxEl){
      // Make the whole badge area hoverable (not just the digits).
      meta.title = idxEl.title || '';
    }

    // Visual state: filled/empty + selection/active.
    cell.classList.toggle('filled-slot', hasWave);
    if (!hasWave){
      // Empty slots should never keep batch-status highlights.
      cell.classList.remove('processing-slot','processed-slot','failed-slot');
    }

    drawMini(cell.querySelector('canvas'), wv);

    if (idx === activeIdx) cell.classList.add('active'); else cell.classList.remove('active');
    if (SELECTED.has(idx)) cell.classList.add('selected'); else cell.classList.remove('selected');
    requestWavetableViewportDraw();
  }

  function ensureActiveHighlight(){
    bySelAll('.mm-digi-slot').forEach(n=>n.classList.remove('active'));
    const cell = bySel(`.mm-digi-slot[data-idx="${activeIdx}"]`);
    if (cell) cell.classList.add('active');
    requestWavetableViewportDraw();
  }

  function maybeGuardBeforeSwitch(targetIdx, onProceed){
    // The old UX asked whether to Save / Discard / Duplicate before switching slots.
    // Testers found it disruptive; now we auto-save to the current slot (with full Undo support).
    if (targetIdx === EDIT.slot) { onProceed(); return; }

    if (LIB.dirty && LIB.dirty.has && LIB.dirty.has(EDIT.slot)){
      // Recordable auto-save: user can always Cmd/Ctrl+Z to revert.
      commitEditorToLibrary({ label: `Auto-save slot ${EDIT.slot+1}` });
    }

    onProceed();
  }

  function openInEditor(idx){
    activeIdx = idx;
    previewSlotIdx = null;
    padsHoverIdx = null;
    const w = LIB.waves[idx];
    EDIT.slot = idx;
    if (w && w.dataU8){
      EDIT.name = (w.name||'WAVE');
	      EDIT._dpHeat = (typeof w._dpHeat === 'number' && isFinite(w._dpHeat) && w._dpHeat > 0) ? w._dpHeat : 1;
      EDIT.dataU8 = new Uint8Array(w.dataU8); // copy
    }else{
      EDIT.name = 'WAVE';
	      EDIT._dpHeat = 1;
      EDIT.dataU8 = new Uint8Array(96); EDIT.dataU8.fill(128);

// Stub: renderEditorBar was already executed during module init in this merged file.

    }
    initUndo(); // === PATCH: start history for this slot
    const didSoftRefresh = !!(
      typeof refreshEditorBar === 'function'
      && editorCanvas
      && editorCanvas.isConnected
      && refreshEditorBar()
    );
    if (!didSoftRefresh) renderEditorBar();
    ensureActiveHighlight();
  }


  // Internal helper (used by batch ops): reload a slot into the editor and refresh UI.
  function dpLoadWaveIntoEditor(idx){
    idx = idx|0;
    if (idx < 0 || idx >= 64) return;
    openInEditor(idx);
  }

  let _previewStopTimer = null;

  function quickPreview(idx){
      const w = dpViewRecordForSlot(idx);
      previewSlotIdx = null;
      if (_previewStopTimer){ try{ clearTimeout(_previewStopTimer); }catch(_){ } _previewStopTimer = null; }
      if (w && w.dataU8 && !isSilentU8(w.dataU8)){
        previewSlotIdx = idx|0;
        requestWavetableViewportDraw();
        startPreview(w.dataU8, dpWavetablePreviewMidi(DIGIPRO_PREVIEW_MIDI));
        _previewStopTimer = setTimeout(()=>{
          _previewStopTimer = null;
          previewSlotIdx = null;
          requestWavetableViewportDraw();
          try{ stopPreview(); }catch(e){}
        }, 1500);
      } else {
        requestWavetableViewportDraw();
      }
    }

  function toggleSelect(idx, force){
    idx = idx|0;
    if (force === true) SELECTED.add(idx);
    else if (force === false) SELECTED.delete(idx);
    else { if (SELECTED.has(idx)) SELECTED.delete(idx); else SELECTED.add(idx); }
    paintGridCell(idx);
    updateButtonsState();
  }

  function rangeSelectTo(idx, toggleRange){
    idx = idx|0;
    const anchor = (SELECT_ANCHOR === null || SELECT_ANCHOR === undefined) ? idx : (SELECT_ANCHOR|0);
    const lo = Math.min(anchor, idx), hi = Math.max(anchor, idx);
    toggleRange = !!toggleRange;

    for (let s=lo; s<=hi; s++){
      if (toggleRange){
        if (SELECTED.has(s)) SELECTED.delete(s); else SELECTED.add(s);
      }else{
        SELECTED.add(s);
      }
    }

    for (let s=lo; s<=hi; s++) paintGridCell(s);

    SELECT_ANCHOR = idx;
    updateButtonsState();
  }

  function clearSelection(){
    SELECTED.clear();
    SELECT_ANCHOR = null;
    bySelAll('.mm-digi-slot').forEach(c=>c.classList.remove('selected'));
    requestWavetableViewportDraw();
    updateButtonsState();
  }

  // Cmd/Ctrl+A helper: select all 64 slots in the grid.
  function selectAllSlots(){
    SELECTED.clear();
    for (let s=0; s<64; s++) SELECTED.add(s);
    // Keep the anchor at the current active slot so Shift-selection behaves predictably.
    SELECT_ANCHOR = (activeIdx|0);

    // Update selection classes without re-rendering canvases.
    bySelAll('.mm-digi-slot').forEach(c=>c.classList.add('selected'));
    requestWavetableViewportDraw();
    updateButtonsState();
  }



  function commitEditorToLibrary(opts){
    // Mirrors the Save button: commit current editor buffer into LIB.waves[EDIT.slot],
    // and record it in bank history so it can be undone/redone.
    opts = opts || {};
    const slot = EDIT.slot|0;
    const label = String(opts.label || `Save slot ${slot+1}`);

    const nm = _alnum4(((nameIn && nameIn.value) ? nameIn.value : (EDIT.name || 'WAVE')).toUpperCase());
    EDIT.name = nm;

	    const cur = LIB.waves[slot];
	    const nameChanged = !cur || String(cur.name||'') !== nm;
	    const dataChanged = !!(LIB.dirty && LIB.dirty.has && LIB.dirty.has(slot));
	    const curHeat = (cur && typeof cur._dpHeat === 'number' && isFinite(cur._dpHeat) && cur._dpHeat > 0) ? cur._dpHeat : 1;
	    const editHeat = (typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1;
	    const heatChanged = !cur || Math.abs(curHeat - editHeat) > 1e-9;
	    const willChange  = !cur || nameChanged || dataChanged || heatChanged;

    if (!willChange){
      if (nameIn) nameIn.value = nm;
      return;
    }

    const __bankBefore = captureBankState([slot]); // capture pre-save LIB + current editor buffer

	    const u8 = new Uint8Array(EDIT.dataU8);
	    if (!LIB.waves[slot]){
	      const rec = attachDisplayRot({ name:nm, dataU8:u8, user:true }, false);
	      rec._dpHeat = editHeat;
	      LIB.waves[slot] = rec;
	    } else {
	      const rec = LIB.waves[slot];
	      rec.name = nm;
	      rec.dataU8 = u8;
	      rec.user = true;
	      rec._dpHeat = editHeat;
	      ensureDisplayRot(rec.dataU8);
	      // Only invalidate cached DigiPRO tables / original float source if the waveform changed.
	      if (dataChanged){
	        delete rec._tables6132;
	        delete rec._tables6132_clip;
	        delete rec._tables6132_norm;
	        delete rec._srcFloat;
	      }
	    }
    if (nameIn) nameIn.value = nm;

    // After saving, the editor is no longer “dirty” for that slot.
    LIB.dirty.delete(slot);
    paintGridCell(slot);

    const __bankAfter = captureBankState([slot]);

    bankPush({ label, before: __bankBefore, after: __bankAfter });

    // Saving mutates the underlying slot; align editor undo baseline with the new reality.
    resetUndoToCurrent(true);
    updateButtonsState();
  }

  function discardEditorChanges(){
    // Re-load current slot from LIB into the editor (drops unsaved edits).
    LIB.dirty.delete(EDIT.slot);
    openInEditor(EDIT.slot);
  }

  function clearSlotsNow(indices){
    const arr = Array.from(indices||[]).map(n=>n|0).filter(n=>n>=0 && n<64);
    if (!arr.length) return;

    const __bankBefore = captureBankState(arr, { preferEditor:true });

    for (const idx of arr){
      LIB.waves[idx] = null;
      LIB.dirty.delete(idx);

      // Clearing a slot should also clear any per-slot success/error badges.
      const cell = bySel(`.mm-digi-slot[data-idx="${idx}"]`);
      if (cell) cell.classList.remove('processing-slot','processed-slot','failed-slot','sending-slot','sent-slot','send-failed-slot');

      paintGridCell(idx);
    }

    const touchedEditor = arr.includes(EDIT.slot|0);
    if (touchedEditor){
      EDIT.name = 'WAVE';
      if (!EDIT.dataU8 || EDIT.dataU8.length !== 96) EDIT.dataU8 = new Uint8Array(96);
      EDIT.dataU8.fill(128);
      if (nameIn) nameIn.value = EDIT.name;
      if (paintEditor) paintEditor();
    }

    const __bankAfter = captureBankState(arr);
    bankPush({
      label: (arr.length === 1) ? `Clear slot ${arr[0]+1}` : `Clear ${arr.length} slot(s)`,
      before: __bankBefore,
      after: __bankAfter
    });

    if (touchedEditor){
      resetUndoToCurrent(true);
    }

    announceIO(arr.length === 1
      ? `Cleared slot ${arr[0]+1} (in memory).`
      : `Cleared ${arr.length} slot(s) (in memory).`);
    updateButtonsState();
  }

  function promptClearSlots(indices){
    const arr = Array.from(indices||[]).map(n=>n|0).filter(n=>n>=0 && n<64);
    if (!arr.length) return;

    const anyFilled = arr.some(i => !!(LIB.waves[i] && LIB.waves[i].dataU8 && LIB.waves[i].dataU8.length));
    if (!anyFilled){
      // nothing meaningful to clear
      clearSlotsNow(arr);
      return;
    }

    // If we're clearing the editor slot and it has unsaved edits, warn that they'll be discarded.
    if (arr.includes(EDIT.slot) && LIB.dirty.has(EDIT.slot)){
      const overlay = el('div','mm-digi-guard');
      const dlg = el('div','dlg');
      const h = el('h4'); h.textContent = 'Discard unsaved changes?';
      const p = el('div','mm-small');
      p.textContent = `Slot ${EDIT.slot+1} has unsaved edits. Clearing will discard them (nothing is sent to the device until Upload).`;
      const btns = el('div','btns');
      const bGo = el('button'); bGo.textContent = 'Discard & Clear';
      const bCancel = el('button'); bCancel.textContent = 'Cancel';
      bGo.onclick = ()=>{ overlay.remove(); LIB.dirty.delete(EDIT.slot); clearSlotsNow(arr); };
      bCancel.onclick = ()=> overlay.remove();
      btns.append(bGo, bCancel); dlg.append(h,p,btns); overlay.append(dlg); document.body.appendChild(overlay);
      return;
    }

    const overlay = el('div','mm-digi-guard');
    const dlg = el('div','dlg');
    const h = el('h4'); h.textContent = (arr.length===1) ? `Clear slot ${arr[0]+1}?` : `Clear ${arr.length} slot(s)?`;
    const p = el('div','mm-small');
    p.textContent = 'This empties the slot(s) in memory only. Nothing is sent to the device until you Upload.';
    const btns = el('div','btns');
    const bGo = el('button'); bGo.textContent = 'Clear';
    const bCancel = el('button'); bCancel.textContent = 'Cancel';
    bGo.onclick = ()=>{ overlay.remove(); clearSlotsNow(arr); };
    bCancel.onclick = ()=> overlay.remove();
    btns.append(bGo, bCancel); dlg.append(h,p,btns); overlay.append(dlg); document.body.appendChild(overlay);
  }

  function doSwapSlots(a,b){
    a = a|0; b = b|0;
    if (a===b) return;

    const wa = LIB.waves[a] || null;
    const wb = LIB.waves[b] || null;
    LIB.waves[a] = wb;
    LIB.waves[b] = wa;

    // Swap dirty flags between positions
    const aDirty = LIB.dirty.has(a);
    const bDirty = LIB.dirty.has(b);
    if (aDirty !== bDirty){
      if (aDirty){ LIB.dirty.delete(a); LIB.dirty.add(b); }
      if (bDirty){ LIB.dirty.delete(b); LIB.dirty.add(a); }
    }

    // Swap selection membership so selection follows the moved content.
    const aSel = SELECTED.has(a);
    const bSel = SELECTED.has(b);
    if (aSel !== bSel){
      if (aSel){ SELECTED.delete(a); SELECTED.add(b); }
      if (bSel){ SELECTED.delete(b); SELECTED.add(a); }
    }

    // Keep active/editor indices tracking the moved content.
    const oldEdit = EDIT.slot;
    const oldActive = activeIdx;

    if (oldActive === a) activeIdx = b;
    else if (oldActive === b) activeIdx = a;

    if (oldEdit === a) EDIT.slot = b;
    else if (oldEdit === b) EDIT.slot = a;

    paintGridCell(a);
    paintGridCell(b);

    if (EDIT.slot !== oldEdit){
      // Re-open editor to keep UI consistent.
      openInEditor(EDIT.slot);
    } else {
      ensureActiveHighlight();
    }

    announceIO(`Swapped slot ${a+1} ↔ ${b+1} (in memory).`);
    updateButtonsState();
  }

  function swapSlots(a,b){
    a = a|0; b = b|0;
    if (a===b) return;

    // If the editor slot is involved and dirty, auto-save first so the swap is deterministic
    // (and fully undoable if the user wants to revert).
    if ((a===EDIT.slot || b===EDIT.slot) && LIB.dirty && LIB.dirty.has && LIB.dirty.has(EDIT.slot)){
      commitEditorToLibrary({ label: `Auto-save slot ${EDIT.slot+1}` });
    }

    const __bankBefore = captureBankState([a,b], { preferEditor:true });
    doSwapSlots(a,b);
    const __bankAfter = captureBankState([a,b]);

    bankPush({ label: `Swap ${a+1} ↔ ${b+1}`, before: __bankBefore, after: __bankAfter });
  }

function buildGrid(){
    const grid = bySel('#digiproGrid'); grid.innerHTML='';

    // Drag & swap UX: highlight destination slot while dragging
    let __dragTargetEl = null;
    const setDragTarget = (el, isBad=false)=>{
      if (__dragTargetEl === el){
        if (el) el.classList.toggle('bad-target', !!isBad);
        return;
      }
      if (__dragTargetEl) __dragTargetEl.classList.remove('drop-target','bad-target');
      __dragTargetEl = el;
      if (__dragTargetEl){
        __dragTargetEl.classList.add('drop-target');
        __dragTargetEl.classList.toggle('bad-target', !!isBad);
      }
    };
    const clearDragTarget = ()=>{
      if (__dragTargetEl) __dragTargetEl.classList.remove('drop-target','bad-target');
      __dragTargetEl = null;
    };
    // Make the latest clearer accessible for global dragend/drop cleanup.
    root.__digiproClearDragTarget = clearDragTarget;
    if (!root.__digiproDragHlGlobalBound){
      root.__digiproDragHlGlobalBound = true;
      document.addEventListener('dragend', ()=>{
        try{ root.__digiproClearDragTarget && root.__digiproClearDragTarget(); }catch(_){}
      }, true);
      document.addEventListener('drop', ()=>{
        try{ root.__digiproClearDragTarget && root.__digiproClearDragTarget(); }catch(_){}
      }, true);
    }

// Grid‑level drop: import .syx/.wav into next free slots
    grid.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    grid.addEventListener('drop', async (e)=>{
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files||[]);
      await importFilesIntoLibrary(files);
      updateButtonsState();
    });

    // Click empty space in the grid to clear selection
    grid.addEventListener('click', (e)=>{
      if (e.target === grid){
        const had = (SELECTED && typeof SELECTED.size === 'number') ? (SELECTED.size|0) : 0;
        clearSelection();
        // Avoid clobbering long-running job progress messages.
        try{
          if (had > 0 && !(JOB && JOB.running)) announceIO('Selection cleared.');
        }catch(_){ }
      }
    });

    for (let i=0;i<64;i++){
      const cell = el('div','mm-digi-slot'); cell.dataset.idx = i;
      const nm = el('div','nm'); nm.textContent='';
      const meta = el('div','meta');
      const usr = el('div','usr'); usr.textContent='';
      const idxEl = el('div','idx'); idxEl.textContent = String(i+1).padStart(2,'0');
      meta.append(usr, idxEl);
      const canv = el('canvas');
      drawMini(canv,null);
      cell.append(nm, meta, canv);

      // click semantics:
      //   Alt/Option‑click: quick preview (no selection changes)
      //   Shift‑click: range select (from anchor). Ctrl+Shift toggles the range.
      //   Ctrl/Cmd‑click: toggle individual selection
      //   Click: open in editor (clears selection unless clicking inside current selection)
      cell.addEventListener('click', (ev)=>{
        const idx = i|0;
        if (ev.altKey){
          // Alt/Option-click previews without changing selection.
          quickPreview(idx);
          // Don't clobber long-running job progress messages.
          try{
            if (!(JOB && JOB.running)){
              const w = (LIB && LIB.waves) ? LIB.waves[idx] : null;
              const ok = !!(w && w.dataU8 && w.dataU8.length && !isSilentU8(w.dataU8));
              announceIO(ok ? `Preview slot ${idx+1}.` : `Slot ${idx+1} empty.`, !ok);
            }
          }catch(_){ }
          return;
        }

        // Shift = range select (optionally toggling range when Ctrl/Cmd is held)
        if (ev.shiftKey){
          // Keep keyboard focus/active tile aligned with selection gestures.
          // (Shift/Ctrl selection previously didn't move activeIdx, which made
          // copy/paste/evolve feel "random" because those ops key off activeIdx.)
          activeIdx = idx;
          ensureActiveHighlight();
          rangeSelectTo(idx, (ev.ctrlKey || ev.metaKey));
          try{
            if (!(JOB && JOB.running)){
              const n = (SELECTED && typeof SELECTED.size === 'number') ? (SELECTED.size|0) : 0;
              announceIO(n<=0 ? 'Selection cleared.' : `${n} slot${n===1?'':'s'} selected.`);
            }
          }catch(_){ }
          return;
        }

        // Ctrl/Cmd = toggle single-slot selection
        if (ev.ctrlKey || ev.metaKey){
          // Keep active tile aligned with the most recent selection click.
          activeIdx = idx;
          ensureActiveHighlight();
          const was = (SELECTED && SELECTED.has) ? SELECTED.has(idx) : false;
          toggleSelect(idx);
          SELECT_ANCHOR = idx;
          try{
            if (!(JOB && JOB.running)){
              const n = (SELECTED && typeof SELECTED.size === 'number') ? (SELECTED.size|0) : 0;
              if (n<=0) announceIO('Selection cleared.');
              else {
                const now = (SELECTED && SELECTED.has) ? SELECTED.has(idx) : !was;
                const verb = now ? 'Added' : 'Removed';
                announceIO(`${verb} slot ${idx+1} (${n}).`);
              }
            }
          }catch(_){ }
          return;
        }

        // Plain click selects the slot (single-selection) and opens it in the editor.
        // This makes batch operations (AMP/NORM, Mutate, Clear, etc.) behave intuitively:
        //   - act on the clicked slot by default
        //   - act on the whole bank only when nothing is selected (Esc / click background).
        if (!(SELECTED.size === 1 && SELECTED.has(idx))){
          clearSelection();
          toggleSelect(idx, true);
        }
        SELECT_ANCHOR = idx;
        maybeGuardBeforeSwitch(idx, ()=>{
          openInEditor(idx);
          try{
            if (!(JOB && JOB.running)){
              const w = (LIB && LIB.waves) ? LIB.waves[idx] : null;
              const ok = !!(w && w.dataU8 && w.dataU8.length && !isSilentU8(w.dataU8));
              const nm = (EDIT && EDIT.name) ? String(EDIT.name).toUpperCase() : ((w && w.name) ? String(w.name).toUpperCase() : 'WAVE');
              announceIO(ok ? `Loaded slot ${idx+1} ${nm}.` : `Loaded slot ${idx+1} (empty).`);
            }
          }catch(_){ }
        });
      });
      // double-click = open + preview
      cell.addEventListener('dblclick', (ev)=>{
        const idx = i|0;
        maybeGuardBeforeSwitch(idx, ()=>{
          openInEditor(idx);
          quickPreview(idx);
          try{
            if (!(JOB && JOB.running)){
              const w = (LIB && LIB.waves) ? LIB.waves[idx] : null;
              const ok = !!(w && w.dataU8 && w.dataU8.length && !isSilentU8(w.dataU8));
              announceIO(ok ? `Preview slot ${idx+1}.` : `Slot ${idx+1} empty.`, !ok);
            }
          }catch(_){ }
        });
      });

      // Right‑click clears a slot (in memory only)
      cell.addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        const targets = (SELECTED && SELECTED.size)
          ? Array.from(SELECTED).sort((a,b)=>a-b)
          : [i];
        promptClearSlots(targets);
      });

      // Internal drag‑swap (tile → tile), plus file‑drop import (.syx/.wav).
      cell.draggable = true;
      cell.addEventListener('dragstart', (e)=>{
        try{
          e.dataTransfer.setData('application/x-digipro-slot', String(i|0));
          e.dataTransfer.effectAllowed = 'move';
        }catch(_){}
      });

      cell.addEventListener('dragover', (e)=>{
      e.preventDefault();
      let isInternalMove = false;
      try{
        const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
        isInternalMove = types.includes('application/x-digipro-slot');
        e.dataTransfer.dropEffect = isInternalMove ? 'move' : 'copy';
      }catch(_){}
      // keep the highlight stable even if nested elements cause extra events
      if (__dragTargetEl !== cell) setDragTarget(cell, false);
    });

      cell.addEventListener('dragenter', (e)=>{
  e.preventDefault();
  let src = null;
  try{
    const txt = e.dataTransfer && e.dataTransfer.getData && e.dataTransfer.getData('application/x-digipro-slot');
    if (txt !== undefined && txt !== null && txt !== '') src = parseInt(txt, 10);
  }catch(_){}
  const isBad = Number.isFinite(src) && ((src|0) === (i|0));
  setDragTarget(cell, isBad);
});

cell.addEventListener('dragleave', ()=>{
  // simplest: clear when leaving this cell
  clearDragTarget();
});

      cell.addEventListener('drop', async (e)=>{
          clearDragTarget();
        e.preventDefault();

        // Swap? (drag one slot onto another)
        let src = null;
        try{
          const txt = e.dataTransfer && e.dataTransfer.getData && e.dataTransfer.getData('application/x-digipro-slot');
          if (txt !== undefined && txt !== null && txt !== '') src = parseInt(txt, 10);
        }catch(_){}
        if (Number.isFinite(src)){
          const dst = i|0;
          if (src !== dst) swapSlots(src, dst);
          return;
        }

        // File import into exact slot
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (!files.length) return;
        await importFilesIntoLibrary(files, i);
        updateButtonsState();
      });

      // keyboard copy target management: focusable for keyboard nav
      cell.tabIndex = 0;

      grid.appendChild(cell);
      paintGridCell(i);
    }
    // default selection: first slot
    const first = bySel('.mm-digi-slot[data-idx="0"]');
    if (first){ first.classList.add('active'); activeIdx = 0; }
  }

  function findNextFreeSlot(){
    for (let i=0;i<64;i++) if (!LIB.waves[i]) return i;
    return -1;
  }

  function updateButtonsState(){
    // Enable/disable based on selection & content
    const anyWaves = LIB.waves.some(w=>!!w);
    const editorSlot = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : 0;
    const cancelBtn = (JOB && JOB.running) ? JOB.uiBtn : null;
    const hasSelection = SELECTED.size>0;
    const anySelectedLib = hasSelection && Array.from(SELECTED).some(i=>!!LIB.waves[i]);
    const anySelected = anySelectedLib;
    const anySelectedForUpload = hasSelection && Array.from(SELECTED).some(i=>{
      i = i|0;
      if (i === editorSlot && LIB.dirty && LIB.dirty.has(i) && EDIT.dataU8 && EDIT.dataU8.length) return true;
      return !!LIB.waves[i];
    });

    const editorHasWave = !!((LIB.dirty && LIB.dirty.has(editorSlot) && EDIT.dataU8 && EDIT.dataU8.length) || (LIB.waves[editorSlot] && LIB.waves[editorSlot].dataU8));
    if (btnExportBank) btnExportBank.disabled = !anyWaves;
    if (btnExportBankZip) btnExportBankZip.disabled = !anyWaves;
    if (btnExportBankSyx) btnExportBankSyx.disabled = !anyWaves;
    if (btnUploadSlots && btnUploadSlots !== cancelBtn) btnUploadSlots.disabled = hasSelection ? !anySelectedForUpload : !editorHasWave;
    if (btnExportSel) btnExportSel.disabled = !anySelectedLib;
    if (btnExportSelSyx) btnExportSelSyx.disabled = !anySelectedLib;
    if (btnUploadAll && btnUploadAll !== cancelBtn) btnUploadAll.disabled = !anyWaves;

    // Batch tools
    // Normalize is selection-only (always 100% now), so require an actual selection.
    if (btnNormBatch){
      const canNorm = hasSelection && anySelectedForUpload;
      btnNormBatch.disabled = !canNorm;
    }
    // Legacy normalize-% slider removed. Keep a defensive disable in case an older
    // DOM element is still present for any reason.
    if (normSlider){
      normSlider.disabled = true;
    }
    if (btnBatchName){
      btnBatchName.disabled = !anyWaves;
    }
    if (btnEvolve){
      const seedSlot = (typeof activeIdx === 'number') ? (activeIdx|0) : (EDIT.slot|0);
      const baseAvail = !!(
        (seedSlot === (EDIT.slot|0) && LIB.dirty && LIB.dirty.has(seedSlot) && EDIT.dataU8 && EDIT.dataU8.length) ||
        (LIB.waves[seedSlot] && LIB.waves[seedSlot].dataU8 && LIB.waves[seedSlot].dataU8.length)
      );

      const sel2 = (typeof dpSelectedTwoWaveSlots === 'function') ? dpSelectedTwoWaveSlots() : [];
      const dualAvail = (sel2 && sel2.length===2);

      btnEvolve.disabled = !(baseAvail || dualAvail);

      // Keep tooltip up-to-date as selection changes.
      if (typeof dpUpdateEvolveBtnTitle === 'function') dpUpdateEvolveBtnTitle();
    }
    if (btnBlend){
      let nSel = 0;
      if (hasSelection){
        for (const s of SELECTED){
          const i = s|0;
          if (LIB.waves[i]){ nSel++; continue; }
          if (i===editorSlot && LIB.dirty && LIB.dirty.has(i) && EDIT.dataU8 && EDIT.dataU8.length) nSel++;
        }
      }
      btnBlend.disabled = nSel < 2;
    }

    // If current LIB entry is factory, discourage rename (device cannot rename factory)
    const cur = LIB.waves[EDIT.slot];
    const isFactory = cur && cur.user===false;

    if (btnExportSlotSyx){
      const slot = (EDIT.slot|0);
      const useEditor = !!(LIB.dirty && LIB.dirty.has(slot));
      const w = useEditor ? { dataU8: EDIT.dataU8 } : (LIB.waves[slot] || { dataU8: EDIT.dataU8 });
      const hasCurWave = !!(w && w.dataU8 && !isSilentU8(w.dataU8));
      btnExportSlotSyx.disabled = !(hasCurWave || (hasSelection ? anySelected : false));
    }
    if (nameIn){
      nameIn.disabled = isFactory;
      nameIn.title = isFactory ? 'Factory waves cannot be renamed on the device.' : '4-character ASCII name (device rule).';
    }

    // Mutate UI state
    if (btnMutate){
      const editorSlot = (EDIT.slot|0);
      const editorHasWave = !!(EDIT.dataU8 && EDIT.dataU8.length && (LIB.dirty && LIB.dirty.has(editorSlot)));
      const canMutate = hasSelection ? anySelected : (anyWaves || editorHasWave);
      btnMutate.disabled = !canMutate;
    }

    // FUSE UI state (creative generator next to Mutate slider)
    if (btnFuse){
      const canFuse = hasSelection ? anySelectedForUpload : editorHasWave;
      btnFuse.disabled = !canFuse;
    }
    if (mutateSlider){
      const editorSlot = (EDIT.slot|0);
      const editorHasWave = !!(EDIT.dataU8 && EDIT.dataU8.length && (LIB.dirty && LIB.dirty.has(editorSlot)));
      mutateSlider.disabled = !(anyWaves || editorHasWave);
    }
  }

  function bindKeyboard(){
    function digiproPanelIsVisible(){
      const el = document.querySelector('.panel[data-panel-id="digipro"] .panel-content');
      // Some hosts toggle a 'visible' class; others toggle display.
      return !!(el && (el.classList.contains('visible') || getComputedStyle(el).display!=='none'));
    }

    function slotsForClipboard(){
      const sel = Array.from(SELECTED||[]).map(n=>n|0).sort((a,b)=>a-b);
      return sel.length ? sel : [activeIdx|0];
    }

    function waveSnapshotForSlot(slot){
      slot = slot|0;

      // If the editor slot is dirty, prefer the live editor buffer.
      const useEditor = (slot === (EDIT.slot|0)) && LIB.dirty && LIB.dirty.has && LIB.dirty.has(slot) && EDIT.dataU8;
      if (useEditor){
        const nm = _alnum4(((nameIn && nameIn.value) ? nameIn.value : (EDIT.name || 'WAVE')).toUpperCase());
        const u8 = new Uint8Array(EDIT.dataU8);
        try{
          const rot = EDIT.dataU8 && EDIT.dataU8.displayRot;
          if (rot !== undefined) u8.displayRot = rot|0;
        }catch(_){}
        const heat = (typeof EDIT._dpHeat === 'number' && isFinite(EDIT._dpHeat) && EDIT._dpHeat > 0) ? EDIT._dpHeat : 1;
        return { name:nm, dataU8:u8, user:true, _dpHeat: heat };
      }

      const w = LIB.waves[slot];
      if (!w || !w.dataU8) return null;

      const u8 = new Uint8Array(w.dataU8);
      try{
        const rot = w.dataU8 && w.dataU8.displayRot;
        if (rot !== undefined) u8.displayRot = rot|0;
      }catch(_){}
      const heat = (typeof w._dpHeat === 'number' && isFinite(w._dpHeat) && w._dpHeat > 0) ? w._dpHeat : 1;
      return { name:String(w.name||'WAVE'), dataU8:u8, user:true, _dpHeat: heat };
    }

    function copySlotsToClipboard(){
      const slots = slotsForClipboard();
      const items = slots.map(waveSnapshotForSlot);

      SLOT_CLIP = { items, srcSlots: slots.slice(), ts: Date.now() };

      // Keep legacy CLIP (single-wave buffer) useful for Morph/Stack/etc: take first non-empty.
      const first = items.find(x=>x && x.dataU8);
      if (first){
        CLIP = { name: first.name, dataU8: new Uint8Array(first.dataU8) };
      }

      announceIO(slots.length===1 ? `Copied slot ${slots[0]+1}.` : `Copied ${slots.length} slot(s).`);
    }

    function cutSlotsToClipboard(){
      const slots = slotsForClipboard();
      const items = slots.map(waveSnapshotForSlot);

      SLOT_CLIP = { items, srcSlots: slots.slice(), ts: Date.now() };

      const first = items.find(x=>x && x.dataU8);
      if (first){
        CLIP = { name: first.name, dataU8: new Uint8Array(first.dataU8) };
      }

      const __bankBefore = captureBankState(slots, { preferEditor:true });

      for (const s of slots){
        LIB.waves[s] = null;
        LIB.dirty.delete(s);
        paintGridCell(s);
      }

      if (slots.includes(EDIT.slot|0)){
        openInEditor(EDIT.slot|0);
      }

      const __bankAfter = captureBankState(slots);
      bankPush({
        label: slots.length===1 ? `Cut slot ${slots[0]+1}` : `Cut ${slots.length} slot(s)`,
        before: __bankBefore,
        after: __bankAfter
      });

      announceIO(slots.length===1 ? `Cut slot ${slots[0]+1}.` : `Cut ${slots.length} slot(s).`);
      updateButtonsState();
    }

    function pasteClipboardToActive(){
      if (!SLOT_CLIP || !SLOT_CLIP.items || !SLOT_CLIP.items.length){
        announceIO('Clipboard empty.', true);
        return;
      }

      const items = SLOT_CLIP.items;

      // PASTE semantics (robust / musical workflow):
      //  - If clipboard has 1 item:
      //      • Paste into *all selected* slots (repeat the single wave).
      //  - If clipboard has N>1 items:
      //      • If exactly 1 destination slot is selected, treat it as the *start* slot and
      //        paste contiguously (dst, dst+1, dst+2, ...), clamped to slot 64.
      //      • Otherwise (2+ destination slots selected), paste one-to-one onto the first
      //        min(selection, clipboard) slots.
      const sel = Array.from(SELECTED||[])
        .map(n=>n|0)
        .filter(n=>n>=0 && n<64)
        .sort((a,b)=>a-b);

      let start = activeIdx|0;
      let targets = [];
      let mapSingle = false;
      let mode = 'range';

      if (sel.length){
        if (items.length === 1){
          // Repeat single wave across selection
          mode = 'selection';
          targets = sel.slice();
          mapSingle = true;
          start = targets[0]|0;
        } else if (sel.length === 1){
          // Multi-item clipboard + single destination slot => contiguous range paste
          mode = 'range';
          start = sel[0]|0;
          for (let k=0;k<items.length;k++){
            const t = start + k;
            if (t < 0 || t >= 64) break;
            targets.push(t);
          }
        } else {
          // Multi destination slots selected => paste onto selection (stable visual order)
          mode = 'selection';
          const n = Math.min(sel.length, items.length);
          targets = sel.slice(0, n);
          start = targets[0]|0;
        }
      } else {
        // No selection: paste contiguously onto active slot.. (clamped to bank).
        for (let k=0;k<items.length;k++){
          const t = start + k;
          if (t < 0 || t >= 64) break;
          targets.push(t);
        }
      }

      if (!targets.length) return;

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      for (let k=0;k<targets.length;k++){
        const t = targets[k];
        const item = mapSingle ? items[0] : items[k];

        if (!item){
          LIB.waves[t] = null;
          LIB.dirty.delete(t);
        } else {
          const nm = _alnum4((item.name||'WAVE').toUpperCase());
          const u8 = new Uint8Array(item.dataU8);

          try{
            const rot = item.dataU8 && item.dataU8.displayRot;
            if (rot !== undefined) u8.displayRot = rot|0;
          }catch(_){ }

          const rec = attachDisplayRot({ name:nm, dataU8:u8, user:true }, false);
          // Preserve HOT gain metadata if present in the clipboard snapshot.
          const heat = (typeof item._dpHeat === 'number' && isFinite(item._dpHeat) && item._dpHeat > 0) ? item._dpHeat : 1;
          rec._dpHeat = heat;
          LIB.waves[t] = rec;

          // Invalidate cached DigiPRO tables so exports rebuild correctly.
          delete LIB.waves[t]._tables6132;
          delete LIB.waves[t]._tables6132_clip;
          delete LIB.waves[t]._tables6132_norm;
          delete LIB.waves[t]._srcFloat;

          LIB.dirty.delete(t);
        }

        paintGridCell(t);
      }

      // If we overwrote the editor slot, reload the editor so UI matches reality.
      if (targets.includes(EDIT.slot|0)){
        openInEditor(EDIT.slot|0);
      }

      const __bankAfter = captureBankState(targets);
      const label = (mode === 'selection')
        ? `Paste into ${targets.length} selected slot(s)`
        : `Paste ${targets.length} slot(s) @ ${start+1}`;
      bankPush({ label, before: __bankBefore, after: __bankAfter });

      if (mode === 'selection'){
        if (items.length === 1){
          announceIO(`Pasted into ${targets.length} selected slot(s).`);
        } else if (targets.length !== sel.length){
          announceIO(`Pasted ${targets.length}/${sel.length} selected slot(s) (clipboard shorter).`);
        } else if (targets.length !== items.length){
          announceIO(`Pasted ${targets.length}/${items.length} item(s) into selected slot(s).`);
        } else {
          announceIO(`Pasted ${targets.length} selected slot(s).`);
        }
      } else {
        announceIO(
          targets.length !== items.length
            ? `Pasted ${targets.length}/${items.length} slot(s) starting at ${start+1} (hit bank end).`
            : `Pasted ${targets.length} slot(s) starting at ${start+1}.`
        );
      }

      updateButtonsState();
    }


    // Paste helper: apply the normal ("musical") paste semantics, but with a caller-supplied
    // item sequence. This is used by creative Paste Special modes like Reverse / Ping-Pong.
    function dpPasteItemsToActiveWithSemantics(items, actionLabel){
      if (!items || !items.length){
        announceIO('Clipboard empty.', true);
        return;
      }

      actionLabel = String(actionLabel || 'Paste');

      const sel = Array.from(SELECTED||[])
        .map(n=>n|0)
        .filter(n=>n>=0 && n<64)
        .sort((a,b)=>a-b);

      let start = activeIdx|0;
      let targets = [];
      let mapSingle = false;
      let mode = 'range';

      if (sel.length){
        if (items.length === 1){
          // Repeat single wave across selection
          mode = 'selection';
          targets = sel.slice();
          mapSingle = true;
          start = targets[0]|0;
        } else if (sel.length === 1){
          // Multi-item list + single destination slot => contiguous range paste
          mode = 'range';
          start = sel[0]|0;
          for (let k=0;k<items.length;k++){
            const t = start + k;
            if (t < 0 || t >= 64) break;
            targets.push(t);
          }
        } else {
          // Multi destination slots selected => paste one-to-one onto selection
          mode = 'selection';
          const n = Math.min(sel.length, items.length);
          targets = sel.slice(0, n);
          start = targets[0]|0;
        }
      } else {
        // No selection: paste contiguously onto active slot.. (clamped to bank).
        for (let k=0;k<items.length;k++){
          const t = start + k;
          if (t < 0 || t >= 64) break;
          targets.push(t);
        }
      }

      if (!targets.length) return;

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      for (let k=0;k<targets.length;k++){
        const tSlot = targets[k];
        const item = mapSingle ? items[0] : items[k];

        if (!item || !item.dataU8){
          LIB.waves[tSlot] = null;
          LIB.userWaves[tSlot] = null;
          LIB.dirty.delete(tSlot);
          paintGridCell(tSlot);
          continue;
        }

        const nm = _alnum4((item.name||'WAVE').toUpperCase());
        const u8 = new Uint8Array(item.dataU8);

        try{
          const rot = item.dataU8 && item.dataU8.displayRot;
          if (rot !== undefined) u8.displayRot = rot|0;
        }catch(_){ }

        const rec = attachDisplayRot({ name:nm, dataU8:u8, user:true }, false);

        // Preserve HOT gain metadata if present in the clipboard snapshot.
        const heat = (typeof item._dpHeat === 'number' && isFinite(item._dpHeat) && item._dpHeat > 0) ? item._dpHeat : 1;
        rec._dpHeat = heat;

        LIB.waves[tSlot] = rec;
        LIB.userWaves[tSlot] = rec;

        // Invalidate cached DigiPRO tables so exports rebuild correctly.
        delete rec._tables6132;
        delete rec._tables6132_clip;
        delete rec._tables6132_norm;
        delete rec._srcFloat;

        LIB.dirty.delete(tSlot);
        paintGridCell(tSlot);
      }

      // If we overwrote the editor slot, reload the editor so UI matches reality.
      if (targets.includes(EDIT.slot|0)){
        openInEditor(EDIT.slot|0);
      }

      const __bankAfter = captureBankState(targets);
      const label = (mode === 'selection')
        ? `${actionLabel} into ${targets.length} selected slot(s)`
        : `${actionLabel} ${targets.length} slot(s) @ ${start+1}`;
      bankPush({ label, before: __bankBefore, after: __bankAfter });

      if (mode === 'selection'){
        if (items.length === 1){
          announceIO(`${actionLabel}: pasted into ${targets.length} selected slot(s).`);
        } else if (targets.length !== sel.length){
          announceIO(`${actionLabel}: pasted ${targets.length}/${sel.length} selected slot(s) (sequence shorter).`);
        } else if (targets.length !== items.length){
          announceIO(`${actionLabel}: pasted ${targets.length}/${items.length} item(s) into selected slot(s).`);
        } else {
          announceIO(`${actionLabel}: pasted ${targets.length} selected slot(s).`);
        }
      } else {
        announceIO(
          targets.length !== items.length
            ? `${actionLabel}: pasted ${targets.length}/${items.length} slot(s) starting at ${start+1} (hit bank end).`
            : `${actionLabel}: pasted ${targets.length} slot(s) starting at ${start+1}.`
        );
      }

      updateButtonsState();
    }


    function pasteClipboardToActiveReverseSpecial(){
      if (!SLOT_CLIP || !SLOT_CLIP.items || !SLOT_CLIP.items.length){
        announceIO('Clipboard empty.', true);
        return;
      }
      const items = SLOT_CLIP.items.slice().reverse();
      dpPasteItemsToActiveWithSemantics(items, 'Paste Special: Reverse');
    }


    function pasteClipboardToActivePingPongSpecial(){
      if (!SLOT_CLIP || !SLOT_CLIP.items || !SLOT_CLIP.items.length){
        announceIO('Clipboard empty.', true);
        return;
      }

      const items = SLOT_CLIP.items;
      if ((items.length|0) < 2){
        announceIO('Paste Ping-Pong needs 2+ copied slots.', true);
        pasteClipboardToActive();
        return;
      }

      // Ping-pong (no endpoints duplication):
      //   [A B C D] => [A B C D C B]
      //   [A B C]   => [A B C B]
      //   [A B]     => [A B]
      const seq = items.concat(items.slice(1, -1).reverse());
      dpPasteItemsToActiveWithSemantics(seq, 'Paste Special: Ping-Pong');
    }



    // Paste Special target selection rules (shared by Evolve + Morph Table Builder)
    //
    // Matches the spec:
    //  - Multi-selection: target exactly those slots (sorted).
    //  - Single selection: treat as a start slot and fill contiguously to the end of the bank.
    //  - No selection: paste contiguously from the active slot, length = clipboard length.
    function dpComputePasteSpecialTargets(clipboardLen){
      clipboardLen = Math.max(0, clipboardLen|0);

      const sel = Array.from(SELECTED||[])
        .map(n=>n|0)
        .filter(n=>n>=0 && n<64)
        .sort((a,b)=>a-b);

      let start = activeIdx|0;
      let targets = [];
      let mode = 'range';

      if (sel.length > 1){
        mode = 'selection';
        targets = sel.slice();
        start = targets[0]|0;
      } else if (sel.length === 1){
        mode = 'range';
        start = sel[0]|0;
        const len = Math.max(1, 64 - start);
        for (let k=0;k<len;k++) targets.push(start + k);
      } else {
        mode = 'range';
        start = activeIdx|0;
        for (let k=0;k<clipboardLen;k++){
          const t = start + k;
          if (t < 0 || t >= 64) break;
          targets.push(t);
        }
      }

      return { start, targets, mode };
    }



    function pasteClipboardToActiveEvolveSpecial(){
      // Paste Special: Apply the *current* Evolve recipe/path while pasting.
      //
      // Key idea: the *destination range length* drives the evolution scan, so you can
      // select any number of slots (musical table lengths) and paste a coherent sweep.
      //
      // Source mapping:
      //   - If the clipboard contains 1 wave: it is evolved across the entire target range.
      //   - If the clipboard contains N>1 waves: we "stretch map" the clipboard across the
      //     targets so the copied *range* meaningfully contributes to the result.
      //
      // Uses the last-chosen Evolve settings (recipe/path/PWM domain).

      if (!SLOT_CLIP || !SLOT_CLIP.items || !SLOT_CLIP.items.length){
        announceIO('Clipboard empty.', true);
        return;
      }
      if (typeof dpEvolveGenerate !== 'function'){
        // Safety: if the evolve engine is unavailable for any reason, fall back to normal paste.
        pasteClipboardToActive();
        return;
      }

      const items = SLOT_CLIP.items;

      // Targets: follow Paste Special target rules (selection or contiguous fill).
      const plan = dpComputePasteSpecialTargets(items.length);
      const start = plan.start|0;
      const targets = plan.targets;
      const mode = plan.mode;

      if (!targets.length) return;

      // If there's only one destination, an "evolve sweep" doesn't make sense.
      // Fall back to normal paste (safe, non-surprising).
      if (targets.length < 2){
        pasteClipboardToActive();
        return;
      }

      // Read last-chosen evolve settings.
      const recipe = (typeof EVOLVE_STATE !== 'undefined' && EVOLVE_STATE && EVOLVE_STATE.recipe)
        ? String(EVOLVE_STATE.recipe)
        : 'seeded';
      let pathId = (typeof EVOLVE_STATE !== 'undefined' && EVOLVE_STATE && EVOLVE_STATE.path)
        ? String(EVOLVE_STATE.path)
        : 'oneway';
      const pwmDomain = (typeof EVOLVE_STATE !== 'undefined' && EVOLVE_STATE && EVOLVE_STATE.pwmDomain === 'full')
        ? 'full'
        : 'half';

      // Some recipes support alternate skew scanning; fall back to oneway if not supported.
      let altOk = false;
      try{
        const r = (typeof EVOLVE_RECIPES !== 'undefined' && Array.isArray(EVOLVE_RECIPES))
          ? EVOLVE_RECIPES.find(x=>x && x.id === recipe)
          : null;
        altOk = !!(r && r.altSkew);
      }catch(_){ altOk = false; }
      if (pathId === 'alternate' && !altOk) pathId = 'oneway';

      const N = targets.length|0;

      // Precompute ping-pong normalization so the midpoint reaches full intensity.
      let pingMax = 1;
      if (pathId === 'pingpong'){
        let m = 0;
        for (let i=0;i<N;i++){
          const u = (i+1)/(N+1);
          const tri = 1 - Math.abs(2*u - 1);
          if (tri > m) m = tri;
        }
        pingMax = (m > 1e-9) ? m : 1;
      }

      // Naming: if clipboard is a single wave, auto-number names like Evolve does (prefix2 + slotNo).
      let useNumberedNames = false;
      let prefix2 = 'WV';
      try{
        if (items.length === 1){
          useNumberedNames = true;
          const tok = (typeof fileToken4 === 'function') ? fileToken4((items[0] && items[0].name) || 'WAVE') : _alnum4((items[0] && items[0].name) || 'WAVE');
          prefix2 = String(tok||'WV').toUpperCase().slice(0,2).padEnd(2,'W');
        }
      }catch(_){ useNumberedNames = false; prefix2 = 'WV'; }

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      try{
        for (let i=0;i<N;i++){
          const tSlot = targets[i]|0;

          // Map clipboard index across targets (stretch mapping aligns endpoints).
          let srcIdx = 0;
          if (items.length > 1){
            srcIdx = (N <= 1) ? 0 : Math.round(i * (items.length - 1) / (N - 1));
            if (srcIdx < 0) srcIdx = 0;
            if (srcIdx >= items.length) srcIdx = items.length - 1;
          }

          const item = items[srcIdx];

          if (!item || !item.dataU8){
            LIB.waves[tSlot] = null;
            LIB.userWaves[tSlot] = null;
            LIB.dirty.delete(tSlot);
            paintGridCell(tSlot);
            continue;
          }

          // Compute evolve position t based on the chosen scan path.
          let t = 1;
          if (pathId === 'oneway'){
            // Include endpoints so the first slot can be the source (t=0) and last reaches full (t=1).
            t = (N <= 1) ? 1 : (i / (N - 1));
          } else if (pathId === 'pingpong'){
            const u = (i+1)/(N+1);
            const tri = 1 - Math.abs(2*u - 1);
            t = tri / pingMax;
          } else if (pathId === 'alternate'){
            // Alternate around neutral (0.5), increasing depth over time: 0.5±d, 0.5±2d, ...
            const pairs = Math.ceil(N/2);
            const pairIdx = Math.floor(i/2);
            const depth = (pairs <= 1) ? 1 : ((pairIdx + 1) / pairs);
            const sign = (i % 2 === 0) ? 1 : -1;
            t = 0.5 + sign * 0.5 * depth;
          } else {
            t = (N <= 1) ? 1 : (i / (N - 1));
          }

          // PWM domain handling matches the Evolve tool.
          if (recipe === 'pwm' && pathId !== 'alternate' && pwmDomain === 'half'){
            t = 0.5 + 0.5 * _clamp01(t);
          } else {
            t = _clamp01(t);
          }

          const out = (pathId === 'alternate' && altOk)
            ? dpEvolveGenerate(item.dataU8, t, recipe, { altSkew:true })
            : dpEvolveGenerate(item.dataU8, t, recipe);

          const nm = useNumberedNames
            ? ((prefix2 + String(tSlot+1).padStart(2,'0')).slice(0,4).padEnd(4,'0'))
            : _alnum4((item.name||'WAVE').toUpperCase());

          const rec = attachDisplayRot({ name:nm, dataU8: out, user:true }, false);

          // Preserve HOT gain metadata if present in the clipboard snapshot.
          const heat = (typeof item._dpHeat === 'number' && isFinite(item._dpHeat) && item._dpHeat > 0) ? item._dpHeat : 1;
          rec._dpHeat = heat;

          LIB.waves[tSlot] = rec;
          LIB.userWaves[tSlot] = rec;

          // Invalidate cached DigiPRO tables so exports rebuild correctly.
          delete rec._tables6132;
          delete rec._tables6132_clip;
          delete rec._tables6132_norm;
          delete rec._srcFloat;

          LIB.dirty.delete(tSlot);
          paintGridCell(tSlot);
        }
      } catch(err){
        console.error(err);
        // Robust: revert any partial writes.
        try{ if (typeof applyBankState === 'function') applyBankState(__bankBefore); }catch(_){ }
        announceIO('Paste Special (Evolve) failed (see Console).', true);
        return;
      }

      // If we overwrote the editor slot, reload the editor so UI matches reality.
      if (targets.includes(EDIT.slot|0)){
        openInEditor(EDIT.slot|0);
      }

      const __bankAfter = captureBankState(targets);
      const label = (mode === 'selection')
        ? `Paste Special (Evolve) into ${targets.length} selected slot(s)`
        : `Paste Special (Evolve) ${targets.length} slot(s) @ ${start+1}`;
      bankPush({ label, before: __bankBefore, after: __bankAfter });

      const recipeLabel = (typeof dpEvolveRecipeLabel === 'function') ? dpEvolveRecipeLabel(recipe) : recipe;
      announceIO(`Paste Special: Evolved ${targets.length} slot(s) (${recipeLabel}).`);
      updateButtonsState();
    }


    function pasteClipboardToActiveMorphTableSpecial(){
      // Paste Special: Morph Table Builder (Anchors)
      // Converts 2–4 clipboard waves into a true morph series across the computed
      // destination range (selection or contiguous fill).

      if (!SLOT_CLIP || !SLOT_CLIP.items || !SLOT_CLIP.items.length){
        announceIO('Clipboard empty.', true);
        return;
      }
      const items = SLOT_CLIP.items;
      const K = items.length|0;

      // Only valid for 2–4 copied slots.
      if (K < 2 || K > 4){
        announceIO('Morph Table Builder needs 2–4 copied slots. (Copy 2–4 slots first.)', true);
        // Robust fallback: keep user workflow moving.
        pasteClipboardToActive();
        return;
      }

      if (typeof dpMorphGenerate !== 'function'){
        // Safety: if the morph engine is unavailable, fall back to normal paste.
        pasteClipboardToActive();
        return;
      }

      // Validate anchors
      const anchors = [];
      const anchorNames = [];
      for (let i=0;i<K;i++){
        const it = items[i];
        if (!it || !it.dataU8 || !it.dataU8.length){
          announceIO('Morph Table Builder: one or more copied slots are empty. Copy 2–4 non-empty waves.', true);
          pasteClipboardToActive();
          return;
        }
        anchors.push(it.dataU8);
        anchorNames.push(String(it.name||'WAVE'));
      }

      // Compute destination targets.
      const plan = dpComputePasteSpecialTargets(K);
      const start = plan.start|0;
      const targets = plan.targets;
      const mode = plan.mode;
      const N = targets.length|0;
      if (!N) return;

      // Read last-chosen morph settings (two-wave morph mode).
      const morphMode = (typeof MORPH_STATE !== 'undefined' && MORPH_STATE && MORPH_STATE.mode)
        ? String(MORPH_STATE.mode)
        : ((typeof EVOLVE_DUAL_STATE !== 'undefined' && EVOLVE_DUAL_STATE && EVOLVE_DUAL_STATE.mode)
          ? String(EVOLVE_DUAL_STATE.mode)
          : 'specblur');

      const isPM = (morphMode === 'pm');
      const pmMax = 0.18; // match Morph tool (FM/PM Boost max phase deviation in cycles)

      // Naming: 2-char prefix from first anchor name + destination slot number.
      let prefix2 = 'MR';
      try{
        const tok = (typeof fileToken4 === 'function') ? fileToken4(anchorNames[0] || 'MORP') : _alnum4((anchorNames[0] || 'MORP').toUpperCase());
        prefix2 = String(tok||'MR').toUpperCase().slice(0,2).padEnd(2,'M');
      }catch(_){ prefix2 = 'MR'; }

      const __bankBefore = captureBankState(targets, { preferEditor:true });

      // Helper: compute a morph between two endpoints with the current mode.
      const morph2 = (aU8, bU8, t)=>{
        const tt = _clamp01(t);
        if (!isPM) return dpMorphGenerate(aU8, bU8, tt, morphMode);
        if (typeof dpPhaseModGenerate !== 'function') return dpMorphGenerate(aU8, bU8, tt, 'xfade');
        const base = dpMorphGenerate(aU8, bU8, tt, 'xfade');
        const depth = pmMax * 4 * tt * (1 - tt);
        return dpPhaseModGenerate(base, bU8, depth);
      };

      try{
        // Edge case: only one target slot (e.g. active at slot 64).
        if (N === 1){
          const tSlot = targets[0]|0;
          const it = items[0];
          const nm = _alnum4(String((it && it.name) ? it.name : 'WAVE').toUpperCase());
          const out = new Uint8Array(anchors[0]);
          try{
            const rot = it && it.dataU8 && it.dataU8.displayRot;
            if (rot !== undefined) out.displayRot = rot|0;
          }catch(_){ }
          const rec = attachDisplayRot({ name:nm, dataU8: out, user:true }, false);
          // Preserve HOT gain metadata when we're effectively pasting the anchor.
          try{
            const heat = (it && typeof it._dpHeat === 'number' && isFinite(it._dpHeat) && it._dpHeat > 0) ? it._dpHeat : 1;
            rec._dpHeat = heat;
          }catch(_){ }
          LIB.waves[tSlot] = rec;
          LIB.userWaves[tSlot] = rec;
          delete rec._tables6132;
          delete rec._tables6132_clip;
          delete rec._tables6132_norm;
          delete rec._srcFloat;
          LIB.dirty.delete(tSlot);
          paintGridCell(tSlot);
        } else {
          for (let k=0;k<N;k++){
            const tSlot = targets[k]|0;
            const u = (N <= 1) ? 0 : (k / (N - 1));

            let out;
            if (K === 2){
              out = morph2(anchors[0], anchors[1], u);
            } else if (K === 3){
              if (u < 0.5){
                out = morph2(anchors[0], anchors[1], u * 2);
              } else {
                out = morph2(anchors[1], anchors[2], (u - 0.5) * 2);
              }
            } else { // K === 4
              const oneThird = 1/3;
              if (u < oneThird){
                out = morph2(anchors[0], anchors[1], u * 3);
              } else if (u < 2*oneThird){
                out = morph2(anchors[1], anchors[2], (u - oneThird) * 3);
              } else {
                out = morph2(anchors[2], anchors[3], (u - 2*oneThird) * 3);
              }
            }

            const num2 = String(tSlot+1).padStart(2,'0');
            const nm = (prefix2 + num2).slice(0,4).padEnd(4,'0');
            const rec = attachDisplayRot({ name:nm, dataU8: out, user:true }, false);

            LIB.waves[tSlot] = rec;
            LIB.userWaves[tSlot] = rec;

            // Invalidate cached DigiPRO tables so exports rebuild correctly.
            delete rec._tables6132;
            delete rec._tables6132_clip;
            delete rec._tables6132_norm;
            delete rec._srcFloat;

            LIB.dirty.delete(tSlot);
            paintGridCell(tSlot);
          }
        }
      } catch(err){
        console.error(err);
        // Robust: revert any partial writes.
        try{ if (typeof applyBankState === 'function') applyBankState(__bankBefore); }catch(_){ }
        announceIO('Paste Special (Morph Table) failed (see Console).', true);
        return;
      }

      // If we overwrote the editor slot, reload the editor so UI matches reality.
      if (targets.includes(EDIT.slot|0)){
        openInEditor(EDIT.slot|0);
      }

      const __bankAfter = captureBankState(targets);
      bankPush({ label: 'Paste Special: Morph Table', before: __bankBefore, after: __bankAfter });

      const modeLabel = (typeof dpEvolveDualModeLabel === 'function') ? dpEvolveDualModeLabel(morphMode) : morphMode;
      announceIO(`Paste Special: Morph Table built across ${targets.length} slot(s) (${modeLabel}).`);
      updateButtonsState();
    }


    function promptPasteSpecialMenu(){
      // Minimal Paste Special palette (Ctrl/Cmd+Shift+V)
      // - Enter triggers the highlighted (default) option
      // - E / M / R / P hotkeys execute immediately
      // - Esc cancels

      if (!SLOT_CLIP || !SLOT_CLIP.items || !SLOT_CLIP.items.length){
        announceIO('Clipboard empty.', true);
        return;
      }

      const clipLen = (SLOT_CLIP.items.length|0);
      const morphValid = (clipLen >= 2 && clipLen <= 4);
      const pingValid = (clipLen >= 2);

      // Determine initial default.
      let last = (typeof PASTE_SPECIAL_STATE !== 'undefined' && PASTE_SPECIAL_STATE && PASTE_SPECIAL_STATE.lastMode)
        ? String(PASTE_SPECIAL_STATE.lastMode)
        : 'evolve';
      if (!/^(evolve|morph|reverse|pingpong)$/.test(last)) last = 'evolve';
      if (last === 'morph' && !morphValid) last = 'evolve';
      if (last === 'pingpong' && !pingValid) last = 'evolve';

      const overlay = el('div','mm-digi-guard');
      const dlg = el('div','dlg');
      const h = el('h4'); h.textContent = 'Paste Special';
      const p = el('div'); p.className = 'mm-small';
      p.textContent = 'Choose how to paste the clipboard into the target slots.';

      const row = el('div','mm-modegrid');
      row.style.marginTop = '8px';

      const bE = el('button');
      bE.textContent = 'Evolve Sweep (E)';
      bE.title = 'Apply the current Evolve settings while pasting.';

      const bM = el('button');
      bM.textContent = 'Morph Table Builder (Anchors) (M)';
      bM.title = 'Build a morph series from 2–4 clipboard waves across the target range.';
      if (!morphValid){
        bM.disabled = true;
        bM.title = `Copy 2–4 slots to use Morph Table Builder (clipboard has ${clipLen}).`;
      }

      const bR = el('button');
      bR.textContent = 'Paste Reverse (R)';
      bR.title = 'Paste the copied waves in reverse order.';

      const bP = el('button');
      bP.textContent = 'Paste Ping-Pong (P)';
      bP.title = 'Paste as a ping-pong / palindrome sequence (A…Z…B). Requires copying 2+ slots.';
      if (!pingValid){
        bP.disabled = true;
        bP.title = `Copy 2+ slots to use Ping-Pong (clipboard has ${clipLen}).`;
      }

      row.append(bE, bM, bR, bP);

      const note = el('div');
      note.className = 'mm-small';
      note.style.marginTop = '10px';
      note.style.opacity = '0.9';
      note.textContent = morphValid
        ? 'Hotkeys: E=Evolve, M=Morph, R=Reverse, P=Ping-Pong. Tip: Select a range of destination slots to control table length. If only 1 slot is selected, Evolve/Morph fill to the end of the bank.'
        : 'Hotkeys: E=Evolve, R=Reverse, P=Ping-Pong. (Morph requires copying 2–4 slots.)';

      const btns = el('div','btns');
      const bCancel = el('button');
      bCancel.textContent = 'Cancel';
      btns.append(bCancel);

      function setDefault(mode){
        mode = /^(evolve|morph|reverse|pingpong)$/.test(String(mode)) ? String(mode) : 'evolve';
        if (mode === 'morph' && !morphValid) mode = 'evolve';
        if (mode === 'pingpong' && !pingValid) mode = 'evolve';

        bE.classList.toggle('mm-mode-active', mode === 'evolve');
        bM.classList.toggle('mm-mode-active', mode === 'morph');
        bR.classList.toggle('mm-mode-active', mode === 'reverse');
        bP.classList.toggle('mm-mode-active', mode === 'pingpong');

        // Clear previous defaults
        try{ delete bE.dataset.default; }catch(_){ }
        try{ delete bM.dataset.default; }catch(_){ }
        try{ delete bR.dataset.default; }catch(_){ }
        try{ delete bP.dataset.default; }catch(_){ }

        if (mode === 'evolve') bE.dataset.default = '1';
        else if (mode === 'morph') bM.dataset.default = '1';
        else if (mode === 'reverse') bR.dataset.default = '1';
        else bP.dataset.default = '1';
      }

      function finish(){
        try{ document.removeEventListener('keydown', onKey, true); }catch(_){ }
        try{ overlay.removeEventListener('click', onOverlayClick); }catch(_){ }
        overlay.remove();
      }

      function onOverlayClick(e){
        if (e && e.target === overlay) finish();
      }

      function onKey(e){
        if (!e) return;
        const k = e.key;
        if (k === 'e' || k === 'E'){
          try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
          bE.click();
        }
        else if (k === 'm' || k === 'M'){
          try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
          if (!morphValid){
            announceIO('Copy 2–4 slots to use Morph Table Builder.', true);
            return;
          }
          bM.click();
        }
        else if (k === 'r' || k === 'R'){
          try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
          bR.click();
        }
        else if (k === 'p' || k === 'P'){
          try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
          if (!pingValid){
            announceIO('Copy 2+ slots to use Ping-Pong paste.', true);
            return;
          }
          bP.click();
        }
      }

      bE.onclick = ()=>{
        if (typeof PASTE_SPECIAL_STATE !== 'undefined' && PASTE_SPECIAL_STATE) PASTE_SPECIAL_STATE.lastMode = 'evolve';
        finish();
        pasteClipboardToActiveEvolveSpecial();
      };
      bM.onclick = ()=>{
        if (!morphValid){
          announceIO('Copy 2–4 slots to use Morph Table Builder.', true);
          return;
        }
        if (typeof PASTE_SPECIAL_STATE !== 'undefined' && PASTE_SPECIAL_STATE) PASTE_SPECIAL_STATE.lastMode = 'morph';
        finish();
        pasteClipboardToActiveMorphTableSpecial();
      };

      bR.onclick = ()=>{
        if (typeof PASTE_SPECIAL_STATE !== 'undefined' && PASTE_SPECIAL_STATE) PASTE_SPECIAL_STATE.lastMode = 'reverse';
        finish();
        pasteClipboardToActiveReverseSpecial();
      };

      bP.onclick = ()=>{
        if (!pingValid){
          announceIO('Copy 2+ slots to use Ping-Pong paste.', true);
          return;
        }
        if (typeof PASTE_SPECIAL_STATE !== 'undefined' && PASTE_SPECIAL_STATE) PASTE_SPECIAL_STATE.lastMode = 'pingpong';
        finish();
        pasteClipboardToActivePingPongSpecial();
      };
      bCancel.onclick = ()=>finish();

      dlg.append(h, p, row, note, btns);
      overlay.append(dlg);
      overlay.addEventListener('click', onOverlayClick);
      // Capture-phase so it can run even if other handlers stopPropagation.
      document.addEventListener('keydown', onKey, true);
      document.body.append(overlay);

      setDefault(last);
    }

    function clickGuardDefault(guard){
      const btns = Array.from(guard.querySelectorAll('.btns button, button'))
        .filter(b=>b && !b.disabled);
      if (!btns.length) return false;

      // Prefer an explicitly marked default/primary button.
      // (Some dialogs place the actionable buttons outside the .btns row.)
      const explicit = guard.querySelector('button[data-default="1"], button.primary, button.mm-primary, .btns button.primary, .btns button.mm-primary');
      if (explicit && !explicit.disabled){
        explicit.click();
        return true;
      }

      const nonCancel = btns.find(b => !/cancel|close|no/i.test((b.textContent||'').trim()));
      (nonCancel || btns[0]).click();
      return true;
    }

    function clickGuardCancel(guard){
      const btns = Array.from(guard.querySelectorAll('.btns button, button'))
        .filter(b=>b && !b.disabled);
      if (!btns.length) return false;

      const cancel = btns.find(b => /cancel|close|no/i.test((b.textContent||'').trim()));
      (cancel || btns[btns.length-1]).click();
      return true;
    }

    document.addEventListener('keydown', (e)=>{
      if (!digiproPanelIsVisible()) return;

      // Modal / guard overlays: Enter confirms, Escape cancels.
      const guard = document.querySelector('.mm-digi-guard');
      if (guard){
        if (e.key === 'Enter'){
          if (clickGuardDefault(guard)){
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        if (e.key === 'Escape'){
          if (clickGuardCancel(guard)){
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        // Don't run global shortcuts while a modal is open.
        return;
      }

      const key = e.key;
      let handled = false;

      // Arrow keys move active tile
      if (key==='ArrowLeft'){ activeIdx = clamp(activeIdx-1, 0, 63); handled=true; }
      else if (key==='ArrowRight'){ activeIdx = clamp(activeIdx+1, 0, 63); handled=true; }
      else if (key==='ArrowUp'){ activeIdx = clamp(activeIdx-8, 0, 63); handled=true; }
      else if (key==='ArrowDown'){ activeIdx = clamp(activeIdx+8, 0, 63); handled=true; }

      // Enter opens editor for the active slot
      else if (key==='Enter'){
        maybeGuardBeforeSwitch(activeIdx, ()=>{
          openInEditor(activeIdx);
          try{
            if (!(JOB && JOB.running)){
              const idx = (activeIdx|0);
              const w = (LIB && LIB.waves) ? LIB.waves[idx] : null;
              const ok = !!(w && w.dataU8 && w.dataU8.length && !isSilentU8(w.dataU8));
              const nm = (EDIT && EDIT.name) ? String(EDIT.name).toUpperCase() : ((w && w.name) ? String(w.name).toUpperCase() : 'WAVE');
              announceIO(ok ? `Loaded slot ${idx+1} ${nm}.` : `Loaded slot ${idx+1} (empty).`);
            }
          }catch(_){ }
        });
        handled=true;
      }

      // Space previews
      else if (key===' '){
        quickPreview(activeIdx);
        try{
          if (!e.repeat && !(JOB && JOB.running)){
            const idx = (activeIdx|0);
            const w = (LIB && LIB.waves) ? LIB.waves[idx] : null;
            const ok = !!(w && w.dataU8 && w.dataU8.length && !isSilentU8(w.dataU8));
            announceIO(ok ? `Preview slot ${idx+1}.` : `Slot ${idx+1} empty.`, !ok);
          }
        }catch(_){ }
        handled=true;
      }

      // Undo/Redo
      else if ((e.metaKey||e.ctrlKey) && (key==='z' || key==='Z')){
        if (e.shiftKey){ redoAny(); } else { undoAny(); }
        handled = true;
      }
      else if ((e.metaKey||e.ctrlKey) && (key==='y' || key==='Y')){
        redoAny(); handled = true;
      }

      // Escape clears selection, or cancels a running job if nothing is selected.
      else if (key==='Escape'){
        if (mmIsTextEntryTarget(e.target)) return;
        if (SELECTED && SELECTED.size){
          clearSelection();
          announceIO('Selection cleared.');
          handled = true;
        } else if (JOB && JOB.running){
          requestCancelJob();
          handled = true;
        }
      }

      // Delete / Backspace clears selection (or active slot)
      else if (key==='Delete' || key==='Backspace'){
        if (mmIsTextEntryTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        const sel = Array.from(SELECTED).sort((a,b)=>a-b);
        const targets = sel.length ? sel : [activeIdx];
        promptClearSlots(targets);
        handled = true;
      }

      // Cmd/Ctrl+A selects all
      else if ((e.metaKey||e.ctrlKey) && (key==='a'||key==='A')){
        if (mmIsTextEntryTarget(e.target)) return;
        selectAllSlots();
        announceIO('Selected all slots.');
        handled = true;
      }

      // Copy/Cut/Paste (bank-slot semantics)
      else if ((e.metaKey||e.ctrlKey) && (key==='c'||key==='C')){
        if (mmIsTextEntryTarget(e.target)) return;
        copySlotsToClipboard();
        handled = true;
      }
      else if ((e.metaKey||e.ctrlKey) && (key==='x'||key==='X')){
        if (mmIsTextEntryTarget(e.target)) return;
        cutSlotsToClipboard();
        handled = true;
      }
      else if ((e.metaKey||e.ctrlKey) && e.shiftKey && (key==='v'||key==='V')){
        if (mmIsTextEntryTarget(e.target)) return;
        promptPasteSpecialMenu();
        handled = true;
      }
      else if ((e.metaKey||e.ctrlKey) && (key==='v'||key==='V')){
        if (mmIsTextEntryTarget(e.target)) return;
        pasteClipboardToActive();
        handled = true;
      }

      if (handled){
        ensureActiveHighlight();
        e.preventDefault();
      }
    }, { passive:false });
  }


  // ----- Piano drawing & events -----
	// Keyboard area can be either a piano keyboard or a 64-pad slot audition grid.
	// Shift-click on either view toggles between them.
	function setKeyboardView(mode){
	  mode = (String(mode) === 'pads') ? 'pads' : 'keys';
	  KB_VIEW_MODE = mode;
	  try{ stopPreview(); }catch(_){ }
	  if (_previewStopTimer){ try{ clearTimeout(_previewStopTimer); }catch(_){ } _previewStopTimer = null; }
	  previewSlotIdx = null;
	  padsHoverIdx = null;
	  if (pianoCanvas) pianoCanvas.style.display = (mode === 'keys') ? '' : 'none';
	  if (padsCanvas)  padsCanvas.style.display  = (mode === 'pads') ? '' : 'none';
	  if (editorCanvas) editorCanvas.classList.toggle('mm-view-active', mode === 'keys');
	  if (wavetableCanvas) wavetableCanvas.classList.toggle('mm-view-active', mode === 'pads');
	  if (kbBtnKeys) kbBtnKeys.classList.toggle('active', mode === 'keys');
	  if (kbBtnPads) kbBtnPads.classList.toggle('active', mode === 'pads');
	  // Redraw the active view
	  if (mode === 'keys'){
	    drawPiano();
	    if (typeof paintEditor === 'function') paintEditor();
	  } else {
	    drawSlotPads();
	    requestWavetableViewportDraw();
	  }
	}
	function toggleKeyboardView(){
	  const next = (KB_VIEW_MODE === 'pads') ? 'keys' : 'pads';
	  setKeyboardView(next);
	  // Lightweight user feedback (avoid clobbering job progress).
	  try{
	    if (!(JOB && JOB.running)) announceIO(next === 'pads' ? 'Pads mode: wavetable view.' : 'Keys mode: editor view.');
	  }catch(_){ }
	}

  const PIANO = { startMidi: 0, endMidi: 127 }; // C2..C7: audible on most speakers
  function drawPiano()
{
    const c = pianoCanvas; if (!c) return;
    const H = 64;

    // Build key list first (so we know how wide we need to be)
    const keys = [], whites = [];
    for (let m = PIANO.startMidi; m <= PIANO.endMidi; m++){
      const n = m % 12, black = [1,3,6,8,10].includes(n);
      keys.push({ midi:m, black });
      if (!black) whites.push(m);
    }
    const whiteCount = whites.length;

    // Ensure usable key width; allow horizontal scroll if needed
    const wrapW = c.parentElement ? (c.parentElement.getBoundingClientRect().width|0) : 800;
    const minWhitePx = 20; // ~20px per white key keeps it playable
    const W = Math.max(wrapW, Math.ceil(whiteCount * minWhitePx));

    c.width = W; c.height = H;
    c.style.width = W + 'px';

    const ctx = c.getContext('2d');
    ctx.clearRect(0,0,W,H);

    // place whites
    const whiteW = W / whiteCount;
    let xw = 0;
    keys.forEach(k=>{
      if (!k.black){ k.x=xw; k.y=0; k.w=whiteW; k.h=H; xw+=whiteW; }
    });

    // place blacks (midpoint between neighboring whites)
    keys.forEach(k=>{
      if (!k.black) return;
      const left  = keys.find(t=>!t.black && t.midi===k.midi-1);
      const right = keys.find(t=>!t.black && t.midi===k.midi+1);
      if (left && right){
        k.w = whiteW*0.6; k.h = H*0.6;
        k.x = (left.x + right.x + right.w)/2 - k.w/2;
        k.y = 0;
      }
    });

    // draw order: whites then blacks
    ctx.lineWidth = 1;
    keys.forEach(k=>{
      if (k.black) return;
      ctx.fillStyle = '#fff'; ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.strokeStyle = '#999'; ctx.strokeRect(k.x, k.y, k.w, k.h);
    });
    keys.forEach(k=>{
      if (!k.black) return;
      ctx.fillStyle = '#222'; ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.strokeStyle = '#111'; ctx.strokeRect(k.x, k.y, k.w, k.h);
    });
    c._keys = keys;
}

// ----- 64-slot pad strip (64 columns, 1 row) -----
function drawSlotPads(){
const c = padsCanvas; if (!c) return;

const H = 64; // internal drawing height (CSS can scale)
const cols = 64, rows = 1;

// Use the parent width so this still works even when pads canvas is display:none.
const wrapW = (kbMainWrap
  ? (kbMainWrap.getBoundingClientRect().width|0)
  : (c.parentElement ? (c.parentElement.getBoundingClientRect().width|0) : 800));

// Make pads a usable size and allow horizontal scroll (like piano).
const W = Math.max(1, wrapW|0);
c.width = W;
c.height = H;
c.style.width = W + 'px';

const ctx = c.getContext('2d');
ctx.clearRect(0,0,W,H);

const pw = W / cols;
const ph = H / rows; // = H

  const active = (EDIT && typeof EDIT.slot === 'number') ? (EDIT.slot|0) : -1;

ctx.font = '10px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';

// One row: idx == col
for (let col=0; col<cols; col++){
  const idx = col;
  const x = col*pw;
  const y = 0;

  const isActive = (idx === active);
  const isHover  = (padsHoverIdx != null) && ((padsHoverIdx|0) === idx);
  const rec = dpViewRecordForSlot(idx);
  const hasWave = !!(rec && rec.dataU8 && rec.dataU8.length);

  // Background
  if (!hasWave) ctx.fillStyle = '#f1f1f1';
  else if (isHover) ctx.fillStyle = '#e8f6ff';
  else if (isActive) ctx.fillStyle = '#dff8ff';
  else ctx.fillStyle = '#fafafa';
  ctx.fillRect(x, y, pw, ph);

  // Border
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#999';
  ctx.strokeRect(x+0.5, y+0.5, pw-1, ph-1);

  // Active outline (extra)
  if (isActive){
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a8';
    ctx.strokeRect(x+1.5, y+1.5, pw-3, ph-3);
  }

  // Label
  ctx.fillStyle = hasWave ? '#333' : '#777';
  ctx.fillText(String(idx+1), x + pw/2, y + ph/2);
}

c._padGeom = { W, H, cols, rows };
}

function slotPadIndexFromEvent(e){
  const c = padsCanvas; if (!c) return null;
  const r = c.getBoundingClientRect();
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;

  // Map CSS pixels -> canvas coordinate space
  const sx = (r.width  ? (c.width  / r.width)  : 1);
  const sy = (r.height ? (c.height / r.height) : 1);
  const x = (e.clientX - r.left) * sx;
  const y = (e.clientY - r.top)  * sy;

  if (!(x >= 0 && y >= 0 && x < c.width && y < c.height)) return null;

  const cols = 64, rows = 1;
  const col = Math.floor(x / (c.width / cols));
  const row = 0; // single row
  const idx = row * cols + col;

  if (idx < 0 || idx > 63) return null;
  return idx|0;
}

	function attachSlotPadsEvents(){
	  const c = padsCanvas; if (!c) return;
	  // Prevent double-binding if renderEditorBar rebuilds.
	  if (c._boundPads) return;
	  c._boundPads = true;
	  const DRAG_PREVIEW_DEBOUNCE_MS = 14;
	  const DRAG_PREVIEW_XFADE_MS = 18;
	  let down = false;
	  let lastIdx = null;
	  c.addEventListener('pointerdown', (e)=>{
	    if (e && e.shiftKey){
	      toggleKeyboardView();
	      return;
	    }
	    down = true;
	    if (_previewStopTimer){ try{ clearTimeout(_previewStopTimer); }catch(_){ } _previewStopTimer = null; }
	    try{ c.setPointerCapture(e.pointerId); }catch(_){ }
	    const idx = slotPadIndexFromEvent(e);
	    if (idx != null){
	      lastIdx = idx;
	      padsHoverIdx = idx;
	      previewSlotIdx = idx;
	      drawSlotPads();
	      requestWavetableViewportDraw();
	      const w = dpViewRecordForSlot(idx);
	      stopPreview();
	      if (typeof startSmoothPreview === 'function'){
	        startSmoothPreview(w && w.dataU8 ? w.dataU8 : null, dpWavetablePreviewMidi(DIGIPRO_PREVIEW_MIDI), {
	          key: `slot-${idx}`,
	          fadeMs: DRAG_PREVIEW_XFADE_MS
	        });
	      } else {
	        startPreview(w && w.dataU8 ? w.dataU8 : null, dpWavetablePreviewMidi(DIGIPRO_PREVIEW_MIDI));
	      }
	    }
	  });
	  c.addEventListener('pointermove', (e)=>{
	    if (!down) return;
	    const idx = slotPadIndexFromEvent(e);
	    if (idx != null && idx !== lastIdx){
	      lastIdx = idx;
	      padsHoverIdx = idx;
	      previewSlotIdx = idx;
	      drawSlotPads();
	      requestWavetableViewportDraw();
	      const w = dpViewRecordForSlot(idx);
	      if (typeof startSmoothPreview === 'function'){
	        startSmoothPreview(w && w.dataU8 ? w.dataU8 : null, dpWavetablePreviewMidi(DIGIPRO_PREVIEW_MIDI), {
	          key: `slot-${idx}`,
	          debounceMs: DRAG_PREVIEW_DEBOUNCE_MS,
	          fadeMs: DRAG_PREVIEW_XFADE_MS
	        });
	      } else {
	        startPreview(w && w.dataU8 ? w.dataU8 : null, dpWavetablePreviewMidi(DIGIPRO_PREVIEW_MIDI));
	      }
	    }
	  });
	  const end = (e)=>{
	    if (!down) return;
	    down = false;
	    lastIdx = null;
	    padsHoverIdx = null;
	    previewSlotIdx = null;
	    drawSlotPads();
	    requestWavetableViewportDraw();
	    try{ if (e) c.releasePointerCapture(e.pointerId); }catch(_){ }
	    stopPreview();
	  };
	  c.addEventListener('pointerup', end);
	  c.addEventListener('pointercancel', end);
	  c.addEventListener('pointerleave', ()=>{ if (down) end(null); });
	  window.addEventListener('resize', ()=>{
	    if (KB_VIEW_MODE === 'pads'){
	      drawSlotPads();
	      requestWavetableViewportDraw();
	    }
	  });
	}


  function pianoNoteFromEvent(e){
    const c = pianoCanvas; if (!c || !c._keys) return null;
    const r = c.getBoundingClientRect();
    // Map CSS pixels -> canvas coordinate space (important when CSS scales the canvas)
    const sx = (r.width  ? (c.width  / r.width)  : 1);
    const sy = (r.height ? (c.height / r.height) : 1);
    const x = (e.clientX - r.left) * sx;
    const y = (e.clientY - r.top)  * sy;
    // test blacks first (they overlap whites)
    for (const k of c._keys.filter(k=>k.black)){
      if (x>=k.x && x<k.x+k.w && y>=k.y && y<k.h) return k.midi;
    }
    for (const k of c._keys.filter(k=>!k.black)){
      if (x>=k.x && x<k.x+k.w && y>=k.y && y<k.h) return k.midi;
    }
    return null;
  }
  function attachPianoEvents(){
    const c = pianoCanvas; if (!c) return;
    // Prevent double-binding if renderEditorBar rebuilds.
    if (c._boundPiano) return;
    c._boundPiano = true;
    let down=false, lastNote=null;
	    c.addEventListener('pointerdown', (e)=>{
	      if (e && e.shiftKey){
	        toggleKeyboardView();
	        return;
	      }
	      down=true;
      try{ c.setPointerCapture(e.pointerId); }catch(_){}
      const n = pianoNoteFromEvent(e);
      if (n!=null){ lastNote=n; startPreview(EDIT.dataU8, n); }
    });
    c.addEventListener('pointermove', (e)=>{
      if (!down) return;
      const n = pianoNoteFromEvent(e);
      if (n!=null && n!==lastNote){ lastNote=n; startPreview(EDIT.dataU8, n); }
    });
    c.addEventListener('pointerup',   (e)=>{
      down=false; lastNote=null;
      try{ c.releasePointerCapture(e.pointerId); }catch(_){}
      stopPreview();
    });
    c.addEventListener('pointerleave',()=>{
      if (down){ down=false; lastNote=null; stopPreview(); }
    });
    // resize-aware redraw
    window.addEventListener('resize', ()=> drawPiano());
  }

  // Init when panel appears
