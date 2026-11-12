// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Command } from '../lib/commands'
import { createQueryClient } from '../lib/queryClient'
import type { TrackItem } from '../types'
import { Overlays } from './Overlays'

afterEach(cleanup)

const client = createQueryClient()

function overlays(over: Partial<React.ComponentProps<typeof Overlays>>): React.JSX.Element {
  const tracks: TrackItem[] = []
  return (
    <QueryClientProvider client={client}>
      <Overlays
        activeModal={{ type: 'palette' }}
        settings={null}
        selected={null}
        bulkTracks={tracks}
        visibleTracks={tracks}
        getCommands={() => []}
        editorFormatRef={{ current: null }}
        close={vi.fn()}
        closeIfPalette={vi.fn()}
        closeSettings={vi.fn()}
        saveSettings={vi.fn()}
        setSettings={vi.fn()}
        setThemePreview={vi.fn()}
        finishOnboarding={vi.fn()}
        deriveTracksUndoable={vi.fn()}
        updateTrack={vi.fn()}
        revealSelection={vi.fn()}
        paletteTrees={[]}
        goToPlaylist={vi.fn()}
        {...over}
      />
    </QueryClientProvider>
  )
}

describe('Overlays command palette', () => {
  // Building the command registry runs dozens of translation and shortcut lookups. App
  // re-renders on every progress tick and drag; while the palette stays open those renders
  // must not rebuild a registry the palette already holds.
  it('builds the command registry once per opening, not on every render behind it', async () => {
    const commands: Command[] = [
      { id: 'a', title: 'Add files', enabled: true, group: 'app', run: () => {} },
    ]
    const getCommands = vi.fn(() => commands)
    const { rerender } = render(overlays({ getCommands }))
    expect(await screen.findByText('Add files')).toBeInTheDocument()
    const builds = getCommands.mock.calls.length

    rerender(overlays({ getCommands, visibleTracks: [] }))
    rerender(overlays({ getCommands, selected: null }))

    expect(getCommands).toHaveBeenCalledTimes(builds)
  })

  // Freezing the registry must not outlive the opening: the next ⌘K reflects whatever
  // changed while the palette was closed.
  it('builds a fresh registry when the palette opens again', async () => {
    const getCommands = vi.fn((): Command[] => [
      { id: 'a', title: 'Add files', enabled: true, group: 'app', run: () => {} },
    ])
    const { rerender } = render(overlays({ getCommands }))
    await screen.findByText('Add files')
    const builds = getCommands.mock.calls.length

    rerender(overlays({ getCommands, activeModal: null }))
    rerender(overlays({ getCommands }))
    await screen.findByText('Add files')

    expect(getCommands.mock.calls.length).toBeGreaterThan(builds)
  })
})
