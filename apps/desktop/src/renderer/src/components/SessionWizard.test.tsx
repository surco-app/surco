// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
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

function setup(roles: Record<string, PlaylistRole> = {}, initial: SessionAnswers = INITIAL) {
  const onRole = vi.fn()
  const onClose = vi.fn()
  const onBuild = vi.fn()
  render(
    <SessionWizard
      program="rekordbox"
      tree={TREE}
      roles={roles}
      initial={initial}
      onRole={onRole}
      onClose={onClose}
      onBuild={onBuild}
    />,
  )
  return { onRole, onClose, onBuild }
}

const next = () => fireEvent.click(screen.getByTestId('session-wizard-next'))
const toSources = () => next()

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

describe('SessionWizard closing', () => {
  it('closes with the cross and the backdrop without building anything', () => {
    const { onClose, onBuild } = setup()
    fireEvent.click(screen.getByTestId('session-wizard-close'))
    fireEvent.click(screen.getByTestId('session-wizard-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onBuild).not.toHaveBeenCalled()
  })
})
