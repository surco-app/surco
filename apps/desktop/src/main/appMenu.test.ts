import { describe, expect, it, vi } from 'vitest'
import { appMenuTemplate } from './appMenu'
import { createMenuT } from './i18n'

type Item = Electron.MenuItemConstructorOptions

function build(locale = 'en') {
  const run = vi.fn()
  const template = appMenuTemplate({
    appName: 'Surco',
    t: createMenuT(locale),
    accel: (id) => `accel:${id}`,
    run,
    checkForUpdates: vi.fn(),
  })
  return { template, run }
}

function menu(template: Item[], label: string): Item[] {
  const found = template.find((m) => m.label === label)
  if (!found) throw new Error(`no ${label} menu`)
  return found.submenu as Item[]
}

function click(item: Item): void {
  ;(item.click as (m: unknown, w: unknown, e: { triggeredByAccelerator?: boolean }) => void)(
    {},
    {},
    {},
  )
}

function itemFor(items: Item[], label: string): Item {
  const found = items.find((i) => i.label === label)
  if (!found) throw new Error(`no ${label} item`)
  return found
}

describe('appMenuTemplate', () => {
  // The toolbar gave up its Stats and Activity buttons and the palette button: the View
  // menu is where they are now, each with the shortcut the keymap owns.
  it('opens the palette, stats and activity from the View menu', () => {
    const { template, run } = build()
    const view = menu(template, 'View')
    const stats = itemFor(view, 'Stats')
    expect(stats.accelerator).toBe('accel:stats')
    click(stats)
    click(itemFor(view, 'Activity'))
    click(itemFor(view, 'Command palette'))
    expect(run.mock.calls.map((c) => c[0])).toEqual(['stats', 'activity', 'palette'])
  })

  // Analyze quality left the toolbar; it runs on import by default and by hand from here.
  it('analyzes the quality of the list from the Tracks menu', () => {
    const { template, run } = build()
    const analyze = itemFor(menu(template, 'Tracks'), 'Analyze quality')
    expect(analyze.accelerator).toBe('accel:analyze-quality')
    click(analyze)
    expect(run).toHaveBeenCalledWith('analyze-quality')
  })

  // The list header dropped its row of list tools; each one is in a menu with the
  // shortcut the keymap owns, next to the ones that were already there.
  it('keeps every list tool the header gave up in the menus', () => {
    const { template, run } = build()
    const tracks = menu(template, 'Tracks')
    const file = menu(template, 'File')
    const selectAll = itemFor(tracks, 'Select all tracks')
    expect(selectAll.accelerator).toBe('accel:select-all')
    const fill = itemFor(tracks, 'Fill all tags from file name…')
    expect(fill.accelerator).toBe('accel:fill-all')
    for (const item of [
      selectAll,
      fill,
      itemFor(file, 'Find & Replace…'),
      itemFor(file, 'Remove all'),
      itemFor(tracks, 'Move selection to Trash…'),
    ]) {
      click(item)
    }
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      'select-all',
      'fill-all',
      'find-replace',
      'remove-all',
      'trash-selected',
    ])
  })

  // A custom View menu replaces Electron's default one, and with it went ⌘+ / ⌘- / ⌘0:
  // someone who needs larger text had no way to zoom the interface. The standard roles
  // bring the items and their accelerators back, with the labels the OS localises.
  it('lets the user zoom the interface from the View menu', () => {
    const { template } = build()
    const roles = menu(template, 'View').map((i) => i.role)
    expect(roles).toEqual(expect.arrayContaining(['resetZoom', 'zoomIn', 'zoomOut']))
  })

  it('names the Tracks menu and its items in every shipped language', () => {
    for (const locale of ['es', 'de', 'fr', 'pt-BR']) {
      const t = createMenuT(locale)
      const { template } = build(locale)
      expect(menu(template, t('tracks')).length).toBeGreaterThan(0)
      expect(t('stats')).not.toBe(createMenuT('en')('stats'))
    }
  })
})
