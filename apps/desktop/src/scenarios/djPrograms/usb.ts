import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { vi } from 'vitest'
import { engineCueSource } from '../../main/engineCueSource'
import { engineRead } from '../../main/enginePlaylistsIpc'
import { ENGINE_USB_FOLDER } from '../../main/engineUsbExport'
import { getSettings } from '../../main/settings'
import { bootVolumeName } from '../../main/traktorNmlLibrary'
import { registerUsbExportIpc } from '../../main/usbExportIpc'
import type { UsbProgram } from '../../shared/djProgram'
import type {
  SourceNode,
  SourcePlaylistEntry,
  TrackCues,
  UsbExportEvent,
  UsbExportRequest,
  UsbPlanResult,
  UsbStartResult,
  UsbVolume,
} from '../../shared/types'
import { invokeMain, seratoRoots, virtualdjRoots } from '../harness'

export interface StickTrack {
  file: string
  title: string
  cuesMs: number[]
}

export interface StickList {
  name: string
  tracks: StickTrack[]
}

export const STAGED_XML = 'staged-collection.xml'

const FAKE_BAKEN = `
const { copyFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const xml = args[1]
const device = args[args.indexOf('--device') + 1]
copyFileSync(xml, join(device, ${JSON.stringify(STAGED_XML)}))
const text = readFileSync(xml, 'utf8')
const collection = text.slice(0, text.indexOf('<PLAYLISTS'))
const tracks = [...collection.matchAll(/<TRACK TrackID="(\\d+)"/g)].map((m) => ({
  id: Number(m[1]),
  usbPath: '/Contents/' + m[1],
  size: 1,
  onStick: false,
}))
console.log(JSON.stringify({
  event: 'plan',
  volumeRoot: true,
  tracks,
  spaceNeeded: tracks.length,
  spaceAvailable: null,
  warnings: [],
  skipped: [],
  onelibraryFiles: [],
}))
`

export function stickVolume(mountPoint: string): UsbVolume {
  return {
    uuid: 'BATTERY-STICK',
    name: 'BATERIA',
    mountPoint,
    filesystem: 'fat32',
    partitionScheme: 'mbr',
    totalBytes: 8 * 1024 ** 3,
    freeBytes: 8 * 1024 ** 3,
    holder: { by: 'empty', at: null },
    remembered: null,
    stickPlaylists: null,
  }
}

export function registerUsb(root: string): void {
  const script = join(root, 'fake-baken.cjs')
  writeFileSync(script, FAKE_BAKEN)
  registerUsbExportIpc({
    collection: () => getSettings().rekordboxDbPath,
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    appData: app.getPath('appData'),
    baken: () => ({ file: process.execPath, prefixArgs: [script] }),
    ensureClosed: async () => true,
    engineLibrary: () => getSettings().engineLibraryDir,
    serato: { roots: seratoRoots },
    traktor: { nml: () => getSettings().traktorNmlPath, bootVolume: bootVolumeName },
    virtualdj: { roots: virtualdjRoots },
  })
}

const attr = (tag: string, name: string): string =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ''

const unescapeXml = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function pioneerList(stick: string, name: string): StickList | null {
  const xml = readFileSync(join(stick, STAGED_XML), 'utf8')
  const byId = new Map<string, StickTrack>()
  for (const [, head, body] of xml.matchAll(/<TRACK (TrackID="[^>]*)>([\s\S]*?)<\/TRACK>/g)) {
    const location = unescapeXml(attr(` ${head}`, 'Location')).replace(
      'file://localhost',
      'file://',
    )
    byId.set(attr(` ${head}`, 'TrackID'), {
      file: basename(fileURLToPath(location)),
      title: unescapeXml(attr(` ${head}`, 'Name')),
      cuesMs: [...body.matchAll(/<POSITION_MARK [^>]*>/g)].map((m) =>
        Math.round(Number(attr(` ${m[0].slice(1)}`, 'Start')) * 1000),
      ),
    })
  }
  const node = [...xml.matchAll(/<NODE ([^>]*Type="1"[^>]*)>([\s\S]*?)<\/NODE>/g)].find(
    ([, head]) => unescapeXml(attr(` ${head}`, 'Name')) === name,
  )
  if (!node) return null
  const ids = [...node[2].matchAll(/<TRACK Key="([^"]*)"/g)].map((m) => m[1])
  return { name, tracks: ids.flatMap((id) => byId.get(id) ?? []) }
}

const flat = (nodes: SourceNode[]): SourceNode[] =>
  nodes.flatMap((n) => [n, ...flat(n.children ?? [])])

async function engineList(stick: string, name: string): Promise<StickList | null> {
  const dir = join(stick, ENGINE_USB_FOLDER)
  const read = engineRead(() => dir, { artDir: () => app.getPath('userData') })
  const node = flat(await read.tree()).find((n) => n.name === name)
  if (!node) return null
  const none = async () => null
  const cues = engineCueSource(
    {
      libraryDir: () => dir,
      queue: { enqueue: () => {}, cuesOp: () => undefined, drop: () => {} },
      applyQuietly: () => {},
      words: none,
    },
    () => '',
    none,
  )
  const entries: SourcePlaylistEntry[] = await read.playlist(node.id)
  return {
    name,
    tracks: await Promise.all(
      entries.map(async (e) => {
        const read: TrackCues | null = e.contentId ? await cues.trackCues(e.contentId) : null
        return {
          file: basename(e.path ?? ''),
          title: e.preview?.title ?? '',
          cuesMs: (read?.cues ?? []).map((c) => c.ms),
        }
      }),
    ),
  }
}

export type StickFormat = 'pioneer' | 'engine'

export const STICK_FORMAT: Record<UsbProgram, StickFormat> = {
  rekordbox: 'pioneer',
  traktor: 'pioneer',
  engine: 'engine',
  serato: 'pioneer',
  virtualdj: 'pioneer',
}

export interface Stick {
  write: (request: UsbExportRequest) => Promise<string[]>
  read: (stick: string, name: string) => Promise<StickList | null>
}

export function sticks(events: UsbExportEvent[]): Record<StickFormat, Stick> {
  return {
    pioneer: {
      write: async (request) => {
        const planned = await invokeMain<UsbPlanResult>('usb:plan', request)
        if (!planned.ok) throw new Error(`usb plan refused: ${planned.reason}`)
        return planned.plan.warnings.flatMap((w) => (w.kind === 'cuesLeftOut' ? w.titles : []))
      },
      read: async (stick, name) => pioneerList(stick, name),
    },
    engine: {
      write: async (request) => {
        const from = events.length
        const started = await invokeMain<UsbStartResult>('usb:export', request)
        if (!started.ok) throw new Error(`usb export refused: ${started.reason}`)
        await vi.waitFor(
          () => {
            const done = events.slice(from).find((e) => e.type === 'finished')
            if (!done) throw new Error('usb export still running')
            if (done.outcome !== 'done') throw new Error(`usb export ${JSON.stringify(done)}`)
          },
          { timeout: 20_000 },
        )
        return []
      },
      read: engineList,
    },
  }
}
