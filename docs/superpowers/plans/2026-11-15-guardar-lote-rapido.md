# Guardar en lote, rápido

Measured 15/11 in the real built app (soak fixture clone, rekordbox closed): after clearing cues on a selection, batch Save takes 7.9 s for 1,000 tracks, but for 13,280 tracks it ran more than 20 minutes without writing anything to master.db. A CPU profile of the first 90 s of that Save: 70 of 90 s are React renders of the whole app; the hottest functions are the Editor's per-chip partial-state calculation over all selected tracks and `programOf`, recomputed on every render. Cause: after `window.api.cues.save` resolves, both save paths forget the saved drafts one by one, and each `forgetDraft` (lib/cueSession.ts) notifies every draft subscriber (App, CuesSection, CuesBatchSection, useGridChecks), so the app re-renders once per saved track:
- `components/CuesBatchSection.tsx` around line 217: `for (const req of reqs) forgetDraft(req.contentId)`
- `components/CuesSection.tsx` around line 1107: same loop; and just above (~1101) it looks each draft up with `keptDrafts().find(...)` inside a loop over all reqs, quadratic in the number of saved tracks.
`forgetDrafts(contentIds)` (one notification, already in lib/cueSession.ts, added by the previous branch) exists for this.

## Global Constraints

- Behaviour of saving does not change: same requests sent, same drafts forgotten, same taste edits recorded, same order of steps. Only the number of notifications and the lookup cost change.
- No code comments. TDD with red seen first. Tests name WHY. data-testid selectors.
- Run tests from `apps/desktop` of the worktree with `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <paths>`. Typecheck all three projects from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit`, then `tsconfig.node.json`, then `tsconfig.scenarios.json`. Biome from apps/desktop. Full suite once before the last commit; report exit code and any `FAIL|Unhandled|Errors` lines (under heavy machine load, re-run failing files alone before calling them real).
- Commit titles: one descriptive sentence, no prefix, no body, never --no-verify.

## Task 1: forget saved drafts in one notification

1. `CuesBatchSection.save`: replace the per-request `forgetDraft` loop with one `forgetDrafts(reqs.map(r => r.contentId))`.
2. `CuesSection` saveAll/send path: same replacement; and replace the `keptDrafts().find` inside the loop with one lookup map built once from `keptDrafts()`.
3. Leave the other `forgetDraft` callers (single-track paths, `undoGridAdjusts`) alone.

Tests (CuesBatchSection.test.tsx, the CuesSection test file that covers saveAll / multi-track save):
- saving many tracks notifies the draft listeners once for the forget step (subscribe with `subscribeCueDrafts` and count), so saving thousands of tracks does not re-render the app once per track;
- after saving, every saved track's draft is gone and nothing else changed (existing tests may already cover; keep them green).
