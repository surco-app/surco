// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DJ_PROGRAMS } from '../../../shared/djProgram'
import type { PlaylistSource } from '../../../shared/types'
import i18n from '../i18n'
import { RAIL_WIDTH } from '../lib/columnLayout'
import { SourceRail } from './SourceRail'

afterEach(cleanup)

const COPIES = { active: false, alert: 'none', onOpen: () => {} } as const

describe('SourceRail', () => {
  it('writes only the program name under VirtualDJ, with no beta pill taking room in the rail', () => {
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={['appleMusic', ...DJ_PROGRAMS]}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-rail-virtualdj')).toHaveTextContent(/^VirtualDJ$/)
    for (const program of DJ_PROGRAMS)
      expect(screen.getByTestId(`source-rail-${program}`)).not.toHaveAccessibleDescription()
  })

  it('is as wide as the rail the column layout subtracts, so the editor columns fill the window exactly', () => {
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={[]}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-rail').style.width).toBe(`${RAIL_WIDTH}px`)
  })

  it('offers the working list plus each source found on this machine', () => {
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={['rekordbox']}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('source-rail-appleMusic')).not.toBeInTheDocument()
  })

  // Each program's own mark is what a DJ recognises at a glance, but a newcomer cannot tell
  // an "e" from a "T", so each mark carries its name in small type under it, the same name
  // the button gives screen readers. The marks are drawn in the text colour like the list
  // icon beside them, not in the apps' own colours, so the rail reads as Surco's and the
  // pressed state shows the same way on all three.
  it('shows each source by its own mark in the rail colour with its name written under it', () => {
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={['appleMusic', 'rekordbox', 'engine', 'traktor']}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    for (const [id, name] of [
      ['tracks', 'Tracks'],
      ['appleMusic', 'Music'],
      ['rekordbox', 'rekordbox'],
      ['engine', 'Engine DJ'],
      ['traktor', 'Traktor'],
    ]) {
      const button = screen.getByTestId(`source-rail-${id}`)
      const label = screen.getByTestId(`source-rail-label-${id}`)
      expect(button).toHaveAccessibleName(name)
      expect(label).toHaveTextContent(name)
      expect(button).toContainElement(label)
    }
    for (const s of ['rekordbox', 'appleMusic', 'engine', 'traktor']) {
      const icon = screen.getByTestId(`source-rail-icon-${s}`)
      expect(icon.tagName.toLowerCase()).toBe('svg')
      expect(icon.querySelector('[fill="currentColor"]')).not.toBeNull()
    }
  })

  // The name is already written under each mark, so a hover bubble repeating it only
  // covers the playlist column beside the rail.
  it('does not repeat the written name in a tooltip or a native title', () => {
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={['appleMusic', 'rekordbox']}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    for (const id of ['tracks', 'appleMusic', 'rekordbox']) {
      const button = screen.getByTestId(`source-rail-${id}`)
      expect(button).not.toHaveAttribute('title')
      fireEvent.focusIn(button)
      fireEvent.mouseEnter(button)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      fireEvent.focusOut(button)
    }
  })

  // Each mark is labelled with the program's own brand name, which no locale translates, so
  // a DJ finds the same word under the mark that they know from the program itself.
  it('writes the same brand name under every source mark in every language', async () => {
    try {
      for (const lng of ['en', 'es', 'de', 'fr', 'pt-BR', 'ja']) {
        await i18n.changeLanguage(lng)
        render(
          <SourceRail
            width={RAIL_WIDTH}
            showNames
            onToggleNames={vi.fn()}
            sidebarShown
            onToggleSidebar={vi.fn()}
            copies={COPIES}
            onHide={vi.fn()}
            sources={['appleMusic', 'rekordbox', 'engine', 'traktor']}
            active={null}
            onSelect={vi.fn()}
          />,
        )
        for (const [id, name] of [
          ['appleMusic', 'Music'],
          ['rekordbox', 'rekordbox'],
          ['engine', 'Engine DJ'],
          ['traktor', 'Traktor'],
        ]) {
          expect(screen.getByTestId(`source-rail-label-${id}`)).toHaveTextContent(name)
        }
        cleanup()
      }
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('picks a source, and the working list with null', () => {
    const onSelect = vi.fn()
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={['appleMusic', 'rekordbox']}
        active="rekordbox"
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(onSelect.mock.calls).toEqual([['appleMusic'], [null]])
  })

  describe('hiding a source', () => {
    function setup(active: PlaylistSource | null = null) {
      const onSelect = vi.fn<(source: PlaylistSource | null) => void>()
      const onHide = vi.fn<(source: PlaylistSource) => void>()
      const onToggleNames = vi.fn()
      const onHideSidebar = vi.fn()
      render(
        <SourceRail
          width={RAIL_WIDTH}
          showNames
          onToggleNames={onToggleNames}
          sidebarShown
          onToggleSidebar={onHideSidebar}
          sources={['appleMusic', 'rekordbox']}
          active={active}
          onSelect={onSelect}
          onHide={onHide}
          copies={COPIES}
        />,
      )
      return { onSelect, onHide, onToggleNames, onHideSidebar }
    }

    it('offers to hide a source from its right-click menu, named after it', () => {
      setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(screen.getByTestId('source-rail-hide')).toHaveTextContent('Hide rekordbox')
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      fireEvent.contextMenu(screen.getByTestId('source-rail-appleMusic'))
      expect(screen.getByTestId('source-rail-hide')).toHaveTextContent('Hide Apple Music')
    })

    it('hides the source it was opened on and leaves the open one alone', () => {
      const { onHide, onSelect } = setup('appleMusic')
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.click(screen.getByTestId('source-rail-hide'))
      expect(onHide.mock.calls).toEqual([['rekordbox']])
      expect(onSelect).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('goes back to the working list first when the source being hidden is the open one', () => {
      const { onHide, onSelect } = setup('rekordbox')
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.click(screen.getByTestId('source-rail-hide'))
      expect(onSelect.mock.calls).toEqual([[null]])
      expect(onHide.mock.calls).toEqual([['rekordbox']])
    })

    it('offers no Hide on the working list, which cannot be hidden', () => {
      setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-tracks'))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(screen.queryByTestId('source-rail-hide')).not.toBeInTheDocument()
    })

    // The names under the marks are what a newcomer reads; someone who knows the marks
    // takes the room back from the same right-click, and the tick says which way it is.
    it('offers to hide the names from any right-click on the rail, ticked while they show', () => {
      const { onToggleNames } = setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-tracks'))
      const item = screen.getByRole('menuitemcheckbox', { name: i18n.t('view.railNames') })
      expect(item).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(item)
      expect(onToggleNames).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes with Escape or a click outside and hides nothing', () => {
      const { onHide } = setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.click(screen.getByTestId('source-rail-menu-backdrop'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(onHide).not.toHaveBeenCalled()
    })

    it('opens from the keyboard with Shift+F10 or the context-menu key, on the focused source, and takes the focus', () => {
      setup()
      const button = screen.getByTestId('source-rail-rekordbox')
      button.focus()
      fireEvent.keyDown(button, { key: 'F10', shiftKey: true })
      expect(screen.getByTestId('source-rail-hide')).toHaveFocus()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(button).toHaveFocus()
      fireEvent.keyDown(button, { key: 'ContextMenu' })
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })

  it('hides the whole sidebar from its own right-click', () => {
    const onHideSidebar = vi.fn()
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={onHideSidebar}
        copies={COPIES}
        onHide={vi.fn()}
        sources={[]}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByTestId('source-rail-tracks'))
    fireEvent.click(screen.getByRole('menuitem', { name: i18n.t('view.hideSidebar') }))
    expect(onHideSidebar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  // Laid over the list while hidden, the same item pins the sidebar back instead of hiding
  // something that is already hidden.
  it('offers to show the sidebar again while it is only laid over the list', () => {
    render(
      <SourceRail
        width={RAIL_WIDTH}
        showNames
        onToggleNames={vi.fn()}
        sidebarShown={false}
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={[]}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByTestId('source-rail-tracks'))
    expect(screen.getByRole('menuitem', { name: i18n.t('view.sidebar') })).toBeInTheDocument()
  })

  it('draws no names when they are hidden, and VoiceOver still hears each one', () => {
    render(
      <SourceRail
        width={52}
        showNames={false}
        onToggleNames={vi.fn()}
        sidebarShown
        onToggleSidebar={vi.fn()}
        copies={COPIES}
        onHide={vi.fn()}
        sources={['rekordbox']}
        active={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('source-rail-label-rekordbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'rekordbox' })).toBeInTheDocument()
    expect(screen.getByTestId('source-rail').style.width).toBe('52px')
  })

  describe('Copias', () => {
    function renderWith(copies: Partial<Parameters<typeof SourceRail>[0]['copies']>) {
      const props = { ...COPIES, onOpen: vi.fn(), ...copies }
      render(
        <SourceRail
          width={RAIL_WIDTH}
          showNames
          onToggleNames={vi.fn()}
          sidebarShown
          onToggleSidebar={vi.fn()}
          onHide={vi.fn()}
          sources={['rekordbox']}
          active="rekordbox"
          onSelect={vi.fn()}
          copies={props}
        />,
      )
      return props
    }

    it('shows Copias at the bottom with no dot when all is well', () => {
      const props = renderWith({})
      const button = screen.getByTestId('source-rail-copies')
      expect(button).toHaveAccessibleName('Backups')
      expect(screen.getByTestId('source-rail')).toContainElement(button)
      expect(screen.queryByTestId('source-rail-copies-dot')).not.toBeInTheDocument()
      expect(screen.getByTestId('source-rail-copies-icon')).toHaveAttribute('data-icon', 'check')
      fireEvent.click(button)
      expect(props.onOpen).toHaveBeenCalledTimes(1)
    })

    it('an amber dot when changes are waiting', () => {
      renderWith({ alert: 'warn' })
      expect(screen.getByTestId('source-rail-copies-dot')).toHaveAttribute('data-alert', 'warn')
      expect(screen.getByTestId('source-rail-copies-icon')).toHaveAttribute('data-icon', 'check')
    })

    it('a red dot and alert shield when Surco stopped', () => {
      renderWith({ alert: 'danger' })
      expect(screen.getByTestId('source-rail-copies-dot')).toHaveAttribute('data-alert', 'danger')
      expect(screen.getByTestId('source-rail-copies-icon')).toHaveAttribute('data-icon', 'alert')
    })

    it('is the one pressed entry while open, so no source looks like the screen on show', () => {
      renderWith({ active: true })
      expect(screen.getByTestId('source-rail-copies')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'false')
    })
  })
})
