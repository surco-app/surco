// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type {
  SourceNode,
  UsbPlan,
  UsbStartResult,
  UsbVolume,
  UsbVolumeList,
} from '../../../shared/types'
import i18n from '../i18n'
import { createUsbExportStore } from '../lib/usbExportStore'
import { stubApi } from '../test/api'
import { UsbExportModal } from './UsbExportModal'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)

const NODES: SourceNode[] = [
  {
    id: 'bases',
    name: 'BASES',
    kind: 'folder',
    count: 1,
    children: [{ id: 'mak', name: 'Makina', kind: 'playlist', count: 7 }],
  },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]
const vol = (over: Partial<UsbVolume>): UsbVolume => ({
  uuid: 'U1',
  name: 'Vicent',
  mountPoint: '/Volumes/Vicent',
  filesystem: 'fat32',
  partitionScheme: 'mbr',
  totalBytes: 32e9,
  freeBytes: 21e9,
  holder: { by: 'empty', at: null },
  remembered: null,
  stickPlaylists: null,
  ...over,
})
const REMEMBERED = { playlistIds: ['mak'], prune: false, settings: false, at: 1 }
const PLAN: UsbPlan = {
  tracks: [],
  trackCount: 7,
  newCount: 5,
  newBytes: 1.2e9,
  keptCount: 2,
  removedSinceLast: 1,
  warnings: [
    { kind: 'exfat' },
    { kind: 'cdj2000', titles: ['No Fear'] },
    {
      kind: 'unexportable',
      tracks: [
        { title: 'Gone', reason: 'missing-file' },
        { title: 'Streamed', reason: 'streaming' },
      ],
    },
  ],
}

let usbPlan = vi.fn<Api['usbPlan']>()
beforeEach(() => {
  usbPlan = vi.fn<Api['usbPlan']>(async () => ({ ok: true, plan: PLAN }))
  ;(window as unknown as { api: Api }).api = stubApi({
    usbPlan,
    usbPickFolder: async () => ({ path: '/Volumes/Vicent/sets', remembered: null }),
  })
})

