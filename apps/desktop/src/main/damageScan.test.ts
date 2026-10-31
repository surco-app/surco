import { describe, expect, it, vi } from 'vitest'
import { type DamageScanDeps, scanDamage } from './damageScan'
import type { EngineDamage } from './engineDamage'
import type { TraktorDamage } from './traktorCueDamageScan'

const MP3 = '/m/uno.mp3'
const WAV = '/m/dos.wav'

const deps = (over: Partial<DamageScanDeps> = {}): DamageScanDeps => ({
  isAllowed: () => true,
  readGenre: vi.fn(async (p: string) => (p === MP3 ? { raw: '(35) Deep House' } : null)),
  libraryGenres: vi.fn(async () => ({})),
  ...over,
})

const traktorDamage: TraktorDamage = {
  path: MP3,
  sibling: '/m/uno.aiff',
  judgement: {
    kind: 'traktor-source-cues',
    certainty: 'sure',
    addMs: 51.18,
    fixEntry: 'source',
    fixTree: false,
    provenance: true,
  },
  before: [{ type: 0, hotcue: 0, ms: 9948.82 }],
  entry: { volume: 'Macintosh HD', dir: '/:m/:', file: 'uno.mp3', entryState: 'S' },
}

const engineDamage = (judgement: EngineDamage['judgement']): EngineDamage => ({
  path: WAV,
  judgement,
  fileBytes: 1234,
  length: 300,
  trackData: { sampleRate: 48000, sampleCount: 14400000 },
})

