# Waftwave tutorial video script

## Accuracy note

I adjusted the opening so it stays fact-safe as of 2026-03-29.

- I could verify the current Syntakt manual for OS 1.40 dated 2026-03-04.
- I could verify the current Tonverk manual for OS 1.2.1 dated 2026-02-04.
- I could not verify a newly announced dedicated Tonverk wavetable machine in Elektron's current official docs, so the intro below talks about renewed Elektron interest in wavetable-style workflows instead of making that claim directly.

If you want a looser, more hype-driven version later, we can do that too. This version is built to be accurate and safe to publish.

## Recording style

This script is written so you can perform the actions while you speak. Each section has a voiceover line and a matching on-screen action list.

## Full script

### 1. Cold open

Narration:

"Wavetables keep coming back because they sit right in that sweet spot between synthesis and motion. You are not just designing one waveform, you are designing a path through timbre. And with Elektron users still pushing deeper into wave-sweep, morph, and sampler-friendly wavetable workflows, Waftwave feels incredibly relevant right now.

This is Waftwave, a browser-based single-cycle and wavetable laboratory built around Elektron Monomachine mk2 DigiPRO workflows, with modern export options that also make sense for Tonverk-oriented wavetable prep. In this video I am going to walk through the interface, show what every major section does, then build a rich wavetable step by step using normal edit mode, morphing, Table Mode, table view, and export."

On screen:

- Land on the Waft Wave main screen.
- Let the camera hold on the title, subtitle, and overall layout.
- Do not click anything yet.

### 2. What Waftwave is for

Narration:

"At the highest level, Waftwave is three things at once. It is a waveform editor for single-cycle material. It is a wavetable builder for turning one sound, multiple anchors, or even a loop into a playable table. And it is a transfer and export hub, so you can move material into DigiPRO, save banks, export WAVs, or prepare Tonverk-friendly wavetable files."

On screen:

- Point to the top subtitle.
- Briefly hover the left control area.
- Briefly hover the center waveform editor.
- Briefly hover the right tools panel.

### 3. Top bar and hardware section

Narration:

"Across the top we have the hardware side. `MIDI I/O` opens the port and Turbo setup. That is where you choose MIDI input and output, enable WebMIDI, set Turbo speed, and adjust the inter-slot delay if your hardware needs a little extra breathing room during larger transfers.

If you are talking directly to a Monomachine, this is where the round trip starts. The status pills also give you a quick read on whether MIDI is active and what Turbo multiplier you are currently running."

On screen:

- Click `MIDI I/O`.
- Point out MIDI input, MIDI output, Turbo button, Turbo slider, inter-slot delay.
- Close the modal.

### 4. Left side controls - import, transfer, export

Narration:

"The left control block is the practical side of the app.

`Download slot(s)` pulls the active slot or the selected slots from hardware.
`Download ALL` captures the whole bank.
`Upload slot(s)` pushes the active slot or the current selection back to hardware.
`Upload ALL` sends the whole bank.

Below that, `Load Audio` imports WAV material into the active slot, or into a run of slots if you are working sequentially.

Then we get one of the most powerful buttons in the whole app: `Slice Loop`. This is how you turn a loop into either raw contiguous playback slices or a proper wavetable spread.

And finally, the export row gives you a few directions out: JSON bank snapshots, WAV exports, SYX export for DigiPRO, and single-slot WAV export."

On screen:

- Point to `Download slot(s)` and `Download ALL`.
- Point to `Upload slot(s)` and `Upload ALL`.
- Point to `Load Audio`.
- Point to `Slice Loop`.
- Point to `Export bank (.json)`, `Export bank WAVs`, `Export bank SYX (.zip)`, and `Export slot WAV`.

### 5. Center editor and hidden table view

Narration:

"The center display is where the sound becomes visible. In the default view, this is the waveform editor. You can hear and shape the active single-cycle wave here.

Under that, the keyboard area has a second job that is easy to miss. If you shift-click the keyboard area, Waftwave flips between keys mode and pads mode. Pads mode becomes the wavetable view. That lets you look at the whole table as a scan path instead of just one waveform.

