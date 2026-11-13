// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { KeyLike } from '../../../shared/shortcuts'
import {
  activeScope,
  columnOf,
  cycleRegion,
  isTypingTarget,
  jumpIndex,
  keyToCommandId,
  moveIndex,
  nextColumn,
  nextRegion,
  pageSize,
  regionOf,
} from './keymap'

function key(
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {},
): { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean } {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mods }
}

const BINDINGS = resolveBindings()

// Drives the real resolver with the default bindings on a mac (⌘ = mod).
function press(e: ReturnType<typeof key>, typing: boolean): string | null {
  return keyToCommandId(e, typing, BINDINGS, true)
}

describe('moveIndex', () => {
  it('returns -1 for an empty list so the caller skips selection', () => {
    expect(moveIndex(0, -1, 1)).toBe(-1)
  })

  it('selects the first item when nothing is selected yet', () => {
    expect(moveIndex(3, -1, 1)).toBe(0)
    expect(moveIndex(3, -1, -1)).toBe(0)
  })

  it('clamps at both ends so navigation never wraps or overflows', () => {
    expect(moveIndex(3, 0, -1)).toBe(0)
    expect(moveIndex(3, 2, 1)).toBe(2)
    expect(moveIndex(3, 1, 1)).toBe(2)
    expect(moveIndex(3, 1, -1)).toBe(0)
  })
})

describe('jumpIndex', () => {
  it('returns -1 for an empty list so the caller skips selection', () => {
    expect(jumpIndex(0, 'first')).toBe(-1)
    expect(jumpIndex(0, 'last')).toBe(-1)
  })

  it('lands on the first or last row regardless of where the selection was', () => {
    expect(jumpIndex(5, 'first')).toBe(0)
    expect(jumpIndex(5, 'last')).toBe(4)
  })
})

describe('pageSize', () => {
  it('pages by the rows that fit minus one, so a row of context carries over', () => {
    expect(pageSize(560, 56)).toBe(9)
  })

  it('never returns less than one, even when a single row taller than the viewport', () => {
    expect(pageSize(40, 56)).toBe(1)
    expect(pageSize(560, 0)).toBe(1)
  })
})

describe('keyToCommandId', () => {
  it('maps the modifier shortcuts to their commands', () => {
    expect(press(key('Enter', { metaKey: true }), false)).toBe('process-current')
    expect(press(key('o', { metaKey: true }), false)).toBe('add')
    expect(press(key(',', { metaKey: true }), false)).toBe('settings')
  })

  it('processes the whole queue on cmd+shift+enter', () => {
    expect(press(key('Enter', { metaKey: true, shiftKey: true }), false)).toBe('process-all')
  })

  // ⌘⇧R opens the file-name builder even while a field is focused (it's a modifier
  // combo, not a bare letter), and the shift keeps it distinct from ⌘R (Reveal).
  it('opens the file-name builder on cmd+shift+r, with or without a focused field', () => {
    expect(press(key('r', { metaKey: true, shiftKey: true }), false)).toBe('rename')
    expect(press(key('R', { metaKey: true, shiftKey: true }), true)).toBe('rename')
    // ⌘R without shift is the sibling Reveal command, not rename.
    expect(press(key('r', { metaKey: true }), false)).toBe('reveal')
  })

  it('plays the current track on space, but never while typing in a field', () => {
    expect(press(key(' '), false)).toBe('play')
    expect(press(key(' '), true)).toBeNull()
  })

  it('navigates the list with arrows or j/k only when not typing', () => {
    expect(press(key('ArrowDown'), false)).toBe('next')
    expect(press(key('j'), false)).toBe('next')
    expect(press(key('ArrowUp'), false)).toBe('prev')
    expect(press(key('k'), false)).toBe('prev')
    expect(press(key('/'), false)).toBe('search')
  })

  it('ignores navigation keys while typing so the field keeps the keystroke', () => {
    expect(press(key('j'), true)).toBeNull()
    expect(press(key('ArrowDown'), true)).toBeNull()
    expect(press(key('/'), true)).toBeNull()
  })

  // Home/End/PageUp/PageDown round out list navigation the way Finder and Music do:
  // fixed aliases like j/k, not rebindable rows, and never stealing a field's keystroke.
  it('jumps and pages the list with Home/End/PageUp/PageDown, only when not typing', () => {
    expect(press(key('Home'), false)).toBe('list-top')
    expect(press(key('End'), false)).toBe('list-bottom')
    expect(press(key('PageDown'), false)).toBe('list-page-down')
    expect(press(key('PageUp'), false)).toBe('list-page-up')
    expect(press(key('Home'), true)).toBeNull()
    expect(press(key('PageDown'), true)).toBeNull()
  })

  // ⌘1/⌘2/⌘3 (Ctrl on Windows) jump focus between the three columns — list, Discogs
  // matches, editor. They're mod-combos, so they fire even while a field is focused (you
  // jump out of the editor with the same key you jump in).
  it('jumps between columns with mod+1/2/3, even while typing', () => {
    expect(press(key('1', { metaKey: true }), false)).toBe('focus-list')
    expect(press(key('2', { metaKey: true }), false)).toBe('focus-matches')
    expect(press(key('3', { metaKey: true }), false)).toBe('focus-editor')
    expect(press(key('3', { metaKey: true }), true)).toBe('focus-editor')
  })

  it('removes the track on ⌘⌫ only when not typing, so editing a field is safe', () => {
    expect(press(key('Backspace', { metaKey: true }), false)).toBe('remove')
    expect(press(key('Backspace', { metaKey: true }), true)).toBeNull()
  })

  // Commands that used to live only in the menu/palette now resolve from the keymap too:
  // ⌘R reveal, ⌘F find & replace, ⌘⇧M add to Apple Music, ? the shortcuts cheat-sheet.
  it('resolves the newly-bound commands', () => {
    expect(press(key('r', { metaKey: true }), false)).toBe('reveal')
    expect(press(key('f', { metaKey: true }), false)).toBe('find-replace')
    expect(press(key('M', { metaKey: true, shiftKey: true }), false)).toBe('add-apple-music')
    expect(press(key('?', { shiftKey: true }), false)).toBe('shortcuts')
  })

  it('returns null for unmapped keys', () => {
    expect(press(key('x'), false)).toBeNull()
  })
})

