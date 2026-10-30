import type { OutputFormat, Settings } from '../../shared/types'
import type { VerifyDetailKey } from '../../shared/verification'

export type Origin =
  | 'wav16'
  | 'wav24'
  | 'aif'
  | 'aiff'
  | 'flac'
  | 'alac'
  | 'aac'
  | 'mp3x'
  | 'mp3n'
  | 'mp3j'
export type FileDest = 'folder' | 'beside' | 'overwrite' | 'appleMusic' | 'appleMusicCopy'
export type Programs = 'rekordbox' | 'engine' | 'traktor' | 'music' | 'all'
export type CellState = 'closed' | 'open' | 'retry'
export type Quality = 'source' | 'rate48' | 'bits16' | 'normalize' | 'trim'
export type InvariantName =
  | 'format'
  | 'pcm'
  | 'points'
  | 'cues'
  | 'playlists'
  | 'tags'
  | 'cover'
  | 'unique'
  | 'collateral'
export type SabotageId = string

export interface Cell {
  id: string
  layer: 'C' | 'D' | 'Q' | 'K' | 'S'
  name: string
  origin: Origin
  target: OutputFormat
  dest: FileDest
  programs: Programs
  state: CellState
  quality: Quality
  settings?: Partial<Settings>
  sabotage?: SabotageId
  expectedKey?: VerifyDetailKey
  expectBroken?: { invariant: InvariantName; why: string }[]
  core: boolean
}

type Row = Omit<Cell, 'layer' | 'core' | 'name'> & { name?: string; core?: boolean }

const ORIGINS: Origin[] = [
  'wav16',
  'wav24',
  'aif',
  'aiff',
  'flac',
  'alac',
  'aac',
  'mp3x',
  'mp3n',
  'mp3j',
]
const TARGETS: OutputFormat[] = ['aiff', 'wav', 'flac', 'alac', 'mp3']

const ORIGIN_NAME: Record<Origin, string> = {
  wav16: 'WAV 16 bits',
  wav24: 'WAV 24 bits a 96 kHz',
  aif: 'AIF',
  aiff: 'AIFF',
  flac: 'FLAC',
  alac: 'ALAC',
  aac: 'AAC',
  mp3x: 'MP3 con cabecera Xing',
  mp3n: 'MP3 sin cabecera Xing',
  mp3j: 'MP3 con basura delante',
}
const TARGET_NAME: Record<OutputFormat, string> = {
  aiff: 'AIFF',
  wav: 'WAV',
  flac: 'FLAC',
  alac: 'ALAC',
  mp3: 'MP3',
}
const DEST_NAME: Record<FileDest, string> = {
  folder: 'en carpeta',
  beside: 'junto al original',
  overwrite: 'sobre el original',
  appleMusic: 'a Music',
  appleMusicCopy: 'a Music con copia en carpeta',
}
const PROGRAMS_NAME: Record<Programs, string> = {
  rekordbox: 'con rekordbox',
  engine: 'con Engine',
  traktor: 'con Traktor',
  music: 'con Music',
  all: 'con rekordbox, Engine y Traktor',
}
const STATE_NAME: Record<CellState, string> = {
  closed: '',
  open: ', programa abierto hasta el final',
  retry: ', primera lectura fallida y Reintentar',
}
const QUALITY_NAME: Record<Quality, string> = {
  source: '',
  rate48: ' a 48 kHz',
  bits16: ' a 16 bits',
  normalize: ' normalizado',
  trim: ' sin los 2 s de silencio inicial',
}

function described(row: Row): string {
  return `${ORIGIN_NAME[row.origin]} a ${TARGET_NAME[row.target]}${QUALITY_NAME[row.quality]} ${DEST_NAME[row.dest]} ${PROGRAMS_NAME[row.programs]}${STATE_NAME[row.state]}`
}

function cell(layer: Cell['layer'], row: Row): Cell {
  return { ...row, layer, name: row.name ?? described(row), core: row.core ?? false }
}

const CORE_C = new Set(['flac>aiff', 'aiff>wav', 'wav16>flac', 'mp3n>aiff', 'flac>mp3'])

const LAYER_C: Cell[] = TARGETS.flatMap((target) =>
  ORIGINS.map((origin) =>
    cell('C', {
      id: `C-${origin}-${target}`,
      origin,
      target,
      dest: 'folder',
      programs: 'all',
      state: 'closed',
      quality: 'source',
      core: CORE_C.has(`${origin}>${target}`),
    }),
  ),
)

