import type { PlaylistRole } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'

const SEPARATOR = /^[-_=*~.\s]+$/

function isSeparator(node: SourceNode): boolean {
  return node.kind === 'playlist' && node.name.length > 0 && SEPARATOR.test(node.name)
}

export function withoutSeparators(nodes: readonly SourceNode[]): SourceNode[] {
  return nodes
    .filter((node) => !isSeparator(node))
    .map((node) => (node.children ? { ...node, children: withoutSeparators(node.children) } : node))
}

const ROLE_WORDS: Readonly<Record<PlaylistRole, readonly string[]>> = {
  base: [
    'base',
    'bases',
    'instrumental',
    'instrumentals',
    'instrumentales',
    'instrumentais',
    'instrumentaux',
    'ベース',
    'インスト',
    'strumentale',
    'strumentali',
  ],
  vocal: [
    'cantadita',
    'cantaditas',
    'cantada',
    'cantadas',
    'cantado',
    'cantados',
    'vocal',
    'vocals',
    'vocales',
    'vocais',
    'voix',
    'chant',
    'chants',
    'gesang',
    'acapella',
    'acapellas',
    'acapela',
    'acapelas',
    'ボーカル',
    'ヴォーカル',
    'cantadeta',
    'cantadetes',
    'cantades',
    'cantat',
    'cantats',
    'voce',
    'voci',
    'cantato',
    'cantati',
  ],
  any: [
    'combo',
    'combos',
    'set',
    'sets',
    'setlist',
    'setlists',
    'tracklist',
    'tracklists',
    'bolo',
    'bolos',
    'gig',
    'gigs',
    'session',
    'sessions',
    'sesion',
    'sesiones',
    'セット',
    'トラックリスト',
    'sessio',
    'sessione',
    'sessioni',
    'serata',
    'serate',
  ],
}

function wordsOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}

const WORD_ROLE = new Map<string, PlaylistRole>(
  (Object.entries(ROLE_WORDS) as [PlaylistRole, readonly string[]][]).flatMap(([role, words]) =>
    words.flatMap(wordsOf).map((word) => [word, role] as const),
  ),
)

function roleOfFolderName(node: SourceNode): PlaylistRole | null {
  if (node.kind !== 'folder') return null
  const found = new Set<PlaylistRole>()
  for (const word of wordsOf(node.name)) {
    const role = WORD_ROLE.get(word)
    if (role) found.add(role)
  }
  return found.size === 1 ? ([...found][0] as PlaylistRole) : null
}

export function suggestRoles(
  nodes: readonly SourceNode[],
  inherited: PlaylistRole | null = null,
): Record<string, PlaylistRole> {
  const roles: Record<string, PlaylistRole> = {}
  for (const node of nodes) {
    const role = inherited ?? roleOfFolderName(node)
    if (node.kind === 'playlist' && role) roles[node.id] = role
    Object.assign(roles, suggestRoles(node.children ?? [], role))
  }
  return roles
}

export function libraryRoles(
  nodes: readonly SourceNode[],
): Record<string, Exclude<PlaylistRole, 'any'>> {
  const roles: Record<string, Exclude<PlaylistRole, 'any'>> = {}
  for (const [id, role] of Object.entries(suggestRoles(nodes))) {
    if (role !== 'any') roles[id] = role
  }
  return roles
}

export type SessionPhase = 'open' | 'close' | 'must'

const PHASE_WORDS: Readonly<Record<SessionPhase, readonly string[]>> = {
  open: [
    'warm up',
    'warmup',
    'apertura',
    'aperturas',
    'opening',
    'openings',
    'opener',
    'openers',
    'calentamiento',
    'comienzo',
    'comienzos',
    'inicio',
    'aufwarmen',
    'eroffnung',
    'echauffement',
    'ouverture',
    'aquecimento',
    'abertura',
    'ウォームアップ',
    'オープニング',
    'escalfament',
    'obertura',
    'obertures',
    'inici',
    'comencament',
    'riscaldamento',
    'aperture',
    'inizio',
  ],
  close: [
    'cierre',
    'cierres',
    'closing',
    'closer',
    'closers',
    'final',
    'finales',
    'abschluss',
    'schluss',
    'cloture',
    'fermeture',
    'encerramento',
    'fecho',
    'クロージング',
    'ラスト',
    'tancament',
    'tancaments',
    'finals',
    'chiusura',
    'chiusure',
    'finale',
    'finali',
  ],
  must: [
    'fijas',
    'fijos',
    'imprescindibles',
    'esenciales',
    'essentials',
    'staples',
    'himnos',
    'anthems',
    'pflicht',
    'incontournables',
    'indispensables',
    'essenciais',
    'hinos',
    '定番',
    '必須',
    'fixes',
    'himnes',
    'essencials',
    'imperdibili',
    'essenziali',
    'inni',
  ],
}

const PHASE_PHRASES = (Object.entries(PHASE_WORDS) as [SessionPhase, readonly string[]][]).map(
  ([phase, phrases]) => ({ phase, phrases: phrases.map((phrase) => wordsOf(phrase).join(' ')) }),
)

function phaseOfName(name: string): SessionPhase | null {
  const words = ` ${wordsOf(name).join(' ')} `
  const found = PHASE_PHRASES.filter(({ phrases }) =>
    phrases.some((phrase) => words.includes(` ${phrase} `)),
  )
  return found.length === 1 ? found[0].phase : null
}

export function libraryPhases(
  nodes: readonly SourceNode[],
  inherited: SessionPhase | null = null,
): Record<string, SessionPhase> {
  const phases: Record<string, SessionPhase> = {}
  for (const node of nodes) {
    const phase = inherited ?? phaseOfName(node.name)
    if (node.kind === 'playlist' && phase) phases[node.id] = phase
    Object.assign(phases, libraryPhases(node.children ?? [], node.kind === 'folder' ? phase : null))
  }
  return phases
}
