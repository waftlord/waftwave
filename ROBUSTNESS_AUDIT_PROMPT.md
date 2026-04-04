Audit this feature for hidden state, ordering, cache, and history bugs, especially cases where a later user action can be overwritten by stale state.

Focus on robust operation across every pathway, not just the happy path.

Scope:
- UI controls, sliders, toggles, selectors, and any derived preview state
- copy, cut, paste, paste special, reverse, ping-pong, evolve, morph, import, export, clear, swap, rename, batch actions
- selection changes, active-slot changes, dirty-editor precedence, bank writes, undo, redo, history replay, and mode toggles
- coalesced work such as requestAnimationFrame, timers, deferred preview, queued commits, and cached source snapshots

Required audit method:
1. Build a mutation map.
List every code path that can change the same underlying state.

2. Build an invariants list.
At minimum verify:
- latest user-visible write wins
- no stale cache/base/source survives an external mutation
- preview state and committed state cannot diverge permanently
- undo/redo restores the exact intended bank, editor, selection, and mode state
- selection order and active-slot order are deterministic
- exceptions cannot leave partial writes behind
- toggling modes cannot silently reuse obsolete slider/cache state

3. Simulate adversarial sequences.
Include:
- rapid slider moves followed by paste or reverse
- copy/paste into selected slots, single-slot contiguous paste, and no-selection paste
- paste special variants
- external bank mutation followed by another slider move
- undo/redo immediately after previewed but not-yet-committed work
- history restore after mode changes
- active-slot changes during or between operations

4. Inspect cache invalidation and source-of-truth rules.
For each cache, snapshot, or memoized base:
- who creates it
- who consumes it
- exactly which pathways invalidate it
- whether any bank/editor/history action can bypass invalidation

5. Add automated regression coverage.
Prefer deterministic tests that prove:
- stale-path behavior would have failed before the fix
- latest-state behavior passes after the fix
- every related control family is covered, not just one representative control

Output format:
- Findings first, ordered by severity
- For each finding: explain the user-visible failure mode, the precise stale/race/order mechanism, and the affected files/functions
- Then implement fixes
- Then summarize the test matrix added
- Then list any residual risks or untested pathways explicitly

Do not stop at “looks fine”.
Actively try to break the feature by making old state compete with new state, especially around cached bases, preview queues, undo/redo, and multi-step paste workflows.
