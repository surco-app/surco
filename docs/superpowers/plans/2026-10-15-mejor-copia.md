# Mejor copia entre duplicados · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surco says which of two copies of the same track to keep, in the list (icon) and against the Apple Music copy (editor pill + card), with measured numbers and "same audio" when nothing separates them.

**Architecture:** Two new per-file facts in main (astats `Peak count` folded into the existing loudness pass; an MD5 fingerprint of the s16 decode as its own cached probe). One pure renderer function `compareCopies` decides, reusing `replaceWarning` for the spectrum criteria. A hook gathers each copy's facts through TanStack Query; the list ranks the existing duplicate groups (`lib/duplicates.ts`) and the editor ranks the open track against `replaceTarget.path`.

**Tech Stack:** Electron main (ffmpeg-static, analysis cache), React 19 + TanStack Query, Vitest + Testing Library, i18next (5 locales), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-15-mejor-copia-design.md`

## Global Constraints

- Run every test from `apps/desktop` with `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (never from the repo root; a root run skips setup). Typecheck with `tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` (bare `tsc` checks nothing). Lint with `biome check src`.
- Never red: no `danger` colour anywhere in this feature. Tones are `good`, `warn` and neutral only.
- Loudness is shown, never decides.
- Bits: padded16 counts as 16. Declared bits never decide.
- No decision on partial data: if either copy lacks a fact a criterion needs, that criterion is skipped; if a copy has no facts at all, no icon and no pill.
- Copy (every user-visible string) is the spec's proposal and must be re-confirmed by Vicent before merge (Task 8). English and Spanish are the reference; de, fr and pt-BR translate them. Every new key must be used in source (`usedKeys.test.ts`) and present in all 5 locales (`keys.test.ts`).
- Decisions taken here that refine the spec (recorded back into it in Task 8):
  1. List grouping reuses `duplicateGroups` from `lib/duplicates.ts` (kind `'duplicate'` only), the same signal as the existing Duplicates filter, instead of `libraryMatchScore`.
  2. Criteria 2 to 4 (lossless vs lossy, transcode, lower cutoff) are `replaceWarning`, applied both ways; no second implementation.
  3. The loudness cache namespace goes from `'loudness'` to `'loudness-v2'` so every result carries `peakCount`. This re-measures loudness once per file for every user.
  4. Margins start at `Infinity` (no winner from peak count or crest) (calibrated, see Task 4).
- `useTracksView.ts` and `analysisCache.ts` contain literal NUL bytes: use `grep -a`, and edit them with a byte-safe shell command, not the Edit tool. This plan does not need to edit them.

## Review Focus

1. A copy whose file vanished (NAS unmounted, track moved) after the pair was found: expect no icon / no pill, never a stale winner. Pinned in Task 5.
2. Three or more copies in one group: exactly one `best` (or all `same`), the rest `worse`, never two `best`. Pinned in Task 6.
3. A group where one copy is still analysing: no icon on any member until all are measured. Pinned in Task 6.
4. Copies identical in audio but different containers (WAV vs AIFF vs padded 24-bit): `same`, never a winner from bits or size. Pinned in Tasks 2, 3 and 4.
5. Loudness alone differs (one copy simply quieter, same crest, same peak count): `tie`, not a winner. Pinned in Task 4.
6. Two different masters of the same title (measured: Wiki Wiki, Xoxito, Mind Penetration) with very different peak counts: `tie`, never a winner by level. Pinned in Task 4.

---

### Task 1: Peak count in the loudness pass

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (`AstatsResult` ~2796, `parseAstats` ~2810, `measureLoudness` ~2863)
- Modify: `apps/desktop/src/shared/types.ts:1212` (`LoudnessResult`)
- Modify: `apps/desktop/src/main/analysisCache.ts:166` (`LOUDNESS_NAMESPACE`, byte-safe edit)
- Test: `apps/desktop/src/main/ffmpeg.test.ts` (next to the `parseAstats` tests ~1141), new `apps/desktop/src/main/peakCount.test.ts`

**Interfaces:**
- Produces: `AstatsResult.peakCount: number | null`; `LoudnessResult.peakCount?: number | null` (optional: results cached before it existed must stay readable).

- [ ] **Step 1: Write the failing parser test** in `ffmpeg.test.ts` inside the existing `parseAstats` describe:

```ts
it('reads how many samples sit at the peak, the trace a limiter leaves', () => {
  const stderr = [
    '[Parsed_astats_0 @ 0x1] Overall',
    '[Parsed_astats_0 @ 0x1] Peak level dB: -0.940000',
    '[Parsed_astats_0 @ 0x1] RMS level dB: -11.670050',
    '[Parsed_astats_0 @ 0x1] Peak count: 1978.000000',
  ].join('\n')
  expect(parseAstats(stderr)?.peakCount).toBe(1978)
})

it('leaves the peak count unknown when astats does not print it', () => {
  const stderr = '[Parsed_astats_0 @ 0x1] Overall\n[Parsed_astats_0 @ 0x1] RMS level dB: -12'
  expect(parseAstats(stderr)?.peakCount).toBeNull()
})
```

- [ ] **Step 2: Run** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/ffmpeg.test.ts -t "peak"`. Expected: FAIL (`peakCount` undefined).

- [ ] **Step 3: Implement.** In `AstatsResult` add `peakCount: number | null`. In `parseAstats`, add `count?: number` to `overall`, and in the `overall` branch:

```ts
      const count = line.match(/^Peak count:\s*(\S+)/)
      if (count) overall.count = finite(count[1]) ?? undefined
```

and return `peakCount: overall.count ?? null`. In `LoudnessResult` add `peakCount?: number | null`. In `measureLoudness` add `peakCount: stats?.peakCount ?? null` to the returned object. Byte-safe edit of the namespace:

```bash
perl -pi -e "s/LOUDNESS_NAMESPACE = 'loudness'/LOUDNESS_NAMESPACE = 'loudness-v2'/" src/main/analysisCache.ts
grep -a "LOUDNESS_NAMESPACE =" src/main/analysisCache.ts
```

- [ ] **Step 4: Write the real-ffmpeg test** `src/main/peakCount.test.ts`, following `convertDcOffset.test.ts` (mocks `electron` and `./settings`, `mkdtempSync`, `sine` source):

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FF from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({}) }))

const { measureLoudness } = await import('./ffmpeg')

const dir = mkdtempSync(join(tmpdir(), 'surco-peakcount-'))
const open = join(dir, 'open.wav')
const limited = join(dir, 'limited.wav')

beforeAll(() => {
  const sine = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4']
  execFileSync(FF as string, [...sine, '-af', 'volume=0.5', '-c:a', 'pcm_s16le', open])
  execFileSync(FF as string, [...sine, '-af', 'volume=4,alimiter=limit=0.5:level=false', '-c:a', 'pcm_s16le', limited])
})

describe('peak count', () => {
  // A limiter pins many samples to its ceiling; an untouched tone touches its peak a few
  // times per cycle at most. This is the number that told Netzwerk's two copies apart.
  it('counts far more samples at the peak on a limited copy than on an open one', async () => {
    const a = await measureLoudness(open)
    const b = await measureLoudness(limited)
    expect(a?.peakCount).not.toBeNull()
    expect(b?.peakCount ?? 0).toBeGreaterThan((a?.peakCount ?? 0) * 10)
  })
})
```

