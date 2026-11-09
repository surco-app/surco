// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import type { SessionRows } from '../hooks/useSessionRows'
import type { BuildResult } from '../hooks/useSessionRun'
import i18n from '../i18n'
import { SessionWizard } from './SessionWizard'

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
]

const INITIAL: SessionAnswers = {
  minutes: 90,
  sources: [],
  fresh: [],
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
  return { load, loading: false, failed }
}

function setup(
  roles: Record<string, PlaylistRole> = {},
  initial: SessionAnswers = INITIAL,
  rows: SessionRows = fakeRows(),
) {
  const onRole = vi.fn()
  const onClose = vi.fn()
  const onBuild = vi.fn()
  render(
    <SessionWizard
      tree={TREE}
      roles={roles}
      initial={initial}
      rows={rows}
      onRole={onRole}
      onClose={onClose}
      onBuild={onBuild}
    />,
  )
  return { onRole, onClose, onBuild, rows }
}

const next = () => fireEvent.click(screen.getByTestId('session-wizard-next'))
const toSources = () => next()
const toFresh = async () => {
  toSources()
  next()
  await screen.findByTestId('session-wizard-fresh-search')
}
const toCharacter = async () => {
  await toFresh()
  next()
  await screen.findByTestId('session-wizard-build')
}

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
  it('goes to the playlists step and moves the focus to its heading', () => {
    setup()
    toSources()
    expect(screen.getByTestId('session-wizard-step-title')).toHaveTextContent(
      i18n.t('sessions.wizard.sources.heading'),
    )
    expect(screen.getByTestId('session-wizard-step-title')).toHaveFocus()
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
    fireEvent.change(screen.getByTestId('session-wizard-search'), { target: { value: 'XATIVA' } })
    expect(screen.getByTestId('session-wizard-hit-mak')).toBeInTheDocument()
    expect(screen.queryByTestId('session-wizard-hit-b90')).toBeNull()
    fireEvent.change(screen.getByTestId('session-wizard-search'), { target: { value: 'mak' } })
    expect(screen.getByTestId('session-wizard-hit-mak')).toBeInTheDocument()
    expect(screen.getByTestId('session-wizard-hit-mk97')).toBeInTheDocument()
  })

  it('says so when nothing matches', () => {
    setup()
    toSources()
    fireEvent.change(screen.getByTestId('session-wizard-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('session-wizard-no-hits')).toBeInTheDocument()
  })

  it('shows a chip in the group of the role it was given and tells the app', () => {
    const { onRole } = setup()
    toSources()
    fireEvent.change(screen.getByTestId('session-wizard-search'), { target: { value: 'mak' } })
    fireEvent.click(screen.getByTestId('session-wizard-hit-role-mk97-base'))
    expect(onRole).toHaveBeenCalledExactlyOnceWith('mk97', 'base')
    const group = screen.getByTestId('session-wizard-group-base')
    expect(within(group).getByTestId('session-wizard-chip-mk97')).toBeInTheDocument()
  })

  it('takes the chip away and clears the role when the active role is pressed again', () => {
    const { onRole } = setup({ mk97: 'base' })
    toSources()
    fireEvent.change(screen.getByTestId('session-wizard-search'), { target: { value: 'mk97' } })
    fireEvent.change(screen.getByTestId('session-wizard-search'), { target: { value: 'bases 97' } })
    fireEvent.click(screen.getByTestId('session-wizard-hit-role-mk97-base'))
    expect(onRole).toHaveBeenCalledExactlyOnceWith('mk97', null)
    expect(screen.queryByTestId('session-wizard-chip-mk97')).toBeNull()
  })

  it('opens with the playlists already marked in the tree, each in its own group', () => {
    setup({ b90: 'base', c90: 'vocal', combos: 'set' })
    toSources()
    expect(
      within(screen.getByTestId('session-wizard-group-base')).getByTestId(
        'session-wizard-chip-b90',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('session-wizard-group-vocal')).getByTestId(
        'session-wizard-chip-c90',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('session-wizard-group-set')).getByTestId(
        'session-wizard-chip-combos',
      ),
    ).toBeInTheDocument()
  })

  it('drops a chip for this session with the cross without forgetting its role', () => {
    const { onRole } = setup({ b90: 'base' })
    toSources()
    fireEvent.click(screen.getByTestId('session-wizard-chip-remove-b90'))
    expect(screen.queryByTestId('session-wizard-chip-b90')).toBeNull()
    expect(onRole).not.toHaveBeenCalled()
  })

  it('ignores a marked playlist that is no longer in the tree', () => {
    setup({ gone: 'base', b90: 'base' })
    toSources()
    expect(screen.queryByTestId('session-wizard-chip-gone')).toBeNull()
    expect(screen.getByTestId('session-wizard-chip-b90')).toBeInTheDocument()
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
    setup({ b90: 'base', c90: 'vocal' })
    toSources()
    expect(screen.getByTestId('session-wizard-eligible')).toHaveTextContent('99')
  })
})

