import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, posix } from 'node:path'
import { beatGrid, maskVocals, wavePreview } from './anlz'
import { buildBakenXml, type XmlTrackFacts } from './bakenXml'
import type { MasterIdentity } from './rekordboxStickSync'
import type { ExportSelection } from './usbExportSource'

// The folder baken works from, so that baken never looks into ~/Library/Pioneer itself and
// nothing there is ever written: the XML, a copy of rekordbox's analysis for the selected
// tracks only (with the vocal section masked as rekordbox's export does), the artwork named
// by TrackID for --artwork-dir, a copy of the My Settings, and the collection's identity
// for --master-ids. Staged fresh each time: a cache would let analysis of unselected tracks
// into baken's filename matching.

export interface Stage {
  dir: string
  xml: string
  anlzDir: string
  artworkDir: string
  settingsDir: string | null
  included: string[]
  missing: string[]
  sizes: Map<string, number>
  waves: Map<string, number[]>
  covers: Map<string, string>
  masterIds: string | null
}

export interface StageInput {
  sel: ExportSelection
  shareDir: string
  settingsSource: string | null
  dir: string
  identity: MasterIdentity | null
  deviceIds: ReadonlyMap<string, number>
  // The names already in the stick's PIONEER/: baken's settings copy overwrites whatever it
  // is given, so a DEVSETTING.DAT listed here is never staged.
  stickHas: string[]
}

const REQUIRED_SETTINGS = ['MYSETTING.DAT', 'MYSETTING2.DAT', 'DJMMYSETTING.DAT']
const OPTIONAL_SETTINGS = ['DEVSETTING.DAT', 'djprofile.nxs']
const isPmai = (bytes: Buffer): boolean =>
  bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'PMAI'
const ANLZ_ROOT = '/PIONEER/USBANLZ/'

// rekordbox keeps an 80 px thumbnail beside each cover with _s before the extension
// (docs/export-usb-medidas.md); the list shows that one, never the full picture.
export function smallCoverPath(imagePath: string): string {
  const ext = extname(imagePath)
  return `${imagePath.slice(0, imagePath.length - ext.length)}_s${ext}`
}

const sizeOf = async (path: string): Promise<number | null> =>
  stat(path)
    .then((s) => (s.isFile() ? s.size : null))
    .catch(() => null)
const read = async (path: string): Promise<Buffer | null> => readFile(path).catch(() => null)

async function stageSettings(
  source: string | null,
  dir: string,
  keepStickDevSetting: boolean,
): Promise<string | null> {
  if (!source) return null
  const files = await Promise.all(REQUIRED_SETTINGS.map((f) => sizeOf(join(source, f))))
  if (files.some((s) => s === null)) return null
  await mkdir(dir, { recursive: true })
  const optional = keepStickDevSetting
    ? OPTIONAL_SETTINGS.filter((f) => f !== 'DEVSETTING.DAT')
    : OPTIONAL_SETTINGS
  for (const f of [...REQUIRED_SETTINGS, ...optional])
    await copyFile(join(source, f), join(dir, f)).catch(() => undefined)
  return dir
}

export async function stageExport(input: StageInput): Promise<Stage> {
  const { sel, shareDir, dir } = input
  const anlzDir = join(dir, 'USBANLZ')
  const artworkDir = join(dir, 'artwork')
  await mkdir(anlzDir, { recursive: true })
  await mkdir(artworkDir, { recursive: true })
  const facts = new Map<string, XmlTrackFacts>()
  const missing: string[] = []
  const waves = new Map<string, number[]>()
  const covers = new Map<string, string>()
  for (const t of sel.tracks) {
    if (t.streaming) continue
    const size = await sizeOf(t.path)
    if (size === null) {
      missing.push(t.id)
      continue
    }
    let grid: XmlTrackFacts['grid'] = []
    const analysisPath = posix.normalize(t.analysisPath)
    try {
      if (analysisPath.startsWith(ANLZ_ROOT)) {
        const rel = analysisPath.slice(ANLZ_ROOT.length)
        for (const ext of ['DAT', 'EXT', '2EX']) {
          const name = rel.replace(/\.DAT$/, `.${ext}`)
          const bytes = await read(join(shareDir, ANLZ_ROOT, name))
          if (!bytes) continue
          await mkdir(dirname(join(anlzDir, name)), { recursive: true })
          await writeFile(
            join(anlzDir, name),
            ext === '2EX' && isPmai(bytes) ? maskVocals(bytes) : bytes,
          )
          if (ext === 'DAT') {
            grid = beatGrid(bytes)
            const wave = wavePreview(bytes)
            if (wave) waves.set(t.id, wave)
          }
        }
      }
    } catch {
      grid = []
      waves.delete(t.id)
    }
    if (t.imagePath) {
      const cover = await read(join(shareDir, t.imagePath))
      if (cover)
        await writeFile(join(artworkDir, `${t.id}${extname(t.imagePath).toLowerCase()}`), cover)
      const small = await read(join(shareDir, smallCoverPath(t.imagePath)))
      if (small) covers.set(t.id, `data:image/jpeg;base64,${small.toString('base64')}`)
    }
    facts.set(t.id, { size, grid })
  }
  const xml = join(dir, 'collection.xml')
  await writeFile(xml, buildBakenXml(sel, facts, process.platform, input.deviceIds))
  const masterIds = input.identity ? join(dir, 'master-ids.json') : null
  if (masterIds) await writeFile(masterIds, JSON.stringify(input.identity))
  return {
    dir,
    xml,
    anlzDir,
    artworkDir,
    settingsDir: await stageSettings(
      input.settingsSource,
      join(dir, 'settings'),
      // FAT32 and exFAT ignore case: devsetting.dat is the same file.
      input.stickHas.some((n) => n.toUpperCase() === 'DEVSETTING.DAT'),
    ),
    included: [...facts.keys()],
    missing,
    sizes: new Map([...facts].map(([id, f]) => [id, f.size])),
    waves,
    covers,
    masterIds,
  }
}
