import { basename, extname } from 'node:path'
import { Genres } from 'node-taglib-sharp'
import type { DamageFinding, DamageNote, DamageScan } from '../shared/types'
import type { EngineDamage } from './engineDamage'
import { engineLengthOf } from './engineRepoint'
import { type GenreSource, judgeGenre } from './genreDamage'
import type { LibraryGenre } from './libraryFileUse'
import type { TraktorDamage } from './traktorCueDamageScan'

export interface DamageScanDeps {
  isAllowed: (path: string) => boolean
  readGenre: (path: string) => Promise<{ raw: string; info?: string } | null>
  libraryGenres: (paths: string[]) => Promise<Record<string, LibraryGenre[]>>
  traktor?: (paths: string[]) => Promise<TraktorDamage[]>
  engine?: (paths: string[]) => Promise<EngineDamage[]>
}

const GENRE_EXTS = ['.mp3', '.aiff', '.aif', '.wav']
const LIBRARY_NAMES: Record<Exclude<GenreSource, 'info'>, string> = {
  rekordbox: 'rekordbox',
  traktor: 'Traktor',
  engine: 'Engine DJ',
}

const sec = (ms: number) => Math.round(ms * 100) / 100000
const abs = (ms: number) => Math.round(Math.abs(ms) * 100) / 100
const idOf = (kind: string, path: string) => `${kind}\0${path}`

async function genreFindings(paths: string[], deps: DamageScanDeps): Promise<DamageFinding[]> {
  const id3 = paths.filter((p) => GENRE_EXTS.includes(extname(p).toLowerCase()))
  const frames = await Promise.all(id3.map((p) => deps.readGenre(p).catch(() => null)))
  const damaged = id3.filter((_, i) => frames[i] !== null)
  if (damaged.length === 0) return []
  const libraries = await deps
    .libraryGenres(damaged)
    .catch(() => ({}) as Record<string, LibraryGenre[]>)
  return id3.flatMap((path, i): DamageFinding[] => {
    const frame = frames[i]
    if (!frame) return []
    const evidence = [
      ...(libraries[path] ?? []),
      ...(frame.info ? [{ source: 'info' as const, value: frame.info }] : []),
    ]
    const j = judgeGenre(frame.raw, evidence)
    if (!j) return []
    const number = /^\((\d+)\)/.exec(frame.raw)?.[1]
    const notes: DamageNote[] =
      j.source === 'info'
        ? [{ key: 'damage.evidence.infoKept', params: { value: j.options[0] } }]
        : j.source
          ? [
              {
                key: 'damage.evidence.libraryKept',
                params: { library: LIBRARY_NAMES[j.source], value: j.options[0] },
              },
            ]
          : [
              number && j.kind === 'genre-number'
                ? {
                    key: 'damage.evidence.id3v1Number',
                    params: { number: Number(number), name: Genres.AUDIO_GENRES[Number(number)] },
                  }
                : { key: 'damage.evidence.doubledParens' },
              { key: 'damage.evidence.maybeLegacy' },
            ]
    return [
      {
        id: idOf(j.kind, path),
        kind: j.kind,
        path,
        certainty: j.certainty,
        evidence: notes,
        before: { key: 'damage.value.text', params: { value: frame.raw } },
        options: j.options,
        repair: { target: 'genre', path, from: frame.raw, to: j.options[0] },
      },
    ]
  })
}

function traktorFinding(d: TraktorDamage): DamageFinding {
  const { judgement: j } = d
  const first = d.before[0]?.ms ?? 0
  const evidence: DamageNote[] =
    j.kind === 'traktor-calibration'
      ? [
          {
            key: 'damage.evidence.traktorOldRule',
            params: { file: basename(d.path), ms: abs(j.addMs) },
          },
        ]
      : j.certainty === 'sure'
        ? [
            {
              key: 'damage.evidence.traktorTree',
              params: {
                fileSec: sec(first + j.addMs),
                entrySec: sec(first),
                sibling: basename(d.sibling),
              },
            },
          ]
        : [
            {
              key: 'damage.evidence.traktorTookSibling',
              params: { sibling: basename(d.sibling), ms: abs(j.addMs) },
            },
          ]
  const treeFile = j.fixTree ? d.path : undefined
  return {
    id: idOf(j.kind, d.path),
    kind: j.kind,
    path: d.path,
    certainty: j.certainty,
    evidence,
    before: { key: 'damage.value.cueAt', params: { sec: sec(first) } },
    after: { key: 'damage.value.cueAt', params: { sec: sec(first + j.addMs) } },
    options: [],
    repair:
      d.entry || treeFile
        ? {
            target: 'traktor',
            path: d.path,
            addMs: j.addMs,
            ...(d.entry ? { entry: d.entry } : {}),
            ...(treeFile ? { treeFile, treeMs: (d.tree ?? []).map((c) => c.ms) } : {}),
          }
        : null,
  }
}

