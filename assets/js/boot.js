// boot.js — minimal stubs + app boot (no UI rendering)
(function(){
  'use strict';

  // Minimal stubs to satisfy mmdt-midi.js in DigiPRO-only build.
  // (Copied from the monolithic index_patched_v2.html)
  window.MMDT_State = window.MMDT_State || {
    makeDefault: () => ({
      selection: {},
      working: {}
    })
  };

  window.MMDT = window.MMDT || {
    state: window.MMDT_State.makeDefault(),
    receive: () => null
  };

  // Optional one-time guards (kept minimal to avoid semantic changes)
  // window.__digiproPanelInitOnce is used by the panel to avoid double-init.
  // Leave undefined unless you explicitly need to force a reset.
})();