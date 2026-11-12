import type { EditorSectionId } from '../../../shared/editorSections'

export function sectionRect(section: EditorSectionId): DOMRect | null {
  const root = document
    .querySelector(`[data-section-header="${section}"]`)
    ?.closest('[data-testid="editor-scroll"] > *')
  return root ? root.getBoundingClientRect() : null
}