// Each finding carries what the review shows and what the repair writes: the proof as
// translatable notes with their numbers, and the exact state the scan read so a repair
// handed twice cannot land twice.
describe('scanDamage', () => {
  it('turns a genre a library kept into a sure finding with that value', async () => {
    const scan = await scanDamage(
      [MP3],
      deps({
        libraryGenres: vi.fn(async () => ({
          [MP3]: [{ source: 'traktor' as const, value: 'House; Deep House' }],
        })),
      }),
    )
    expect(scan).toEqual({
      unread: [],
      findings: [
        {
          id: `genre-number\0${MP3}`,
          kind: 'genre-number',
          path: MP3,
          certainty: 'sure',
          evidence: [
            {
              key: 'damage.evidence.libraryKept',
              params: { library: 'Traktor', value: 'House; Deep House' },
            },
          ],
          before: { key: 'damage.value.text', params: { value: '(35) Deep House' } },
          options: ['House; Deep House'],
          repair: { target: 'genre', path: MP3, from: '(35) Deep House', to: 'House; Deep House' },
        },
      ],
    })
  })

  it('names the ID3v1 number and the doubt when no library proves the genre', async () => {
    const [finding] = (await scanDamage([MP3], deps())).findings
    expect(finding.certainty).toBe('likely')
    expect(finding.evidence).toEqual([
      { key: 'damage.evidence.id3v1Number', params: { number: 35, name: 'House' } },
      { key: 'damage.evidence.maybeLegacy' },
    ])
  })

  it("takes a WAV's INFO genre as proof", async () => {
    const scan = await scanDamage(
      [WAV],
      deps({
        readGenre: vi.fn(async () => ({ raw: '(35) Deep House', info: 'House; Deep House' })),
      }),
    )
    expect(scan.findings[0]).toMatchObject({
      certainty: 'sure',
      evidence: [{ key: 'damage.evidence.infoKept', params: { value: 'House; Deep House' } }],
    })
  })

  it('reads the genre frame only of ID3 containers', async () => {
    const readGenre = vi.fn(async (_p: string) => null)
    await scanDamage(['/m/a.flac', '/m/b.m4a', '/m/c.aif', MP3], deps({ readGenre }))
    expect(readGenre.mock.calls.map(([p]) => p)).toEqual(['/m/c.aif', MP3])
  })

  it('scans only the files the app was handed', async () => {
    const readGenre = vi.fn(async (_p: string) => null)
    const traktor = vi.fn(async () => [])
    await scanDamage([MP3, WAV], deps({ isAllowed: (p) => p === WAV, readGenre, traktor }))
    expect(readGenre.mock.calls.map(([p]) => p)).toEqual([WAV])
    expect(traktor).toHaveBeenCalledWith([WAV])
  })

  it('carries the Traktor entry the scan read and the ms to add', async () => {
    const scan = await scanDamage(
      [MP3],
      deps({ readGenre: vi.fn(async () => null), traktor: vi.fn(async () => [traktorDamage]) }),
    )
    expect(scan.findings[0]).toMatchObject({
      id: `traktor-source-cues\0${MP3}`,
      certainty: 'sure',
      before: { key: 'damage.value.cueAt', params: { sec: 9.94882 } },
      after: { key: 'damage.value.cueAt', params: { sec: 10 } },
      repair: { target: 'traktor', path: MP3, addMs: 51.18, entry: traktorDamage.entry },
    })
    expect(scan.findings[0].evidence[0]).toEqual({
      key: 'damage.evidence.traktorTree',
      params: { fileSec: 10, entrySec: 9.94882, sibling: 'uno.aiff' },
    })
  })

  it('says whether Copias records the conversion between the two files', async () => {
    const run = async (provenance: boolean) =>
      (
        await scanDamage(
          [MP3],
          deps({
            readGenre: vi.fn(async () => null),
            traktor: vi.fn(async () => [
              { ...traktorDamage, judgement: { ...traktorDamage.judgement, provenance } },
            ]),
          }),
        )
      ).findings[0].evidence
    expect(await run(true)).toContainEqual({
      key: 'damage.evidence.traktorRecord',
      params: { sibling: 'uno.aiff' },
    })
    expect(await run(false)).toContainEqual({
      key: 'damage.evidence.traktorNoRecord',
      params: { sibling: 'uno.aiff' },
    })
  })

  it('names the converted file a calibration repair also moves', async () => {
    const scan = await scanDamage(
      [MP3],
      deps({
        readGenre: vi.fn(async () => null),
        traktor: vi.fn(async () => [
          {
            ...traktorDamage,
            path: '/m/uno.wav',
            sibling: MP3,
            judgement: {
              kind: 'traktor-calibration' as const,
              certainty: 'sure' as const,
              addMs: -51.18,
              fixEntry: 'sibling' as const,
              fixTree: true,
              provenance: true,
            },
            tree: [{ type: 0, hotcue: 0, ms: 10000 }],
          },
        ]),
      }),
    )
    expect(scan.findings[0].repair).toMatchObject({
      treeFile: '/m/uno.wav',
      treeMs: [10000],
      addMs: -51.18,
    })
  })

  it('carries the trackData the scan read for an Engine repair', async () => {
    const scan = await scanDamage(
      [WAV],
      deps({
        readGenre: vi.fn(async () => null),
        engine: vi.fn(async () => [
          engineDamage({
            kind: 'engine-cues',
            certainty: 'sure',
            trimmedMs: 0,
            sampleRateHz: 44100,
          }),
        ]),
      }),
    )
    expect(scan.findings[0]).toMatchObject({
      kind: 'engine-cues',
      certainty: 'sure',
      evidence: [
        { key: 'damage.evidence.engineRate', params: { engineKhz: 48, fileKhz: 44.1 } },
        { key: 'damage.evidence.engineNoCopy' },
      ],
      repair: {
        target: 'engine',
        path: WAV,
        fileBytes: 1234,
        expectTrackData: { sampleRate: 48000, sampleCount: 14400000 },
        trimmedMs: 0,
        sampleRateHz: 44100,
      },
    })
  })

  it('says the size could not vouch for an Engine repair when Engine keeps none', async () => {
    const scan = await scanDamage(
      [WAV],
      deps({
        readGenre: vi.fn(async () => null),
        engine: vi.fn(async () => [
          {
            ...engineDamage({
              kind: 'engine-cues',
              certainty: 'sure',
              trimmedMs: 0,
              sampleRateHz: 44100,
            }),
            fileBytes: null,
          },
        ]),
      }),
    )
    expect(scan.findings[0].evidence).toContainEqual({ key: 'damage.evidence.engineSizeUnknown' })
    expect(scan.findings[0].repair).toMatchObject({ fileBytes: null })
  })

  it.each([
    [true, 'sure', 'damage.evidence.engineCuesKept'],
    [false, 'likely', 'damage.evidence.engineCuesChanged'],
    [null, 'likely', 'damage.evidence.engineNoCopy'],
  ] as const)('says whether the cues were moved by hand (%s)', async (cuesKept, certainty, key) => {
    const scan = await scanDamage(
      [WAV],
      deps({
        readGenre: vi.fn(async () => null),
        engine: vi.fn(async () => [
          engineDamage({
            kind: 'engine-cues',
            certainty,
            trimmedMs: 0,
            sampleRateHz: 44100,
            cuesKept,
          }),
        ]),
      }),
    )
    expect(scan.findings[0].certainty).toBe(certainty)
    expect(scan.findings[0].evidence).toContainEqual({ key })
  })

  it('lists an Engine trim with no backup as a warning with nothing to stage', async () => {
    const scan = await scanDamage(
      [WAV],
      deps({
        readGenre: vi.fn(async () => null),
        engine: vi.fn(async () => [
          engineDamage({ kind: 'engine-cues', unrepairable: true, missingSec: 2.1 }),
        ]),
      }),
    )
    expect(scan.findings[0]).toMatchObject({
      repair: null,
      evidence: [{ key: 'damage.evidence.engineNoBackup', params: { sec: 2.1 } }],
    })
  })

  it('keeps the other findings and says which library it could not read', async () => {
    const scan = await scanDamage(
      [MP3],
      deps({ traktor: vi.fn(async () => Promise.reject(new Error('locked'))) }),
    )
    expect(scan.unread).toEqual(['traktor'])
    expect(scan.findings.map((f) => f.kind)).toEqual(['genre-number'])
  })
})