const CONVERSION = {
  keep: { origin: 'aiff', target: 'wav' },
  toLossy: { origin: 'flac', target: 'mp3' },
  fromLossy: { origin: 'mp3n', target: 'aiff' },
} as const

const PAIRWISE: [FileDest, Programs, CellState, keyof typeof CONVERSION, boolean?][] = [
  ['folder', 'rekordbox', 'closed', 'keep'],
  ['folder', 'engine', 'open', 'fromLossy'],
  ['folder', 'traktor', 'retry', 'toLossy'],
  ['folder', 'all', 'open', 'fromLossy'],
  ['beside', 'rekordbox', 'open', 'toLossy'],
  ['beside', 'engine', 'retry', 'keep'],
  ['beside', 'traktor', 'closed', 'fromLossy'],
  ['beside', 'all', 'retry', 'keep'],
  ['overwrite', 'rekordbox', 'retry', 'fromLossy'],
  ['overwrite', 'engine', 'closed', 'toLossy', true],
  ['overwrite', 'traktor', 'open', 'keep'],
  ['overwrite', 'all', 'closed', 'toLossy', true],
  ['appleMusic', 'rekordbox', 'closed', 'keep'],
  ['appleMusic', 'engine', 'open', 'fromLossy'],
  ['appleMusic', 'traktor', 'retry', 'toLossy'],
  ['appleMusic', 'music', 'closed', 'keep', true],
  ['appleMusic', 'all', 'open', 'fromLossy'],
  ['appleMusicCopy', 'rekordbox', 'open', 'toLossy'],
  ['appleMusicCopy', 'engine', 'retry', 'keep'],
  ['appleMusicCopy', 'traktor', 'closed', 'fromLossy'],
  ['appleMusicCopy', 'music', 'open', 'toLossy'],
  ['appleMusicCopy', 'all', 'retry', 'keep'],
  ['appleMusic', 'music', 'retry', 'fromLossy'],
  ['folder', 'traktor', 'closed', 'keep'],
  ['beside', 'traktor', 'closed', 'keep'],
  ['beside', 'all', 'closed', 'keep', true],
  ['appleMusicCopy', 'music', 'closed', 'keep'],
  ['overwrite', 'all', 'closed', 'keep'],
]

const LAYER_D: Cell[] = PAIRWISE.map(([dest, programs, state, conversion, core], i) =>
  cell('D', {
    id: `D${String(i + 1).padStart(2, '0')}`,
    ...CONVERSION[conversion],
    dest,
    programs,
    state,
    quality: 'source',
    core,
  }),
)

const LAYER_Q: Cell[] = (['rate48', 'bits16', 'normalize', 'trim'] as const).flatMap((quality) =>
  (
    [
      ['wav24', 'aiff'],
      ['flac', 'flac'],
      ['mp3n', 'wav'],
    ] as const
  ).map(([origin, target]) =>
    cell('Q', {
      id: `Q-${quality}-${origin}`,
      origin,
      target,
      dest: 'folder',
      programs: 'all',
      state: 'closed',
      quality,
    }),
  ),
)