When you are in the wavetable view, you also get the transpose controls overlay, so you can audition the table up or down in semitones without changing the actual data."

On screen:

- Show the waveform editor.
- Shift-click to switch to pads mode / wavetable view.
- Point to the transpose controls: `-`, semitone box, `ST`, `+`, `0`.
- Shift-click back if you want to keep the rest of the demo in editor view first.

### 6. Right side tools - classic mode versus Table Mode

Narration:

"The right side is the creative engine. This area has two personalities.

The first is the classic edit view, which is basically your normal mode. This is where you hit individual effects, destructive edits, batch tools, Evolve, Blend, Mutate, FUSE, AMP, and NORM.

The second is `Table Mode`. Table Mode is not just another effect page. It is a way of pushing a controlled transformation across an entire wavetable, or across just the slots you selected. That is the key idea to understand in Waftwave: classic mode is where you make or shape ingredients, and Table Mode is where you spread motion across the whole table."

On screen:

- Point to `Table Mode`.
- Briefly show the classic FX grid.
- Click `Table Mode` to reveal the slider panel.
- Point to the morph drop-down and sliders.
- Click back to classic mode for the next section.

### 7. Classic mode walkthrough

Narration:

"Let me break down the right panel in practical terms.

The big effects grid is for direct waveform edits. This is where you see tools like `Smooth`, `Normalize`, `Reverse`, `Morph`, `WaveShape`, `Stack`, `PWM Warp`, `Phase Dist`, `HardClip`, `SoftClip`, `RingMod`, and a whole set of FFT tools like `Warm`, `Bright`, `Formant`, `HarmShift`, `SpecCrush`, `Smear`, and `SpecMorph`.

Under that are the batch and table-building tools. `Mutate` gives variation. `FUSE` creates a new derived wave. `Batch Name` renames groups of slots. `Evolve` generates a series. `Blend Sel` combines selected waves into one result. `Randomize slots` is great for idea generation. `AMP` applies gain treatment across slots. `NORM` peak-matches them. And `Clear` is your cleanup button."

On screen:

- Slowly move across the FX grid.
- Point to `Mutate`, `FUSE`, `Batch Name`, `Evolve`, `Blend Sel`, `Randomize slots`, `AMP`, `NORM`, `Clear`.

### 8. Deep edit example - build a seed wave in classic mode

Narration:

"Now let us do the first practical pass. I am going to build a stronger seed wave before I turn it into a table.

Start by loading audio or selecting an existing slot. Then use the classic buttons to give the source more identity. A clean workflow is something like `Smooth` to tame rough edges, `Normalize` to level the waveform, then one or two character moves like `PWM Warp`, `Phase Dist`, `HardClip`, `Smear`, or `Formant`.

The main idea here is not to over-process the seed. Give it a clear character, then let the table-building tools create motion from that character."

On screen:

- Load a source into one slot, or use an existing slot.
- Apply a simple chain such as `Smooth`, `Normalize`, `PWM Warp`, then maybe `Smear (FFT)` or `Formant (FFT)`.
- Keep the moves readable and slow.

### 9. Step-by-step single-seed Evolve

Narration:

"With one good seed wave ready, now we can generate a table.

Click `Evolve`. If you shift-click it, you get the full settings dialog. This uses the active slot as the seed and writes new variations into the following slots, while leaving the seed itself unchanged.

The first thing to choose is total slot count. If I set this to 16, Waftwave keeps the current slot as the starting point and writes 15 new waves after it.

Then choose the scan path. `One-way` is the classic gradual sweep from subtle to strong. `Ping-pong` builds a more symmetrical motion that feels great when scanning back and forth. `Alt skew` alternates left and right style movement, but only for recipes that support a musically meaningful positive and negative direction.

Then choose the recipe. This is the character of the evolution. For smoother, organic movement, I like `Formant Drift`, `Harmonic Stretch/Compress`, or `Spectral`. For more animated, digital, or aggressive motion, try `Phase Warp`, `Hardsync`, `Bin Switch`, `Phase Quantize`, or `Cheby`.