describe('isTypingTarget', () => {
  it('treats text inputs and textareas as typing so their keystrokes are theirs', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
  })

  // The album-match dropdown is a <select>; without this its arrow keys would be
  // hijacked by the global next/prev navigation and never reach the options.
  it('treats a <select> as typing so its own arrow/space keys are not stolen', () => {
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
  })

  it('treats contenteditable elements as typing', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('is not typing for plain elements or nothing focused', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('activeScope', () => {
  it('no devuelve ámbitos sin elemento enfocado', () => {
    expect(activeScope(null)).toEqual([])
  })

  it('no devuelve ámbitos cuando el foco está fuera de cualquiera', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(activeScope(el)).toEqual([])
    el.remove()
  })

  it('devuelve el ámbito del ancestro más cercano', () => {
    const box = document.createElement('div')
    box.setAttribute('data-shortcut-scope', 'track-list')
    const inner = document.createElement('button')
    box.appendChild(inner)
    document.body.appendChild(box)
    expect(activeScope(inner)).toEqual(['track-list'])
    box.remove()
  })

  // El recorte declara su propio ámbito DENTRO del editor (TrimSection dentro de
  // Editor), así que con el foco en el handle el ancestro más cercano es 'trim' y el
  // de fuera queda tapado. Un comando de ámbito 'editor' —⌘] y ⌘[ para saltar de
  // sección— dejaba de resolver ahí: la tecla llegaba al listener y moría, y al salir
  // de la sección volvía a funcionar. El ámbito activo tiene que ser la cadena, no
  // sólo el más cercano.
  it('devuelve la cadena de ámbitos cuando están anidados', () => {
    const outer = document.createElement('div')
    outer.setAttribute('data-shortcut-scope', 'editor')
    const inner = document.createElement('div')
    inner.setAttribute('data-shortcut-scope', 'trim')
    const handle = document.createElement('button')
    inner.appendChild(handle)
    outer.appendChild(inner)
    document.body.appendChild(outer)
    expect(activeScope(handle)).toEqual(['trim', 'editor'])
    outer.remove()
  })
})

describe('un ámbito anidado no tapa al de fuera', () => {
  const bindings = resolveBindings()
  const cmdBracket = (key: string): KeyLike => ({
    key,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
  })

  it('⌘] salta de sección con el foco dentro del recorte', () => {
    expect(keyToCommandId(cmdBracket(']'), false, bindings, true, ['trim', 'editor'])).toBe(
      'section-next',
    )
    expect(keyToCommandId(cmdBracket('['), false, bindings, true, ['trim', 'editor'])).toBe(
      'section-prev',
    )
  })

  // Y el de dentro sigue ganando cuando el comando es suyo: el anidamiento añade
  // alcance, no lo redefine.
  it('el ámbito más cercano sigue resolviendo lo suyo', () => {
    expect(keyToCommandId(cmdBracket(']'), false, bindings, true, ['editor'])).toBe('section-next')
  })

  // Fuera de la cadena la tecla no debe disparar nada, o un comando de sección saltaría
  // desde la lista de pistas.
  it('no dispara fuera de la cadena', () => {
    expect(keyToCommandId(cmdBracket(']'), false, bindings, true, ['track-list'])).toBeNull()
  })
})

describe('keyToCommandId con ámbito', () => {
  const bindings = resolveBindings()
  const press = (key: string, shift = false): KeyLike => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: shift,
  })

  it('no dispara un comando de ámbito fuera de él', () => {
    expect(keyToCommandId(press('F10', true), false, bindings, true, null)).toBeNull()
  })

  it('dispara el comando dentro de su ámbito', () => {
    expect(keyToCommandId(press('F10', true), false, bindings, true, 'track-list')).toBe(
      'track-menu',
    )
  })

  // Shift es el paso grueso de las teclas del recorte, no parte del chord: ⇧W tiene que
  // resolver al mismo comando que W. Sin esto el comando existe, la tecla llega al
  // listener y muere ahí — el fallo silencioso más caro de diagnosticar.
  it('resuelve una tecla suelta aunque se pulse con shift', () => {
    expect(keyToCommandId(press('w', true), false, bindings, true, null)).toBe('trim-start-forward')
    expect(keyToCommandId(press('w'), false, bindings, true, null)).toBe('trim-start-forward')
  })

  // Pero un comando rebindeado A un chord con shift gana al reintento: si el usuario
  // guarda ⇧A, esa combinación tiene que disparar lo suyo y no el comando de la A pelada.
  it('prefiere el comando ligado al chord con shift sobre el reintento', () => {
    const rebound = resolveBindings({ 'trim-end-audition': ['shift', 'a'] })
    expect(keyToCommandId(press('a', true), false, rebound, true, null)).toBe('trim-end-audition')
  })

  // Las flechas son seek en toda la app: el editor de silencios ya no se las queda, sus
  // teclas son propias por lado y actúan sin foco.
  it('deja las flechas al seek en cualquier ámbito', () => {
    expect(keyToCommandId(press('ArrowLeft'), false, bindings, true, null)).toBe('seek-back')
    expect(keyToCommandId(press('ArrowLeft'), false, bindings, true, 'track-list')).toBe(
      'seek-back',
    )
  })
})

