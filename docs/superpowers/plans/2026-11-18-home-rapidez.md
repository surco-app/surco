# Home Speed Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a section to the web home, between Matching and Library review, with the headline «Rápido, muy rápido.» and three measured figures that count up once.

**Architecture:** A pure frame function in `lib/speed.ts` turns progress `t` (0 to 1) into the three formatted figures. A `Speed` component drives it with the existing `useSceneProgress` hook and is mounted in `App.tsx`. Copy lives in the 8 locale files.

**Tech Stack:** React 19, TypeScript, Tailwind v4, react-i18next, Vitest (jsdom for component tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-home-rapidez-design.md`

## Global Constraints

- Everything happens in the worktree `.claude/worktrees/home-rapidez` (branch `home-rapidez`). If `node_modules` is missing, run `npm install` at the worktree root first.
- All commands run from `apps/web`. Run the whole suite with `npm test`, never filtered by path. Check the exit code, not only the summary line.
- Gates before every commit: `npm test`, `npm run typecheck`, `npm run lint` (read the whole lint output).
- ZERO code comments in new code. No CSS classes as test selectors, use `data-testid`.
- Every colour through a `var(--color-*)` token utility (`text-muted`, `text-fg`). `palette.test.ts` and `flat.test.ts` must stay green. No shadows, no borders on the section.
- The number 30.000 appears nowhere in the copy.
- Copy uses the informal second person, no em dash, no explanatory colon.
- A figure never changes width while it counts.
- Commit titles are a descriptive sentence in English, no body, no `feat:` prefix. Never `--no-verify`.
- No push. Merge to local `main` only after everything is verified.

## Review Focus

- A locale whose grouping separator is a space (fr) or a comma (en, ja): the figure must use that locale's separators and still reserve its exact final width.
- `prefers-reduced-motion`: the figures show their final values and never count.
- Prerendered HTML and the moment before the section scrolls into view: the figures show their final values, never `0`.
- `t` outside 0 to 1 (a late animation frame): the figure never overshoots its value.
- A narrow phone (about 400px): the three figures stack and `25.000` does not overflow.

---

### Task 1: The figures and their frame function

**Files:**
- Create: `apps/web/src/lib/speed.ts`
- Test: `apps/web/src/lib/speed.test.ts`

**Interfaces:**
- Produces:
  - `SPEED_COUNT_MS = 1200`
  - `SPEED_FIGURES`: readonly array, in this order, of `{ key: 'open' | 'select' | 'clear'; value: number; decimals: number; unit: string; source: string }` with exactly these values:
    - `open`, `44`, `0`, `'ms'`, source `'responsiveness v1.37.1, rekordbox, 14835 tracks'`
    - `select`, `25000`, `0`, `''`, source `'surco-gate-traktor-25000, 17/11/2026, no main thread blocks'`
    - `clear`, `5.3`, `1`, `'s'`, source `'surco-gate-engine-13280, 17/11/2026'`
  - `speedFrame(t: number, language: string): string[]` returns one formatted string per figure, in order.

- [ ] **Step 1: Write the failing tests** in `speed.test.ts`

```ts
describe('speed figures', () => {
  it('ends on the measured figures, because the page may only claim what was measured', () => {
    expect(speedFrame(1, 'es')).toEqual(['44', '25.000', '5,3'])
  })
  it('starts from zero with the final number of decimals, so the figure keeps its shape while it counts', () => {
    expect(speedFrame(0, 'es')).toEqual(['0', '0', '0,0'])
  })
  it('writes each figure with the separators of the visitor language', () => {
    expect(speedFrame(1, 'en')).toEqual(['44', '25,000', '5.3'])
    expect(speedFrame(1, 'de')).toEqual(['44', '25.000', '5,3'])
  })
  it('never overshoots or goes negative when a frame arrives outside the run', () => {
    expect(speedFrame(1.4, 'es')).toEqual(speedFrame(1, 'es'))
    expect(speedFrame(-0.2, 'es')).toEqual(speedFrame(0, 'es'))
  })
  it('never shows more than the final figure on the way up', () => {
    for (const t of [0.1, 0.5, 0.9, 0.99]) {
      const [open] = speedFrame(t, 'en')
      expect(Number(open)).toBeLessThanOrEqual(44)
    }
  })
  it('is already most of the way after half the run, so the count settles instead of racing to the end', () => {
    expect(Number(speedFrame(0.5, 'en')[0])).toBeGreaterThan(38)
  })
})
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, `speed.ts` does not exist.

- [ ] **Step 3: Implement `speed.ts`.** Clamp `t` to 0..1, ease with `1 - (1 - t) ** 4`, multiply each value, format with `new Intl.NumberFormat(language, { useGrouping: 'always', minimumFractionDigits: decimals, maximumFractionDigits: decimals })` (same cast as `useFormat` in `components/Stats.tsx`).

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run lint`.** Expected: all pass, exit code 0.

- [ ] **Step 5: Mutation check.** Temporarily change the easing exponent to `1` and confirm the "most of the way after half" test fails, then restore.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/speed.ts apps/web/src/lib/speed.test.ts
git commit -m "Count the measured speed figures from zero as a pure frame function"
```

---

### Task 2: The section on the home

**Files:**
- Create: `apps/web/src/components/Speed.tsx`
- Test: `apps/web/src/components/speed.test.ts` (jsdom, follow the harness in `components/homeReveals.test.ts`)
- Modify: `apps/web/src/lib/analytics.ts` (add `'home-speed'` to `SectionLocation`, after `'home-matching'`)
- Modify: `apps/web/src/lib/sceneAnchors.ts` (add `speed: 'rapidez'` to `SCENE_ANCHORS` and `speed: 'home-speed'` to `SECTION_VIEWS`, both after `matching`)
- Modify: `apps/web/src/App.tsx` (render `<Speed />` between the matching `Spotlight` and `<LibraryReview />`)
- Modify: `apps/web/src/components/homeReveals.test.ts` (add `[data-testid="speed"]` to `SECTIONS` and render `Speed` with the others)
- Modify: the 8 files in `apps/web/src/i18n/locales/` (add `home.speed` right after `home.matching`)

**Interfaces:**
- Consumes: `SPEED_FIGURES`, `SPEED_COUNT_MS`, `speedFrame(t, language)` from Task 1; `useSceneProgress(ref, durationMs)` from `lib/useSceneProgress.ts`; `Reveal`, `SectionView`, `AnchorLink`.
- Produces: default export `Speed()` rendering `<section data-testid="speed">`, each figure as `<li data-testid="speed-figure">` whose number sits in an element with `data-testid="speed-value"`.

**Copy** (key `home.speed`, with `title`, `lede`, `figures.open`, `figures.select`, `figures.clear`). Before pasting each language, check that file's existing words for library, track and cue and use those if they differ.

| | title | lede | open | select | clear |
|---|---|---|---|---|---|
| es | Rápido, muy rápido. | Surco responde al momento, por grande que sea tu biblioteca. | Abrir una biblioteca de rekordbox de 14.835 pistas | Pistas de Traktor seleccionadas de golpe, sin esperar | Borrar los cues de 13.280 pistas en Engine DJ |
| en | Fast, really fast. | Surco responds instantly, however large your library is. | Opening a rekordbox library of 14,835 tracks | Traktor tracks selected at once, with no wait | Clearing the cues of 13,280 tracks in Engine DJ |
| de | Schnell, richtig schnell. | Surco reagiert sofort, egal wie groß deine Bibliothek ist. | Eine rekordbox-Bibliothek mit 14.835 Tracks öffnen | Traktor-Tracks auf einmal ausgewählt, ohne Wartezeit | Die Cues von 13.280 Tracks in Engine DJ löschen |
| fr | Rapide, très rapide. | Surco répond à l'instant, quelle que soit la taille de ta bibliothèque. | Ouvrir une bibliothèque rekordbox de 14 835 morceaux | Morceaux Traktor sélectionnés d'un coup, sans attendre | Effacer les cues de 13 280 morceaux dans Engine DJ |
| pt-BR | Rápido, muito rápido. | O Surco responde na hora, por maior que seja a sua biblioteca. | Abrir uma biblioteca do rekordbox com 14.835 faixas | Faixas do Traktor selecionadas de uma vez, sem esperar | Apagar os cues de 13.280 faixas no Engine DJ |
| ja | 速い、とにかく速い。 | ライブラリがどれだけ大きくても、Surcoはすぐに応えます。 | 14,835曲のrekordboxライブラリを開く | Traktorの曲を一度に選択、待ち時間なし | Engine DJで13,280曲のキューを消去 |
| ca | Ràpid, molt ràpid. | Surco respon a l'instant, per gran que sigui la teva biblioteca. | Obrir una biblioteca de rekordbox de 14.835 pistes | Pistes de Traktor seleccionades de cop, sense esperar | Esborrar els cues de 13.280 pistes a Engine DJ |
| it | Veloce, molto veloce. | Surco risponde all'istante, per quanto grande sia la tua libreria. | Aprire una libreria rekordbox di 14.835 brani | Brani di Traktor selezionati in un colpo, senza attese | Cancellare i cue di 13.280 brani in Engine DJ |

**Layout** (from the approved sketch, version 3 of https://claude.ai/artifact/WFjmsEh8ToS885mXHoXpiV):
- Section `pt-24`, heading block copied from `LibraryReview.tsx` (same `h2` classes, `AnchorLink`, lede `max-w-2xl text-muted`), inside one `Reveal`.
- Figures: `ul` with `mt-16 grid gap-12 text-center sm:grid-cols-3 sm:gap-8`.
- Number: `font-mono font-semibold tabular-nums tracking-tighter leading-none text-[min(4.5rem,17vw)]`. The value element is `inline-block text-right` with inline `style={{ width: \`${final.length}ch\` }}` where `final` is that figure's string from `speedFrame(1, language)`.
- Unit: a `<small>` at `text-[0.38em] text-muted ml-[0.15em] tracking-normal`, omitted when `unit` is empty.
- Caption: `mx-auto mt-4 max-w-60 text-[0.9375rem] text-balance text-muted`.
- The value shown is `speedFrame(progress === 0 ? 1 : progress, i18n.language)`: final values until the count starts, so the prerender and a visitor without the section in view never see zeros. The hook's ref goes on the `ul`.

- [ ] **Step 1: Write the failing tests**

In `speed.test.ts` (render `Speed` under `I18nextProvider` with `loadI18n('es')`, stubbing `IntersectionObserver` and `matchMedia` as `homeReveals.test.ts` does):

```ts
it('shows the measured figures before the count starts, so the prerendered page never claims zero', ...)
// values read from [data-testid="speed-value"] equal ['44', '25.000', '5,3']

it('shows the final figures and never counts when the visitor asked for reduced motion', ...)
// matchMedia matches: true, a requestAnimationFrame spy is never called, values equal ['44', '25.000', '5,3']

it('counts from zero once the section scrolls into view', ...)
// IntersectionObserver stub captures the callback, the test fires it with isIntersecting true,
// requestAnimationFrame stub runs its callback once with performance.now() + 1; values then differ from the final ones

it('reserves the final width of each figure, so nothing shifts while it counts', ...)
// every speed-value has style.width === `${finalText.length}ch` both before and after the count starts

it('writes the figures with the separators of the page language', ...)
// with loadI18n('en') the values are ['44', '25,000', '5.3']
```

In `lib/sceneAnchors.test.ts` nothing new is needed: its existing "measures every section" test covers the new key once both maps have it.

In `speed.test.ts`, one test on the home order, rendering `App` the way `components/scrollProgress.test.ts` does:

```ts
it('sits between matching and the library review, after the features it speaks for', ...)
// order of [data-testid="spotlight-matching"], [data-testid="speed"], [data-testid="library-review"] in document order
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, `Speed` does not exist; `keys.test.ts` green until locales change.

- [ ] **Step 3: Add `home.speed` to the 8 locale files, `'home-speed'` to `SectionLocation`, and the `speed` entries to `sceneAnchors.ts`.**

- [ ] **Step 4: Implement `Speed.tsx` and mount it in `App.tsx`.**

- [ ] **Step 5: Update `homeReveals.test.ts`** so the "reveal at most one block each" test also covers `Speed`.

- [ ] **Step 6: Run `npm test`, `npm run typecheck`, `npm run lint`.** Expected: all pass, exit code 0. If `analytics.test.ts` or another test enumerates section names, extend its list with `home-speed`; report any existing assertion you had to change before committing.

- [ ] **Step 7: Mutation check.** Temporarily render `speedFrame(progress, …)` without the `progress === 0 ? 1 :` guard and confirm the "before the count starts" test fails; temporarily drop the inline width and confirm the width test fails. Restore both.

- [ ] **Step 8: Look at it.** `npm run build && npm run preview`, then capture `/` scrolled to `#rapidez` with Brave through `playwright-core` (`executablePath` to Brave, clean URL) at 1440px and 400px wide, dark and light, in `es` and `fr`. Check: headline on one line at desktop, three figures aligned on one baseline, nothing clipped at 400px, no horizontal scroll. Fix what is off and rerun Step 6.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "Show how fast Surco is on the home with three measured figures that count up"
```
