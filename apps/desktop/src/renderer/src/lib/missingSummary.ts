import type { TFunction } from 'i18next'

// The one-line note above the main button when required fields are empty: the names while
// they fit (one or two), a count past that. The full list stays in the button's description.
export function missingSummary(labels: string[], tr: TFunction): string {
  if (labels.length === 1) return tr('editor.missingOne', { field: labels[0] })
  if (labels.length === 2) return tr('editor.missingTwo', { first: labels[0], second: labels[1] })
  return tr('editor.missingCount', { count: labels.length })
}