Check `./settings` mock shape against `convertDcOffset.test.ts` before running and copy it exactly.

- [ ] **Step 5: Run** both test files, then the loudness suites that may assert exact objects: `node …/vitest.mjs run src/main/ffmpeg.test.ts src/main/peakCount.test.ts src/main/ffmpeg.loudness.test.ts src/main/audioIpc.test.ts`. Fix any literal `LoudnessResult` expectations by adding `peakCount: null` (canned stderr without `Peak count`). Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Count the samples sitting at the peak in the loudness pass"`

---

### Task 2: Audio fingerprint probe

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (new export next to `measureLoudness`)
- Modify: `apps/desktop/src/main/analysisCache.ts` (new `FINGERPRINT_NAMESPACE = 'fingerprint'`, byte-safe append)
- Modify: `apps/desktop/src/main/audioIpc.ts` (handler after `audio:loudness` ~285)
- Modify: `apps/desktop/src/shared/audioIpcContract.ts` (entry after `'audio:loudness'`)
- Modify: `apps/desktop/src/preload/index.ts:209`, `apps/desktop/src/preload/api.ts:276`, `apps/desktop/src/renderer/src/test/api.ts:242`
- Modify: `apps/desktop/src/renderer/src/lib/analysisQueries.ts:56` (`ANALYSIS_QUERY_KEYS` gains `'fingerprint'`)
- Test: new `apps/desktop/src/main/fingerprint.test.ts`

**Interfaces:**
- Produces: `audioFingerprint(input: string, signal?: AbortSignal): Promise<string | null>` (hex MD5 of the decode as s16 stereo 44.1 kHz); IPC `'audio:fingerprint'` `args: [inputPath: string, priority?: 'high' | 'low']`, `result: string | null`; `window.api.fingerprint(path, priority?)`.

- [ ] **Step 1: Write the failing test** `src/main/fingerprint.test.ts` (same mocks as Task 1):

```ts
const dir = mkdtempSync(join(tmpdir(), 'surco-fp-'))
const wav16 = join(dir, 'a.wav')
const aiff24 = join(dir, 'a.aiff')
const louder = join(dir, 'b.wav')

beforeAll(() => {
  const sine = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2']
  execFileSync(FF as string, [...sine, '-af', 'volume=0.4', '-c:a', 'pcm_s16le', wav16])
  execFileSync(FF as string, ['-v', 'error', '-y', '-i', wav16, '-c:a', 'pcm_s24be', aiff24])
  execFileSync(FF as string, ['-v', 'error', '-y', '-i', wav16, '-af', 'volume=0.1dB', '-c:a', 'pcm_s16le', louder])
})

describe('audioFingerprint', () => {
  // Netzwerk's AIF declared 24 bits with an empty low byte: the same samples as a 16-bit
  // WAV. The fingerprint must prove that, whatever the container says.
  it('matches a 16-bit file and its padded 24-bit copy', async () => {
    expect(await audioFingerprint(aiff24)).toBe(await audioFingerprint(wav16))
  })

  it('tells apart a copy only a tenth of a decibel louder', async () => {
    expect(await audioFingerprint(louder)).not.toBe(await audioFingerprint(wav16))
  })

  it('returns null for a file it cannot decode', async () => {
    expect(await audioFingerprint(join(dir, 'missing.wav'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `node …/vitest.mjs run src/main/fingerprint.test.ts`. Expected: FAIL (`audioFingerprint` not exported).

- [ ] **Step 3: Implement** in `ffmpeg.ts`, using the module's own `run`, `ffmpegPath`, `forcedInputArgs`, `ANALYSIS_TIMEOUT_MS` exactly as `measureLoudness` does:

```ts
export async function audioFingerprint(input: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const { stdout } = await run(
      ffmpegPath,
      ['-v', 'error', ...forcedInputArgs(input), '-i', input, '-map', '0:a:0', '-ac', '2', '-ar', '44100',
        '-c:a', 'pcm_s16le', '-f', 'md5', '-'],
      { maxBuffer: 1024 * 64, timeout: ANALYSIS_TIMEOUT_MS, signal },
    )
    const m = stdout.match(/MD5=([0-9a-f]{32})/)
    return m ? m[1] : null
  } catch (err) {
    if (isAbortError(err)) throw err
    return null
  }
}
```

(If `run` rejects a non-zero exit with a typed error and `isAbortError` lives elsewhere, import it the way `audioIpc.ts` does.) Append the namespace byte-safely:

```bash
printf "\nexport const FINGERPRINT_NAMESPACE = 'fingerprint'\n" >> src/main/analysisCache.ts
```

Handler in `audioIpc.ts`, mirroring `audio:loudness`:

```ts
  handleAudio('audio:fingerprint', async (_e, inputPath: string, priority: 'high' | 'low' = 'low') => {
    try {
      return await cachedAnalysis(FINGERPRINT_NAMESPACE, inputPath, () =>
        cancellable(inputPath, priority, (signal) =>
          analysisLimiter.run(() => audioFingerprint(inputPath, signal), priority, signal),
        ),
      )
    } catch (err) {
      if (!isAbortError(err)) log.error('audio:fingerprint failed', err)
      return null
    }
  })
```

Contract entry: `'audio:fingerprint': { args: [inputPath: string, priority?: 'high' | 'low']; result: string | null }`. Preload: `fingerprint: (path: string, priority: 'high' | 'low' = 'low'): Promise<string | null> => invokeAudio('audio:fingerprint', path, priority),` and in `api.ts` `fingerprint: (path: string, priority?: 'high' | 'low') => Promise<string | null>`. Test mock: `fingerprint: async () => null,`. Add `'fingerprint'` to `ANALYSIS_QUERY_KEYS`.

- [ ] **Step 4: Run** `node …/vitest.mjs run src/main/fingerprint.test.ts src/main/audioIpc.test.ts src/shared` and both `tsc` configs. Expected: PASS, no type errors (the contract table makes a missing preload entry a type error).

- [ ] **Step 5: Commit** `git commit -m "Fingerprint the decoded audio so two containers of the same samples read as one"`

---

### Task 3: Same-master pair probe

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (new export next to `audioFingerprint`)
- Modify: `apps/desktop/src/main/audioIpc.ts`, `apps/desktop/src/shared/audioIpcContract.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/renderer/src/test/api.ts`
- Modify: `apps/desktop/src/shared/types.ts` (new `PairFacts`)
- Test: new `apps/desktop/src/main/sameMaster.test.ts`

**Why:** calibration (26 real pairs) showed peak count and crest separate copies only inside one master; across different sources they vary as much and would name a false winner. Same master = correlation >= 0.98 after alignment (measured: same master 0.992 to 0.9999, different source 0.38 to 0.86, one borderline remix 0.954).

**Interfaces:**
- Produces: `export interface PairFacts { correlation: number; residualDb: number; gainDb: number }` in `shared/types.ts`; `comparePair(a: string, b: string, signal?: AbortSignal): Promise<PairFacts | null>` in `ffmpeg.ts`; IPC `'audio:pair'` `args: [a: string, b: string]`, `result: PairFacts | null`; `window.api.comparePair(a, b)`.

Method (deterministic, cheap): decode both files with the module's `decodePcm` to mono float at 11025 Hz. Take a 5 s window of `a` starting at 30 s (or at 0 when shorter than 40 s), find the lag in -1 s..+1 s of `b` maximising normalised cross-correlation, then over the overlapping full length compute `correlation` (Pearson of a vs shifted b), `gainDb` = 20·log10(g) with g = Σab/Σbb, and `residualDb` = 10·log10(Σ(a - g·b)² / Σa²) (`-Infinity` when the residual is exactly zero). Return null if either decode fails or either file is under 10 s. Not cached on disk (pairs are few and change with either file); the renderer caches per session by query key `['pair', a, b]` with a and b sorted.

- [ ] **Step 1: Write the failing test** `src/main/sameMaster.test.ts` (mocks as in `fingerprint.test.ts`). Fixtures from one 20 s three-sine mix `base.wav` (use the same three-sine lavfi expression Task 1's `peakCount.test.ts` ended up with): `shifted.wav` = base delayed 6 samples (`adelay=6S:all=1`), `limited.wav` = base `volume=4,alimiter=limit=0.5:level=false`, `other.wav` = a different three-sine mix (other frequencies).

```ts
it('finds a copy shifted by a few samples to be the same audio', async () => {
  const p = await comparePair(base, shifted)
  expect(p?.correlation).toBeGreaterThan(0.999)
  expect(p?.residualDb).toBeLessThan(-60)
})

