# Waft Wave

https://wftlrd.uk/waftwave

**Monomachine mk2 DigiPRO waveform import/export & single‑cycle laboratory.**

Waft Wave is a **static, client‑side web app** (HTML + vanilla JS) for editing and transferring **Elektron Monomachine DigiPRO** single‑cycle waveforms over **MIDI SysEx** (C6‑style **0x5D** dumps / **0x5E** requests).

It also includes optional tooling for **Machinedrum UW** wave sending (see `assets/js/md-uw-wavemode.js`) and optional export for **Tonverk** wavetables.

> **Not affiliated with or endorsed by Elektron.**  
> “Elektron”, “Monomachine”, and “Machinedrum” are trademarks of Elektron Music Machines.

## What’s in this repo

- `index.html` + `*.css` — the UI (runs in your browser)
- `digipro-sysex.js` — DigiPRO SysEx (0x5D) decode/encode implementation
- `midi.js` — WebMIDI + SysEx reassembly + “Turbo” sending
- `import-export.js` — WAV / SYX / JSON import + WAV / SYX / ZIP export
- `scripts/e2e-sim-check.mjs` — Node-based smoke test for asset wiring and core browser/runtime flows

## Browser / MIDI notes

- WebMIDI + SysEx is best supported in **Chromium‑based browsers** (Chrome / Edge).
- You will be asked for MIDI permission; SysEx access must be allowed.
- Use a reliable MIDI interface and **double‑check in/out routing** before sending.

## Protocol notes (DigiPRO)

The DigiPRO waveform dump message is a fixed‑size **7027‑byte SysEx** message.

Under the hood, DigiPRO decode reads the `0x5D` SysEx header, slot, and 4‑character name, 7‑bit unpacks the **7008‑byte** payload back into **6132 raw bytes**, and then reassembles those bytes as **1022 six‑byte blocks** laid out `A0_hi, A0_lo, B_hi, A1_hi, A1_lo, B_lo`, which become three `Int16Array(1022)` streams (`t0`, `t1`, `t2`). Encode does the reverse, but first renders a single cycle into the Monomachine/C6 table structure: DC is removed, the wave is resampled to **1024** samples, FFT/C6 rolloff and coefficient weighting are applied, and nine stacked mip levels (`1024..4`) are quantized into the A/B streams before being repacked, 7‑bit encoded, and wrapped with checksum/length bytes. The multi‑resolution table layout: `t0` and `t1` hold the main A stream as even/odd samples across the stacked levels, while `t2` carries the companion low‑passed B stream for the smaller levels plus two zero terminators, so DigiPRO stores a compact wavetable pyramid rather than one flat 1024‑sample waveform.

## WAV export notes

- **Export slot WAV** exports the current slot as a single-cycle WAV with embedded loop points. If multiple slots are selected, it exports a ZIP of the selected WAVs.
  - **Shift+Click** opens advanced pitch/tuning options. For selected-slot ZIP exports, it can also include a **packed chain WAV + slice info**.
- **Export bank WAVs** exports the full 64-slot bank by default (including silent placeholders for empty slots).
  - **Shift+Click** opens advanced pitch/tuning options and also allows choosing a **slot scope**: **All 64 / Filled only / Selected only**.

## Safety / device caution

This tool can send SysEx to hardware. You are responsible for:

- backing up your device,
- using correct MIDI routing,
- and complying with any applicable laws / agreements.

## License

Licensed under the **Apache License 2.0**. See `LICENSE`.
