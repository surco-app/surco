export const PROGRAMS = [
  { id: 'rekordbox', name: 'rekordbox' },
  { id: 'traktor', name: 'Traktor' },
  { id: 'engine', name: 'Engine DJ' },
  { id: 'serato', name: 'Serato' },
  { id: 'virtualdj', name: 'VirtualDJ' },
] as const

export type ProgramId = (typeof PROGRAMS)[number]['id']

export type Note =
  | 'noRenameMove'
  | 'crates'
  | 'listsFolders'
  | 'hotCuesOnly'
  | 'zones'
  | 'losslessFiles'
  | 'readsOnly'
  | 'inPlace'
  | 'sameFolder'
  | 'keepsOriginal'
  | 'engineUsb'
  | 'noRestore'
  | 'beta'

export type RowId =
  | 'tab'
  | 'edit'
  | 'paste'
  | 'session'
  | 'cueEditor'
  | 'calls'
  | 'flows'
  | 'grid'
  | 'add'
  | 'names'
  | 'follow'
  | 'usb'
  | 'copies'
  | 'windows'

export interface Cell {
  yes: boolean
  note?: Note
}

const Y: Cell = { yes: true }
const N: Cell = { yes: false }
const y = (note: Note): Cell => ({ yes: true, note })
const n = (note: Note): Cell => ({ yes: false, note })

export const PROGRAM_TABLE: readonly {
  id: 'library' | 'cues' | 'convert' | 'usb'
  rows: readonly { id: RowId; cells: Record<ProgramId, Cell> }[]
}[] = [
  {
    id: 'library',
    rows: [
      { id: 'tab', cells: { rekordbox: Y, traktor: Y, engine: Y, serato: Y, virtualdj: Y } },
      {
        id: 'edit',
        cells: {
          rekordbox: Y,
          traktor: Y,
          engine: y('noRenameMove'),
          serato: y('crates'),
          virtualdj: y('listsFolders'),
        },
      },
      { id: 'paste', cells: { rekordbox: Y, traktor: Y, engine: N, serato: Y, virtualdj: Y } },
      { id: 'session', cells: { rekordbox: Y, traktor: Y, engine: Y, serato: Y, virtualdj: Y } },
    ],
  },
  {
    id: 'cues',
    rows: [
      { id: 'cueEditor', cells: { rekordbox: Y, traktor: Y, engine: Y, serato: Y, virtualdj: Y } },
      {
        id: 'calls',
        cells: {
          rekordbox: Y,
          traktor: n('hotCuesOnly'),
          engine: n('hotCuesOnly'),
          serato: n('hotCuesOnly'),
          virtualdj: n('hotCuesOnly'),
        },
      },
      { id: 'flows', cells: { rekordbox: Y, traktor: Y, engine: Y, serato: Y, virtualdj: Y } },
      {
        id: 'grid',
        cells: {
          rekordbox: y('zones'),
          traktor: y('losslessFiles'),
          engine: y('losslessFiles'),
          serato: n('readsOnly'),
          virtualdj: n('readsOnly'),
        },
      },
    ],
  },
  {
    id: 'convert',
    rows: [
      { id: 'add', cells: { rekordbox: Y, traktor: Y, engine: Y, serato: Y, virtualdj: Y } },
      {
        id: 'names',
        cells: { rekordbox: Y, traktor: Y, engine: Y, serato: y('inPlace'), virtualdj: Y },
      },
      {
        id: 'follow',
        cells: {
          rekordbox: Y,
          traktor: y('sameFolder'),
          engine: Y,
          serato: n('keepsOriginal'),
          virtualdj: Y,
        },
      },
    ],
  },
  {
    id: 'usb',
    rows: [
      {
        id: 'usb',
        cells: { rekordbox: Y, traktor: Y, engine: y('engineUsb'), serato: Y, virtualdj: Y },
      },
      {
        id: 'copies',
        cells: { rekordbox: Y, traktor: Y, engine: Y, serato: y('noRestore'), virtualdj: Y },
      },
      {
        id: 'windows',
        cells: { rekordbox: Y, traktor: Y, engine: Y, serato: Y, virtualdj: y('beta') },
      },
    ],
  },
]
