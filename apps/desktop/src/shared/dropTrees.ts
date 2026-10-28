export type TreeNode =
  | [feature: number, threshold: number, left: number, right: number]
  | [value: number]

export interface TreesModel {
  base: number
  trees: TreeNode[][]
}

export interface TreesOptions {
  trees: number
  depth: number
  minLeaf: number
  rate?: number
  lambda?: number
  bins?: number
  from?: TreesModel
}

const round = (x: number): number => Number(x.toPrecision(6))

function edgesOf(rows: number[][], feature: number, bins: number): number[] {
  const values = Float64Array.from(rows, (r) => r[feature]).sort()
  const edges: number[] = []
  for (let b = 1; b < bins; b++) {
    const x = round(values[Math.floor((b * values.length) / bins)])
    if (edges.length === 0 || x > edges[edges.length - 1]) edges.push(x)
  }
  return edges
}

function binOf(edges: number[], x: number): number {
  let lo = 0
  let hi = edges.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x > edges[mid]) lo = mid + 1
    else hi = mid
  }
  return lo
}

function leafOf(tree: TreeNode[], row: number[]): number {
  let node = tree[0]
  while (node.length === 4) node = tree[row[node[0]] <= node[1] ? node[2] : node[3]]
  return node[0]
}

export function predictTrees(model: TreesModel, row: number[]): number {
  let score = model.base
  for (const tree of model.trees) score += leafOf(tree, row)
  return score
}

export function trainTrees(rows: number[][], labels: number[], options: TreesOptions): TreesModel {
  const { depth, minLeaf, rate = 0.1, lambda = 1, bins = 32 } = options
  const n = rows.length
  const features = rows[0].length
  const edges = Array.from({ length: features }, (_, j) => edgesOf(rows, j, bins))
  const binned = edges.map((e, j) => Uint8Array.from(rows, (r) => binOf(e, r[j])))
  const positive = labels.reduce((a, b) => a + b, 0) / n
  const base = options.from?.base ?? round(Math.log(positive / (1 - positive)))
  const from = options.from
  const score = from ? Float64Array.from(rows, (r) => predictTrees(from, r)) : new Float64Array(n).fill(base)
  const g = new Float64Array(n)
  const h = new Float64Array(n)
  const trees: TreeNode[][] = [...(from?.trees ?? [])]
  for (let t = 0; t < options.trees; t++) {
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-score[i]))
      g[i] = p - labels[i]
      h[i] = Math.max(p * (1 - p), 1e-6)
    }
    const tree: TreeNode[] = []
    const grow = (members: Int32Array, level: number): number => {
      const at = tree.length
      tree.push([0])
      let G = 0
      let H = 0
      for (const i of members) {
        G += g[i]
        H += h[i]
      }
      const parent = (G * G) / (H + lambda)
      let best: { gain: number; feature: number; bin: number } | null = null
      if (level < depth && members.length >= 2 * minLeaf)
        for (let j = 0; j < features; j++) {
          const width = edges[j].length + 1
          const gs = new Float64Array(width)
          const hs = new Float64Array(width)
          const cs = new Int32Array(width)
          for (const i of members) {
            const b = binned[j][i]
            gs[b] += g[i]
            hs[b] += h[i]
            cs[b]++
          }
          let gl = 0
          let hl = 0
          let cl = 0
          for (let b = 0; b < width - 1; b++) {
            gl += gs[b]
            hl += hs[b]
            cl += cs[b]
            if (cl < minLeaf || members.length - cl < minLeaf) continue
            const gain = (gl * gl) / (hl + lambda) + (G - gl) ** 2 / (H - hl + lambda) - parent
            if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, feature: j, bin: b }
          }
        }
      if (!best) {
        tree[at] = [round((-G / (H + lambda)) * rate)]
        return at
      }
      const { feature, bin } = best
      const left = members.filter((i) => binned[feature][i] <= bin)
      const right = members.filter((i) => binned[feature][i] > bin)
      const l = grow(left, level + 1)
      const r = grow(right, level + 1)
      tree[at] = [feature, edges[feature][bin], l, r]
      return at
    }
    grow(
      Int32Array.from({ length: n }, (_, i) => i),
      0,
    )
    trees.push(tree)
    for (let i = 0; i < n; i++) score[i] += leafOf(tree, rows[i])
  }
  return { base, trees }
}