describe('nextColumn', () => {
  it('avanza y retrocede por el orden visual de las tres columnas', () => {
    expect(nextColumn('list', 1)).toBe('matches')
    expect(nextColumn('matches', 1)).toBe('editor')
    expect(nextColumn('editor', -1)).toBe('matches')
    expect(nextColumn('matches', -1)).toBe('list')
  })

  // Tope y no ciclo: dar la vuelta desde un extremo desorienta, porque el usuario
  // pierde la referencia de en qué lado de la ventana está.
  it('hace tope en los extremos en vez de dar la vuelta', () => {
    expect(nextColumn('list', -1)).toBe('list')
    expect(nextColumn('editor', 1)).toBe('editor')
  })

  it('entra por la lista cuando el foco no está en ninguna columna', () => {
    expect(nextColumn(null, 1)).toBe('list')
    expect(nextColumn(null, -1)).toBe('list')
  })
})

describe('columnOf', () => {
  function mount(html: string): HTMLElement {
    document.body.innerHTML = html
    return document.querySelector('[data-probe]') as HTMLElement
  }

  it('reconoce cada columna por su contenedor', () => {
    expect(columnOf(mount('<aside data-testid="sidebar"><b data-probe></b></aside>'))).toBe('list')
    expect(columnOf(mount('<div data-testid="matches-column"><b data-probe></b></div>'))).toBe(
      'matches',
    )
    expect(columnOf(mount('<div data-shortcut-scope="editor"><b data-probe></b></div>'))).toBe(
      'editor',
    )
  })

  it('devuelve null fuera de las tres columnas y sin elemento', () => {
    expect(columnOf(mount('<div><b data-probe></b></div>'))).toBeNull()
    expect(columnOf(null)).toBeNull()
  })
})

