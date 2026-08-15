import { useEffect } from 'react'
import { nextSection } from '../lib/sectionNav'
import { claimKeys } from '../lib/spaceClaim'

// Moves focus from one section header to the next, over the fields in between: the
// editor carries 133 tab stops with a single section open, so tabbing from the title
// field down to the silence trimmer means crossing dozens of inputs.
//
// The jump only moves focus. Opening stays on Enter (the header is a button with
// aria-expanded), because trim, click repair and normalize each kick off an expensive
// pass when they open — passing through three of them must not start three analyses.
export function useSectionNavigation(): void {
  useEffect(() => {
    const jump = (dir: 1 | -1): void => {
      const headers = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-shortcut-scope="editor"] [data-section-header]',
        ),
      ]
      if (headers.length === 0) return
      const shown = headers.map((h) => h.dataset.sectionHeader ?? '')
      const current = document.activeElement?.closest<HTMLElement>('[data-section-header]')
      // Focus usually sits in a FIELD, not on a header, so the current section is the one
      // whose body contains the focus — that is what makes ⌘] from the title field land on
      // the section after the form rather than back at the top.
      const from =
        current?.dataset.sectionHeader ??
        headers.findLast((h) => h.parentElement?.parentElement?.contains(document.activeElement))
          ?.dataset.sectionHeader ??
        null
      const to = nextSection(shown, from, dir)
      if (to) headers[shown.indexOf(to)]?.focus()
    }
    return claimKeys({
      'section-next': () => jump(1),
      'section-prev': () => jump(-1),
    })
  }, [])
}
