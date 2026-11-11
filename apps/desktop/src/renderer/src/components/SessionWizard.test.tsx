// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import type { SessionRows } from '../hooks/useSessionRows'
import type { BuildResult } from '../hooks/useSessionRun'
import i18n from '../i18n'
import { type SessionDestination, SessionWizard } from './SessionWizard'

afterEach(cleanup)

const TREE: SourceNode[] = [
  {
    id: 'rem',
    name: 'Remember',
    kind: 'folder',
    count: 0,
    children: [
      { id: 'b90', name: 'Bases 90', kind: 'playlist', count: 38 },
      { id: 'c90', name: 'Cantaditas 90', kind: 'playlist', count: 61 },
      { id: 'mak', name: 'Makina Xàtiva', kind: 'playlist', count: 47 },
      { id: 'mk97', name: 'Makina bases 97', kind: 'playlist', count: 22 },
    ],
  },
  { id: 'combos', name: 'COMBOS', kind: 'playlist', count: 24 },
  { id: 'sep', name: '--------------------', kind: 'playlist', count: 0 },
]

const INITIAL: SessionAnswers = {
  minutes: 90,
  playMinutes: 3,
  sources: [],
  freshShare: 0.15,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: true,
  surprise: false,
}

const entry = (path: string, key?: string): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta: key ? { key } : {},
})

function fakeRows(byId: Record<string, SourcePlaylistEntry[]> = {}, failed: string[] = []) {
  const load = vi.fn(
    async (ids: readonly string[]) =>
      new Map(
        ids
          .filter((id) => !failed.includes(id))
          .map((id) => [id, byId[id] ?? [entry(`/m/${id}.mp3`)]] as const),
      ),
  )
  return { load, reset: vi.fn(), loading: false, failed }
}

const DESTINATION: SessionDestination = { kind: 'new', name: 'Session 11-9 (2)', where: 'COMBOS' }

function setup(
  roles: Record<string, PlaylistRole> = {},
  initial: SessionAnswers = INITIAL,
  rows: SessionRows = fakeRows(),
  destination: SessionDestination = DESTINATION,
) {
  const handed = {
    ...initial,
    sources: initial.sources.length > 0 ? initial.sources : Object.keys(roles),
  }
  const onClose = vi.fn()
  const onBuild = vi.fn()
  render(
    <SessionWizard
      tree={TREE}
      roles={roles}
      initial={handed}
      rows={rows}
      destination={destination}
      onClose={onClose}
      onBuild={onBuild}
    />,
  )
  return { onClose, onBuild, rows }
}

const next = () => fireEvent.click(screen.getByTestId('session-wizard-next'))
const LONG: SessionAnswers = { ...INITIAL, minutes: 999 }
const reach = (tracks: number, target = 999) =>
  i18n.t('sessions.wizard.sources.short', { minutes: tracks * INITIAL.playMinutes, target })
const toSources = () => next()
const toCharacter = async () => {
  toSources()
  next()
  await screen.findByTestId('session-wizard-build')
}

describe('SessionWizard steps', () => {
  it('goes back to a step already done by pressing its name, without stepping back one by one', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-step-duration'))
    expect(screen.getByTestId('session-wizard-step-title')).toHaveTextContent(
      i18n.t('sessions.wizard.duration.heading'),
    )
  })

  it('does not let a step ahead be pressed, since it may need what comes before', () => {
    setup()
    expect(screen.queryByTestId('session-wizard-step-character')).toBeNull()
  })
})