// Netzwerk's two copies: same master, one pushed through a limiter.
it('keeps a limited copy of the same master above the same-master line', async () => {
  const p = await comparePair(base, limited)
  expect(p?.correlation).toBeGreaterThanOrEqual(0.98)
  expect(p?.residualDb).toBeGreaterThan(-60)
})

it('puts a different recording far below the same-master line', async () => {
  expect((await comparePair(base, other))?.correlation ?? 1).toBeLessThan(0.9)
})

it('has nothing to say about a file it cannot decode', async () => {
  expect(await comparePair(base, join(dir, 'missing.wav'))).toBeNull()
})
```

- [ ] **Step 2: Run** it. Expected: FAIL (not exported).
- [ ] **Step 3: Implement** `comparePair` as described, plus the IPC handler (wrapped in `cancellable`/`analysisLimiter` like `audio:fingerprint`, low priority, no `cachedAnalysis`), contract entry, preload (`comparePair: (a: string, b: string): Promise<PairFacts | null> => invokeAudio('audio:pair', a, b)`), api type, test mock `comparePair: async () => null`.
- [ ] **Step 4: Run** the test, `src/main/audioIpc.test.ts`, both `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Tell whether two copies come from the same master by aligning them"`

---

### Task 4: `compareCopies`

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/bestCopy.ts`
- Test: `apps/desktop/src/renderer/src/lib/bestCopy.test.ts`

**Interfaces:**
- Consumes: `replaceWarning`, `ReplaceSide` from `lib/replaceWarning.ts`; `PairFacts` from `shared/types.ts` (Task 3).
- Produces:

```ts
export interface CopyFacts {
  ext: string
  cutoffHz?: number
  hasKnee?: boolean
  processed?: boolean
  upsampled?: boolean
  fingerprint?: string | null
  peakCount?: number | null
  crestDb?: number | null
  integratedLufs?: number
}
export type CopyReason = 'lossless' | 'transcode' | 'cutoff' | 'processed' | 'upsampled' | 'peakCount' | 'crest'
export type CopyVerdict =
  | { winner: 'a' | 'b'; reason: CopyReason }
  | { winner: 'same' }
  | { winner: 'tie' }
export interface CopyMargins { sameMasterCorrelation: number; peakCountRatio: number; crestDb: number }
export const COPY_MARGINS: CopyMargins // { sameMasterCorrelation: 0.98, peakCountRatio: 10, crestDb: 1.5 }
export function isSameAudio(a: CopyFacts, b: CopyFacts, pair: PairFacts | null | undefined): boolean
export function compareCopies(a: CopyFacts, b: CopyFacts, pair?: PairFacts | null, margins?: CopyMargins): CopyVerdict
```

Rules, in order (calibrated on 26 real pairs, report in the session scratchpad `calib/REPORT.md`):
1. Same audio: equal fingerprints, or `pair.residualDb <= -60` with `|pair.gainDb| < 0.01` (catches a copy shifted by a few samples, whose MD5 differs; measured on Aquagen).
2. `replaceWarning` both ways (lossless over lossy, not a transcode, clearly higher lossy cutoff). Applies across masters.
3. Processed, then upsampled: the clean copy wins. Applies across masters.
4. Level criteria ONLY when `pair` exists and `pair.correlation >= margins.sameMasterCorrelation`:
   a. peak count: the copy with `(max + 1) / (min + 1) >= margins.peakCountRatio` more samples at its peak loses (measured: 8 of 8 same-master pairs differing by >= 1 LU, ratios 25x to 36000x; pairs under 0.4 LU stayed under 3x).
   b. crest: the copy with >= `margins.crestDb` less crest loses (measured: the one same-master pair where the two metrics disagreed in direction had 1.18 dB).
5. Otherwise `tie`. Loudness never decides.

- [ ] **Step 1: Write the failing tests** `bestCopy.test.ts` (real numbers from the calibration pairs):

```ts
import { describe, expect, it } from 'vitest'
import { compareCopies, type CopyFacts } from './bestCopy'

const sameMaster = { correlation: 0.9956, residualDb: -20.5, gainDb: -2.2 }
const otherMaster = { correlation: 0.8618, residualDb: -5.9, gainDb: 0.4 }

const netzwerkWav: CopyFacts = { ext: 'wav', cutoffHz: 22050, hasKnee: false, fingerprint: 'w', peakCount: 1978, crestDb: 10.7, integratedLufs: -10 }
const netzwerkAif: CopyFacts = { ext: 'aif', cutoffHz: 22050, hasKnee: false, fingerprint: 'a', peakCount: 2, crestDb: 13.2, integratedLufs: -12.2 }

