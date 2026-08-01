// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import type { PatchSynced } from '../../lib/settingsTabs'
import '../../i18n'
import { ShortcutsTab } from './ShortcutsTab'

afterEach(cleanup)

const synced: SyncedDraft = {
  shortcutOverrides: {},
} as SyncedDraft

function renderTab(patch: PatchSynced = vi.fn()): void {
  const bindings = resolveBindings(synced.shortcutOverrides)
  const conflictIds = new Set(findConflicts(bindings).flat())
  render(
    <ShortcutsTab synced={synced} patch={patch} bindings={bindings} conflictIds={conflictIds} />,
  )
}

// The trim commands only fire with the focus on a silence-editor handle, unlike every
// other row in this tab — a user rebinding one of them needs to see that scope called
// out, not find it mixed in with the global commands as if 'a' worked everywhere.
describe('ShortcutsTab trim group', () => {
  it('lists the silence editor commands under their own group', () => {
    renderTab()
    expect(screen.getByTestId('shortcut-group-trim')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-trim-start-audition')).toBeInTheDocument()
  })

  it('keeps the global commands out of the trim group', () => {
    renderTab()
    const trimGroup = screen.getByTestId('shortcut-group-trim')
    expect(trimGroup.querySelector('[data-testid="shortcut-row-play"]')).toBeNull()
  })

  // A missing translation renders the key itself, so the panel printed
  // "settings.shortcuts.groupHintTrim" where the sentence belongs. Asserting no group
  // header leaks a raw key catches the next scope added without its two strings.
  it('translates every group heading and hint', () => {
    renderTab()
    for (const group of screen.getAllByTestId(/^shortcut-group-/)) {
      expect(group.textContent).not.toContain('settings.shortcuts.')
    }
  })
})

// Doce filas seguidas sin ningún corte — convertir, añadir ficheros, buscar y reemplazar,
// revelar, ajustes, reproducir, pista siguiente — obligan a leer la lista entera para dar
// con una tecla. La paleta ya reparte estos mismos comandos por lo que hacen, así que el
// tab toma prestada esa clasificación en vez de inventar una segunda que acabaría
// divergiendo de ella.
describe('ShortcutsTab agrupa por función', () => {
  it('agrupa las filas por lo que hace el comando', () => {
    renderTab()
    expect(screen.getByTestId('shortcut-group-convert')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-group-playback')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-group-navigate')).toBeInTheDocument()
  })

  it('archiva cada comando en su grupo y en ningún otro', () => {
    renderTab()
    const convert = screen.getByTestId('shortcut-group-convert')
    expect(convert.querySelector('[data-testid="shortcut-row-process-current"]')).not.toBeNull()
    expect(convert.querySelector('[data-testid="shortcut-row-play"]')).toBeNull()
  })

  // Los saltos de sección y el menú de pista los ejecuta un componente, no el registro, así
  // que declaran su grupo en la tabla. Son navegación igualmente y van con el resto, no en
  // un cajón aparte.
  it('archiva con la navegación los comandos que ejecuta un componente', () => {
    renderTab()
    const navigate = screen.getByTestId('shortcut-group-navigate')
    expect(navigate.querySelector('[data-testid="shortcut-row-section-next"]')).not.toBeNull()
    expect(navigate.querySelector('[data-testid="shortcut-row-track-menu"]')).not.toBeNull()
  })

  // Nada puede escaparse de la agrupación: un comando sin sitio desaparecería del tab, y un
  // atajo que no se ve es uno que no se puede reasignar.
  it('no deja ningún comando sin grupo', () => {
    renderTab()
    for (const row of screen.getAllByTestId(/^shortcut-row-/)) {
      expect(row.closest('[data-testid^="shortcut-group-"]')).not.toBeNull()
    }
  })

  it('da una fila a cada comando de la tabla', () => {
    renderTab()
    for (const def of SHORTCUT_DEFAULTS) {
      expect(screen.getByTestId(`shortcut-row-${def.id}`)).toBeInTheDocument()
    }
  })
})

// El reporte que originó esto: "option+E control+E o option+E no funciona, no hace
// nada". El chord no se formaba, así que el grabador descartaba la pulsación en
// silencio y el usuario no tenía forma de saber por qué.
it('graba una combinación con option', () => {
  const patch = vi.fn()
  renderTab(patch)
  const boton = screen.getByTestId('shortcut-record-play')
  fireEvent.click(boton)
  fireEvent.keyDown(boton, { key: '´', code: 'KeyE', altKey: true })
  expect(patch).toHaveBeenCalledWith(
    'shortcutOverrides',
    expect.objectContaining({ play: ['alt', 'e'] }),
  )
})