const K_ROWS: Row[] = [
  {
    id: 'K01',
    name: 'AIFF a WAV a Music con la entrada del AIFF ya etiquetada, el WAV entra como entrada nueva y la vieja no queda',
    origin: 'aiff',
    target: 'wav',
    dest: 'appleMusic',
    programs: 'music',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K02',
    name: 'WAV a AIFF a Music con la entrada del WAV ya en la biblioteca, sin quedarse con la entrada vieja',
    origin: 'wav16',
    target: 'aiff',
    dest: 'appleMusic',
    programs: 'music',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K03',
    name: 'FLAC a WAV a Music con carpeta multimedia, sin Unknown Artist y con los tags que Music no escribe en el WAV',
    origin: 'flac',
    target: 'wav',
    dest: 'appleMusic',
    programs: 'music',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K04',
    name: 'AIFF a WAV con las mismas muestras conserva el análisis de rekordbox',
    origin: 'aiff',
    target: 'wav',
    dest: 'folder',
    programs: 'rekordbox',
    state: 'closed',
    quality: 'source',
    core: true,
  },
  {
    id: 'K05',
    name: 'FLAC a MP3 a Music conserva el grouping en TIT1 y GRP1',
    origin: 'flac',
    target: 'mp3',
    dest: 'appleMusic',
    programs: 'music',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K06',
    name: 'FLAC a MP3 escribe pista 3 de 12, disco 1 de 2 y la posición de vinilo A2',
    origin: 'flac',
    target: 'mp3',
    dest: 'folder',
    programs: 'all',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K07',
    name: 'AIFF a WAV encuentra la fila de rekordbox guardada con el nombre en NFD',
    origin: 'aiff',
    target: 'wav',
    dest: 'folder',
    programs: 'rekordbox',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K08',
    name: 'AIFF a WAV con dos filas de rekordbox para el mismo fichero por el enlace de Music no escribe y avisa',
    origin: 'aiff',
    target: 'wav',
    dest: 'folder',
    programs: 'rekordbox',
    state: 'closed',
    quality: 'source',
    expectedKey: 'rekordboxAmbiguous',
    expectBroken: [
      { invariant: 'points', why: 'con dos filas para el mismo fichero rekordbox no se toca' },
      { invariant: 'unique', why: 'ninguna fila pasa al fichero nuevo porque no se escribe' },
    ],
  },
  {
    id: 'K09',
    name: 'MP3 con cabecera Xing a FLAC deja los cues donde estaban',
    origin: 'mp3x',
    target: 'flac',
    dest: 'folder',
    programs: 'all',
    state: 'closed',
    quality: 'source',
    core: true,
  },
  {
    id: 'K10',
    name: 'FLAC a AIFF sin el silencio inicial y con Reintentar mueve los cues una sola vez',
    origin: 'flac',
    target: 'aiff',
    dest: 'folder',
    programs: 'all',
    state: 'retry',
    quality: 'trim',
    core: true,
  },
  {
    id: 'K11',
    name: 'FLAC a FLAC sobre el original, que es su propio origen',
    origin: 'flac',
    target: 'flac',
    dest: 'overwrite',
    programs: 'all',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K12',
    name: 'FLAC a AIFF junto al original con el nombre ya ocupado, todos los programas apuntan al (2)',
    origin: 'flac',
    target: 'aiff',
    dest: 'beside',
    programs: 'all',
    state: 'closed',
    quality: 'source',
  },
  {
    id: 'K13',
    name: 'MP3 sin cabecera Xing a AIFF conservando los MP3 no toca el fichero ni las bibliotecas',
    origin: 'mp3n',
    target: 'aiff',
    dest: 'folder',
    programs: 'all',
    state: 'closed',
    quality: 'source',
    settings: { keepMp3Sources: true },
  },
  {
    id: 'K14',
    name: 'FLAC a AIFF con rekordbox abierto todo el lote pasa de en cola a pendiente y a aplicado sin marca intermedia',
    origin: 'flac',
    target: 'aiff',
    dest: 'folder',
    programs: 'rekordbox',
    state: 'open',
    quality: 'source',
    core: true,
  },
]

const LAYER_K: Cell[] = K_ROWS.map((row) => cell('K', row))

const SABOTAGE_BASE: Record<'file' | 'music' | 'rekordbox' | 'engine' | 'traktor', Row> = {
  file: {
    id: '',
    origin: 'flac',
    target: 'aiff',
    dest: 'folder',
    programs: 'rekordbox',
    state: 'closed',
    quality: 'source',
  },
  music: {
    id: '',
    origin: 'flac',
    target: 'aiff',
    dest: 'appleMusic',
    programs: 'music',
    state: 'closed',
    quality: 'source',
  },
  rekordbox: {
    id: '',
    origin: 'flac',
    target: 'aiff',
    dest: 'folder',
    programs: 'rekordbox',
    state: 'closed',
    quality: 'source',
  },
  engine: {
    id: '',
    origin: 'flac',
    target: 'aiff',
    dest: 'folder',
    programs: 'engine',
    state: 'closed',
    quality: 'source',
  },
  traktor: {
    id: '',
    origin: 'flac',
    target: 'aiff',
    dest: 'beside',
    programs: 'traktor',
    state: 'closed',
    quality: 'source',
  },
}

const CORE_SABOTAGES = new Set([
  'filePcmDiffers',
  'fileTagDiffers',
  'rekordboxStillOld',
  'engineSizeDiffers',
  'traktorStillOld',
  'musicDuplicate',
])

