// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_FLOWS, MY_FLOW } from '../../../../shared/cueFlows'
import i18n from '../../i18n'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { CuesTab } from './CuesTab'

let afterTest: (() => unknown) | null = null

afterEach(async () => {
  cleanup()
  await afterTest?.()
  afterTest = null
})

let last: Pick<SyncedDraft, 'cueFlows' | 'activeCueFlow'> | null = null

function Harness({ active = 'mine' }: { active?: string }) {
  const [draft, setDraft] = useState({ cueFlows: BUNDLED_FLOWS, activeCueFlow: active })
  last = draft
  return (
    <CuesTab
      synced={draft as unknown as SyncedDraft}
      patch={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
    />
  )
}

describe('CuesTab', () => {
  it('lists the bundled flows by their translated names with Mi flujo in use', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(
      within(screen.getByTestId('cue-flows'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining(['Mi flujo', 'Una cue a 32', 'Solo CALL']))
    expect(screen.getByTestId('cue-flow-in-use')).toBeInTheDocument()
  })

  it('recalculates the preview live when a block changes', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('cue-rule-0-repeat'), { target: { value: '1' } })
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.rules[0].repeat).toBe(1)
  })

  it('adds and removes a rule', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-flow-calls-only'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-add'))
    expect(screen.getByTestId('cue-rule-0')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-remove'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
  })

  it('hides direction and repeat for a cue on the origin itself', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-rule-1-direction')).toBeNull()
    expect(screen.queryByTestId('cue-rule-1-repeat')).toBeNull()
  })

  it('warns that a loose CALL from a rule reads as a drop next time', () => {
    render(<Harness />)
    fireEvent.change(screen.getByTestId('cue-rule-0-place'), { target: { value: 'call' } })
    expect(screen.getByTestId('cue-rule-0-loose-call')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-rule-0-color-mode')).toBeNull()
  })

  it('creates a flow, names it and makes it the one in use', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-flow-new'))
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mis 64' } })
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    const made = last?.cueFlows.find((f) => f.name === 'Mis 64')
    expect(made).toBeDefined()
    expect(last?.activeCueFlow).toBe(made?.id)
  })

  it('never offers to delete Mi flujo but restores it to rules.py', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    fireEvent.change(screen.getByTestId('cue-rule-0-bars'), { target: { value: '8' } })
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')).toEqual(MY_FLOW)
  })

  it('deletes another flow and falls back to Mi flujo when it was in use', () => {
    render(<Harness active="one-at-32" />)
    fireEvent.click(screen.getByTestId('cue-flow-one-at-32'))
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mine', 'calls-only'])
    expect(last?.activeCueFlow).toBe('mine')
  })
})
