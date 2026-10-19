import type { ColumnShares } from '../../../shared/types'

export type SharedColumn = 'tree' | 'list' | 'results'
export type ResizableColumn = 'list' | 'results'

export interface ColumnWidths {
  tree: number
  list: number
  results: number
  form: number
}

export const RAIL_WIDTH = 60
export const FORM_MIN = 420

export const COLUMN_LIMITS: Record<SharedColumn, { share: number; min: number; max: number }> = {
  tree: { share: 0.17, min: 200, max: 280 },
  list: { share: 0.24, min: 300, max: 480 },
  results: { share: 0.26, min: 300, max: 560 },
}

const GIVE_WAY: ResizableColumn[] = ['results', 'list']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function shareOf(column: SharedColumn, shares: ColumnShares | undefined): number {
  const saved = shares?.[column]
  return typeof saved === 'number' && saved > 0 && saved < 1 ? saved : COLUMN_LIMITS[column].share
}

function scaleFor(hasTree: boolean, shares: ColumnShares | undefined): number {
  return hasTree ? 1 : 1 / (1 - shareOf('tree', shares))
}

export function columnWidths(
  available: number,
  hasTree: boolean,
  shares: ColumnShares | undefined,
): ColumnWidths {
  const scale = scaleFor(hasTree, shares)
  const sized = (column: SharedColumn): number => {
    const { min, max } = COLUMN_LIMITS[column]
    return clamp(Math.round(available * shareOf(column, shares) * scale), min, max)
  }
  const widths = {
    tree: hasTree ? sized('tree') : 0,
    list: sized('list'),
    results: sized('results'),
  }
  for (const column of GIVE_WAY) {
    const short = FORM_MIN - (available - widths.tree - widths.list - widths.results)
    if (short <= 0) break
    widths[column] = Math.max(COLUMN_LIMITS[column].min, widths[column] - short)
  }
  return { ...widths, form: available - widths.tree - widths.list - widths.results }
}

export function shareFor(
  column: ResizableColumn,
  width: number,
  available: number,
  hasTree: boolean,
  shares: ColumnShares | undefined,
): number {
  const { min, max } = COLUMN_LIMITS[column]
  return clamp(width, min, max) / (available * scaleFor(hasTree, shares))
}
