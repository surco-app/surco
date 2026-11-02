import { fieldValue } from '../../../shared/customFields'
import type { ReviewWriteField, TrackMetadata } from '../../../shared/types'

export const REVIEW_WRITE_FIELDS: readonly ReviewWriteField[] = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'genre',
  'year',
  'grouping',
]

export type IncompleteSource = 'shown' | 'suggested' | 'name'

export interface IncompleteField {
  field: ReviewWriteField
  proposal?: { value: string; source: IncompleteSource }
}

export interface IncompleteFinding {
  id: string
  fields: IncompleteField[]
}

export interface IncompleteInput {
  id: string
  disk: TrackMetadata
  shown: TrackMetadata
  suggested?: TrackMetadata
  fromName: Partial<TrackMetadata>
}

function proposalOf(row: IncompleteInput, field: ReviewWriteField): IncompleteField['proposal'] {
  const sources: [IncompleteSource, string | undefined][] = [
    ['shown', row.shown[field]],
    ['suggested', row.suggested?.[field]],
    ['name', row.fromName[field]],
  ]
  for (const [source, value] of sources) {
    const v = value?.trim()
    if (v) return { value: v, source }
  }
  return undefined
}

export function incompleteFindings(
  rows: IncompleteInput[],
  required: readonly string[],
): IncompleteFinding[] {
  const writable = required.filter((f): f is ReviewWriteField =>
    REVIEW_WRITE_FIELDS.includes(f as ReviewWriteField),
  )
  const findings: IncompleteFinding[] = []
  for (const row of rows) {
    const fields = writable
      .filter((f) => !fieldValue(row.disk, f).trim())
      .map((field): IncompleteField => {
        const proposal = proposalOf(row, field)
        return proposal ? { field, proposal } : { field }
      })
    if (fields.length > 0) findings.push({ id: row.id, fields })
  }
  return findings
}
