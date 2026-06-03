import { describe, expect, it, vi } from 'vitest'
import { type Command, filterCommands, runCommand } from './commands'

function cmd(id: string, title: string): Command {
  return { id, title, enabled: true, run: () => {} }
}

const commands = [
  cmd('add', 'Añadir archivos'),
  cmd('settings', 'Ajustes'),
  cmd('all', 'Procesar todo'),
]

describe('filterCommands', () => {
  it('returns every command when the query is empty, so the menu is browsable', () => {
    expect(filterCommands(commands, '').map((c) => c.id)).toEqual(['add', 'settings', 'all'])
  })

  it('matches case-insensitively on a substring of the title', () => {
    expect(filterCommands(commands, 'proc').map((c) => c.id)).toEqual(['all'])
    expect(filterCommands(commands, 'AJUSTES').map((c) => c.id)).toEqual(['settings'])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(filterCommands(commands, '  add ').map((c) => c.id)).toEqual([])
    expect(filterCommands(commands, '  añadir ').map((c) => c.id)).toEqual(['add'])
  })

  it('returns nothing when no title matches', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([])
  })
})

describe('runCommand', () => {
  // The palette, the keyboard shortcuts and the native menu all trigger actions
  // by command id. Routing them through one runner keeps the three in sync and
  // enforces the `enabled` gate in a single place, so a disabled action can
  // never fire no matter which surface invoked it.
  it('runs the matching command when it is enabled', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: true, run }], 'add')
    expect(run).toHaveBeenCalledOnce()
  })

  it('never runs a disabled command', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: false, run }], 'add')
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing for an unknown id', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: true, run }], 'missing')
    expect(run).not.toHaveBeenCalled()
  })
})
