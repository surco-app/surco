import { localDate } from './rekordboxRows'

type Param = string | number

interface Condition {
  property: string
  operator: number
  unit: string
  left: string
  right: string
}

const nameOf = (table: string, column: string): string =>
  `(SELECT Name FROM ${table} WHERE ID = c.${column})`

const TEXT: Readonly<Record<string, string>> = {
  name: 'c.Title',
  mixName: 'c.Subtitle',
  comments: 'c.Commnt',
  fileName: 'c.FileNameL',
  artist: nameOf('djmdArtist', 'ArtistID'),
  originalArtist: nameOf('djmdArtist', 'OrgArtistID'),
  producer: nameOf('djmdArtist', 'ComposerID'),
  remixedBy: nameOf('djmdArtist', 'RemixerID'),
  album: nameOf('djmdAlbum', 'AlbumID'),
  albumArtist: `(SELECT a.Name FROM djmdAlbum al JOIN djmdArtist a ON a.ID = al.AlbumArtistID WHERE al.ID = c.AlbumID)`,
  genre: nameOf('djmdGenre', 'GenreID'),
  label: nameOf('djmdLabel', 'LabelID'),
  key: '(SELECT ScaleName FROM djmdKey WHERE ID = c.KeyID)',
}

const NUMBER: Readonly<Record<string, string>> = {
  year: 'c.ReleaseYear',
  counter: 'c.DJPlayCount',
  bpm: 'c.BPM',
  rating: 'c.Rating',
  duration: 'c.Length',
}

const DATE: Readonly<Record<string, string>> = {
  stockDate: 'c.StockDate',
  dateReleased: 'c.ReleaseDate',
  dateCreated: 'c.DateCreated',
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

const unescape = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name])

function attribute(tag: string, name: string): string | null {
  const found = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return found ? unescape(found[1]) : null
}

function conditionsOf(xml: string): { any: boolean; conditions: Condition[] } | null {
  const node = xml.match(/<NODE\b[^>]*>/)?.[0]
  if (!node) return null
  const logic = attribute(node, 'LogicalOperator')
  const conditions = (xml.match(/<CONDITION\b[^>]*\/?>/g) ?? []).map((tag) => ({
    property: attribute(tag, 'PropertyName') ?? '',
    operator: Number(attribute(tag, 'Operator')),
    unit: attribute(tag, 'ValueUnit') ?? '',
    left: attribute(tag, 'ValueLeft') ?? '',
    right: attribute(tag, 'ValueRight') ?? '',
  }))
  if (conditions.length === 0 || (logic !== '1' && logic !== '2')) return null
  return { any: logic === '2', conditions }
}

type Clause = { sql: string; params: Param[] } | null

function textClause(column: string, { operator, left }: Condition): Clause {
  const value = `lower(coalesce(${column}, ''))`
  const wanted = left.toLowerCase()
  switch (operator) {
    case 1:
      return { sql: `${value} = ?`, params: [wanted] }
    case 2:
      return { sql: `${value} <> ?`, params: [wanted] }
    case 8:
      return { sql: `instr(${value}, ?) > 0`, params: [wanted] }
    case 9:
      return { sql: `instr(${value}, ?) = 0`, params: [wanted] }
    case 10:
      return { sql: `instr(${value}, ?) = 1`, params: [wanted] }
    case 11:
      return { sql: `substr(${value}, -length(?)) = ?`, params: [wanted, wanted] }
    default:
      return null
  }
}

function rangeClause(
  value: string,
  { operator, left, right }: Condition,
  of: (v: string) => Param,
): Clause {
  switch (operator) {
    case 1:
      return { sql: `${value} = ?`, params: [of(left)] }
    case 2:
      return { sql: `${value} <> ?`, params: [of(left)] }
    case 3:
      return { sql: `${value} > ?`, params: [of(left)] }
    case 4:
      return { sql: `${value} < ?`, params: [of(left)] }
    case 5:
      return { sql: `${value} BETWEEN ? AND ?`, params: [of(left), of(right)] }
    default:
      return null
  }
}

function since(now: Date, amount: number, unit: string): string | null {
  if (unit === 'day')
    return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - amount))
  if (unit === 'month')
    return localDate(new Date(now.getFullYear(), now.getMonth() - amount, now.getDate()))
  return null
}

function dateClause(column: string, condition: Condition, now: Date): Clause {
  const value = `nullif(substr(coalesce(${column}, ''), 1, 10), '')`
  if (condition.operator === 6 || condition.operator === 7) {
    const from = since(now, Number(condition.left), condition.unit)
    if (from === null) return null
    return { sql: `${value} ${condition.operator === 6 ? '>=' : '<'} ?`, params: [from] }
  }
  return rangeClause(value, condition, (v) => v)
}

function myTagClause({ operator, left }: Condition): Clause {
  if (operator !== 8 && operator !== 9) return null
  const id = Number(left) < 0 ? String(Number(left) + 2 ** 32) : left
  const tagged = `EXISTS (SELECT 1 FROM djmdSongMyTag s WHERE s.ContentID = c.ID AND s.MyTagID = ? AND coalesce(s.rb_local_deleted, 0) = 0)`
  return { sql: operator === 8 ? tagged : `NOT ${tagged}`, params: [id] }
}

function colourClause({ operator, left }: Condition): Clause {
  const colour = 'CAST(coalesce(c.ColorID, 0) AS INTEGER)'
  if (operator === 1) return { sql: `${colour} = ?`, params: [Number(left)] }
  if (operator === 2) return { sql: `${colour} <> ?`, params: [Number(left)] }
  return null
}

function clauseOf(condition: Condition, now: Date): Clause {
  const { property } = condition
  if (property in TEXT) return textClause(TEXT[property], condition)
  if (property in NUMBER)
    return rangeClause(`coalesce(${NUMBER[property]}, 0)`, condition, (v) => Number(v))
  if (property in DATE) return dateClause(DATE[property], condition, now)
  if (property === 'myTag') return myTagClause(condition)
  if (property === 'grouping') return colourClause(condition)
  return null
}

export function smartListContent(
  xml: string,
  now: Date,
): { where: string; params: Param[] } | null {
  const list = conditionsOf(xml)
  if (list === null) return null
  const clauses = list.conditions.map((condition) => clauseOf(condition, now))
  const known = clauses.filter((clause) => clause !== null)
  if (known.length < clauses.length) return null
  return {
    where: `(${known.map((clause) => `(${clause.sql})`).join(list.any ? ' OR ' : ' AND ')})`,
    params: known.flatMap((clause) => clause.params),
  }
}
