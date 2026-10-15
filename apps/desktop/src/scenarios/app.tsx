import { QueryClientProvider } from '@tanstack/react-query'
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import { loadLastSession, saveLastSession } from '../main/session'
import {
  getSettings,
  sanitizeSettingsPatch,
  saveSettings,
  settingsForRenderer,
} from '../main/settings'
import type { Api } from '../preload/api'
import { createQueryClient } from '../renderer/src/lib/queryClient'
import type { Release } from '../shared/types'
import { bootMain, closeMain, invokeMain, listen, type ScenarioOptions } from './harness'

// The whole app, not its hooks: <App/> rendered over the same real main the hook-level
// harness drives, so a scenario clicks the UI and nothing between the editor and the
// conversion is re-wired by hand. Only what a window and Electron provide is stubbed:
// menus, updates, dock, dialogs, the clipboard and the browser APIs jsdom lacks. It mounts
// on its own root rather than through render(), which the suite unmounts after every test:
// one app stays up across a scenario's steps the way it does for a user, and close()
// takes it down before the file's jsdom goes.
export interface AppScenario {
  drop: (...paths: string[]) => Promise<void>
  select: (title: string) => Promise<void>
  convertAll: () => Promise<void>
  errors: string[]
  close: () => void
}

// The releases a search finds, standing in for Discogs: every query lists them all, the way
// a search for the record a DJ is holding lists its pressings, and the DJ picks one.
function catalogApi(catalog: Release[]): Partial<Api> {
  return {
    search: async (_query, provider) =>
      catalog
        .filter((r) => !provider || r.provider === provider)
        .map((r) => ({
          provider: r.provider,
          id: Number(r.id),
          title: `${r.artists[0]?.name ?? ''} - ${r.title}`,
          year: r.year ? String(r.year) : undefined,
        })),
    getRelease: async (ref) => {
      const found = catalog.find((r) => String(r.id) === String(ref))
      if (!found) throw new Error(`scenario: no release ${ref} in the catalog`)
      return found
    },
  }
}

function shellApi(errors: string[], openFiles: { current?: (paths: string[]) => void }) {
  return {
    version: '0.0.0-scenario',
    getSettings: async () => settingsForRenderer(getSettings()),
    saveSettings: async (patch) => settingsForRenderer(saveSettings(sanitizeSettingsPatch(patch))),
    getLastSession: loadLastSession,
    saveLastSession: async (paths, edits) => saveLastSession(paths, edits),
    logError: (message, stack) => errors.push(`renderer: ${message}${stack ? `\n${stack}` : ''}`),
    onOpenFiles: (cb) => {
      openFiles.current = cb
      return () => {
        openFiles.current = undefined
      }
    },
    onProcessProgress: (cb) => listen('process:progress', cb),
    onActivity: (cb) => listen('activity:event', cb),
    onDeclickPreviewProgress: (cb) => listen('audio:declickPreviewProgress', cb),
    loadCachedAnalyses: (paths) => invokeMain('audio:cached-batch', paths),
    waveformWindow: (path, startSec, durSec, buckets) =>
      invokeMain('audio:waveformWindow', path, startSec, durSec, buckets),
    declickPreview: (path, mode) => invokeMain('audio:declickPreview', path, mode),
    cancelDeclickPreview: () => invokeMain('audio:cancelDeclickPreview'),
    readCoverFull: (path) => invokeMain('audio:coverFull', path),
    onMenuCommand: () => () => {},
    onUpdateDownloaded: () => () => {},
    onUpdateError: () => () => {},
    onUpdateCheckFailed: () => () => {},
    onRekordboxSyncIssue: () => () => {},
    onEngineSyncIssue: () => () => {},
    checkForUpdates: async () => {},
    hasClipboardImage: async () => false,
    prepareCoverDrag: async () => null,
    getConfigDir: async () => null,
    detectTraktorNmlPath: async () => null,
    rekordboxCollection: async () => '',
    setDockPlaying: () => {},
    setDockFrames: () => {},
    cancelJob: () => {},
  } satisfies Partial<Api>
}

function stubBrowser(): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  globalThis.IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  } as unknown as typeof IntersectionObserver
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
}

export async function openApp(
  options: ScenarioOptions,
  catalog: Release[] = [],
): Promise<AppScenario> {
  configure({ getElementError: (message) => new Error(message ?? '') })
  const { errors, api } = bootMain({
    ...options,
    settings: { hasSeenOnboarding: true, ...options.settings },
  })
  const openFiles: { current?: (paths: string[]) => void } = {}
  const shell = { ...shellApi(errors, openFiles), ...catalogApi(catalog) }
  ;(window as unknown as { api: Api }).api = new Proxy(api, {
    get(target, key) {
      if (key in shell) return shell[key as keyof typeof shell]
      return target[key as keyof Api]
    },
  })
  stubBrowser()
  const { default: App } = await import('../renderer/src/App')
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  act(() =>
    root.render(
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>,
    ),
  )
  await waitFor(() => {
    if (!openFiles.current) throw new Error('scenario: the app never listened for opened files')
  })
  return {
    drop: async (...paths) => {
      const before = screen.queryAllByTestId('track-row').length
      openFiles.current?.(paths)
      await waitFor(
        () => {
          if (screen.queryAllByTestId('track-row').length <= before)
            throw new Error('scenario: the dropped files never reached the list')
          if (screen.queryAllByTestId('track-loading').length > 0)
            throw new Error('scenario: the dropped files were never read')
        },
        { timeout: 30_000 },
      )
    },
    select: async (title) => {
      const row = screen.getAllByTestId('track-row').find((r) => r.textContent?.includes(title))
      if (!row) throw new Error(`scenario: no row shows ${title}`)
      fireEvent.click(row)
      await waitFor(
        () => {
          const field = screen.getByTestId('field-title') as HTMLInputElement
          if (field.value !== title) throw new Error(`scenario: the editor never opened ${title}`)
        },
        { timeout: 30_000 },
      )
    },
    convertAll: async () => {
      const button = () => screen.getByTestId('convert-all') as HTMLButtonElement
      await waitFor(
        () => {
          if (button().disabled) throw new Error('scenario: Convert all never became available')
        },
        { timeout: 30_000 },
      )
      fireEvent.click(button())
    },
    errors,
    close: () => {
      act(() => root.unmount())
      container.remove()
      closeMain()
    },
  }
}

// Chromium tells the two ways a number field changes apart by the event it fires: a
// keystroke arrives as an InputEvent with an inputType, a step of the arrows as a plain Event.
export function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  fireEvent(input, new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
}

export function stepTo(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } })
}