async function show(
  list: UsbVolumeList | null,
  over: Partial<Parameters<typeof UsbExportModal>[0]> = {},
) {
  vi.useFakeTimers()
  const onStart = vi.fn(async (): Promise<UsbStartResult> => ({ ok: true }))
  const store = createUsbExportStore(() => 0)
  render(
    <UsbExportModal
      nodes={NODES}
      volumes={list}
      preselect={null}
      onStart={onStart}
      onCancelExport={() => {}}
      onClose={() => {}}
      store={store}
      {...over}
    />,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  vi.useRealTimers()
  return { onStart, store }
}

const withWarnings = (warnings: UsbPlan['warnings']) =>
  usbPlan.mockResolvedValue({ ok: true, plan: { ...PLAN, warnings } })

describe('UsbExportModal choosing', () => {
  it('asks to connect a USB when there is none', async () => {
    await show({ volumes: [], lastKey: null })
    expect(screen.getByTestId('usb-none')).toHaveTextContent('Conecta un USB')
  })

  // Two sticks both called "Vicent": each row is its own stick, picked by its identifier.
  it('lists each stick with its space, format and what it holds', async () => {
    await show({
      volumes: [
        vol({}),
        vol({
          uuid: 'U2',
          mountPoint: '/Volumes/Vicent 1',
          holder: { by: 'rekordbox', at: Date.now() },
        }),
      ],
      lastKey: null,
    })
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('Vicent')
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('FAT32')
    expect(screen.getByTestId('usb-volume-U2')).toHaveTextContent('exportado por rekordbox hoy')
  })

  // The second time is one press: the stick last used is chosen, its playlists ticked and
  // visible (their folder opens), its boxes as they were.
  it('preselects the last stick and ticks what it got last time', async () => {
    await show({
      volumes: [vol({}), vol({ uuid: 'U2', remembered: { ...REMEMBERED, settings: true } })],
      lastKey: 'volume:U2',
    })
    expect(screen.getByTestId('usb-volume-pick-U2')).toBeChecked()
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
    expect(screen.getByTestId('usb-settings')).toBeChecked()
    expect(usbPlan).toHaveBeenCalledWith({
      playlistIds: ['mak'],
      target: { kind: 'volume', uuid: 'U2' },
      prune: false,
      settings: true,
    })
  })

  // The connect notice opens the chooser on the stick it named, whatever was used last.
  it('preselects the stick it was opened for', async () => {
    await show(
      { volumes: [vol({}), vol({ uuid: 'U2' })], lastKey: 'volume:U1' },
      { preselect: 'U2' },
    )
    expect(screen.getByTestId('usb-volume-pick-U2')).toBeChecked()
    expect(screen.getByTestId('usb-volume-pick-U1')).not.toBeChecked()
  })

  // rekordbox may have synced more playlists to the stick since Surco last wrote it; leaving
  // them unticked would drop them from the stick on the next export.
  it("ticks what the stick's sync file lists over what Surco remembers", async () => {
    await show({
      volumes: [
        vol({
          stickPlaylists: ['mak'],
          remembered: { playlistIds: ['house'], prune: false, settings: true, at: 1 },
        }),
      ],
      lastKey: null,
    })
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
    expect(screen.getByTestId('check-node-house')).not.toBeChecked()
    expect(screen.getByTestId('usb-settings')).toBeChecked()
  })

  // The boxes are per stick and off by default: switching to a stick Surco never wrote must
  // not carry over "copy My Settings" or "delete music" from the previous one.
  it('starts a stick Surco never wrote with both boxes off', async () => {
    await show({
      volumes: [
        vol({ remembered: { ...REMEMBERED, prune: true, settings: true } }),
        vol({ uuid: 'U2' }),
      ],
      lastKey: 'volume:U1',
    })
    expect(screen.getByTestId('usb-settings')).toBeChecked()
    fireEvent.click(screen.getByTestId('usb-volume-pick-U2'))
    expect(screen.getByTestId('usb-settings')).not.toBeChecked()
    expect(screen.getByTestId('usb-prune')).not.toBeChecked()
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
  })

  it('falls back to what Surco remembers on a stick without a sync file', async () => {
    await show({ volumes: [vol({ stickPlaylists: null, remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
  })

  it('summarises, warns, and names each track that cannot go with its reason', async () => {
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    const s = screen.getByTestId('usb-summary')
    expect(s).toHaveTextContent('7 pistas')
    expect(s).toHaveTextContent('5 nuevas')
    expect(s).toHaveTextContent('2 ya están')
    expect(s).toHaveTextContent('1 quitada desde la última vez')
    expect(screen.getByTestId('usb-warning-exfat')).toBeInTheDocument()
    expect(screen.getByTestId('usb-warning-cdj2000')).toHaveTextContent('No Fear')
    expect(screen.getByTestId('usb-warning-unexportable')).toHaveTextContent(
      '2 pistas no se pueden exportar',
    )
    expect(screen.getByTestId('usb-warning-unexportable')).toHaveTextContent(
      'Gone · no se encuentra el fichero',
    )
  })

  it('cannot export what does not fit, and says how much is needed and free', async () => {
    withWarnings([{ kind: 'noSpace', neededBytes: 3.1 * 1024 ** 3, freeBytes: 1.7 * 1024 ** 3 }])
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-export')).toBeDisabled()
    expect(screen.getByTestId('usb-warning-noSpace')).toHaveTextContent(
      'Hace falta 3,10 GB y hay 1,70 GB libres',
    )
  })

  // The summary works with rekordbox open; the export will ask to close it, so it is said
  // up front without blocking.
  it('shows the new notices', async () => {
    withWarnings([
      { kind: 'rekordboxOpen' },
      { kind: 'sourcesUnreachable', volume: 'Public', tracks: 7 },
      { kind: 'emptyPlaylist', names: ['Makina'] },
    ])
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-warning-rekordboxOpen')).toHaveTextContent(
      'rekordbox está abierto',
    )
    expect(screen.getByTestId('usb-warning-sourcesUnreachable')).toHaveTextContent(
      'No se encuentra Public, donde está la música de 7 pistas',
    )
    expect(screen.getByTestId('usb-warning-emptyPlaylist')).toHaveTextContent(
      'No se encuentra ninguna pista de Makina',
    )
  })

  // Main refuses both anyway; offering Exportar would only lead to that refusal.
  it('disables Exportar while the music is not reachable or a playlist would be empty', async () => {
    withWarnings([{ kind: 'rekordboxOpen' }])
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-export')).toBeEnabled()
    cleanup()
    withWarnings([{ kind: 'sourcesUnreachable', volume: 'Public', tracks: 7 }])
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-export')).toBeDisabled()
    cleanup()
    withWarnings([{ kind: 'emptyPlaylist', names: ['Makina'] }])
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-export')).toBeDisabled()
  })

  // Deleting music and copying settings are opt-in, both sent only when ticked.
  it('exports with both boxes off unless ticked', async () => {
    const { onStart } = await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-prune')).not.toBeChecked()
    expect(screen.getByTestId('usb-settings')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(onStart).toHaveBeenCalledWith({
      playlistIds: ['mak'],
      target: { kind: 'volume', uuid: 'U1' },
      prune: false,
      settings: false,
    })
  })

  // A double click before the first answer must not ask twice.
  it('disables Exportar while the export is starting', async () => {
    let finish: (r: UsbStartResult) => void = () => {}
    const onStart = vi.fn(
      () =>
        new Promise<UsbStartResult>((r) => {
          finish = r
        }),
    )
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null }, { onStart })
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(screen.getByTestId('usb-export')).toBeDisabled()
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(onStart).toHaveBeenCalledTimes(1)
    await act(async () =>
      finish({ ok: false, reason: 'no-space', neededBytes: 2 * 1024 ** 3, freeBytes: 1024 ** 3 }),
    )
    expect(screen.getByTestId('usb-start-error')).toHaveTextContent(
      'Hace falta 2,00 GB y hay 1,00 GB libres',
    )
    expect(screen.getByTestId('usb-export')).toBeEnabled()
  })

  // Between main accepting the export and its first event the chooser is still on screen;
  // a second press there would only be refused as busy.
  it('keeps Exportar disabled once the export is accepted, until the progress shows', async () => {
    const { onStart } = await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    await act(async () => {
      fireEvent.click(screen.getByTestId('usb-export'))
    })
    expect(screen.getByTestId('usb-export')).toBeDisabled()
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  // A plan that fails outright (IPC rejected) must not leave "Calculando…" forever.
  it('says the summary could not be worked out when asking for it fails', async () => {
    usbPlan.mockRejectedValue(new Error('ipc'))
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-summary')).toHaveTextContent('No se pudo calcular el resumen')
    expect(screen.getByTestId('usb-export')).toBeDisabled()
  })

  // A playlist deleted in rekordbox can still be listed in the stick's sync file or in
  // Surco's memory; ticked but absent from the tree, it would be invisible yet sent.
  it('drops ticks for playlists no longer in the tree', async () => {
    await show({
      volumes: [vol({ stickPlaylists: ['mak', 'gone'] })],
      lastKey: null,
    })
    expect(usbPlan).toHaveBeenLastCalledWith(expect.objectContaining({ playlistIds: ['mak'] }))
  })

  // A folder picked by hand is never pruned, so the box is not offered for it.
  it('hides the prune box for a folder destination', async () => {
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    await act(async () => {
      fireEvent.click(screen.getByTestId('usb-other'))
    })
    expect(screen.queryByTestId('usb-prune')).toBeNull()
  })

  it('shows the progress list once an export runs', async () => {
    const { store } = await show({ volumes: [vol({})], lastKey: null })
    act(() => store.dispatch({ type: 'started', tracks: [], targetName: 'Vicent', startedAt: 0 }))
    expect(screen.getByTestId('usb-rows')).toBeInTheDocument()
    expect(screen.queryByTestId('usb-summary')).toBeNull()
  })

  // Each of these leaves the stick as it was or half known to rekordbox; the user must be
  // told in words, not a raw code.
  it('says rekordbox stayed open, the music went away mid-run, and the sync files could not be written', async () => {
    const onStart = vi.fn(
      async (): Promise<UsbStartResult> => ({ ok: false, reason: 'rekordbox-open' }),
    )
    const { store } = await show(
      { volumes: [vol({ remembered: REMEMBERED })], lastKey: null },
      {
        onStart,
      },
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('usb-export'))
    })
    expect(screen.getByTestId('usb-start-error')).toHaveTextContent('rekordbox sigue abierto')
    act(() => {
      store.dispatch({ type: 'started', tracks: [], targetName: 'Vicent', startedAt: 0 })
      store.dispatch({ type: 'finished', outcome: 'error', reason: 'source-lost' })
    })
    expect(screen.getByTestId('usb-error')).toHaveTextContent(
      'Se desmontó el disco de la música a mitad',
    )
    act(() => {
      store.dispatch({ type: 'started', tracks: [], targetName: 'Vicent', startedAt: 0 })
      store.dispatch({
        type: 'finished',
        outcome: 'done',
        tracks: 7,
        failed: 0,
        ms: 1000,
        syncFiles: false,
      })
    })
    expect(screen.getByTestId('usb-sync-files')).toHaveTextContent(
      'rekordbox puede no reconocer sus playlists',
    )
  })
})

describe('UsbExportModal for Engine DJ', () => {
  const engineVol = (over: Partial<UsbVolume>, engine: UsbVolume['engine']): UsbVolume =>
    vol({ ...over, engine })

  it('asks main for an Engine DJ export and offers none of the rekordbox options, which a Denon player never reads', async () => {
    await show(
      {
        volumes: [engineVol({}, { holder: { by: 'surco', at: 1 }, remembered: REMEMBERED })],
        lastKey: null,
      },
      { source: 'engine' },
    )
    expect(usbPlan).toHaveBeenCalledWith({
      playlistIds: ['mak'],
      target: { kind: 'volume', uuid: 'U1' },
      prune: false,
      settings: false,
      source: 'engine',
    })
    expect(screen.queryByTestId('usb-settings')).toBeNull()
    expect(screen.queryByTestId('usb-prune')).toBeNull()
  })

  it('ticks what Surco last exported to the drive for Engine DJ, not what rekordbox keeps there', async () => {
    await show(
      {
        volumes: [
          engineVol(
            {
              stickPlaylists: ['house'],
              remembered: { ...REMEMBERED, playlistIds: ['house'] },
            },
            { holder: { by: 'surco', at: 1 }, remembered: REMEMBERED },
          ),
        ],
        lastKey: null,
      },
      { source: 'engine' },
    )
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
    expect(screen.getByTestId('check-node-house')).not.toBeChecked()
  })

  it('says who wrote the Engine Library on each drive', async () => {
    await show(
      {
        volumes: [
          engineVol(
            { holder: { by: 'rekordbox', at: Date.now() } },
            { holder: { by: 'surco', at: Date.now() }, remembered: null },
          ),
        ],
        lastKey: null,
      },
      { source: 'engine' },
    )
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('exportado por Surco hoy')
    expect(screen.getByTestId('usb-volume-U1')).not.toHaveTextContent('rekordbox')
  })

  it('preselects the drive it last exported to for Engine DJ, whatever rekordbox used last', async () => {
    await show(
      {
        volumes: [
          engineVol({}, { holder: { by: 'surco', at: 5 }, remembered: { ...REMEMBERED, at: 5 } }),
          engineVol(
            { uuid: 'U2' },
            { holder: { by: 'surco', at: 9 }, remembered: { ...REMEMBERED, at: 9 } },
          ),
        ],
        lastKey: 'volume:U1',
      },
      { source: 'engine' },
    )
    expect(screen.getByTestId('usb-volume-pick-U2')).toBeChecked()
  })

  it('asks for the folder with what Surco remembers for Engine DJ there', async () => {
    const usbPickFolder = vi.fn<Api['usbPickFolder']>(async () => null)
    ;(window as unknown as { api: Api }).api = stubApi({ usbPlan, usbPickFolder })
    await show({ volumes: [vol({})], lastKey: null }, { source: 'engine' })
    await act(async () => {
      fireEvent.click(screen.getByTestId('usb-other'))
    })
    expect(usbPickFolder).toHaveBeenCalledWith('engine')
  })

  it('warns that Engine DJ is open', async () => {
    withWarnings([{ kind: 'engineOpen' }])
    await show(
      {
        volumes: [engineVol({}, { holder: { by: 'empty', at: null }, remembered: REMEMBERED })],
        lastKey: null,
      },
      { source: 'engine' },
    )
    expect(screen.getByTestId('usb-warning-engineOpen')).toHaveTextContent(
      'Engine DJ está abierto. Se te pedirá cerrarlo al exportar.',
    )
  })
})
