// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import type { Command } from '../lib/commands'
import { CommandPalette } from './CommandPalette'

afterEach(cleanup)

function cmd(over: Partial<Command> & { id: string }): Command {
  return { title: over.id, enabled: true, run: () => {}, ...over }
}

describe('CommandPalette', () => {
  it('runs an enabled command and closes when its item is clicked', () => {
    const run = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette commands={[cmd({ id: 'a', title: 'Add', run })]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not run a disabled command', () => {
    const run = vi.fn()
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add', enabled: false, run })]}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(run).not.toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={[cmd({ id: 'a' })]} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('palette-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('filters commands by the query', () => {
    render(
      <CommandPalette
        commands={[cmd({ id: 'a', title: 'Add files' }), cmd({ id: 'b', title: 'Settings' })]}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'sett' } })
    expect(screen.getAllByTestId('palette-item')).toHaveLength(1)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
