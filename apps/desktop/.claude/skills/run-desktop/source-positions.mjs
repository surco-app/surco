import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { repoRoot } from './big-fixtures.mjs'

const { TraceMap, originalPositionFor } = createRequire(join(repoRoot, 'index.js'))(
  '@jridgewell/trace-mapping',
)

export const assetsOf = (tree) => join(tree, 'apps/desktop/out/renderer/assets')

export function sourcePositions(tree) {
  const maps = new Map()
  const mapFor = (url) => {
    const file = `${basename(url)}.map`
    if (!maps.has(file)) {
      const path = join(assetsOf(tree), file)
      maps.set(file, existsSync(path) ? new TraceMap(readFileSync(path, 'utf8')) : null)
    }
    return maps.get(file)
  }
  const at = (url, line, column) => {
    const map = url && mapFor(url)
    const found = map && originalPositionFor(map, { line: line + 1, column })
    if (!found?.source) return null
    return {
      name: found.name,
      where: `${found.source.replace(/^.*?(src|node_modules)\//, '$1/')}:${found.line}`,
    }
  }
  const label = (frame) => {
    const found = at(frame.url, frame.lineNumber, frame.columnNumber)
    if (found) return `${found.name ?? frame.functionName} ${found.where}`
    return `${frame.functionName || '(anon)'} ${basename(frame.url || '')}`
  }
  return { at, label }
}
