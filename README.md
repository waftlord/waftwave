# Waft Wave

**Monomachine mk2 DigiPRO waveform import/export & single‑cycle laboratory.**

Waft Wave is a **static, client‑side web app** (HTML + vanilla JS) for editing and transferring **Elektron Monomachine DigiPRO** single‑cycle waveforms over **MIDI SysEx** (C6‑style **0x5D** dumps / **0x5E** requests).

It also includes optional tooling for **Machinedrum UW** wave sending (see `assets/js/md-uw-wavemode.js`).

> **Not affiliated with or endorsed by Elektron.**  
> “Elektron”, “Monomachine”, and “Machinedrum” are trademarks of Elektron Music Machines.

## What’s in this repo

- `index.html` + `*.css` — the UI (runs in your browser)
- `digipro-sysex.js` — DigiPRO SysEx (0x5D) decode/encode implementation
- `midi.js` — WebMIDI + SysEx reassembly + “Turbo” sending
- `import-export.js` — WAV / SYX / JSON import + WAV / SYX / ZIP export
- `scripts/e2e-sim-check.mjs` — Node-based smoke test for asset wiring and core browser/runtime flows

## Quick start

### Option A: Run locally (recommended for development)

WebMIDI generally requires a **secure context**. `http://localhost` counts as secure in modern browsers.

```bash
# from the repo root
python3 -m http.server 8000
# then open: http://localhost:8000
```

### Optional: run the smoke test

If you have Node.js available, you can run the included smoke test before sharing changes:

```bash
node scripts/e2e-sim-check.mjs
```

### Option B: Host on GitHub Pages

This repo is a static site (no build step), so it works well with **GitHub Pages**:

1. Push the repo to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your default branch and the **`/ (root)`** folder.
5. Save and wait for the Pages deploy to finish.

GitHub Pages is served over HTTPS, which satisfies the browser secure-context requirement for WebMIDI. Chromium-based browsers are still recommended for SysEx access.

## Browser / MIDI notes

- WebMIDI + SysEx is best supported in **Chromium‑based browsers** (Chrome / Edge).
- You will be asked for MIDI permission; SysEx access must be allowed.
- Use a reliable MIDI interface and **double‑check in/out routing** before sending.

## Protocol notes (DigiPRO)

The DigiPRO waveform dump message is a fixed‑size **7027‑byte SysEx** message.

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

## Before sharing publicly

- Replace the placeholder copyright owner in `NOTICE`.
- Run `node scripts/e2e-sim-check.mjs`.
- Test once in a Chromium-based browser with your expected MIDI routing.