describe('SessionWizard duration step', () => {
  it('opens on the duration with the saved length marked', () => {
    setup({}, { ...INITIAL, minutes: 120 })
    expect(screen.getByTestId('session-wizard-duration-120')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-duration-90')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('marks the length that was pressed', () => {
    setup()
    fireEvent.click(screen.getByTestId('session-wizard-duration-180'))
    expect(screen.getByTestId('session-wizard-duration-180')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-duration-90')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('opens a field for any other length and accepts only whole positive minutes', () => {
    setup()
    fireEvent.click(screen.getByTestId('session-wizard-duration-custom'))
    const field = screen.getByTestId('session-wizard-custom')
    fireEvent.change(field, { target: { value: '45' } })
    expect(screen.getByTestId('session-wizard-next')).toBeEnabled()
    for (const bad of ['0', '-5', '4.5', 'abc', '']) {
      fireEvent.change(field, { target: { value: bad } })
      expect(screen.getByTestId('session-wizard-next')).toBeDisabled()
    }
  })

  it('has no way back from the first step', () => {
    setup()
    expect(screen.queryByTestId('session-wizard-back')).toBeNull()
  })
})

describe('SessionWizard sources step', () => {
  it('goes to the playlists step', () => {
    setup()
    toSources()
    expect(screen.getByTestId('session-wizard-step-title')).toHaveTextContent(
      i18n.t('sessions.wizard.sources.heading'),
    )
  })

  it('comes back to the duration from the playlists step', () => {
    setup()
    toSources()
    fireEvent.click(screen.getByTestId('session-wizard-back'))
    expect(screen.getByTestId('session-wizard-duration-90')).toBeInTheDocument()
  })

  it('lists the playlists whose name has what was typed, ignoring case and accents', () => {
    setup()
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'XATIVA' } })
    expect(screen.getByTestId('playlists-row-mak')).toBeInTheDocument()
    expect(screen.queryByTestId('playlists-row-b90')).toBeNull()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'mak' } })
    expect(screen.getByTestId('playlists-row-mak')).toBeInTheDocument()
    expect(screen.getByTestId('playlists-row-mk97')).toBeInTheDocument()
  })

  it('browses the folders without typing and gives a role from the row', () => {
    setup({}, LONG)
    toSources()
    expect(screen.queryByTestId('session-wizard-role-b90-base')).toBeNull()
    fireEvent.click(screen.getByTestId('playlists-folder-rem'))
    fireEvent.click(screen.getByTestId('session-wizard-role-b90-base'))
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(reach(38))
  })

  it('warns before building that the chosen playlists fall short of the length asked, so the DJ adds another instead of finding a short set at the end', () => {
    setup()
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'bases 97' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-mk97-any'))
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(
      i18n.t('sessions.wizard.sources.short', { minutes: 66, target: 90 }),
    )
    expect(screen.getByTestId('session-wizard-next')).toBeEnabled()
  })

  it('warns of a short set beside the buttons, where the eye lands before pressing Next', () => {
    setup({}, LONG)
    toSources()
    fireEvent.click(screen.getByTestId('playlists-folder-rem'))
    fireEvent.click(screen.getByTestId('session-wizard-role-b90-base'))
    const footer = screen.getByTestId('session-wizard-footer')
    expect(footer).toContainElement(screen.getByTestId('session-wizard-length'))
    expect(footer).toContainElement(screen.getByTestId('session-wizard-next'))
  })

  it('stays quiet once the chosen playlists reach the length asked, since only a short set needs a word', () => {
    setup()
    toSources()
    fireEvent.click(screen.getByTestId('playlists-folder-rem'))
    fireEvent.click(screen.getByTestId('session-wizard-role-b90-base'))
    expect(screen.queryByTestId('session-wizard-length')).toBeNull()
    expect(screen.queryByTestId('session-wizard-summary')).toBeNull()
  })

  it('lands in the search on the Playlists step, so the DJ types a name without reaching for the mouse first', () => {
    setup()
    toSources()
    expect(screen.getByTestId('playlists-search')).toHaveFocus()
  })

  it('walks down to a playlist with the arrows and marks it with 1, 2 or 3, so the whole step works from the keyboard', () => {
    setup()
    toSources()
    const press = (key: string) => fireEvent.keyDown(document.activeElement as Element, { key })
    press('ArrowDown')
    press('ArrowRight')
    press('ArrowDown')
    expect(screen.getByTestId('playlists-row-b90')).toHaveFocus()
    press('1')
    expect(screen.getByTestId('session-wizard-role-b90-base')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    press('2')
    expect(screen.getByTestId('session-wizard-role-b90-vocal')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    press('2')
    expect(screen.getByTestId('session-wizard-role-b90-vocal')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('marks every playlist in a folder when 3 is pressed on the folder, like its own Mixed button', () => {
    setup({}, LONG)
    toSources()
    fireEvent.keyDown(screen.getByTestId('playlists-search'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByTestId('playlists-folder-rem'), { key: '3' })
    expect(screen.getByTestId('session-wizard-folder-role-rem-any')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(reach(168))
  })

  it('leaves numbers typed in the search to the search, since playlist names carry years', () => {
    setup()
    toSources()
    fireEvent.keyDown(screen.getByTestId('playlists-search'), { key: '1' })
    expect(screen.getByTestId('session-wizard-none')).toBeInTheDocument()
  })

  it('invites to search the playlists and never to create one', () => {
    setup()
    toSources()
    expect(screen.getByTestId('playlists-search')).toHaveAttribute(
      'placeholder',
      i18n.t('sessions.wizard.sources.search', { count: 5 }),
    )
  })

  it('has no box to create a playlist, since the session only reads them', () => {
    setup()
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'Algo nuevo' } })
    expect(screen.queryByTestId('playlists-create')).toBeNull()
  })

  it('says so when nothing matches', () => {
    setup()
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('playlists-empty')).toBeInTheDocument()
  })

  it('counts the playlist it was given a role in toward the length', () => {
    setup({}, LONG)
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'mak' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-mk97-base'))
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(reach(22))
  })

  it('takes the playlist away and clears the role when the active role is pressed again', () => {
    setup({ mk97: 'base' })
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'mk97' } })
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'bases 97' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-mk97-base'))
    expect(screen.queryByTestId('session-wizard-length')).toBeNull()
    expect(screen.getByTestId('session-wizard-none')).toBeInTheDocument()
  })

  it('opens with the playlists already marked in the tree, each pressed in its own row', () => {
    setup({ b90: 'base', c90: 'vocal', combos: 'any' })
    toSources()
    expect(screen.getByTestId('session-wizard-role-b90-base')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-role-c90-vocal')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-role-combos-any')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('ignores a marked playlist that is no longer in the tree', () => {
    setup({ gone: 'base', b90: 'base' }, LONG)
    toSources()
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(reach(38))
  })

  it('opens with nothing chosen when no playlist was handed over, whatever roles are known', () => {
    render(
      <SessionWizard
        tree={TREE}
        roles={{ b90: 'base', c90: 'vocal' }}
        initial={INITIAL}
        rows={fakeRows()}
        destination={DESTINATION}
        onClose={vi.fn()}
        onBuild={vi.fn()}
      />,
    )
    next()
    expect(screen.getByTestId('session-wizard-none')).toBeInTheDocument()
    expect(screen.getByTestId('session-wizard-next')).toBeDisabled()
  })

  it('offers to see only the chosen playlists, and to see them all again', () => {
    setup({ b90: 'base', c90: 'vocal' })
    toSources()
    const button = screen.getByTestId('session-wizard-only-chosen')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('playlists-row-mak')).toBeInTheDocument()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('playlists-row-mak')).toBeNull()
    expect(screen.getByTestId('playlists-row-b90')).toBeInTheDocument()
    expect(screen.getByTestId('playlists-row-c90')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.getByTestId('playlists-row-mak')).toBeInTheDocument()
  })

  it('takes a playlist out of that view as soon as its role is unpressed', () => {
    setup({ b90: 'base', c90: 'vocal' })
    toSources()
    fireEvent.click(screen.getByTestId('session-wizard-only-chosen'))
    fireEvent.click(screen.getByTestId('session-wizard-role-b90-base'))
    expect(screen.queryByTestId('playlists-row-b90')).toBeNull()
    expect(screen.getByTestId('playlists-row-c90')).toBeInTheDocument()
  })

  it('offers nothing to filter while no playlist is chosen', () => {
    setup()
    toSources()
    expect(screen.queryByTestId('session-wizard-only-chosen')).toBeNull()
  })

  it('goes back to the whole list when the last chosen playlist is unpressed', () => {
    setup({ b90: 'base' })
    toSources()
    fireEvent.click(screen.getByTestId('session-wizard-only-chosen'))
    fireEvent.click(screen.getByTestId('session-wizard-role-b90-base'))
    expect(screen.getByTestId('playlists-row-mak')).toBeInTheDocument()
    expect(screen.queryByTestId('session-wizard-only-chosen')).toBeNull()
  })

  it('will not go on without a playlist and goes on with one', () => {
    setup()
    toSources()
    expect(screen.getByTestId('session-wizard-next')).toBeDisabled()
    cleanup()
    setup({ b90: 'base' })
    toSources()
    expect(screen.getByTestId('session-wizard-next')).toBeEnabled()
  })

  it('counts the tracks the chosen playlists hold', () => {
    setup({ b90: 'base', c90: 'vocal' }, LONG)
    toSources()
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(reach(99))
  })
})