const KEYED: [keyof typeof SABOTAGE_BASE, VerifyDetailKey, string][] = [
  ['file', 'fileMissing', 'el fichero convertido borrado'],
  ['file', 'fileWrongFormat', 'el fichero convertido cambiado a otro contenedor'],
  ['file', 'fileTruncated', 'el fichero convertido truncado a la mitad'],
  ['file', 'filePcmDiffers', 'una muestra del fichero convertido cambiada'],
  ['file', 'fileTagDiffers', 'el título del fichero convertido cambiado'],
  ['file', 'fileNoCover', 'la carátula del fichero convertido quitada'],
  ['music', 'musicMissing', 'la entrada nueva de Music borrada'],
  ['music', 'musicWrongFile', 'la entrada de Music apuntando a otro fichero'],
  ['music', 'musicDuplicate', 'una segunda entrada de Music para el mismo fichero'],
  ['music', 'musicTagDiffers', 'otro título en la entrada de Music'],
  ['music', 'musicPlaylistLost', 'la entrada de Music sacada de una playlist'],
  ['rekordbox', 'rekordboxStillOld', 'la fila de rekordbox devuelta a la ruta vieja'],
  ['rekordbox', 'rekordboxMissing', 'la fila de rekordbox borrada'],
  ['rekordbox', 'rekordboxAmbiguous', 'la fila de rekordbox duplicada'],
  ['rekordbox', 'rekordboxSizeDiffers', 'un tamaño erróneo en la fila de rekordbox'],
  ['rekordbox', 'rekordboxCuesLost', 'un cue de rekordbox borrado'],
  ['rekordbox', 'rekordboxAnalysisEmptied', 'el análisis de rekordbox vaciado'],
  ['engine', 'engineStillOld', 'la pista de Engine devuelta a la ruta vieja'],
  ['engine', 'engineMissing', 'la pista de Engine borrada'],
  ['engine', 'engineSizeDiffers', 'un tamaño erróneo en la pista de Engine'],
  ['engine', 'enginePerformanceChanged', 'los hot cues de Engine tocados'],
  ['traktor', 'traktorStillOld', 'la entrada de Traktor devuelta a la ruta vieja'],
  ['traktor', 'traktorMissing', 'la entrada de Traktor borrada'],
  ['traktor', 'traktorAmbiguous', 'la entrada de Traktor duplicada'],
]

const BLIND: [keyof typeof SABOTAGE_BASE, SabotageId, InvariantName, string, string][] = [
  [
    'rekordbox',
    'blindRekordboxCueMoved',
    'cues',
    'un cue de rekordbox movido 500 ms sin cambiar cuántos hay',
    'el verificador cuenta los cues de rekordbox y no mira dónde están',
  ],
  [
    'rekordbox',
    'blindRekordboxPlaylistLink',
    'playlists',
    'un enlace de playlist de rekordbox borrado',
    'el verificador no mira las playlists de rekordbox',
  ],
  [
    'traktor',
    'blindTraktorPlaylistKey',
    'playlists',
    'la clave de una playlist de Traktor rota',
    'el verificador no mira las playlists de Traktor',
  ],
]

const LAYER_S: Cell[] = [
  ...KEYED.map(([place, key, what]) =>
    cell('S', {
      ...SABOTAGE_BASE[place],
      id: `S-${key}`,
      name: `Avería tras convertir, ${what}`,
      sabotage: key,
      expectedKey: key,
      core: CORE_SABOTAGES.has(key),
    }),
  ),
  ...BLIND.map(([place, id, invariant, what, why]) =>
    cell('S', {
      ...SABOTAGE_BASE[place],
      id: `S-${id}`,
      name: `Punto ciego, ${what}`,
      sabotage: id,
      expectBroken: [{ invariant, why }],
    }),
  ),
]

export const CELLS: Cell[] = [...LAYER_C, ...LAYER_D, ...LAYER_Q, ...LAYER_K, ...LAYER_S]

export interface CellGroup {
  key: string
  cells: Cell[]
}

function batchKey(cell: Cell): string {
  if (cell.sabotage || cell.layer === 'K') return cell.id
  const base = `${cell.target} ${cell.dest} ${cell.programs} ${cell.state} ${cell.quality}`
  return cell.settings ? `${base} ${JSON.stringify(cell.settings)}` : base
}

export function groupsOf(cells: Cell[]): CellGroup[] {
  const groups = new Map<string, Cell[]>()
  for (const cell of cells) {
    const key = batchKey(cell)
    groups.set(key, [...(groups.get(key) ?? []), cell])
  }
  return [...groups].map(([key, members]) => ({ key, cells: members }))
}

const QUALITY_SETTINGS: Record<Quality, Partial<Settings>> = {
  source: {},
  rate48: { outputSampleRate: '48000' },
  bits16: { outputBitDepth: '16' },
  normalize: { normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 } },
  trim: {},
}

export function qualitySettings(q: Quality): Partial<Settings> {
  return { keepMp3Sources: false, ...QUALITY_SETTINGS[q] }
}