describe('SessionWizard reading the chosen playlists', () => {
  it('reads the chosen source playlists when leaving the playlists step', async () => {
    const { rows } = setup({ b90: 'base', c90: 'vocal' })
    toSources()
    next()
    await screen.findByTestId('session-wizard-fresh-search')
    expect(rows.load).toHaveBeenCalledTimes(1)
    expect(rows.load).toHaveBeenCalledWith(['b90', 'c90'])
  })

  it('shows it is reading while the playlists load, and blocks pressing again', async () => {
    type Loaded = ReadonlyMap<string, readonly SourcePlaylistEntry[]>
    let release: (value: Loaded) => void = () => {}
    const rows: SessionRows = {
      load: vi.fn(() => new Promise<Loaded>((resolve) => (release = resolve))),
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
    await screen.findByTestId('session-wizard-fresh-search')
  })

  it('also reads the new-track playlists when leaving that step', async () => {
    const { rows } = setup({ b90: 'base' })
    await toFresh()
    fireEvent.change(screen.getByTestId('session-wizard-fresh-search'), {
      target: { value: 'mak' },
    })
    fireEvent.click(screen.getByTestId('session-wizard-fresh-add-mak'))
    next()
    await screen.findByTestId('session-wizard-build')
    expect(rows.load).toHaveBeenLastCalledWith(['mak'])
  })

  it('names a playlist that could not be read and goes on without it', async () => {
    setup({ b90: 'base', c90: 'vocal' }, INITIAL, fakeRows({}, ['c90']))
    toSources()
    next()
    expect(await screen.findByTestId('session-wizard-load-failed')).toHaveTextContent(
      'Cantaditas 90',
    )
    expect(screen.getByTestId('session-wizard-next')).toBeEnabled()
  })
})

describe('SessionWizard new tracks step', () => {
  it('lets the step be skipped, leaving no new playlists and no share', async () => {
    const { onBuild } = setup({ b90: 'base' })
    await toCharacter()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fresh: [], freshShare: 0, sources: ['b90'] }),
    )
  })

  it('adds a playlist of new tracks and takes the share from the slider', async () => {
    const { onBuild } = setup({ b90: 'base' })
    await toFresh()
    fireEvent.change(screen.getByTestId('session-wizard-fresh-search'), {
      target: { value: 'xativa' },
    })
    fireEvent.click(screen.getByTestId('session-wizard-fresh-add-mak'))
    expect(screen.getByTestId('session-wizard-fresh-chip-mak')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('session-wizard-fresh-share'), { target: { value: '30' } })
    next()
    await screen.findByTestId('session-wizard-build')
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fresh: ['mak'], freshShare: 0.3 }),
    )
  })

  it('keeps the share between 0 and 40 and off until a playlist is chosen', async () => {
    setup({ b90: 'base' })
    await toFresh()
    const slider = screen.getByTestId('session-wizard-fresh-share')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '40')
    expect(slider).toBeDisabled()
    fireEvent.change(screen.getByTestId('session-wizard-fresh-search'), {
      target: { value: 'mak' },
    })
    fireEvent.click(screen.getByTestId('session-wizard-fresh-add-mak'))
    expect(slider).toBeEnabled()
  })

  it('takes a new-track playlist away with its cross', async () => {
    setup({ b90: 'base' })
    await toFresh()
    fireEvent.change(screen.getByTestId('session-wizard-fresh-search'), {
      target: { value: 'mak' },
    })
    fireEvent.click(screen.getByTestId('session-wizard-fresh-add-mak'))
    fireEvent.click(screen.getByTestId('session-wizard-fresh-chip-remove-mak'))
    expect(screen.queryByTestId('session-wizard-fresh-chip-mak')).toBeNull()
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
    expect(onBuild).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ harmony: 'free' }))
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
    expect(onBuild).toHaveBeenCalledExactlyOnceWith({
      minutes: 120,
      sources: ['b90', 'c90'],
      fresh: [],
      freshShare: 0,
      preferCombos: true,
      harmony: 'neighbours',
      tasteWeight: true,
      alternate: true,
      surprise: true,
    })
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
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    expect(onBuild).toHaveBeenCalledTimes(2)
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