describe('SessionWizard reading the chosen playlists', () => {
  it('reads the chosen source playlists when leaving the playlists step', async () => {
    const { rows } = setup({ b90: 'base', c90: 'vocal' })
    toSources()
    next()
    await screen.findByTestId('session-wizard-build')
    expect(rows.load).toHaveBeenCalledTimes(1)
    expect(rows.load).toHaveBeenCalledWith(['b90', 'c90'])
  })

  it('shows it is reading while the playlists load, and blocks pressing again', async () => {
    type Loaded = ReadonlyMap<string, readonly SourcePlaylistEntry[]>
    let release: (value: Loaded) => void = () => {}
    const rows: SessionRows = {
      load: vi.fn(() => new Promise<Loaded>((resolve) => (release = resolve))),
      reset: vi.fn(),
      loading: false,
      failed: [],
    }
    setup({ b90: 'base' }, INITIAL, rows)
    toSources()
    next()
    expect(screen.getByTestId('session-wizard-next')).toBeDisabled()
    expect(screen.getByTestId('session-wizard-next')).toHaveTextContent(
      i18n.t('sessions.wizard.loading'),
    )
    release(new Map())
    await screen.findByTestId('session-wizard-build')
  })

  it('names a playlist that could not be read and goes on without it', async () => {
    setup({ b90: 'base', c90: 'vocal' }, INITIAL, fakeRows({}, ['c90']))
    toSources()
    next()
    expect(await screen.findByTestId('session-wizard-load-failed')).toHaveTextContent(
      'Cantaditas 90',
    )
    expect(screen.getByTestId('session-wizard-build')).toBeEnabled()
  })
})

