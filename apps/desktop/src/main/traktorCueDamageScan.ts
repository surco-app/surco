import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { automaticCueOffsetOfFiles } from './cueCalibration'
import { readCueTree } from './tags'
import { readTraktorMarkers } from './traktor4'
import { type CueMark, judgeTraktorPair, type TraktorJudgement } from './traktorCueDamage'
import { traktorCueElements } from './traktorCues'
import { attr, entryStates, findEntries, type NmlEntry } from './traktorNml'
import { bootVolumeName } from './traktorNmlLibrary'
import { traktorFileOf } from './traktorPlaylists'

export interface TraktorDamage {
  path: string
  judgement: TraktorJudgement
  sibling: string
  before: CueMark[]
  tree?: CueMark[]
  entry?: { volume: string; dir: string; file: string; entryState: string }
}

interface ScanDeps {
  bootVolume?: string
  exists?: (p: string) => boolean
  readdir?: (dir: string) => string[]
}

const GRID_TYPE = 4
const SIBLING_EXTS = ['.aiff', '.aif', '.flac', '.wav']

const nfc = (s: string) => s.normalize('NFC')
const stemOf = (p: string) => nfc(basename(p, extname(p)))
const extOf = (p: string) => extname(p).toLowerCase()

function entryMarks(block: string): CueMark[] {
  return traktorCueElements(block)
    .map(({ element }) => ({
      type: Number(attr(element, 'TYPE')),
      hotcue: Number(attr(element, 'HOTCUE') || '-1'),
      ms: Number(attr(element, 'START')),
    }))
    .filter((c) => c.type !== GRID_TYPE)
}

function treeMarks(file: string): CueMark[] | null {
  const tree = readCueTree(file)
  const marks = tree
    ? readTraktorMarkers(tree)
        .filter((m) => m.type !== GRID_TYPE)
        .map((m) => ({ type: m.type, hotcue: m.hotcue, ms: m.startMs }))
    : []
  return marks.length > 0 ? marks : null
}

interface Located extends NmlEntry {
  path: string
  block: string
}

export async function scanTraktorDamage(
  paths: string[],
  nmlPath: string,
  deps: ScanDeps = {},
): Promise<TraktorDamage[]> {
  const nml = await readFile(nmlPath, 'utf8')
  const boot = deps.bootVolume ?? bootVolumeName()
  const exists = deps.exists ?? existsSync
  const readdir =
    deps.readdir ??
    ((dir: string) => {
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    })
  const located: Located[] = findEntries(nml).map((e) => {
    const block = nml.slice(e.start, e.end)
    return { ...e, block, path: nfc(traktorFileOf(block, boot)) }
  })
  const entriesAt = (p: string) => located.filter((e) => e.path === nfc(p))

  const namesakes = (p: string, exts: string[]): string[] => {
    const stem = stemOf(p)
    const found = new Map<string, string>()
    const consider = (candidate: string) => {
      if (stemOf(candidate) === stem && exts.includes(extOf(candidate)) && exists(candidate))
        found.set(nfc(candidate), candidate)
    }
    for (const e of located) consider(e.path)
    for (const name of readdir(dirname(p))) consider(join(dirname(p), name))
    return [...found.values()]
  }

  const sources = new Map<string, string>()
  for (const p of paths) {
    const candidates =
      extOf(p) === '.mp3' ? [p] : SIBLING_EXTS.includes(extOf(p)) ? namesakes(p, ['.mp3']) : []
    if (candidates.length === 1) sources.set(nfc(candidates[0]), candidates[0])
  }

  const out: TraktorDamage[] = []
  for (const source of sources.values()) {
    const siblings = namesakes(source, SIBLING_EXTS)
    if (siblings.length !== 1) continue
    const [sibling] = siblings
    const [sourceEntries, siblingEntries] = [entriesAt(source), entriesAt(sibling)]
    const sourceEntry = sourceEntries.length === 1 ? sourceEntries[0] : null
    const siblingEntry = siblingEntries.length === 1 ? siblingEntries[0] : null
    const marks = {
      sourceEntry: sourceEntry && entryMarks(sourceEntry.block),
      siblingEntry: siblingEntry && entryMarks(siblingEntry.block),
      sourceTree: treeMarks(source),
      siblingTree: treeMarks(sibling),
    }
    const judgements = judgeTraktorPair({
      ...marks,
      k: await automaticCueOffsetOfFiles(source, sibling),
      sourceOnBootDisk:
        sourceEntry !== null && (sourceEntry.volume === boot || sourceEntry.volume === ''),
    })
    for (const judgement of judgements) {
      const onSource = judgement.fixEntry === 'source'
      const fixed = onSource ? sourceEntry : siblingEntry
      const state =
        fixed &&
        entryStates(nml, [{ volume: fixed.volume, dir: fixed.dir, file: fixed.file }], boot)[0]
      out.push({
        path: onSource ? source : sibling,
        judgement,
        sibling: onSource ? sibling : source,
        before: (onSource ? marks.sourceEntry : (marks.siblingEntry ?? marks.siblingTree)) ?? [],
        ...(judgement.fixTree && marks.siblingTree ? { tree: marks.siblingTree } : {}),
        ...(fixed && state
          ? { entry: { volume: fixed.volume, dir: fixed.dir, file: fixed.file, entryState: state } }
          : {}),
      })
    }
  }
  return out
}
