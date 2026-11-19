import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repoRoot } from './big-fixtures.mjs'
import { assetsOf, sourcePositions } from './source-positions.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const buffers = process.argv.includes('--buffers')
const depth = Number(arg('depth', '16'))
const tree = resolve(arg('tree', repoRoot))
const { at } = sourcePositions(tree)
const chunks = readdirSync(assetsOf(tree)).filter((f) => f.endsWith('.js'))

const file = arg('snapshot', null)
const buf = readFileSync(file)
const want = arg('props', '').split(',').filter(Boolean)
const find = (needle, from = 0) => buf.indexOf(needle, from)
const metaEnd = find('"nodes":')
const head = JSON.parse(buf.subarray(0, metaEnd).toString().replace(/,\s*$/, '') + '}')
const meta = head.snapshot.meta
const NF = meta.node_fields.length
const EF = meta.edge_fields.length
const nodeCount = head.snapshot.node_count
const edgeCount = head.snapshot.edge_count

function ints(start, count) {
  const out = new Float64Array(count)
  let i = buf.indexOf(0x5b, start) + 1
  let n = 0
  let v = 0
  let has = false
  for (; n < count; i++) {
    const c = buf[i]
    if (c >= 48 && c <= 57) {
      v = v * 10 + (c - 48)
      has = true
    } else if (has) {
      out[n++] = v
      v = 0
      has = false
    }
    if (c === 0x5d) break
  }
  return { out, end: i, n }
}
const nodesAt = metaEnd
const nodes = ints(nodesAt, nodeCount * NF)
const edgesAt = find('"edges":', nodes.end)
const edges = ints(edgesAt, edgeCount * EF)
const locAt = find('"locations":', edges.end)
const locs = ints(locAt, 8e6)
const LF = meta.location_fields.length
const locOf = new Map()
for (let i = 0; i < locs.n; i += LF) locOf.set(locs.out[i] / NF, [locs.out[i + 1], locs.out[i + 3], locs.out[i + 4]])
const where = (i) => {
  const l = locOf.get(i)
  if (!l) return typeOf(i) === 'closure' ? ' {noloc}' : ''
  const found = new Set()
  for (const chunk of chunks) {
    const hit = at(chunk, l[1], l[2])
    if (hit && !hit.where.includes('node_modules/react')) found.add(hit.where)
  }
  return ` {${l.join(',')} ${[...found].slice(0, 3).join(' | ')}}`
}
const stringsAt = find('"strings":', locs.end)
const strings = JSON.parse(buf.subarray(buf.indexOf(0x5b, stringsAt), buf.lastIndexOf(0x5d) + 1).toString())

const nType = meta.node_fields.indexOf('type')
const nName = meta.node_fields.indexOf('name')
const nSelf = meta.node_fields.indexOf('self_size')
const nEdges = meta.node_fields.indexOf('edge_count')
const eType = meta.edge_fields.indexOf('type')
const eName = meta.edge_fields.indexOf('name_or_index')
const eTo = meta.edge_fields.indexOf('to_node')
const nodeTypes = meta.node_types[nType]
const edgeTypes = meta.edge_types[eType]
const N = nodes.out
const E = edges.out
const firstEdge = new Float64Array(nodeCount + 1)
for (let i = 0, e = 0; i < nodeCount; i++) {
  firstEdge[i] = e
  e += N[i * NF + nEdges]
}
firstEdge[nodeCount] = edgeCount
const nameOf = (i) => strings[N[i * NF + nName]]
const typeOf = (i) => nodeTypes[N[i * NF + nType]]
const edgeLabel = (e) => {
  const t = edgeTypes[E[e * EF + eType]]
  const v = E[e * EF + eName]
  return t === 'element' || t === 'hidden' ? `[${v}]` : `${strings[v]}${t === 'property' ? '' : `(${t})`}`
}

const parent = new Int32Array(nodeCount).fill(-1)
const via = new Int32Array(nodeCount).fill(-1)
const queue = new Int32Array(nodeCount)
let qh = 0
let qt = 0
queue[qt++] = 0
parent[0] = 0
while (qh < qt) {
  const i = queue[qh++]
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
    const t = edgeTypes[E[e * EF + eType]]
    if (t === 'weak' || t === 'shortcut') continue
    const to = E[e * EF + eTo] / NF
    if (parent[to] !== -1) continue
    parent[to] = i
    via[to] = e
    queue[qt++] = to
  }
}

{
  const by = new Map()
  for (let i = 0; i < nodeCount; i++) {
    const t = typeOf(i)
    const k = t === 'string' || t === 'concatenated string' || t === 'sliced string' ? t : `${t} ${nameOf(i).slice(0, 60)}`
    const c = by.get(k) ?? [0, 0]
    c[0]++
    c[1] += N[i * NF + nSelf]
    by.set(k, c)
  }
  writeFileSync(`${file}.summary.json`, JSON.stringify([...by]))
}
const hits = []
for (let i = 0; i < nodeCount; i++) {
  if (buffers) { if (nameOf(i) === 'system / JSArrayBufferData' && N[i * NF + nSelf] > 30000) hits.push(i); continue }
  if (typeOf(i) !== 'object') continue
  const names = new Set()
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++)
    if (edgeTypes[E[e * EF + eType]] === 'property') names.add(strings[E[e * EF + eName]])
  if (want.every((w) => names.has(w))) hits.push(i)
}
console.log(`\n${buffers ? 'buffers over 30 KB' : `objects with {${want.join(', ')}}`}: ${hits.length}`)
const paths = new Map()
for (const h of hits) {
  if (parent[h] === -1) {
    paths.set('(unreachable without weak edges)', (paths.get('(unreachable without weak edges)') ?? 0) + 1)
    continue
  }
  const steps = []
  for (let i = h; i !== 0 && steps.length < 40; i = parent[i])
    steps.push(`${edgeLabel(via[i])} <- ${typeOf(parent[i])}:${nameOf(parent[i]).slice(0, 50)}${where(parent[i])}`)
  const key = steps.slice(0, depth).join('\n      ')
  paths.set(key, (paths.get(key) ?? 0) + 1)
}
for (const [p, n] of [...paths].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`\n${n}x  ${p}`)