describe('SessionWizard new tracks', () => {
  const today = new Date().toISOString().slice(0, 10)
  const row = (path: string, meta: SourcePlaylistEntry['meta']): SourcePlaylistEntry => ({
    path,
    separator: false,
    meta,
  })
  const withNew = () =>
    fakeRows({
      b90: [
        row('/m/known.mp3', { rating: 80, playCount: 5, dateAdded: '2025-01-01' }),
        row('/m/new.mp3', { dateAdded: today }),
      ],
    })

  it('has no step of its own, so the playlists lead straight to how it should feel', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    expect(screen.queryByTestId('session-wizard-fresh')).toBeNull()
  })

  it('offers the share of new tracks when the chosen playlists hold some', async () => {
    setup({ b90: 'base' }, INITIAL, withNew())
    await toCharacter()
    const slider = screen.getByTestId('session-wizard-fresh-share')
    expect(slider).toHaveValue('15')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '40')
  })

  it('says how a track counts as new', async () => {
    setup({ b90: 'base' }, INITIAL, withNew())
    await toCharacter()
    expect(screen.getByTestId('session-wizard-fresh-hint')).toHaveTextContent(
      i18n.t('sessions.wizard.fresh.hint'),
    )
  })

  it('offers nothing about new tracks when none of the chosen ones is new', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    expect(screen.queryByTestId('session-wizard-fresh-share')).toBeNull()
    expect(screen.queryByTestId('session-wizard-fresh-hint')).toBeNull()
  })

  it('hands over the share that was chosen when building', async () => {
    const { onBuild } = setup({ b90: 'base' }, INITIAL, withNew())
    await toCharacter()
    fireEvent.change(screen.getByTestId('session-wizard-fresh-share'), { target: { value: '30' } })
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ freshShare: 0.3 }),
      expect.anything(),
    )
  })

  it('hands over the saved share untouched when there are no new tracks to place', async () => {
    const { onBuild } = setup({ b90: 'base' }, { ...INITIAL, freshShare: 0.3 })
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ freshShare: 0.3 }),
      expect.anything(),
    )
  })
})

describe('SessionWizard minutes each track plays', () => {
  it('sits on the duration step with the length, since together they decide how many tracks are needed', () => {
    setup({ b90: 'base' }, { ...INITIAL, minutes: 90, playMinutes: 2 })
    expect(screen.getByTestId('session-wizard-play')).toBeInTheDocument()
    expect(screen.getByTestId('session-wizard-track-count')).toHaveTextContent(
      i18n.t('sessions.wizard.duration.tracks', { count: 45, minutes: 90 }),
    )
    fireEvent.change(screen.getByTestId('session-wizard-play'), { target: { value: '4' } })
    expect(screen.getByTestId('session-wizard-track-count')).toHaveTextContent(
      i18n.t('sessions.wizard.duration.tracks', { count: 23, minutes: 90 }),
    )
  })

  it('starts from the saved minutes and shows them', async () => {
    setup({ b90: 'base' }, { ...INITIAL, playMinutes: 4 })
    expect(screen.getByTestId('session-wizard-play')).toHaveValue('4')
    expect(screen.getByTestId('session-wizard-play-value')).toHaveTextContent(
      i18n.t('sessions.wizard.character.playValue', { minutes: 4 }),
    )
  })

  it('goes from 1 to 10 whole minutes', async () => {
    setup({ b90: 'base' })
    const slider = screen.getByTestId('session-wizard-play')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '10')
    expect(slider).toHaveAttribute('step', '1')
  })

  it('explains that tracks are mixed and not played whole', async () => {
    setup({ b90: 'base' })
    expect(screen.getByTestId('session-wizard-play-hint')).toHaveTextContent(
      i18n.t('sessions.wizard.character.playHint'),
    )
  })

  it('hands over the minutes that were chosen when building', async () => {
    const { onBuild } = setup({ b90: 'base' })
    fireEvent.change(screen.getByTestId('session-wizard-play'), { target: { value: '5' } })
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ playMinutes: 5 }),
      expect.anything(),
    )
  })
})