And this is a big advanced point: you can build a sequence of up to three recipe steps. Control-click or command-click multiple recipes, then reorder them in the sequence area. That gives you evolving transformations instead of just one transform repeated across the table."

On screen:

- Shift-click `Evolve`.
- Set a count like 16.
- Show `One-way`, then briefly mention `Ping-pong` and `Alt skew`.
- Choose one recipe, or briefly show a 2-step sequence.
- Run it.
- Show the new block of slots.

### 10. Two-wave, three-wave, and four-wave morphs

Narration:

"Single-seed Evolve is one way to build a table. The other big way is anchor-based morphing.

This part is beautifully simple. If you select exactly two slots and click `Evolve`, Waftwave automatically switches into two-wave morph mode. If you select three slots, it becomes an A to B to C morph. If you select four, it becomes A to B to C to D. And if you select five or more filled slots, Waftwave fills the gaps between those anchors.

This is where you move from waveform variation into real wavetable storytelling."

On screen:

- Select 2 slots.
- Click `Evolve` to open the morph dialog.
- Cancel and briefly repeat with 3 or 4 selected slots if you want to show the behavior.

### 11. Detailed morph mode guide

Narration:

"Inside the morph dialog, placement is the first choice. `Fill gap` writes between existing anchors and keeps the anchor slots untouched. `Write after A` builds the series after the first anchor instead.

Then we choose the morph mode. Here is the practical way to think about the main ones.

`Time Crossfade` is the fast, direct, punchy option.
`FM/PM Boost` adds extra phase movement near the midpoint, so the middle of the table feels more alive.
`Spectral Blur` is one of the safest musical defaults because it smooths the transition and avoids a lot of ugly stepping.
`Spectral Tilt` is great when you want the table to feel like it is opening or darkening.
`Harmonic Crossover` is excellent when one anchor has the body and the other has the brightness.
`WaveShaper` makes B act like a curve on A, so it gets more extreme and more synthetic.
`Ring Mod` is great for metallic or sideband-heavy tables.
`XOR`, `AND`, and `OR` are for harder digital textures.

And just like the single-wave Evolve dialog, you can stack up to three morph modes into a sequence if you want a more complex interpolation path."

On screen:

- Open the two-wave morph dialog.
- Click through a few modes slowly.
- Show the sequence area briefly.

### 12. Practical morph recipe for a rich table

Narration:

"Here is a really solid performance-friendly recipe.

Pick two anchors with clearly different spectral identities. Make the first one darker and weightier. Make the second one brighter or more phase-warped. Then run a morph with `Spectral Blur` or `Harmonic Crossover`.

If you want the center of the table to have more animation, try a two-step sequence like `Spectral Blur` then `FM/PM Boost`. That keeps the ends readable while giving the middle extra motion.

For more synthetic or aggressive results, try `WaveShaper` into `Ring Mod`, or even `XOR` for a deliberately digital edge."

On screen:

- Prepare two contrasting anchor slots.
- Run one tasteful morph.
- Optionally run a more extreme morph on a second set of anchors.

### 13. Table Mode - what it actually does

Narration:

"Now we get to one of the signature features of Waftwave: `Table Mode`.

Click `Table Mode` and the FX grid turns into a fan-out control panel. The morph selector at the top changes how Waftwave distributes change across the table, and the vertical sliders decide what kind of change is being distributed.

This is the crucial behavior to understand: if you have slots selected, Table Mode only affects those selected slots. If nothing is selected, it fans out across the whole wavetable, starting from the active slot and applying across the filled slots in that table.

So classic mode is for making ingredients. Table Mode is for spreading intentional variation across a whole wavetable."

On screen:

- Select a block of slots first.
- Click `Table Mode`.
- Show that the panel is active.

### 14. Table Mode morph types

Narration:

"The morph selector at the top changes the kind of interpolation.

