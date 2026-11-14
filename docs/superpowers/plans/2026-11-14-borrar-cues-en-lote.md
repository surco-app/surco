# Borrar cues en lote

Spec: approved sketch https://claude.ai/artifact/T7d2AugEKS6heZc1yKwbnS (user feedback from Enrique: select many tracks and clear their hot cues and memory cues to start over; in rekordbox it is one by one).

## Global Constraints

- Hot cues and memory cues (Surco calls memory cues "CALLs", kind 0) are removed. Loops stay. The grid stays (the draft never touches it; Traktor's grid marker is preserved by the writer already).
- Only the program the selected track belongs to. No propagation to the same track in other programs. (Batch Save already only carries flow-placed breaks to twins via `carriedBreaks`; a cleared draft has none, so nothing propagates. Do not change cueTwins.)
- Tracks that already have an unsaved cue draft (`unsavedCueTracks()` from `lib/cueSession.ts`) are NOT touched and are counted apart.
- The result is an unsaved draft per track, exactly like Auto marcar acceptance; the DJ saves with the existing batch Save button (`cues-batch-save`), which already takes the library copy and asks to close the program.
- No confirmation dialog.
- No code comments (project rule). data-testid on every new element tests touch. Tuteo in every language. No em dash and no explanatory colon in UI copy.
- Run tests from `apps/desktop` of the worktree: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (the worktree has no node_modules of its own). Typecheck with all three: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit`, same with `tsconfig.node.json` and `tsconfig.scenarios.json` (run from repo root of the worktree; bare tsc is a no-op). Biome: `npx biome check <files>`.
- Commit titles: descriptive sentence only, no body, no `feat:` prefix. TDD: see the test fail first.

## Task 1: clearCueDrafts in lib

File: `apps/desktop/src/renderer/src/lib/cueAutoMark.ts` (add next to `acceptAutoMarks`, same style; it already owns the batch-draft logic and `AutoMarkTarget`/`AutoMarkSettings`). Tests in `lib/cueAutoMark.test.ts`, following the existing tests of `acceptAutoMarks` there (same mocking of the query client / window.api).

Signature:

```ts
export interface ClearedCues {
  hot: number
  calls: number
  loops: number
  unsaved: number
  cleared: string[]
}

export async function clearCueDrafts(
  client: QueryClient,
  targets: AutoMarkTarget[],
  settings: AutoMarkSettings,
): Promise<ClearedCues>
```

Behaviour per target, in order:
1. If `unsavedCueTracks().has(contentId)` → `unsaved += 1`, skip.
2. Read `trackCuesQuery(contentId)` with `.catch(() => null)`; if null skip silently. Do NOT require `analysed` or a grid: clearing needs neither.
3. Baseline exactly as `acceptOne` does: queued save if `queued.fingerprint === read.fingerprint`, else `read.cues` mapped to `{ id, ms, kind, color }`. Loop ids = `read.cues.filter(c => c.loop).map(c => c.id)`.
4. `startDraft(baseline, settings.activeCueFlow, loopIds)` then `reduceDraft(draft, { type: 'clear' }, ctx)` with ctx built like `acceptOne` builds it.
5. Count from the baseline: non-loop cues with `kind !== 0` → `hot`, non-loop with `kind === 0` → `calls`, loops → `loops`.
6. If nothing was removed (all loops or empty) → no draft.
7. Otherwise `keepDraft(contentId, cueDraftKey(contentId, read.fingerprint, queued), cleared, { path, label, fingerprint: read.fingerprint }, fresh ? queued : null)` and push contentId to `cleared`.

Tests (each says WHY in its name):
- removes hot cues and CALLs and keeps loops, so the DJ starts over without losing loops they set by hand (draft's `wantedOfDraft` contains only the loop; counts hot/calls/loops right).
- leaves a track with an unsaved draft untouched, so clearing never throws away work in progress (counts `unsaved`, draft unchanged).
- leaves no draft for a track with only loops or no cues, so Save does not count tracks it would not change.
- clears on top of a queued save that is still pending (baseline = queued wanted).
- works on a track that is not analysed (no grid).

## Task 2: button and tally in CuesBatchSection, 8 languages

File: `apps/desktop/src/renderer/src/components/CuesBatchSection.tsx`, tests in `CuesBatchSection.test.tsx` (follow its existing setup).

- New button after `cues-batch-phrases` in the same row: `data-testid="cues-batch-clear"`, text style identical to the existing `cues-batch-discard` button classes (`press px-2 py-1.5 text-xs text-fg-dim hover:text-fg`), label `tr('editor.cues.clearAll')` (existing key, same words as the single-track deck button). Disabled while busy.
- On click: `setCleared(await clearCueDrafts(queryClient, targets, settings))` with busy handling like `accept`.
- When `cleared` is set and any count > 0, render `<dl data-testid="cues-batch-cleared">` with the same markup as `cues-batch-tally`, one row per non-zero count, row testids `cues-batch-cleared-hot|calls|loops|unsaved`. The unsaved row uses `text-warn` on dt and dd.
- Next to it a text button `data-testid="cues-batch-clear-discard"` labelled `tr('editor.cues.auto.discard'...)`? NO: use new key `editor.cues.batch.clearDiscard` = "Descartar"; it calls `forgetDraft(id)` for every id in `cleared.cleared` and sets `cleared` to null. Only shown when `cleared.cleared.length > 0`.
- After a successful batch save the tally hides (set `cleared` null where `save` forgets drafts).
- Tests: clicking clears and the Save button appears with the cleared count; tally shows only non-zero rows; discard brings back nothing to save; a track with an unsaved draft shows the warn row.

New keys under `editor.cues.batch` (exact text, i18next plurals; ja keeps both forms like its other keys):

| key | es | en | ca | de | fr | it | pt-BR | ja |
|---|---|---|---|---|---|---|---|---|
| clearedHot_one | {{count}} hot cue que se borra | {{count}} hot cue to clear | {{count}} hot cue que s'esborra | {{count}} Hot Cue wird gelöscht | {{count}} hot cue à effacer | {{count}} hot cue da eliminare | {{count}} hot cue a apagar | 削除するホットキュー {{count}} 件 |
| clearedHot_other | {{count}} hot cues que se borran | {{count}} hot cues to clear | {{count}} hot cues que s'esborren | {{count}} Hot Cues werden gelöscht | {{count}} hot cues à effacer | {{count}} hot cue da eliminare | {{count}} hot cues a apagar | 削除するホットキュー {{count}} 件 |
| clearedCalls_one | {{count}} CALL que se borra | {{count}} CALL to clear | {{count}} CALL que s'esborra | {{count}} CALL wird gelöscht | {{count}} CALL à effacer | {{count}} CALL da eliminare | {{count}} CALL a apagar | 削除するCALL {{count}} 件 |
| clearedCalls_other | {{count}} CALLs que se borran | {{count}} CALLs to clear | {{count}} CALLs que s'esborren | {{count}} CALLs werden gelöscht | {{count}} CALLs à effacer | {{count}} CALL da eliminare | {{count}} CALLs a apagar | 削除するCALL {{count}} 件 |
| clearedLoops_one | {{count}} loop, se queda | {{count}} loop, kept | {{count}} loop, es queda | {{count}} Loop bleibt | {{count}} loop, conservé | {{count}} loop, resta | {{count}} loop, fica | ループ {{count}} 件はそのまま |
| clearedLoops_other | {{count}} loops, se quedan | {{count}} loops, kept | {{count}} loops, es queden | {{count}} Loops bleiben | {{count}} loops, conservés | {{count}} loop, restano | {{count}} loops, ficam | ループ {{count}} 件はそのまま |
| clearedUnsaved_one | {{count}} con cambios sin guardar, no se toca | {{count}} with unsaved changes, left as it is | {{count}} amb canvis sense desar, no es toca | {{count}} mit ungespeicherten Änderungen, bleibt unverändert | {{count}} avec des modifications non enregistrées, laissé tel quel | {{count}} con modifiche non salvate, non viene toccato | {{count}} com alterações não salvas, fica como está | {{count}} 件は未保存の変更があるため、そのままにします |
| clearedUnsaved_other | {{count}} con cambios sin guardar, no se tocan | {{count}} with unsaved changes, left as they are | {{count}} amb canvis sense desar, no es toquen | {{count}} mit ungespeicherten Änderungen, bleiben unverändert | {{count}} avec des modifications non enregistrées, laissés tels quels | {{count}} con modifiche non salvate, non vengono toccati | {{count}} com alterações não salvas, ficam como estão | {{count}} 件は未保存の変更があるため、そのままにします |
| clearDiscard | Descartar | Discard | Descarta | Verwerfen | Annuler | Annulla | Descartar | 破棄 |

Rows render the full string as one `<dt>` spanning the row (no separate number dd), since the count is in the sentence. Before adding keys, check how existing locale tests (`i18n/*.test.ts`) constrain new keys (plural forms, unused keys, quotes, tuteo) and keep them green. Check existing words for "Descartar" in each locale (e.g. `editor.cues.auto.discard`) and reuse that verb if it differs from the table.