describe('SessionWizard character step', () => {
  it('starts every option from the saved answers', async () => {
    setup(
      { b90: 'base' },
      {
        ...INITIAL,
        alternate: false,
        preferCombos: false,
        tasteWeight: false,
        surprise: true,
        harmony: 'neighbours',
      },
      fakeRows({ b90: [entry('/m/a.mp3', '8A')] }),
    )
    await toCharacter()
    expect(screen.getByTestId('session-wizard-opt-alternate')).not.toBeChecked()
    expect(screen.getByTestId('session-wizard-opt-preferCombos')).not.toBeChecked()
    expect(screen.getByTestId('session-wizard-opt-tasteWeight')).not.toBeChecked()
    expect(screen.getByTestId('session-wizard-opt-surprise')).toBeChecked()
    expect(screen.getByTestId('session-wizard-harmony-neighbours')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('groups alternation with the key, since they decide what follows what and the role wins when they clash', async () => {
    setup({ b90: 'base' }, INITIAL, fakeRows({ b90: [entry('/m/a.mp3', '8A')] }))
    await toCharacter()
    const chain = screen.getByRole('group', { name: i18n.t('sessions.wizard.character.chain') })
    expect(chain).toContainElement(screen.getByTestId('session-wizard-opt-alternate'))
    expect(chain).toContainElement(screen.getByTestId('session-wizard-harmony-same'))
    expect(chain).not.toContainElement(screen.getByTestId('session-wizard-opt-preferCombos'))
  })

  it('groups what decides which tracks get in apart from the order', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    const pick = screen.getByRole('group', { name: i18n.t('sessions.wizard.character.pick') })
    for (const key of ['preferCombos', 'tasteWeight', 'surprise'])
      expect(pick).toContainElement(screen.getByTestId(`session-wizard-opt-${key}`))
    expect(pick).not.toContainElement(screen.getByTestId('session-wizard-opt-alternate'))
  })

  it('turns harmony off and says why when no chosen track has a key', async () => {
    setup({ b90: 'base' }, { ...INITIAL, harmony: 'neighbours' })
    await toCharacter()
    expect(screen.getByTestId('session-wizard-no-keys')).toBeInTheDocument()
    for (const mode of ['free', 'neighbours', 'same']) {
      expect(screen.getByTestId(`session-wizard-harmony-${mode}`)).toBeDisabled()
    }
  })

  it('builds with free harmony when the saved mode needs keys nobody has', async () => {
    const { onBuild } = setup({ b90: 'base' }, { ...INITIAL, harmony: 'same' })
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ harmony: 'free' }), {
      b90: 'base',
    })
  })

  it('offers the harmony modes when a chosen playlist has keys', async () => {
    setup({ b90: 'base' }, INITIAL, fakeRows({ b90: [entry('/m/a.mp3', '8A')] }))
    await toCharacter()
    expect(screen.queryByTestId('session-wizard-no-keys')).toBeNull()
    expect(screen.getByTestId('session-wizard-harmony-same')).toBeEnabled()
  })

  it('builds only when Build is pressed, once, with every answer', async () => {
    const { onBuild } = setup(
      { b90: 'base', c90: 'vocal' },
      { ...INITIAL, minutes: 120 },
      fakeRows({ b90: [entry('/m/a.mp3', '8A')] }),
    )
    await toCharacter()
    expect(onBuild).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('session-wizard-harmony-neighbours'))
    fireEvent.click(screen.getByTestId('session-wizard-opt-surprise'))
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      {
        minutes: 120,
        playMinutes: 3,
        sources: ['b90', 'c90'],
        freshShare: 0.15,
        preferCombos: true,
        harmony: 'neighbours',
        tasteWeight: true,
        alternate: true,
        surprise: true,
      },
      { b90: 'base', c90: 'vocal' },
    )
  })

  it('hands over the roles chosen inside the wizard, even before the app has saved them', async () => {
    const { onBuild } = setup({ b90: 'base' })
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'combos' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-combos-any'))
    fireEvent.change(screen.getByTestId('playlists-search'), {
      target: { value: 'cantaditas' },
    })
    fireEvent.click(screen.getByTestId('session-wizard-role-c90-vocal'))
    next()
    await screen.findByTestId('session-wizard-build')
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sources: ['b90', 'combos', 'c90'] }),
      { b90: 'base', combos: 'any', c90: 'vocal' },
    )
  })

  it('does not hand over the role of a playlist that was taken away', async () => {
    const { onBuild } = setup({ b90: 'base', c90: 'vocal' })
    toSources()
    fireEvent.change(screen.getByTestId('playlists-search'), {
      target: { value: 'cantaditas' },
    })
    fireEvent.click(screen.getByTestId('session-wizard-role-c90-vocal'))
    next()
    await screen.findByTestId('session-wizard-build')
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sources: ['b90'] }), {
      b90: 'base',
    })
  })
})

