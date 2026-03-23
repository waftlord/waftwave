// DigiPRO UI split: bootstrap/init (runs once)

'use strict';

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  if (root.__digiproPanelInitOnce) return;
  root.__digiproPanelInitOnce = true;

  function init(){
    try{
      const panel = bySel('[data-panel-id="digipro"] .panel-content');
      if (!panel) return;

      // Minimal dependency sanity checks (prevents hard crash on load)
      if (!root.MMDT_DigiPRO){
        try{ console.error('[DigiPRO] Missing dependency: window.MMDT_DigiPRO (mmdt-digipro-sysex.js)'); }catch(_){}
        panel.innerHTML = '<div style="padding:12px;border:1px solid #f99;background:#fff5f5;border-radius:8px;">'
                        + '<b>DigiPRO panel failed to start.</b><br>'
                        + '<span class="small">Missing dependency: <code>window.MMDT_DigiPRO</code> (SysEx codec).</span>'
                        + '</div>';
        return;
      }

      // Build scaffolding if not present
      if (!bySel('#digiproEditorBar', panel)){
        const editorBar = el('div'); editorBar.id='digiproEditorBar';
        const grid = el('div'); grid.id='digiproGrid'; grid.className='mm-digi-grid';
        panel.innerHTML='';

    // Wire extracted modules (no ES modules): undo/redo + import/export
    try {
      if (root.DP_Undo && typeof root.DP_Undo.init === 'function') {
        root.DP_Undo.init(
          () => ({
            LIB,
            EDIT,
            SELECTED,
            getSelectAnchor: () => SELECT_ANCHOR,
            setSelectAnchor: (v) => { SELECT_ANCHOR = v; },
            getActiveIdx: () => activeIdx,
            setActiveIdx: (v) => { activeIdx = v|0; },
          }),
          null,
          (info) => {
            // Keep repaint logic defensive: initUndo() is called before the UI is fully built.
            try {
              if (info && info.domain === 'bank') {
                const touched = Array.isArray(info.touched)
                  ? info.touched.map(n => n|0).filter(n => n >= 0 && n < 64)
                  : [];

                // Bank actions already repaint their own targets; avoid a full editor DOM rebuild here
                // because it recreates the wavetable canvas and causes a visible flash on swaps/moves.
                if (touched.length){
                  touched.forEach(i => paintGridCell(i));
                } else if (info.op === 'undo' || info.op === 'redo'){
                  for (let i=0;i<64;i++) paintGridCell(i);
                }

                ensureActiveHighlight();

                const didSoftRefresh = !!(
                  typeof refreshEditorBar === 'function'
                  && refreshEditorBar()
                );
                if (!didSoftRefresh && typeof renderEditorBar === 'function'){
                  renderEditorBar();
                }
              } else if (info && typeof info.slot === 'number') {
                paintGridCell(info.slot|0);
              } else {
                // Best-effort: repaint active slot (or 0 as fallback)
                paintGridCell((activeIdx|0) || 0);
              }
            } catch (e) {}

            try { if (typeof paintEditor === 'function') paintEditor(); } catch (e) {}
            try { if (typeof updateUndoButtons === 'function') updateUndoButtons(); } catch (e) {}
            try { if (typeof updateButtonsState === 'function') updateButtonsState(); } catch (e) {}

            // Keep users informed when undo/redo is applied (short + descriptive).
            // We only announce on explicit undo/redo operations to avoid spamming during snapshots.
            try {
              if (info && (info.op === 'undo' || info.op === 'redo')) {
                // Don't clobber progress/status during long-running batch operations.
                if (JOB && JOB.running) return;
                const verb = (info.op === 'undo') ? 'Undo' : 'Redo';
                const raw = String(info.label || '').trim();
                const label = (raw && raw !== 'baseline') ? raw : '';
                announceIO(label ? `${verb}: ${label}` : `${verb}.`);
              }
            } catch (e) {}
          }
        );
      }
    } catch (e) {}

    try {
      if (root.DP_IO && typeof root.DP_IO.init === 'function') {
        root.DP_IO.init({
          getCurrentState: () => ({ LIB, EDIT }),
          job: JOB,
          beginJob,
          endJob,
          repaintSlot: (slot) => paintGridCell(slot|0),
          repaintAll: () => { for (let i=0;i<64;i++) paintGridCell(i); },
          onProgress: (msg) => announceIO(msg, false),
          onError: (msg) => announceIO(msg, true),
          onDone: (msg) => announceIO(msg, false),
          getSysexDeviceId: () => (typeof root.mmGetSysexDeviceId === 'function' ? root.mmGetSysexDeviceId() : 0),
        });
      }
    } catch (e) {}
        panel.append(editorBar, grid);
      }

      initUndo(); // === PATCH: start history for this slot
      renderEditorBar();
      buildGrid();
      bindKeyboard();
      attachMidiCaptureOnce();

      // Initial tooltips / reminders
      announceIO('Ready');
    }catch(err){
      try{ console.error('[DigiPRO] init() crashed', err); }catch(_){}
      try{
        const panel = document.querySelector('[data-panel-id="digipro"] .panel-content');
        if (panel){
          panel.innerHTML = '<div style="padding:12px;border:1px solid #f99;background:#fff5f5;border-radius:8px;">'
                          + '<b>DigiPRO panel failed to start.</b><br>'
                          + '<span class="small">Open DevTools → Console for details.</span>'
                          + '</div>';
        }
      }catch(_){}
    }
  }

  // Defer to DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