`Linear` is the most direct.
`Spectral` is smoother and usually better for timbral continuity.
`Phase Warp` gives a more animated internal movement.
`Equal Power` keeps perceived energy more even.
`Magnitude Only` focuses on spectral magnitude behavior.
`Phase Only` is useful when you want motion without magnitude shaping, although that disables tone and smear-based behavior.
`Ping-Pong` mirrors the motion back across the table.
`Center-Out` pushes change outward from the middle.

So even before you touch a slider, that top morph menu is already deciding what kind of table motion you get."

On screen:

- Click through the morph selector options slowly.
- Pause on `Spectral`, `Phase Warp`, `Ping-Pong`, and `Center-Out`.

### 15. Table Mode sliders explained

Narration:

"Then we have the sliders.

`Fold` adds wavefolding style density.
`Skew` shifts the waveform shape left or right across the cycle.
`Sat` adds saturation.
`Crush` brings in bit and digital roughness.
`PWM` creates pulse-width style movement.
`PD` adds phase distortion character.
`Tone` pushes the spectral balance.
`Smear` diffuses the spectral detail for softer or more hazy motion.

The best way to use this panel is not to slam everything at once. Use two or three sliders as the main story, then one small supporting move."

On screen:

- Move each slider one at a time.
- Reset after a big move if needed.

### 16. Practical Table Mode finishing pass

Narration:

"Here is a really useful finishing pass for rich but controlled wavetable motion.

Start with `Spectral` morph mode.
Push `Fold` just enough to add harmonic density.
Add a little `Skew` so each slot leans in a direction.
Bring in a touch of `PWM` or `PD` for moving edge.
Then use a small amount of `Tone` or `Smear` to decide whether the table should open up or soften as it scans.

If the result gets too wild, hit `Reset` and rebuild with smaller moves. Table Mode is most powerful when the motion feels intentional instead of random."

On screen:

- Set `Spectral`.
- Move `Fold`, `Skew`, `PWM`, and `Tone` in a moderate way.
- Pause on the updated slots or wavetable view.

### 17. How classic mode and Table Mode work together

Narration:

"The most important workflow lesson in Waftwave is that normal mode and Table Mode are not competing ideas. They are partners.

Use classic mode to create or edit anchor waves.
Use `Evolve` or anchor morphing to turn those anchors into a full table.
Then use Table Mode to add a final layer of distributed motion across the finished result.

That combination is where the richest tables happen. You are not relying on one process. You are layering structure, interpolation, and global movement."

On screen:

- Briefly show the same table in classic mode.
- Toggle to Table Mode.
- Toggle back once more.

### 18. Slice Loop workflow for building tables from audio

Narration:

"Now let us do the audio-to-wavetable workflow, because this is another major strength of the app.

Click `Slice Loop`. If you shift-click it, you get the full loop import dialog. This is where you decide how a loop gets mapped into slots.

If you choose `Raw contiguous`, Waftwave slices the loop as playback chunks. That is great for stepping through a loop.

If you choose `Wavetable: Equal slices`, you get a more classic direct wavetable split.

If you choose `Wavetable: Overlap x4` or `Overlap x8`, Waftwave builds smoother, more scan-friendly tables by using overlapping windows. Those are usually the best places to start when the goal is a playable wavetable rather than literal loop playback."

On screen:

- Shift-click `Slice Loop`.
- Point to `Raw contiguous`, `Wavetable: Equal slices`, `Wavetable: Overlap x4`, `Wavetable: Overlap x8`.

### 19. Deep loop import options

Narration:

"This dialog is much deeper than it first looks, and this is where a lot of advanced table design happens before you even hit import.

You can choose slot count - 8, 16, 32, 48, or 64.

For raw slicing, seam handling matters. `Detrend`, `Rotate to zero crossing`, and `ZC cut` all help reduce clicks.

Then you get creative transforms across the table: reverse patterns, inversion patterns, gain ramps, semitone warp, fine warp in cents, slot order changes like `Ping-pong` or `Scramble`, `Align adjacent slots` to reduce discontinuity between neighbors, and spectral tilt from dark to bright or bright to dark.