describe('SessionWizard roles for a whole folder', () => {
  const FOLDERS: SourceNode[] = [
    {
      id: 'fb',
      name: 'BASES',
      kind: 'folder',
      count: 2,
      children: [
        { id: 'b1', name: 'Todas', kind: 'playlist', count: 10 },
        { id: 'b2', name: 'Fijas', kind: 'playlist', count: 5 },
      ],
    },
    {
      id: 'fc',
      name: 'CANTADITAS',
      kind: 'folder',
      count: 1,
      children: [{ id: 'c1', name: 'Todas', kind: 'playlist', count: 7 }],
    },
    {
      id: 'fo',
      name: 'Remember',
      kind: 'folder',
      count: 1,
      children: [{ id: 'o1', name: 'Otra', kind: 'playlist', count: 3 }],
    },
  ]
  const renderFolders = (roles: Record<string, PlaylistRole> = {}, sources: string[] = []) => {
    const onBuild = vi.fn()
    render(
      <SessionWizard
        tree={FOLDERS}
        roles={roles}
        initial={{ ...INITIAL, sources }}
        rows={fakeRows()}
        destination={DESTINATION}
        onClose={vi.fn()}
        onBuild={onBuild}
      />,
    )
    toSources()
    return onBuild
  }

  it('gives every playlist of the folder the role with one press', () => {
    renderFolders()
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    expect(screen.getByTestId('session-wizard-length')).toHaveTextContent(reach(15, 90))
    expect(screen.getByTestId('playlists-folder-fb')).toHaveTextContent(/^\D*$/)
    fireEvent.click(screen.getByTestId('playlists-folder-fb'))
    expect(screen.getByTestId('session-wizard-role-b1-base')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-role-b2-base')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('leaves the playlists of the other folders alone', () => {
    renderFolders()
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    fireEvent.click(screen.getByTestId('playlists-folder-fc'))
    expect(screen.getByTestId('session-wizard-role-c1-base')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('shows the role as pressed on the folder only when all its playlists have it', () => {
    renderFolders({ b1: 'base' }, ['b1'])
    expect(screen.getByTestId('session-wizard-folder-role-fb-base')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    expect(screen.getByTestId('session-wizard-folder-role-fb-base')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('takes the role off every playlist of the folder when the pressed role is pressed again', () => {
    renderFolders()
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    expect(screen.getByTestId('session-wizard-none')).toBeInTheDocument()
  })

  it('replaces a different role the playlists already had', () => {
    renderFolders({ b1: 'vocal' }, ['b1'])
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    expect(screen.getByTestId('session-wizard-role-b1-base')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('session-wizard-role-b1-vocal')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('hands the roles of the whole folder over when building', async () => {
    const onBuild = renderFolders()
    fireEvent.click(screen.getByTestId('session-wizard-folder-role-fb-base'))
    next()
    await screen.findByTestId('session-wizard-build')
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sources: ['b1', 'b2'] }),
      { b1: 'base', b2: 'base' },
    )
  })
})

describe('SessionWizard for assistive technology', () => {
  it('names the role buttons of every row after its playlist', () => {
    setup()
    toSources()
    fireEvent.click(screen.getByTestId('playlists-folder-rem'))
    expect(
      screen.getByRole('group', { name: i18n.t('sessions.role.of', { name: 'Bases 90' }) }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: i18n.t('sessions.role.of', { name: 'COMBOS' }) }),
    ).toBeInTheDocument()
  })

  it('reads the time each track plays with its unit, not as a bare number', () => {
    setup({ b90: 'base' })
    expect(screen.getByTestId('session-wizard-play')).toHaveAttribute(
      'aria-valuetext',
      i18n.t('sessions.wizard.character.playValue', { minutes: 3 }),
    )
  })

  it('reads the share of new tracks as a percentage', async () => {
    const today = new Date().toISOString().slice(0, 10)
    setup(
      { b90: 'base' },
      INITIAL,
      fakeRows({
        b90: [
          { path: '/m/k.mp3', separator: false, meta: { rating: 80, dateAdded: '2025-01-01' } },
          { path: '/m/n.mp3', separator: false, meta: { dateAdded: today } },
        ],
      }),
    )
    await toCharacter()
    expect(screen.getByTestId('session-wizard-fresh-share')).toHaveAttribute(
      'aria-valuetext',
      i18n.t('sessions.wizard.fresh.shareValue', { percent: 15 }),
    )
  })

  it('announces a problem when building fails, without taking the focus', async () => {
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockResolvedValue('refused')
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('sessions.wizard.refused'))
  })
})

describe('SessionWizard playlists that are not playlists', () => {
  it('leaves out the playlists that are only a line of dashes, which DJs use as separators', () => {
    setup()
    toSources()
    expect(screen.queryByTestId('playlists-row-sep')).toBeNull()
    expect(screen.getByTestId('playlists-search')).toHaveAttribute(
      'placeholder',
      i18n.t('sessions.wizard.sources.search', { count: 5 }),
    )
  })
})

describe('SessionWizard keeping the view when going back', () => {
  it('keeps the list of only the chosen playlists after going back from the last step', async () => {
    setup({ b90: 'base', c90: 'vocal' })
    toSources()
    fireEvent.click(screen.getByTestId('session-wizard-only-chosen'))
    next()
    await screen.findByTestId('session-wizard-build')
    fireEvent.click(screen.getByTestId('session-wizard-back'))
    expect(screen.getByTestId('session-wizard-only-chosen')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('playlists-row-mak')).toBeNull()
  })
})

describe('SessionWizard keyboard', () => {
  const commandEnter = () => fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

  it('goes on to the next step with Command and Enter', () => {
    setup({ b90: 'base' })
    commandEnter()
    expect(screen.getByTestId('session-wizard-step-title')).toHaveTextContent(
      i18n.t('sessions.wizard.sources.heading'),
    )
  })

  it('also takes Control and Enter, for Windows', () => {
    setup({ b90: 'base' })
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(screen.getByTestId('session-wizard-step-title')).toHaveTextContent(
      i18n.t('sessions.wizard.sources.heading'),
    )
  })

  it('does not go on while the step is blocked, like Next itself', () => {
    setup()
    toSources()
    commandEnter()
    expect(screen.getByTestId('session-wizard-step-title')).toHaveTextContent(
      i18n.t('sessions.wizard.sources.heading'),
    )
  })

  it('builds from the last step', async () => {
    const { onBuild } = setup({ b90: 'base' })
    await toCharacter()
    commandEnter()
    expect(onBuild).toHaveBeenCalledOnce()
  })

  it('does not build twice while it is already writing', async () => {
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockImplementation(() => new Promise<BuildResult>(() => {}))
    await toCharacter()
    commandEnter()
    commandEnter()
    expect(onBuild).toHaveBeenCalledOnce()
  })

  it('leaves a plain Enter alone, so typing in a field does not move the wizard', () => {
    setup({ b90: 'base' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('session-wizard-duration-90')).toBeInTheDocument()
  })
})

describe('SessionWizard combos without Mixed playlists', () => {
  it('warns under Prefer combos when no Mixed playlist was chosen, since there is no order to read', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    expect(screen.getByTestId('session-wizard-combos-hint')).toHaveTextContent(
      i18n.t('sessions.wizard.character.noMixed'),
    )
  })

  it('says nothing when a Mixed playlist was chosen', async () => {
    setup({ b90: 'base', combos: 'any' })
    await toCharacter()
    expect(screen.queryByTestId('session-wizard-combos-hint')).toBeNull()
  })

  it('says nothing once Prefer combos is switched off', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-opt-preferCombos'))
    expect(screen.queryByTestId('session-wizard-combos-hint')).toBeNull()
  })
})

describe('SessionWizard wording', () => {
  it('explains in the playlists step what Mixed is for, since the order of those playlists makes the combos', () => {
    setup()
    toSources()
    expect(screen.getByTestId('session-wizard-sources-hint')).toHaveTextContent(
      i18n.t('sessions.role.any'),
    )
  })

  it('does not promise to remember playlists, since it opens empty every time', () => {
    setup()
    toSources()
    const hint = i18n.t('sessions.wizard.sources.hint')
    expect(hint).not.toMatch(/next time|próxima vez|nächsten Mal|prochaine fois|次回|próxima vez/i)
  })

  it('is called by the same name as the menu item that opens it', () => {
    setup()
    const menu = i18n.t('sources.tree.newSession')
    expect(menu.startsWith(i18n.t('sessions.wizard.title'))).toBe(true)
    expect(menu.startsWith(i18n.t('sessions.band.title'))).toBe(true)
  })

  it('says harmonic mixing is Camelot', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    expect(screen.getByTestId('session-wizard-harmony-title')).toHaveTextContent('Camelot')
  })
})

describe('SessionWizard where it writes', () => {
  it('says the name and the folder of the playlist it is going to create, before building', async () => {
    setup({ b90: 'base' })
    await toCharacter()
    const line = screen.getByTestId('session-wizard-destination')
    expect(line).toHaveTextContent('Session 11-9 (2)')
    expect(line).toHaveTextContent('COMBOS')
  })

  it('names no folder when the playlist goes to the top of the tree', async () => {
    setup({ b90: 'base' }, INITIAL, fakeRows(), { kind: 'new', name: 'Session 11-9', where: null })
    await toCharacter()
    const line = screen.getByTestId('session-wizard-destination')
    expect(line).toHaveTextContent('Session 11-9')
    expect(line.textContent).not.toContain('null')
  })

  it('says it will fill the playlist when it was opened on an empty one', async () => {
    setup({ b90: 'base' }, INITIAL, fakeRows(), { kind: 'fill', name: 'Session 11-9', where: null })
    await toCharacter()
    expect(screen.getByTestId('session-wizard-destination')).toHaveTextContent(
      i18n.t('sessions.wizard.destinationFill', { name: 'Session 11-9' }),
    )
  })

  it('says it will replace the playlist when it was opened to adjust one', async () => {
    setup({ b90: 'base' }, INITIAL, fakeRows(), {
      kind: 'replace',
      name: 'Session 11-9',
      where: null,
    })
    await toCharacter()
    expect(screen.getByTestId('session-wizard-destination')).toHaveTextContent(
      i18n.t('sessions.wizard.destinationReplace', { name: 'Session 11-9' }),
    )
  })

  it('keeps it out of the steps before the last one', () => {
    setup({ b90: 'base' })
    toSources()
    expect(screen.queryByTestId('session-wizard-destination')).toBeNull()
  })

  it('turns the Build button into a Building label with the busy state while it writes', async () => {
    let finish: (result: BuildResult) => void = () => {}
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockImplementation(() => new Promise<BuildResult>((resolve) => (finish = resolve)))
    await toCharacter()
    const button = screen.getByTestId('session-wizard-build')
    expect(button).toHaveTextContent(i18n.t('sessions.wizard.build'))
    expect(button).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(button)
    expect(button).toHaveTextContent(i18n.t('sessions.wizard.building'))
    expect(button).toHaveAttribute('aria-busy', 'true')
    finish('refused')
    await waitFor(() => expect(button).toHaveTextContent(i18n.t('sessions.wizard.build')))
  })
})

describe('SessionWizard while building', () => {
  it('blocks Build until the session is written, then lets the parent close it', async () => {
    let finish: (result: BuildResult) => void = () => {}
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockImplementation(() => new Promise<BuildResult>((resolve) => (finish = resolve)))
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(screen.getByTestId('session-wizard-build')).toBeDisabled()
    finish('built')
    await waitFor(() => expect(screen.getByTestId('session-wizard-build')).toBeEnabled())
    expect(screen.queryByTestId('session-wizard-empty')).toBeNull()
  })

  it('stays open and lets the user try again when the write was refused', async () => {
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockResolvedValue('refused')
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await waitFor(() => expect(screen.getByTestId('session-wizard-build')).toBeEnabled())
    expect(screen.queryByTestId('session-wizard-empty')).toBeNull()
    expect(screen.getByTestId('session-wizard-refused')).toHaveTextContent(
      i18n.t('sessions.wizard.refused'),
    )
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledTimes(2)
  })

  it('shows one message at a time and clears it when the next try starts', async () => {
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockResolvedValueOnce('refused').mockResolvedValueOnce('empty')
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await screen.findByTestId('session-wizard-refused')
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await screen.findByTestId('session-wizard-empty')
    expect(screen.queryByTestId('session-wizard-refused')).toBeNull()
    expect(screen.queryByTestId('session-wizard-closed')).toBeNull()
  })

  it('asks to close the DJ program when it is open, and lets the user try again', async () => {
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockResolvedValueOnce('closed')
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(await screen.findByTestId('session-wizard-closed')).toHaveTextContent(
      i18n.t('sessions.closed'),
    )
    expect(screen.getByTestId('session-wizard-build')).toBeEnabled()
    expect(screen.queryByTestId('session-wizard-empty')).toBeNull()
    onBuild.mockResolvedValueOnce('refused')
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await waitFor(() => expect(screen.queryByTestId('session-wizard-closed')).toBeNull())
  })

  it('says so when the chosen playlists have no track to build with', async () => {
    const { onBuild } = setup({ b90: 'base' })
    onBuild.mockResolvedValue('empty')
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(await screen.findByTestId('session-wizard-empty')).toBeInTheDocument()
  })
})

describe('SessionWizard closing', () => {
  it('closes with the cross and the backdrop without building anything', () => {
    const { onClose, onBuild } = setup()
    fireEvent.click(screen.getByTestId('session-wizard-close'))
    fireEvent.click(screen.getByTestId('session-wizard-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onBuild).not.toHaveBeenCalled()
  })
})
