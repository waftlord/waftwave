// DigiPRO UI split: MIDI capture/orchestration

'use strict';

  // MIDI Capture-ALL: one listener only (guard if helper not present)
  function attachMidiCaptureOnce(){
    if (!root) return;

    // Remove previous if any
    try{
      if (root.__digiproCaptureUnsub){ root.__digiproCaptureUnsub(); }
    }catch(_){}
    root.__digiproCaptureUnsub = null;

    // Passive “capture-all” of incoming DigiPRO dumps is now opt-in.
    //
    // Default behaviour (dpPassiveCaptureEnabled = false/undefined):
    //   Ignore unsolicited slot dumps completely.
    //
    // Explicit downloads (Download slot(s) / Download ALL) are still handled via
    // requestDumpAsync/requestDigiPRODumpAsync and are unaffected.
    if (!root.dpPassiveCaptureEnabled) return;

    // Handler now expects a *complete* SysEx (chunking already reassembled upstream).
    const handler = (u8)=>{
      try{
        if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8||[]);
      }catch(_){
        return;
      }

      if (root.MMDT_DigiPRO && root.MMDT_DigiPRO.isWaveDump && !root.MMDT_DigiPRO.isWaveDump(u8)) return;

      // If this is a DigiPRO dump we *solicited* via requestDumpAsync, ignore here
      // (the request/response path will handle it).
      try{
        const slot = (u8 && u8.length > 9) ? (u8[9] & 0x3F) : -1;
        if (slot >= 0 && root.__digiproRequestsInFlight && root.__digiproRequestsInFlight.has(slot)) return;
      }catch(_){}

      // Decode + stash
      try{
        // Slot number is a 6-bit field (0..63). Some firmware/cables set upper bits
        // in this byte, so mask to 0x3F to avoid dropping slot 64 (index 63).
        const slot = (u8 && u8.length > 9) ? (u8[9] & 0x3F) : -1;
        if (slot < 0) return;

        if (root.MMDT_DigiPRO && root.MMDT_DigiPRO.MSG_SIZE_BYTES && u8.length < root.MMDT_DigiPRO.MSG_SIZE_BYTES){
          console.warn('Captured DigiPRO dump truncated:', u8.length, '<', root.MMDT_DigiPRO.MSG_SIZE_BYTES);
          return;
        }

        const dec = root.MMDT_DigiPRO.decode(u8);
        // If the dump is corrupted (e.g., interleaved/noisy MIDI, partial joins),
        // avoid overwriting the slot with a bad capture.
        if (dec && dec.checksumOk === false){
          console.warn('Captured DigiPRO dump failed checksum; ignoring.', { slot: slot+1, name: dec.name });
          return;
        }
        const name = (dec && dec.name) ? dec.name : '????';
        const dataU8 = (dec && dec.dataU8) ? dec.dataU8 : null;
        if (!dataU8) return;

        const rec = { name, dataU8: new Uint8Array(dataU8), user:true };
        if (dec && dec.kind === 'slot6132' && dec.tables){
          rec._tables6132 = {
            t0: new Int16Array(dec.tables.t0),
            t1: new Int16Array(dec.tables.t1),
            t2: new Int16Array(dec.tables.t2),
          };
        }

        // Store into library slot
        LIB.waves[slot] = attachDisplayRot(rec, true);
        paintGridCell(slot);
        announceIO(`Captured slot ${slot+1} “${name}” (${dataU8.length} samples).`);
      }catch(_){}
      updateButtonsState();
    };

    root.__digiproCaptureBound = handler;

    if (root.mmAddSysexListener){
      // Preferred: listen on the complete-SysEx bus.
      root.__digiproCaptureUnsub = root.mmAddSysexListener(handler);
    } else if (root.selectedMidiIn){
      // Fallback: raw WebMIDI midimessage (may be chunked on some drivers/browsers).
      const raw = (ev)=>handler(new Uint8Array(ev.data||[]));
      try{ root.selectedMidiIn.addEventListener('midimessage', raw); }catch(_){}
      root.__digiproCaptureUnsub = ()=>{ try{ root.selectedMidiIn.removeEventListener('midimessage', raw); }catch(_){} };
    }
  }
