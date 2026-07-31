// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ShortcutsTab reads window.api.platform at module load, so stub it before import.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import {
  findConflicts,
  resolveBindings,
  SHORTCUT_DEFAULTS,
} from '../../../../shared/shortcutDefaults'
import type { SyncedDraft } from '../../lib/settingsDraft'
import '../../i18n'
import { ShortcutsTab } from './ShortcutsTab'

afterEach(cleanup)

const synced: SyncedDraft = {
  shortcutOverrides: {},
} as SyncedDraft

function renderTab(): void {
  const bindings = resolveBindings(synced.shortcutOverrides)
  const conflictIds = new Set(findConflicts(bindings).flat())
  render(
    <ShortcutsTab synced={synced} patch={vi.fn()} bindings={bindings} conflictIds={conflictIds} />,
  )
}

// The trim commands only fire with the focus on a silence-editor handle, unlike every
// other row in this tab — a user rebinding one of them needs to see that scope called
// out, not find it mixed in with the global commands as if 'a' worked everywhere.
describe('ShortcutsTab trim group', () => {
  it('lists the silence editor commands under their own group', () => {
    renderTab()
    expect(screen.getByTestId('shortcut-group-trim')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-trim-audition')).toBeInTheDocument()
  })

  it('keeps the global commands out of the trim group', () => {
    renderTab()
    const trimGroup = screen.getByTestId('shortcut-group-trim')
    expect(trimGroup.querySelector('[data-testid="shortcut-row-play"]')).toBeNull()
  })
})

// Un comando con ámbito propio no puede desaparecer del tab: si no tiene fila, el usuario
// no puede reasignarlo, y reasignarlo es justo lo que necesita quien no tiene la tecla.
describe('ShortcutsTab agrupa por ámbito', () => {
  it('lista los comandos de la lista de pistas en su propio grupo', () => {
    renderTab()
    const group = screen.getByTestId('shortcut-group-track-list')
    expect(group.querySelector('[data-testid="shortcut-row-track-menu"]')).not.toBeNull()
  })

  it('da una fila a cada comando de la tabla', () => {
    renderTab()
    for (const def of SHORTCUT_DEFAULTS) {
      expect(screen.getByTestId(`shortcut-row-${def.id}`)).toBeInTheDocument()
    }
  })
})