describe('compareCopies', () => {
  it('reads two containers of the same samples as the same audio', () => {
    expect(compareCopies({ ...netzwerkWav, fingerprint: 'x' }, { ...netzwerkAif, fingerprint: 'x' })).toEqual({ winner: 'same' })
  })

  // Aquagen: the download sat 6 samples late, so its MD5 differed from an identical copy.
  it('reads a copy shifted by a few samples as the same audio', () => {
    expect(compareCopies(netzwerkAif, { ...netzwerkAif, fingerprint: 'z' }, { correlation: 1, residualDb: Number.NEGATIVE_INFINITY, gainDb: 0 }))
      .toEqual({ winner: 'same' })
  })

  // Measured 15/10: the Apple Music WAV was the AIF pushed through a limiter.
  it('prefers the copy a limiter did not flatten (Netzwerk)', () => {
    expect(compareCopies(netzwerkWav, netzwerkAif, sameMaster)).toEqual({ winner: 'b', reason: 'peakCount' })
  })

  // Wiki Wiki: two masters of one title, 822 against 3.5 samples at the peak. Level says
  // nothing about which master is better, so no winner.
  it('never ranks two different masters by level', () => {
    const a = { ...netzwerkAif, fingerprint: 'p', peakCount: 822.5, crestDb: 11 }
    const b = { ...netzwerkAif, fingerprint: 'q', peakCount: 3.5, crestDb: 11 }
    expect(compareCopies(a, b, otherMaster)).toEqual({ winner: 'tie' })
  })

  it('never ranks by level without the pair probe', () => {
    expect(compareCopies(netzwerkWav, netzwerkAif)).toEqual({ winner: 'tie' })
  })

  it('prefers lossless over lossy whatever the master', () => {
    const mp3 = { ...netzwerkAif, ext: 'mp3', cutoffHz: 19800, hasKnee: true, fingerprint: 'm' }
    expect(compareCopies(mp3, netzwerkWav, otherMaster)).toEqual({ winner: 'b', reason: 'lossless' })
  })

  it('prefers the lossy copy with the clearly higher cutoff', () => {
    expect(compareCopies({ ext: 'mp3', cutoffHz: 16000, hasKnee: true }, { ext: 'mp3', cutoffHz: 19800, hasKnee: true }))
      .toEqual({ winner: 'b', reason: 'cutoff' })
  })

  it('prefers the clean copy over a processed one', () => {
    expect(compareCopies({ ...netzwerkAif, processed: true, fingerprint: 'r' }, netzwerkAif)).toEqual({ winner: 'b', reason: 'processed' })
  })

  // Louder is not better: a quieter copy with the same dynamics must not lose.
  it('never decides on loudness alone', () => {
    expect(compareCopies(netzwerkAif, { ...netzwerkAif, fingerprint: 'q', integratedLufs: -20 }, sameMaster)).toEqual({ winner: 'tie' })
  })

  // Night Power: peak counts within 3x, crest 3.8 dB apart.
  it('falls back to crest when the peak counts are close', () => {
    const a = { ...netzwerkAif, fingerprint: 's', peakCount: 1343.5, crestDb: 9.4 }
    const b = { ...netzwerkAif, fingerprint: 't', peakCount: 465, crestDb: 13.2 }
    expect(compareCopies(a, b, sameMaster)).toEqual({ winner: 'b', reason: 'crest' })
  })

  // Children: 0.2 LU apart, crest 1.18 dB the other way from the peak count. Not separable.
  it('calls a small crest gap a tie', () => {
    const a = { ...netzwerkAif, fingerprint: 's', peakCount: 1176, crestDb: 12 }
    const b = { ...netzwerkAif, fingerprint: 't', peakCount: 2706, crestDb: 13.18 }
    expect(compareCopies(a, b, sameMaster)).toEqual({ winner: 'tie' })
  })

  it('skips a criterion one side has not measured', () => {
    expect(compareCopies({ ...netzwerkWav, peakCount: null, crestDb: null }, netzwerkAif, sameMaster)).toEqual({ winner: 'tie' })
  })
})
```

- [ ] **Step 2: Run** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/bestCopy.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `bestCopy.ts`:

```ts
import type { PairFacts } from '../../../shared/types'
import { type ReplaceSide, replaceWarning } from './replaceWarning'

// (CopyFacts, CopyReason, CopyVerdict, CopyMargins exactly as in Interfaces above)

export const COPY_MARGINS: CopyMargins = { sameMasterCorrelation: 0.98, peakCountRatio: 10, crestDb: 1.5 }

const IDENTICAL_RESIDUAL_DB = -60
const IDENTICAL_GAIN_DB = 0.01

function side(f: CopyFacts): ReplaceSide {
  return { ext: f.ext, cutoffHz: f.cutoffHz, hasKnee: f.hasKnee }
}

function flag(a: boolean | undefined, b: boolean | undefined, reason: CopyReason): CopyVerdict | null {
  if (a && !b) return { winner: 'b', reason }
  if (b && !a) return { winner: 'a', reason }
  return null
}

function byPeakCount(a: CopyFacts, b: CopyFacts, ratio: number): CopyVerdict | null {
  if (a.peakCount == null || b.peakCount == null) return null
  const hi = Math.max(a.peakCount, b.peakCount) + 1
  const lo = Math.min(a.peakCount, b.peakCount) + 1
  if (hi / lo < ratio) return null
  return { winner: a.peakCount < b.peakCount ? 'a' : 'b', reason: 'peakCount' }
}

function byCrest(a: CopyFacts, b: CopyFacts, margin: number): CopyVerdict | null {
  if (a.crestDb == null || b.crestDb == null || Math.abs(a.crestDb - b.crestDb) < margin) return null
  return { winner: a.crestDb > b.crestDb ? 'a' : 'b', reason: 'crest' }
}

const REASON = { 'lossless-to-lossy': 'lossless', transcode: 'transcode', 'lower-cutoff': 'cutoff' } as const

export function isSameAudio(a: CopyFacts, b: CopyFacts, pair: PairFacts | null | undefined): boolean {
  if (a.fingerprint && a.fingerprint === b.fingerprint) return true
  return !!pair && pair.residualDb <= IDENTICAL_RESIDUAL_DB && Math.abs(pair.gainDb) < IDENTICAL_GAIN_DB
}

export function compareCopies(a: CopyFacts, b: CopyFacts, pair?: PairFacts | null, margins: CopyMargins = COPY_MARGINS): CopyVerdict {
  if (isSameAudio(a, b, pair)) return { winner: 'same' }
  const bWorse = replaceWarning(side(a), side(b))
  const aWorse = replaceWarning(side(b), side(a))
  if (bWorse && !aWorse) return { winner: 'a', reason: REASON[bWorse.reason] }
  if (aWorse && !bWorse) return { winner: 'b', reason: REASON[aWorse.reason] }
  const cleaner = flag(a.processed, b.processed, 'processed') ?? flag(a.upsampled, b.upsampled, 'upsampled')
  if (cleaner) return cleaner
  if (!pair || pair.correlation < margins.sameMasterCorrelation) return { winner: 'tie' }
  return byPeakCount(a, b, margins.peakCountRatio) ?? byCrest(a, b, margins.crestDb) ?? { winner: 'tie' }
}
```

Above `COPY_MARGINS`, one comment line with the measured bounds (same style as `CUTOFF_NOISE_HZ` in `replaceWarning.ts`).

- [ ] **Step 4: Run** the test. Expected: PASS. Then mutate to prove the tests bite: remove the `pair.correlation` gate line, run, expect `never ranks two different masters by level` to FAIL, revert.

- [ ] **Step 5: Commit** `git commit -m "Decide which of two copies to keep from measured differences only"`

---

### Task 5: `useCopyFacts`

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useCopyFacts.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useCopyFacts.test.tsx`