This means you can shape the travel of the table before the table even exists."

On screen:

- Point to slot count.
- Point to seam options.
- Point to reverse / invert / gain / warp controls.
- Point to slot order, align adjacent slots, and spectral tilt.

### 20. Recommended loop-to-table recipe

Narration:

"If you want a reliable starting recipe for lush, playable wavetable results, use this:

Set the slot count to 32 or 64.
Choose `Wavetable: Overlap x4` for a balanced result, or `Overlap x8` for the smoothest scan.
Turn on `Align adjacent slots`.
Use `Dark to Bright` spectral tilt if you want the table to naturally open up as it scans.
Then after import, use classic mode on one or two standout slots, and finish with a light Table Mode pass.

That workflow gives you a table with structure, continuity, and movement without immediately turning it into mush."

On screen:

- Set a recommended combination in the dialog.
- Confirm.
- Import a loop.
- Show the resulting slot spread.

### 21. Table view and scan reading

Narration:

"Once the table is built, switch to pads mode and look at the wavetable view. This gives you a better sense of the table as a continuous object rather than a list of slots.

The value of this view is not just visual. It helps you see whether the movement is smooth, whether one region is too static, or whether one section of the table has too much discontinuity.

If the front half looks too similar, go back and reshape anchors or add a little more Table Mode movement. If one section looks too chaotic, back off the more extreme sliders or choose a smoother morph mode."

On screen:

- Shift-click into pads mode / wavetable view.
- Move across the table visually.
- Use the transpose controls if you want to audition different pitch ranges.

### 22. Bonus tools worth mentioning

Narration:

"A few extra tools are worth calling out.

`Blend Sel` lets you combine selected waves into a single new result, which is great for creating a fresh anchor.
`FUSE` is useful when you want one more derived waveform from the current material.
`Randomize slots` is excellent for idea generation, especially if you just want strange source material to tame afterward.
`AMP` is for gain structure across selected slots or the whole filled table.
And `NORM` gets everything peak-matched again when you want cleaner comparison between slots."

On screen:

- Point to each of those buttons.
- Optionally perform one quick `Blend Sel`.

### 23. Export paths - DigiPRO, WAV, and Tonverk

Narration:

"When the table is ready, Waftwave gives you a few exits.

If you are staying inside DigiPRO workflows, export SYX or upload straight to hardware.

If you want audio files, `Export slot WAV` gives you the current slot, and `Export bank WAVs` gives you the whole table or bank as WAV material.

And this is the Tonverk-relevant part: shift-click `Export bank WAVs`, open the advanced export dialog, and enable `Tonverk wavetable mode`. That automatically writes a Tonverk-friendly packed-chain WAV at 2048 samples per wave, with the `_wt2048.wav` naming convention. So even though Waftwave is rooted in DigiPRO thinking, it absolutely reaches into newer wavetable workflows too."

On screen:

- Shift-click `Export bank WAVs`.
- Point to the advanced options.
- Point to `Tonverk wavetable mode`.

### 24. Wrap-up

Narration:

"So the real power of Waftwave is not just that it edits one waveform well. It is that it gives you multiple layers of table design.

You can sculpt a seed in classic mode.
You can evolve it into a family.
You can morph between anchors.
You can build tables from loops.
You can use Table Mode to distribute motion across the whole result.
And then you can export or transfer that material into real hardware workflows.

If you think in terms of single waves, anchors, movement, and final table shaping, Waftwave becomes incredibly deep very quickly."

On screen:

- Show the final table in wavetable view.
- End on the app logo or the finished bank.

## Shorter alternate intro

If you want a faster opening that still stays accurate, use this instead:

"Wavetables are having another moment, and for good reason. They are one of the most musical ways to move from static tone into real timbral motion. Waftwave takes that idea and turns it into a practical browser-based lab for DigiPRO-style waveform design, morphing, loop slicing, table shaping, and Tonverk-friendly wavetable export. In this video I am going to walk through the whole interface and build a rich table step by step."