describe('F6 regions', () => {
  function mount(html: string): HTMLElement {
    document.body.innerHTML = html
    return document.querySelector('[data-probe]') as HTMLElement
  }

  it('resolves F6 and Shift+F6 to the region commands', () => {
    expect(press(key('F6'), false)).toBe('focus-region-next')
    expect(press(key('F6', { shiftKey: true }), false)).toBe('focus-region-prev')
  })

  it('moves from the title field to the rail on F6, because a function key types nothing and the field would trap the focus', () => {
    document.body.innerHTML = `
      <nav data-testid="source-rail"><button data-testid="source-rail-tracks" aria-pressed="true">a</button></nav>
      <aside data-testid="sidebar"><input data-testid="track-search" /><div data-testid="track-row" tabindex="0">y</div></aside>
      <div data-shortcut-scope="editor"><input data-testid="field-title" /></div>`
    ;(document.querySelector('[data-testid="field-title"]') as HTMLElement).focus()
    expect(press(key('F6'), isTypingTarget(document.activeElement))).toBe('focus-region-next')
    cycleRegion(document.activeElement, 1)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('source-rail-tracks')
  })

  it('moves backwards from the search box on Shift+F6, so the cycle works from any field', () => {
    document.body.innerHTML = `
      <nav data-testid="source-rail"><button data-testid="source-rail-tracks" aria-pressed="true">a</button></nav>
      <aside data-testid="sidebar"><input data-testid="track-search" /><div data-testid="track-row" tabindex="0">y</div></aside>
      <div data-shortcut-scope="editor"><input data-testid="field-title" /></div>`
    ;(document.querySelector('[data-testid="track-search"]') as HTMLElement).focus()
    expect(press(key('F6', { shiftKey: true }), isTypingTarget(document.activeElement))).toBe(
      'focus-region-prev',
    )
    cycleRegion(document.activeElement, -1)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('source-rail-tracks')
  })

  it('still leaves a plain letter to the field while typing, so a name with a q is never a trim nudge', () => {
    expect(press(key('q'), false)).toBe('trim-start-back')
    expect(press(key('q'), true)).toBeNull()
    expect(press(key('ArrowDown'), true)).toBeNull()
  })

  it('names the sources rail, the track list and the editor as the three regions', () => {
    expect(regionOf(mount('<nav data-testid="source-rail"><b data-probe></b></nav>'))).toBe('rail')
    expect(regionOf(mount('<aside data-testid="sidebar"><b data-probe></b></aside>'))).toBe('list')
    expect(regionOf(mount('<div data-shortcut-scope="editor"><b data-probe></b></div>'))).toBe(
      'editor',
    )
    expect(regionOf(mount('<div data-testid="matches-column"><b data-probe></b></div>'))).toBe(
      'editor',
    )
    expect(regionOf(mount('<div><b data-probe></b></div>'))).toBeNull()
  })

  it('goes round in both directions, because F6 is a cycle and not a walk to an edge', () => {
    expect(nextRegion('rail', 1)).toBe('list')
    expect(nextRegion('list', 1)).toBe('editor')
    expect(nextRegion('editor', 1)).toBe('rail')
    expect(nextRegion('rail', -1)).toBe('editor')
    expect(nextRegion('editor', -1)).toBe('list')
  })

  it('enters by the track list when the focus is in none of them', () => {
    expect(nextRegion(null, 1)).toBe('list')
    expect(nextRegion(null, -1)).toBe('list')
  })
})

describe('cycleRegion', () => {
  const page = `
    <nav data-testid="source-rail"><button data-testid="source-rail-tracks" aria-pressed="false">a</button><button data-testid="source-rail-virtualdj" aria-pressed="true">b</button></nav>
    <aside data-testid="sidebar"><div data-testid="track-row" tabindex="-1">x</div><div data-testid="track-row" tabindex="0" data-probe-list>y</div></aside>
    <div data-shortcut-scope="editor"><input data-testid="field-title" /></div>`

  function focusedTestId(): string | null {
    return document.activeElement?.getAttribute('data-testid') ?? null
  }

  it('moves from the rail to the list row that holds the tab stop, then to the title', () => {
    document.body.innerHTML = page
    ;(document.querySelector('[data-testid="source-rail-tracks"]') as HTMLElement).focus()
    cycleRegion(document.activeElement, 1)
    expect(document.activeElement).toBe(document.querySelector('[tabindex="0"]'))
    cycleRegion(document.activeElement, 1)
    expect(focusedTestId()).toBe('field-title')
  })

  it('lands on the rail button of the source in use', () => {
    document.body.innerHTML = page
    ;(document.querySelector('[data-testid="field-title"]') as HTMLElement).focus()
    cycleRegion(document.activeElement, 1)
    expect(focusedTestId()).toBe('source-rail-virtualdj')
  })

  it('goes back with a negative step', () => {
    document.body.innerHTML = page
    ;(document.querySelector('[data-testid="field-title"]') as HTMLElement).focus()
    cycleRegion(document.activeElement, -1)
    expect(document.activeElement).toBe(document.querySelector('[tabindex="0"]'))
  })

  it('enters a maximized section instead of the title it covers', () => {
    document.body.innerHTML = `${page}<div data-testid="section-maximized-overlay"><span>t</span><button data-testid="overlay-first" disabled>x</button><button data-testid="overlay-live">y</button></div>`
    ;(document.querySelector('[tabindex="0"]') as HTMLElement).focus()
    cycleRegion(document.activeElement, 1)
    expect(focusedTestId()).toBe('overlay-live')
  })

  it('skips a region that is not on screen instead of dropping the focus', () => {
    document.body.innerHTML = page.replace(/<aside[\s\S]*<\/aside>/, '')
    ;(document.querySelector('[data-testid="source-rail-tracks"]') as HTMLElement).focus()
    cycleRegion(document.activeElement, 1)
    expect(focusedTestId()).toBe('field-title')
  })
})