**Interfaces:**
- Consumes: `spectrogramOptions`, `useCachedSpectrum` (`hooks/useSpectrogram.ts`), `analysisOptions` (`lib/analysisQueries.ts`), `window.api.loudness`, `window.api.fingerprint`, `fileExtension` (same helper `Editor.tsx` imports), `CopyFacts`.
- Produces: `pairOptions(a: string, b: string)` (query options, key `['pair', ...[a, b].sort()]`, `queryFn: () => window.api.comparePair(a, b)`, `staleTime: Infinity`, add `'pair'` to `ANALYSIS_QUERY_KEYS` eviction only if that helper matches keys by first element and path; otherwise leave eviction to session end and say so in the report), `usePairFacts(a: string, b: string, enabled: boolean): PairFacts | null | undefined` (same undefined/null convention), `copyFactsQueries(path: string)` (array of three query options, low priority) and `useCopyFacts(path: string, enabled: boolean): CopyFacts | null | undefined` (`undefined` while any of the three queries is pending or disabled; `null` once they settled and any probe failed or resolved to null; facts otherwise).

- [ ] **Step 1: Write the failing test** with a `QueryClientProvider` wrapper (copy the wrapper used by an existing hook test, e.g. `useTrackProperties` or `useLibraryVerdict` tests) and `window.api` stubs from `renderer/src/test/api.ts`:

```tsx
it('gathers spectrum, loudness and fingerprint into one set of facts', async () => {
  api.spectrogram = vi.fn().mockResolvedValue({ image: '', cutoffHz: 22050, sampleRateHz: 44100, processed: false, hasKnee: false })
  api.loudness = vi.fn().mockResolvedValue({ integratedLufs: -12.2, truePeakDb: -0.7, lra: 5.4, crestDb: 13.2, peakCount: 1, channelBalanceDb: null, dcOffset: null, noiseFloorDb: null })
  api.fingerprint = vi.fn().mockResolvedValue('abc')
  const { result } = renderHook(() => useCopyFacts('/m/a.aif', true), { wrapper })
  await waitFor(() => expect(result.current).not.toBeNull())
  expect(result.current).toEqual({ ext: 'aif', cutoffHz: 22050, hasKnee: false, processed: false, upsampled: undefined, fingerprint: 'abc', peakCount: 1, crestDb: 13.2, integratedLufs: -12.2 })
})

// Review focus 1: a copy whose file vanished must not keep a verdict alive.
it('has no facts for a file the probes could not read', async () => {
  api.spectrogram = vi.fn().mockRejectedValue(new Error('ENOENT'))
  api.loudness = vi.fn().mockResolvedValue(null)
  api.fingerprint = vi.fn().mockResolvedValue(null)
  const { result } = renderHook(() => useCopyFacts('/gone.wav', true), { wrapper })
  await waitFor(() => expect(api.fingerprint).toHaveBeenCalled())
  expect(result.current).toBeNull()
})

it('compares a pair once whichever order the two paths come in', async () => {
  api.comparePair = vi.fn().mockResolvedValue({ correlation: 0.99, residualDb: -20, gainDb: -2 })
  const { result } = renderHook(() => [usePairFacts('/a', '/b', true), usePairFacts('/b', '/a', true)], { wrapper })
  await waitFor(() => expect(result.current[1]).toEqual({ correlation: 0.99, residualDb: -20, gainDb: -2 }))
  expect(api.comparePair).toHaveBeenCalledTimes(1)
})

it('is still measuring while a probe is pending', () => {
  api.fingerprint = vi.fn(() => new Promise<string | null>(() => {}))
  const { result } = renderHook(() => useCopyFacts('/m/a.aif', true), { wrapper })
  expect(result.current).toBeUndefined()
})
```

- [ ] **Step 2: Run** it. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**:

```ts
import { useQueries } from '@tanstack/react-query'
import type { LoudnessResult, SpectrumVerdict } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'
import type { CopyFacts } from '../lib/bestCopy'
import { fileExtension } from '../lib/<same module Editor.tsx imports it from>'
import { spectrogramOptions } from './useSpectrogram'

export function copyFactsQueries(path: string) {
  return [
    spectrogramOptions(path, 'low'),
    analysisOptions('loudness', path, () => window.api.loudness(path, 'low')),
    analysisOptions('fingerprint', path, () => window.api.fingerprint(path, 'low')),
  ] as const
}

export function toCopyFacts(path: string, spectrum: SpectrumVerdict | undefined, loud: LoudnessResult | null | undefined, fingerprint: string | null | undefined): CopyFacts | null {
  if (!spectrum || spectrum.cutoffHz === null || !loud || !fingerprint) return null
  return {
    ext: fileExtension(path),
    cutoffHz: spectrum.cutoffHz,
    hasKnee: spectrum.hasKnee,
    processed: spectrum.processed,
    upsampled: spectrum.upsampled,
    fingerprint,
    peakCount: loud.peakCount ?? null,
    crestDb: loud.crestDb,
    integratedLufs: loud.integratedLufs,
  }
}

export function useCopyFacts(path: string, enabled: boolean): CopyFacts | null {
  const [spectrum, loud, fp] = useQueries({
    queries: copyFactsQueries(path).map((q) => ({ ...q, enabled: enabled && !!path })),
  })
  if (!enabled || !path || spectrum.isPending || loud.isPending || fp.isPending) return undefined
  return toCopyFacts(path, spectrum.data as SpectrumVerdict | undefined, loud.data as LoudnessResult | null | undefined, fp.data as string | null | undefined)
}
```

(Resolve the `fileExtension` import path with `grep -n "fileExtension" src/renderer/src/components/Editor.tsx`. If `cutoffHz === null` the spectrum failed and no decision is allowed, per the spec.)

- [ ] **Step 4: Run** it. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Gather the facts a copy comparison needs through the analysis queries"`

---

### Task 6: Rank duplicates in the list and draw the icon

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/duplicateRanks.ts`, `apps/desktop/src/renderer/src/hooks/useDuplicateRanks.ts`
- Modify: `apps/desktop/src/renderer/src/components/TrackList.tsx` (`Props` ~41, `RowProps` ~253, parent map ~975, detail line after `track-cleaned` ~705)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (~2157, pass the map)
- Modify: 5 locale files under `"trackList"` (~367)
- Test: `apps/desktop/src/renderer/src/lib/duplicateRanks.test.ts`, `apps/desktop/src/renderer/src/components/TrackList.test.tsx`

**Interfaces:**
- Consumes: `duplicateGroups` (`lib/duplicates.ts`), `compareCopies`, `CopyFacts`, `copyFactsQueries`, `toCopyFacts`.
- Produces: `type DuplicateRank = { rank: 'best' | 'worse' | 'same'; count: number; identical: boolean; reason?: CopyReason }`; `rankGroup(facts: (CopyFacts | null | undefined)[], pairAt: (i: number, j: number) => PairFacts | null | undefined, margins?: CopyMargins): DuplicateRank[] | null` (`identical` is true only when every pair is `isSameAudio`; a `same` row that is not identical reads `trackList.copyNoDifference`); `useDuplicateRanks(tracks: TrackItem[]): ReadonlyMap<string, DuplicateRank>`; `TrackList` prop `duplicateRankById?: ReadonlyMap<string, DuplicateRank>`.

- [ ] **Step 1: Write the failing `rankGroup` tests**:

```ts
const SAME = { correlation: 0.995, residualDb: -20, gainDb: -2 }
const all = () => SAME
const open: CopyFacts = { ext: 'aif', cutoffHz: 22050, fingerprint: 'a', peakCount: 1, crestDb: 13 }
const limited: CopyFacts = { ext: 'wav', cutoffHz: 22050, fingerprint: 'w', peakCount: 1978, crestDb: 10 }
const mp3: CopyFacts = { ext: 'mp3', cutoffHz: 19800, hasKnee: true, fingerprint: 'm', peakCount: 2, crestDb: 13 }

