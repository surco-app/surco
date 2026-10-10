// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { EMPTY_FILTER } from '../lib/triage'
import type { TrackItem } from '../types'
import { TrackListHeader } from './TrackListHeader'

afterEach(cleanup)

const track = { id: 't1' } as TrackItem

function renderHeader(over: Partial<Parameters<typeof TrackListHeader>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onImportApplePlaylist: vi.fn(),
    onSelectAllTracks: vi.fn(),
    scrollToSelected: vi.fn(),
    onFillAll: vi.fn(),
    onFindReplace: vi.fn(),
    onReviewList: vi.fn(),
    onClearAll: vi.fn(),
    onRemoveSelected: vi.fn(),
    onTrashSelected: vi.fn(),
    onTrashSuspects: vi.fn(),
  }
  render(
    <TrackListHeader
      tr={i18n.t}
      hintFor={() => ''}
      search=""
      setSearch={() => {}}
      trackSearchRef={createRef()}
      qualityFilterRef={createRef()}
      filterSelection={EMPTY_FILTER}
      setFilterSelection={() => {}}
      librarySource="appleMusic"
      qualityTally={{} as never}
      formatTally={[]}
      sortBy="import"
      setSortBy={() => {}}
      sortDir="asc"
      toggleSortDir={() => {}}
      tracks={[track]}
      visibleTracks={[track]}
      selectedId="t1"
      selectedIds={['t1']}
      selectedPosition={1}
      canReviewList
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

const openMenu = (): HTMLElement => {
  fireEvent.click(screen.getByTestId('list-actions-more'))
  return screen.getByRole('menu')
}

describe('TrackListHeader actions row', () => {
  it('keeps the everyday actions one click away as icons and names the occasional list-wide ones in a ⋯ menu', () => {
    renderHeader()
    for (const id of [
      'add-files',
      'import-apple-playlist',
      'select-all',
      'reveal-selected',
      'remove-selected',
    ]) {
      expect(screen.getByTestId(id)).toBeVisible()
    }
    for (const id of [
      'list-review-open',
      'fill-all',
      'open-find-replace',
      'trash-selected',
      'clear-all',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    const more = screen.getByTestId('list-actions-more')
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAccessibleName(i18n.t('header.moreActions'))
  })

  it('lists the menu items in order, each named by its action', () => {
    renderHeader()
    const menu = openMenu()
    expect(screen.getByTestId('list-actions-more')).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.dataset.testid),
    ).toEqual(['list-review-open', 'fill-all', 'open-find-replace', 'trash-selected', 'clear-all'])
    expect(within(menu).getByTestId('list-review-open')).toHaveTextContent(
      i18n.t('header.reviewList'),
    )
    expect(within(menu).getByTestId('fill-all')).toHaveTextContent(i18n.t('header.fillFromName'))
    expect(within(menu).getByTestId('open-find-replace')).toHaveTextContent(
      i18n.t('commands.findReplace'),
    )
    expect(within(menu).getByTestId('clear-all')).toHaveTextContent(i18n.t('header.clearAll'))
  })

  it('marks clearing the list as destructive, since it is the one item that throws work away', () => {
    renderHeader()
    openMenu()
    expect(screen.getByTestId('clear-all')).toHaveClass('text-danger')
    expect(screen.getByTestId('trash-selected')).toHaveClass('text-danger')
    expect(screen.getByTestId('fill-all')).not.toHaveClass('text-danger')
  })

  it.each([
    ['list-review-open', 'onReviewList'],
    ['fill-all', 'onFillAll'],
    ['open-find-replace', 'onFindReplace'],
    ['trash-selected', 'onTrashSelected'],
    ['clear-all', 'onClearAll'],
  ] as const)('runs %s from the menu and closes it', (id, handler) => {
    const handlers = renderHeader()
    openMenu()
    fireEvent.click(screen.getByTestId(id))
    expect(handlers[handler]).toHaveBeenCalledTimes(1)
    for (const other of Object.keys(handlers) as (keyof typeof handlers)[]) {
      if (other !== handler) expect(handlers[other]).not.toHaveBeenCalled()
    }
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the review disabled, never hidden, so a blocked action still reads as available later', () => {
    const handlers = renderHeader({ canReviewList: false })
    openMenu()
    const review = screen.getByTestId('list-review-open')
    expect(review).toBeDisabled()
    fireEvent.click(review)
    expect(handlers.onReviewList).not.toHaveBeenCalled()
    expect(screen.getByTestId('fill-all')).toBeEnabled()
  })

  it('keeps the trash item in the menu disabled while nothing is selected', () => {
    renderHeader({ selectedId: null, selectedIds: [] })
    openMenu()
    expect(screen.getByTestId('trash-selected')).toBeDisabled()
  })

  it('offers the neutral remove-from-list icon, never the red trash, so the visible action cannot delete files', () => {
    const handlers = renderHeader()
    const remove = screen.getByTestId('remove-selected')
    expect(remove).toHaveAccessibleName(i18n.t('trackList.context.remove'))
    expect(remove).not.toHaveClass('hover:text-danger')
    fireEvent.click(remove)
    expect(handlers.onRemoveSelected).toHaveBeenCalledTimes(1)
    expect(handlers.onTrashSelected).not.toHaveBeenCalled()
  })

  it('disables remove-from-list while nothing is selected', () => {
    const handlers = renderHeader({ selectedId: null, selectedIds: [] })
    const remove = screen.getByTestId('remove-selected')
    expect(remove).toBeDisabled()
    fireEvent.click(remove)
    expect(handlers.onRemoveSelected).not.toHaveBeenCalled()
  })

  it('walks the items with the arrow keys, skipping a disabled one', () => {
    renderHeader({ canReviewList: false })
    const menu = openMenu()
    expect(screen.getByTestId('fill-all')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('open-find-replace')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('trash-selected')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('clear-all')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('fill-all')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('clear-all')).toHaveFocus()
  })

  it('opens onto the review when it can run', () => {
    renderHeader()
    openMenu()
    expect(screen.getByTestId('list-review-open')).toHaveFocus()
  })

  it('closes on Escape and returns the focus to the ⋯ button', () => {
    const handlers = renderHeader()
    const menu = openMenu()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    const more = screen.getByTestId('list-actions-more')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveFocus()
    expect(handlers.onClearAll).not.toHaveBeenCalled()
  })

  it('keeps the Escape that closes the menu from also clearing the selection through the window handler', () => {
    renderHeader()
    const menu = openMenu()
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    fireEvent.keyDown(menu, { key: 'Escape' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })

  it('closes when the ⋯ button is pressed again or a click lands outside', () => {
    renderHeader()
    openMenu()
    fireEvent.click(screen.getByTestId('list-actions-more'))
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
