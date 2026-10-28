// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../../preload/api'
import { type CueFlow, MIX_IN, MY_FLOW } from '../../../../shared/cueFlows'
import type { CueProfile, CueProfileRead } from '../../../../shared/cueProfile'
import '../../i18n'
import { installApi } from '../../test/api'
import { CueProfileCard } from './CueProfileCard'

afterEach(cleanup)

const COUNTDOWN = MY_FLOW.rules[0]

const PROFILE: CueProfile = {
  learnedAt: '2026-10-28T10:00:00.000Z',
  sources: { rekordbox: 1576, edits: 42 },
  taste: null,
  check: {
    tracks: 1618,
    checked: 480,
    before: { found: 0.68, right: 0.68 },
    after: { found: 0.68, right: 0.68 },
  },
  flow: { id: 'learned', name: '', markPoint: true, rules: [COUNTDOWN] },
  coverage: { matching: 1161, marked: 1576 },
  paired: 0.995,
  start: { open: 322, withStart: 44 },
}

const read = (over: Partial<CueProfileRead> = {}): CueProfileRead => ({
  profile: null,
  edits: { count: 0, sinceLearn: 0 },
  marked: 1576,
  ...over,
})

let last: { cueFlows: CueFlow[]; activeCueFlow: string; cueLearnFromEdits: boolean } | null = null

function Harness({ flows = [MIX_IN] }: { flows?: CueFlow[] }) {
  const [draft, setDraft] = useState({
    cueFlows: flows,
    activeCueFlow: MIX_IN.id,
    cueLearnFromEdits: true,
  })
  last = draft
  return (
    <CueProfileCard
      synced={draft}
      patch={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      onAdopt={vi.fn()}
    />
  )
}

function setup(first: CueProfileRead, learned: Promise<CueProfile> = Promise.resolve(PROFILE)) {
  let changed: () => void = () => {}
  const api = installApi({
    cueProfile: vi.fn<Api['cueProfile']>(async () => first),
    learnCueProfile: vi.fn<Api['learnCueProfile']>(() => learned),
    onCueProfileChanged: (cb) => {
      changed = cb
      return () => {}
    },
  })
  render(<Harness />)
  return { api, changed: () => changed() }
}

describe('CueProfileCard', () => {
  it('invites the DJ to teach Surco, saying how many marked tracks each source has', async () => {
    setup(read({ edits: { count: 3, sinceLearn: 3 } }))
    const card = await screen.findByTestId('cue-profile')
    expect(card).toHaveTextContent('Teach Surco how you mark')
    expect(screen.getByTestId('cue-profile-source-rekordbox')).toHaveTextContent('1,576')
    expect(screen.getByTestId('cue-profile-source-edits')).toHaveTextContent('3')
    expect(screen.getByTestId('cue-profile-learn')).toBeEnabled()
  })

  it('leaves out a source with nothing in it', async () => {
    setup(read())
    await screen.findByTestId('cue-profile')
    expect(screen.queryByTestId('cue-profile-source-edits')).toBeNull()
  })

  it('says Auto uses the general model until there is something to learn from, the button there but off', async () => {
    setup(read({ marked: 0 }))
    expect(await screen.findByTestId('cue-profile-nothing')).toBeInTheDocument()
    expect(screen.getByTestId('cue-profile-learn')).toBeDisabled()
  })

  it('learns on request and then shows what it learned', async () => {
    let finish: (p: CueProfile) => void = () => {}
    const { api } = setup(
      read(),
      new Promise((done) => {
        finish = done
      }),
    )
    fireEvent.click(await screen.findByTestId('cue-profile-learn'))
    expect(screen.getByTestId('cue-profile-learn')).toBeDisabled()
    await act(async () => finish(PROFILE))
    expect(api.learnCueProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('cue-profile')).toHaveTextContent('How you mark')
    expect(screen.getByTestId('cue-profile-summary')).toHaveTextContent('1,618 tracks')
  })

  it('says how often Auto finds where the DJ marks, and that the general model already fits when nothing was tuned', async () => {
    setup(read({ profile: PROFILE }))
    const auto = await screen.findByTestId('cue-profile-auto')
    expect(auto).toHaveTextContent('7 in 10')
    expect(auto).toHaveTextContent('general model already fits')
  })

  it('says Auto was tuned to the DJ and how it did before', async () => {
    const tuned: CueProfile = {
      ...PROFILE,
      taste: { trees: [[[0.5]]], picking: { threshold: 0, spacingBars: 16, maxDrops: 2 } },
      check: {
        tracks: 1618,
        checked: 480,
        before: { found: 0.4, right: 0.2 },
        after: { found: 0.6, right: 0.5 },
      },
    }
    setup(read({ profile: tuned }))
    const auto = await screen.findByTestId('cue-profile-auto')
    expect(auto).toHaveTextContent('6 in 10')
    expect(auto).toHaveTextContent('Tuned to you')
    expect(auto).toHaveTextContent('4')
  })

  it('says Auto needs more marked tracks before it can be tuned', async () => {
    setup(read({ profile: { ...PROFILE, check: null } }))
    expect(await screen.findByTestId('cue-profile-auto')).toHaveTextContent('30')
  })

  it('shows the countdown it learned with its distances and how often a CALL goes under, and the start cue', async () => {
    setup(read({ profile: PROFILE }))
    const countdown = await screen.findByTestId('cue-profile-countdown')
    expect(countdown).toHaveTextContent('48 · 32 · 16 bars')
    expect(countdown).toHaveTextContent('99.5')
    expect(screen.getByTestId('cue-profile-start')).toHaveTextContent('44 of 322')
  })

  it('offers the learned countdown as a flow until one like it exists', async () => {
    setup(read({ profile: PROFILE }))
    fireEvent.click(await screen.findByTestId('cue-profile-use-flow'))
    const made = last?.cueFlows.find((f) => f.id !== MIX_IN.id)
    expect(made?.rules).toEqual([COUNTDOWN])
    expect(last?.activeCueFlow).toBe(made?.id)
    expect(screen.queryByTestId('cue-profile-use-flow')).toBeNull()
  })

  it('lets the DJ stop Auto from learning from what they save', async () => {
    setup(read({ profile: PROFILE }))
    fireEvent.click(await screen.findByTestId('settings-cue-learn-from-edits'))
    expect(last?.cueLearnFromEdits).toBe(false)
  })

  it('shows a profile learned in the background as soon as it lands', async () => {
    const { api, changed } = setup(read())
    await screen.findByTestId('cue-profile-learn')
    vi.mocked(api.cueProfile).mockResolvedValue(read({ profile: PROFILE }))
    act(() => changed())
    await waitFor(() => expect(screen.getByTestId('cue-profile-summary')).toBeInTheDocument())
  })

  it('says the collection could not be read instead of spinning forever', async () => {
    const locked = Promise.reject(new Error('locked'))
    locked.catch(() => {})
    setup(read(), locked)
    fireEvent.click(await screen.findByTestId('cue-profile-learn'))
    expect(await screen.findByTestId('cue-profile-failed')).toBeInTheDocument()
    expect(screen.getByTestId('cue-profile-learn')).toBeEnabled()
  })
})