it('marks the one copy that beats every other as best', () => {
  expect(rankGroup([limited, open], all)).toEqual([
    { rank: 'worse', count: 2, identical: false, reason: 'peakCount' },
    { rank: 'best', count: 2, identical: false, reason: 'peakCount' },
  ])
})

// Review focus 2: three copies, never two winners.
it('names exactly one best among three copies', () => {
  const ranks = rankGroup([mp3, limited, open], all)
  expect(ranks?.filter((r) => r.rank === 'best')).toHaveLength(1)
  expect(ranks?.[2].rank).toBe('best')
})

it('marks every copy the same when none beats the others', () => {
  expect(rankGroup([open, { ...open }], all)).toEqual([
    { rank: 'same', count: 2, identical: true },
    { rank: 'same', count: 2, identical: true },
  ])
})

it('keeps the pair still being compared out of any verdict', () => {
  expect(rankGroup([limited, open], () => undefined)).toBeNull()
})

// Review focus 3: one copy still analysing hides the whole group.
it('ranks nothing while a copy is not measured yet', () => {
  expect(rankGroup([open, null], all)).toBeNull()
})
```

Rule: a copy is `best` only if it wins or is `same` against every other copy and wins at least once; if no copy qualifies, every member is `same`; everyone else is `worse`. `reason` is the reason of the best copy's first win (the same reason goes on the `worse` rows).

- [ ] **Step 2: Run**. Expected: FAIL.

- [ ] **Step 3: Implement** `duplicateRanks.ts`:

```ts
import type { PairFacts } from '../../../shared/types'
import { type CopyFacts, type CopyMargins, type CopyReason, COPY_MARGINS, compareCopies, isSameAudio } from './bestCopy'

export interface DuplicateRank { rank: 'best' | 'worse' | 'same'; count: number; reason?: CopyReason }

export function rankGroup(facts: (CopyFacts | null | undefined)[], pairAt: (i: number, j: number) => PairFacts | null | undefined, margins: CopyMargins = COPY_MARGINS): DuplicateRank[] | null {
  if (facts.some((f) => !f)) return null
  const all = facts as CopyFacts[]
  const count = all.length
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) if (pairAt(i, j) === undefined) return null
  const verdict = (i: number, j: number) => compareCopies(all[i], all[j], pairAt(i, j), margins)
  const identical = all.every((f, i) => all.every((g, j) => i === j || isSameAudio(f, g, pairAt(i, j))))
  const best = all.findIndex((me, i) => {
    let won = false
    for (let j = 0; j < count; j++) {
      if (j === i) continue
      const v = verdict(i, j)
      if (v.winner === 'b' || v.winner === 'tie') return false
      if (v.winner === 'a') won = true
    }
    return won
  })
  if (best === -1) return all.map(() => ({ rank: 'same' as const, count, identical }))
  const firstWin = all.map((_, j) => (j === best ? null : verdict(best, j))).find((v) => v?.winner === 'a')
  const reason = firstWin && firstWin.winner === 'a' ? firstWin.reason : undefined
  return all.map((_, i) => ({ rank: i === best ? 'best' : 'worse', count, identical: false, reason }))
}
```

Note the `tie` rule: a `tie` against any copy disqualifies a best, so "same" is only claimed when nothing separates. `identical` drives the `same` row label: `trackList.copySame` ("Mismo audio…") only when true, `trackList.copyNoDifference` otherwise (Step 5). Pair indices are always i < j when looked up; `pairAt` must answer symmetrically.

`useDuplicateRanks.ts`:

```ts
export function useDuplicateRanks(tracks: TrackItem[]): ReadonlyMap<string, DuplicateRank> {
  const groups = useMemo(
    () => duplicateGroups(tracks.map((t) => ({ id: t.id, artist: t.meta.artist ?? '', title: t.meta.title ?? '', durationSec: t.duration })))
      .filter((g) => g.kind === 'duplicate'),
    [tracks],
  )
  const pathById = useMemo(() => new Map(tracks.map((t) => [t.id, t.inputPath])), [tracks])
  const ids = groups.flatMap((g) => g.ids)
  const results = useQueries({ queries: ids.flatMap((id) => copyFactsQueries(pathById.get(id) ?? '')) })
  const pairIds = groups.flatMap((g) => g.ids.flatMap((a, i) => g.ids.slice(i + 1).map((b) => [a, b] as const)))
  const pairResults = useQueries({ queries: pairIds.map(([a, b]) => pairOptions(pathById.get(a) ?? '', pathById.get(b) ?? '')) })
  const pairData = (a: string, b: string): PairFacts | null | undefined => {
    const k = pairIds.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a))
    const r = pairResults[k]
    return !r || r.isPending ? undefined : (r.data ?? null)
  }
  return useMemo(() => {
    const factsById = new Map(ids.map((id, i) => {
      const [s, l, f] = results.slice(i * 3, i * 3 + 3)
      return [id, toCopyFacts(pathById.get(id) ?? '', s.data as SpectrumVerdict | undefined, l.data as LoudnessResult | null | undefined, f.data as string | null | undefined)]
    }))
    const out = new Map<string, DuplicateRank>()
    for (const g of groups) {
      const ranks = rankGroup(g.ids.map((id) => factsById.get(id) ?? null), (i, j) => pairData(g.ids[i], g.ids[j]))
      ranks?.forEach((r, i) => out.set(g.ids[i], r))
    }
    return out
  }, [groups, results, pathById])
}
```

(`useQueries` returns a new array each render; if the memo churns, combine via the `combine` option of `useQueries` returning the data tuple. Check with React DevTools-free reasoning: the map is only read per row through `.get`, and rows are `memo`, so pass `rank` scalars per row, not the map.)

- [ ] **Step 4: Write the failing row test** in `TrackList.test.tsx` (use the file's existing render helper):

```tsx
it('marks the best copy and the worse one with the same duplicate icon in two shapes', () => {
  renderList([trackA, trackB], { duplicateRankById: new Map([
    ['a', { rank: 'best', count: 2, identical: false, reason: 'peakCount' }],
    ['b', { rank: 'worse', count: 2, identical: false, reason: 'peakCount' }],
  ]) })
  const [rowA, rowB] = screen.getAllByTestId('track-row')
  expect(within(rowA).getByTestId('track-duplicate')).toHaveAttribute('data-rank', 'best')
  expect(within(rowA).getByTestId('track-duplicate')).toHaveAccessibleName('Best of 2 copies · less limited')
  expect(within(rowB).getByTestId('track-duplicate')).toHaveAttribute('data-rank', 'worse')
})

