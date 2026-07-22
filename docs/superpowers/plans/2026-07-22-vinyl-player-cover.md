# Vinyl Player Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player card's 40×40 square cover becomes a 40px vinyl disc — black with CSS grooves, the cover art as the circular center label — that spins while the track plays.

**Architecture:** Pure CSS/DOM. The cover block in `Player.tsx` is wrapped in a circular disc `<span>` styled with `repeating-radial-gradient` grooves and a `vinyl-spin` keyframe in `index.css`. Play/pause drives `animation-play-state` inline so the rotation freezes in place instead of resetting. No new props: `Player` already receives `paused` and `loading`.

**Tech Stack:** React 19 + TS, Tailwind v4 utility classes + one CSS block in `index.css`, Vitest + Testing Library (jsdom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-vinyl-player-cover-design.md`.
- Keep `data-testid="player-cover"` (with `src`) and `data-testid="player-cover-placeholder"` — existing tests must keep passing untouched.
- Disc: 40px (`h-10 w-10`); label: 50% = 20px (`h-5 w-5`); spin: 4s linear infinite; paused/loading ⇒ `animation-play-state: paused`; `prefers-reduced-motion: reduce` ⇒ no animation (match the `player-marquee` pattern at `index.css:240`).
- Comment convention conflict, resolved for conformance: the global rule says zero comments, but `Player.tsx` uses English explanatory block comments as its established idiom — match it (Conformance > taste).
- Do NOT run `npm run check` (it rewrites ~92 unrelated files). Verify per file: `npx biome check <file>` and `npx tsc --noEmit -p .` from `apps/desktop`.
- Work happens in a git worktree, never on main (create via superpowers:using-git-worktrees).
- Commits: descriptive Spanish title only, no body, no `feat:`/`fix:` prefix (matches repo history).

---

### Task 1: Vinyl disc with spin state in the player

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Player.tsx:226-243` (the cover/placeholder block)
- Modify: `apps/desktop/src/renderer/src/index.css` (append after the `.player-marquee` reduced-motion block ending at line 244)
- Test: `apps/desktop/src/renderer/src/components/Player.test.tsx`

**Interfaces:**
- Consumes: existing `PlayerProps.paused` / `PlayerProps.loading` (already passed by `LivePlayer`), existing `track.embeddedCover`.
- Produces: `data-testid="player-vinyl"` — the disc wrapper, present with and without cover, whose inline `animation-play-state` is `running` only while `!paused && !loading`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('Player', …)` in `Player.test.tsx`, after the placeholder test (line 133):

```tsx
  // The cover is drawn as a vinyl disc that spins while sound is actually coming out.
  // animation-play-state (not conditional animation) is the contract: pausing must freeze
  // the record in place like a real turntable, not snap it back to 0°.
  it('spins the vinyl while playing', () => {
    renderUI(<Player {...props({ paused: false, loading: false })} />)
    expect(screen.getByTestId('player-vinyl')).toHaveStyle({ animationPlayState: 'running' })
  })

  it('freezes the vinyl when paused', () => {
    renderUI(<Player {...props({ paused: true })} />)
    expect(screen.getByTestId('player-vinyl')).toHaveStyle({ animationPlayState: 'paused' })
  })

  // While buffering from a network drive no audio is advancing, so a spinning record
  // would claim playback that isn't happening.
  it('freezes the vinyl while loading', () => {
    renderUI(<Player {...props({ paused: false, loading: true })} />)
    expect(screen.getByTestId('player-vinyl')).toHaveStyle({ animationPlayState: 'paused' })
  })

  // Coverless tracks get the same disc with a plain label, so the player never regresses
  // to the old flat square just because a file has no art.
  it('renders the disc for coverless tracks too', () => {
    renderUI(<Player {...props({ track: track({ embeddedCover: undefined }) })} />)
    expect(screen.getByTestId('player-vinyl')).toBeInTheDocument()
    expect(screen.getByTestId('player-cover-placeholder')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run from `apps/desktop`: `npx vitest run src/renderer/src/components/Player.test.tsx`
Expected: the four new tests FAIL with "Unable to find an element by: [data-testid="player-vinyl"]"; every pre-existing test still passes.

- [ ] **Step 3: Implement the disc**

In `Player.tsx`, replace the cover/placeholder block (lines 227–243, the `{track.embeddedCover ? (…) : (…)}` ternary and its comment context stays inside the same flex row) with:

```tsx
        {/* The cover as a 40px vinyl: CSS-groove disc, the art clipped into the center
            label, a spindle dot on top. It spins only while sound is actually playing —
            paused or buffering freezes it in place via animation-play-state, so like a
            real record it never snaps back to 0°. */}
        <span
          data-testid="player-vinyl"
          className="player-vinyl relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full outline outline-1 -outline-offset-1 outline-white/10"
          style={{ animationPlayState: !paused && !loading ? 'running' : 'paused' }}
        >
          {track.embeddedCover ? (
            <img
              data-testid="player-cover"
              src={track.embeddedCover}
              alt=""
              // Same as the list covers: keep the base64 JPEG decode off the main thread.
              decoding="async"
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <span
              data-testid="player-cover-placeholder"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-panel)]"
            >
              <Music className="h-3 w-3 text-fg-faint" aria-hidden="true" />
            </span>
          )}
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80"
          />
        </span>
```

In `index.css`, append after the `player-marquee` reduced-motion block (after line 244):

```css
/* The player cover as a vinyl record: near-black disc, faint concentric grooves from a
   repeating gradient (the center is hidden under the label image, so the rings only need
   to read on the outer half). Spins at a calm 4s/rev while playing; Player.tsx freezes it
   in place with animation-play-state so pausing never resets the rotation. */
.player-vinyl {
  background:
    repeating-radial-gradient(
      circle at 50%,
      rgba(255, 255, 255, 0.05) 0 1px,
      transparent 1px 3px
    ),
    radial-gradient(circle at 50%, #1a1a1c 0 68%, #0e0e10 100%);
  animation: vinyl-spin 4s linear infinite;
}

@keyframes vinyl-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-vinyl {
    animation: none;
  }
}
```

- [ ] **Step 4: Run the full component test file to verify green**

Run from `apps/desktop`: `npx vitest run src/renderer/src/components/Player.test.tsx`
Expected: PASS — the four new tests plus every pre-existing test (the embedded-cover `src` test and the placeholder test must pass unchanged).

- [ ] **Step 5: Per-file lint and typecheck**

Run from `apps/desktop`:
- `npx biome check src/renderer/src/components/Player.tsx src/renderer/src/components/Player.test.tsx src/renderer/src/index.css` — expected: no errors.
- `npx tsc --noEmit -p .` — expected: exit 0. (Never `npm run check`: it reformats ~92 unrelated files.)

- [ ] **Step 6: Run the whole desktop suite**

Run from `apps/desktop`: `npm test`
Expected: all suites pass (App.test.tsx renders the player too and must not break).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/Player.tsx \
        apps/desktop/src/renderer/src/components/Player.test.tsx \
        apps/desktop/src/renderer/src/index.css
git commit -m "Convertir la carátula del reproductor en un vinilo que gira al sonar"
```

---

### Task 2: Visual verification in the real app

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: the running app via the `run-desktop` skill.

- [ ] **Step 1: Launch and screenshot**

Use the `run-desktop` skill: start the app, play a track with embedded art, screenshot the player. Confirm the disc reads as a vinyl (grooves visible, label centered, spindle dot), spins while playing and freezes on pause.

- [ ] **Step 2: Coverless check**

Play a track without embedded art; confirm the plain-label disc renders with the music note.