function engineFinding(d: EngineDamage): DamageFinding {
  const { judgement: j, trackData } = d
  const engineSec = Math.round((trackData.sampleCount / trackData.sampleRate) * 1000) / 1000
  const analysis = (khz: number, s: number): DamageNote => ({
    key: 'damage.value.engineAnalysis',
    params: { khz, sec: Math.round(s * 1000) / 1000 },
  })
  const base = { id: idOf(j.kind, d.path), kind: j.kind, path: d.path, options: [] }
  if ('unrepairable' in j)
    return {
      ...base,
      certainty: 'sure',
      evidence: [{ key: 'damage.evidence.engineNoBackup', params: { sec: j.missingSec } }],
      before: analysis(trackData.sampleRate / 1000, engineSec),
      repair: null,
    }
  const repair = {
    target: 'engine' as const,
    path: d.path,
    fileBytes: d.fileBytes,
    expectTrackData: trackData,
    trimmedMs: j.trimmedMs,
    ...(j.sampleRateHz ? { sampleRateHz: j.sampleRateHz } : {}),
  }
  const sizeUnknown: DamageNote[] =
    d.fileBytes === null ? [{ key: 'damage.evidence.engineSizeUnknown' }] : []
  if (j.kind === 'engine-length') {
    const length = engineLengthOf(trackData.sampleCount, trackData.sampleRate)
    return {
      ...base,
      certainty: 'sure',
      evidence: [
        { key: 'damage.evidence.engineLength', params: { length: d.length, sec: length } },
        ...sizeUnknown,
      ],
      before: { key: 'damage.value.seconds', params: { sec: d.length } },
      after: { key: 'damage.value.seconds', params: { sec: length } },
      repair,
    }
  }
  const evidence: DamageNote[] = [
    ...(j.backup
      ? [
          {
            key: 'damage.evidence.engineBackup',
            params: { date: j.backup.trashedAt, sec: sec(j.trimmedMs) },
          },
        ]
      : []),
    ...(j.sampleRateHz
      ? [
          {
            key: 'damage.evidence.engineRate',
            params: { engineKhz: trackData.sampleRate / 1000, fileKhz: j.sampleRateHz / 1000 },
          },
        ]
      : []),
    ...sizeUnknown,
  ]
  return {
    ...base,
    certainty: 'sure',
    evidence,
    before: analysis(trackData.sampleRate / 1000, engineSec),
    after: analysis(
      (j.sampleRateHz ?? trackData.sampleRate) / 1000,
      engineSec - j.trimmedMs / 1000,
    ),
    repair,
  }
}

export async function scanDamage(paths: string[], deps: DamageScanDeps): Promise<DamageScan> {
  const allowed = paths.filter((p) => deps.isAllowed(p))
  const unread: DamageScan['unread'] = []
  const library = async <T>(
    name: 'traktor' | 'engine',
    scan: ((paths: string[]) => Promise<T[]>) | undefined,
  ): Promise<T[]> => {
    if (!scan || allowed.length === 0) return []
    try {
      return await scan(allowed)
    } catch {
      unread.push(name)
      return []
    }
  }
  const [genres, traktor, engine] = await Promise.all([
    genreFindings(allowed, deps),
    library('traktor', deps.traktor),
    library('engine', deps.engine),
  ])
  return {
    findings: [...genres, ...traktor.map(traktorFinding), ...engine.map(engineFinding)],
    unread: unread.sort(),
  }
}