it('draws no duplicate icon on a track with no ranked copy', () => {
  renderList([trackA])
  expect(screen.queryByTestId('track-duplicate')).toBeNull()
})
```

- [ ] **Step 5: Implement the row.** `RowProps` gains `duplicate?: DuplicateRank`; the parent map passes `duplicate={duplicateRankById?.get(t.id)}`. After the `cleaned` block in the detail line:

```tsx
{duplicate && (
  <span
    data-testid="track-duplicate"
    data-rank={duplicate.rank}
    className={`group/dot relative flex shrink-0 items-center ${duplicate.rank === 'best' ? 'text-good' : 'text-fg-faint'}`}
  >
    {duplicate.rank === 'best' ? <CopyCheck className="h-3 w-3" aria-hidden="true" />
      : duplicate.rank === 'worse' ? <Copy className="h-3 w-3" aria-hidden="true" />
      : <CopyMinus className="h-3 w-3" aria-hidden="true" />}
    <Tooltip label={duplicateLabel} align="end" scope="dot" />
    <span className="sr-only">{duplicateLabel}</span>
  </span>
)}
```

The accessible name test uses `toHaveAccessibleName`; since the span is not a control, assert with `toHaveTextContent` on the `sr-only` span instead if `toHaveAccessibleName` returns empty for a plain span, and keep the assertion on the visible meaning. `duplicateLabel`:

```ts
const duplicateLabel = !duplicate ? '' :
  duplicate.rank === 'best' ? tr('trackList.copyBest', { count: duplicate.count, reason: tr(`trackList.copyReason.${duplicate.reason}`) })
  : duplicate.rank === 'worse' ? tr('trackList.copyWorse', { reason: tr(`trackList.copyReasonWorse.${duplicate.reason}`) })
  : duplicate.identical ? tr('trackList.copySame') : tr('trackList.copyNoDifference')
```

Keys (en / es, the spec's copy; de, fr, pt-BR translated the same way):

```json
"copyBest": "Best of {{count}} copies · {{reason}}",            "Mejor copia de {{count}} · {{reason}}"
"copyWorse": "There is a better copy in the list · {{reason}}",  "Hay una copia mejor en la lista · {{reason}}"
"copySame": "Same audio as another copy in the list",            "Mismo audio que otra copia de la lista"
"copyNoDifference": "No measured difference from another copy in the list", "Sin diferencia medida con otra copia de la lista"
"copyReason": { "lossless": "lossless", "transcode": "not a transcode", "cutoff": "higher cutoff", "processed": "not reprocessed", "upsampled": "not upsampled", "peakCount": "less limited", "crest": "more dynamic" }
   es: "sin pérdidas", "no es una transcodificación", "corte más alto", "sin reprocesar", "sin reescalar", "menos limitada", "más dinámica"
"copyReasonWorse": { "lossless": "this one is lossy", "transcode": "this one is a transcode", "cutoff": "this one cuts lower", "processed": "this one is reprocessed", "upsampled": "this one is upsampled", "peakCount": "this one is more limited", "crest": "this one is less dynamic" }
   es: "esta tiene pérdidas", "esta es una transcodificación", "esta corta más abajo", "esta está reprocesada", "esta está reescalada", "esta está más limitada", "esta es menos dinámica"
```

Render the list with the map from App: `const duplicateRankById = useDuplicateRanks(tracks)` next to `backupAtByPath`, passed as `duplicateRankById={duplicateRankById}`.

- [ ] **Step 6: Run** `node …/vitest.mjs run src/renderer/src/lib/duplicateRanks.test.ts src/renderer/src/components/TrackList.test.tsx src/renderer/src/i18n src/renderer/src/App.test.tsx`. Expected: PASS.

- [ ] **Step 7: Commit** `git commit -m "Mark the best copy among duplicates in the list"`

---

### Task 7: The Apple Music pill compares and shows its numbers

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx` (~599-620 and the `libraryMarks` JSX ~1121-1157)
- Create: `apps/desktop/src/renderer/src/components/CopyComparison.tsx`
- Modify: 5 locale files under `"editor"`
- Test: `apps/desktop/src/renderer/src/components/CopyComparison.test.tsx`, `apps/desktop/src/renderer/src/components/Editor.test.tsx`

**Interfaces:**
- Consumes: `useCopyFacts`, `compareCopies`, `CopyVerdict`, `CopyFacts`, `replacedCopyPath` (already computed at `Editor.tsx:608`), `SectionPill`.
- Produces: `<CopyComparison verdict here libraryCopy hereLabel libraryLabel />` (table + one sentence), and the pill states `copy-verdict` `data-state="here|library|same|tie|measuring"`.

- [ ] **Step 1: Write the failing `CopyComparison` test**:

```tsx
it('argues the Netzwerk verdict with the measured numbers, colouring only the deciding rows', () => {
  render(<CopyComparison verdict={{ winner: 'a', reason: 'peakCount' }} here={aif} library={wav} hereLabel="AIF" libraryLabel="WAV" />)
  expect(screen.getByTestId('copy-sentence')).toHaveTextContent('The Apple Music copy is 2.2 dB louder and went through a limiter, with 1978 samples pinned at its ceiling.')
  expect(screen.getByTestId('copy-row-peakCount')).toHaveAttribute('data-decides', 'true')
  expect(screen.getByTestId('copy-row-loudness')).not.toHaveAttribute('data-decides')
})
```

- [ ] **Step 2: Run**. Expected: FAIL.

- [ ] **Step 3: Implement `CopyComparison.tsx`**: a bordered block like the `quality-evidence` block (copy its classes from `QualitySection.tsx`), a sentence `<p data-testid="copy-sentence">` chosen by `verdict.reason` and side, and a `<table>` with rows `cutoff`, `loudness`, `crest`, `peakCount` (`data-testid="copy-row-<id>"`, `data-decides` on the row named by `verdict.reason`), numbers formatted with `formatUpTo` in the app language. Sentence keys (en / es):

```json
"copyLimited": "The {{loser}} copy is {{db}} dB louder and went through a limiter, with {{count}} samples pinned at its ceiling.",
   "La copia de {{loser}} está {{db}} dB más alta y pasó por un limitador, con {{count}} muestras clavadas en su techo."
"copyLossy": "This file is lossy with its cutoff at {{cutoff}} kHz. The {{winner}} copy reaches {{other}} kHz.",
   "Este fichero tiene pérdidas, con el corte en {{cutoff}} kHz. La copia de {{winner}} llega a {{other}} kHz."
"copySameAudio": "Same samples, same gain. Only the container differs.",
   "Mismas muestras, misma ganancia. Solo cambia el contenedor."
"copyNoDifference": "No measured difference between the two copies.",
   "Sin diferencia medida entre las dos copias."
```

(Other reasons reuse `copyLossy`-style sentences per reason; write one key per reason that `CopyReason` has, so no reason renders blank. `copyNoDifference` is the extra text the spec left pending; it goes to Vicent in Task 8 with the rest.)

- [ ] **Step 4: Write the failing Editor tests** (use the existing helper that renders an editor with `replaceTarget`; the suite already covers `apple-music-copy-better`):

```tsx
it('says this file is better than the Apple Music copy and opens the numbers', async () => {
  // library copy facts: limited WAV; this file: open AIF (mock window.api.* per path)
  renderWithLibraryCopy({ here: aifFacts, library: wavFacts })
  const pill = await screen.findByTestId('copy-verdict')
  expect(pill).toHaveAttribute('data-state', 'here')
  expect(pill).toHaveTextContent('This file is better')
  fireEvent.click(pill)
  expect(screen.getByTestId('copy-sentence')).toBeInTheDocument()
})

it('shows no verdict when the library copy cannot be read', async () => {
  renderWithLibraryCopy({ here: aifFacts, library: null })
  await waitFor(() => expect(screen.getByTestId('apple-music-status')).toBeInTheDocument())
  expect(screen.queryByTestId('copy-verdict')).toBeNull()
})
```

Mock `window.api.comparePair` to return the Netzwerk pair `{ correlation: 0.9956, residualDb: -20.5, gainDb: -2.2 }`; the default margins are the calibrated ones.

- [ ] **Step 5: Implement in `Editor.tsx`**: next to `replacedCopySpectrum`,

```ts
const hereFacts = useCopyFacts(item.inputPath, !!replacedCopyPath)
const libraryFacts = useCopyFacts(replacedCopyPath, !!replacedCopyPath)
const copyPair = usePairFacts(item.inputPath, replacedCopyPath, !!replacedCopyPath)
const copyVerdict = hereFacts && libraryFacts && copyPair !== undefined ? compareCopies(hereFacts, libraryFacts, copyPair) : null
const copyMeasuring = !!replacedCopyPath && (hereFacts === undefined || libraryFacts === undefined || copyPair === undefined)
```

Keep `libraryCopyBetter` but derive it as `copyVerdict ? copyVerdict.winner === 'b' : <the existing replaceWarning expression>` so the existing tests and the pre-convert behaviour hold while facts load. In `libraryMarks`, after the format span, render a toggle button pill (`data-testid="copy-verdict"`, `data-state`), labels `editor.copyHereBetter` "This file is better" / "Este fichero es mejor", `editor.copyLibraryBetter` "Apple Music has a better one" / "Apple Music tiene una mejor", `editor.copySame` "Same audio" / "Mismo audio", `editor.copyComparing` "Comparing…" / "Comparando…"; `same` shows `editor.copySame`; `tie` shows nothing in the pill and `copyNoDifference` in the card. Clicking toggles `<CopyComparison>` under the Metadata header. Tone: `good` for `here`, `warn` for `library`, neutral otherwise.

- [ ] **Step 6: The pre-convert button stops pushing a worse replacement.** Failing test in `src/renderer/src/lib/exportLabel.test.ts`:

```ts
it('says Apple Music already has a better copy instead of offering the replace', () => {
  expect(exportButtonLabel({ ...base, replaces: true, libraryBetter: true, withAppleMusic: true }))
    .toEqual({ key: 'editor.libraryHasBetter' })
})
```

Add `libraryBetter?: boolean` to `ExportLabelState`, return `{ key: 'editor.libraryHasBetter' }` right where the `replaces` branch is chosen (only when `replaces` is true), thread `libraryBetter={libraryCopyBetter}` from `Editor.tsx` through `ConvertFooter` to the non-quiet `ExportButton`. Key: "Apple Music already has a better copy" / "Apple Music ya tiene una copia mejor". The press still converts as before (replacing stays one deliberate click away, as the spec says). Run `exportLabel.test.ts`, `ExportButton.test.tsx`, `ConvertFooter.test.tsx`.

- [ ] **Step 7: Run** `node …/vitest.mjs run src/renderer/src/components/CopyComparison.test.tsx src/renderer/src/components/Editor.test.tsx src/renderer/src/lib/exportLabel.test.ts src/renderer/src/i18n`. Expected: PASS.

- [ ] **Step 8: Commit** `git commit -m "Compare the open track with its Apple Music copy and show the numbers"`

---

### Task 8: Calibration regression

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/bestCopy.calibration.test.ts`

**Interfaces:**
- Consumes: `compareCopies`, `COPY_MARGINS`; data from `/private/tmp/claude-501/-Users-vicent-code-surco/a6961592-5446-4b2a-8e81-712ce55b90b1/scratchpad/calib/pairs.csv` (26 pairs; columns `class,label,A_codec,...,A_crestDb,A_peakCount,A_md5,B_...,corr,gain_db_B_to_A,resid_db`).

- [ ] **Step 1: Write the test**: one `it.each` row per CSV pair, copied as literals (label, class, both sides' `ext` from codec (`pcm_*` → `wav`, `flac`, `mp3`), cutoffHz 22050, hasKnee false for lossless, md5 as fingerprint, crestDb, peakCount, and the pair `{ correlation: corr, residualDb: resid_db, gainDb: gain_db_B_to_A }`). Expected verdict per class: `I` → `same`; `S` → the winner the report names when peak counts differ >= 10x or crest >= 1.5 dB, else `tie`; `S-drift`, `B`, `D`, `X` → `tie` (except a lossless-vs-lossy pair, which must say `lossless`). The expected column is derived from the measured classes, not from running the code.
- [ ] **Step 2: Run**. Expected: PASS with the Task 4 defaults. If any row fails, do not change the margins silently: report the row and the numbers as DONE_WITH_CONCERNS.
- [ ] **Step 3: Commit** `git commit -m "Pin the copy comparison to the 26 measured pairs"`

---

### Task 9: Scenario, copy review and spec update

**Files:**
- Create: `apps/desktop/src/scenarios/bestCopy.test.tsx`
- Modify: `docs/superpowers/specs/2026-10-15-mejor-copia-design.md`

- [ ] **Step 1: Write the scenario** following `scenarios/replaceInLibrary.test.tsx` (same four `vi.mock` lines, `music.reset()`, `music.addEntry({ location, title, artist, durationSec })`, `makeTrack`, `openSurco`). Fixtures: `open.aiff` = `makeTrack` with a tone; `limited.wav` = the same tone through `alimiter` at +6 dB (lavfi spec as in Task 1), added to the fake library under the same title/artist. Open `open.aiff`, wait for `copy-verdict` with `data-state="here"`, click it, assert `copy-row-peakCount` has `data-decides`. Second case: open both files into the list and assert `track-duplicate` `data-rank="best"` on the AIFF row.
- [ ] **Step 2: Run** `node …/vitest.mjs run src/scenarios/bestCopy.test.tsx`. Expected: PASS (if it fails, the bug is in Tasks 5 to 7, not in the scenario).
- [ ] **Step 3: Update the spec**: record the four decisions from Global Constraints and the final margins.
- [ ] **Step 4: Full verification**: `node …/vitest.mjs run src`, both `tsc`, `biome check src`; drive the app with the run-desktop skill against the Netzwerk pair (copy both files into a scratch folder, destination "Beside the original", never convert to Apple Music) and screenshot the list and the editor pill.
- [ ] **Step 5: Copy review gate**: show Vicent every new string (en + es) with a screenshot. Do not merge until he approves; apply his changes in all 5 locales.
- [ ] **Step 6: Commit** `git commit -m "Walk finding the best copy of a record in the list and against Apple Music"` and merge `worktree-mejor-copia` into local `main` (no push).
