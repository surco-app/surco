import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const config = readFileSync(resolve(__dirname, '../../electron.vite.config.ts'), 'utf8')
const builder = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')
const renderer = config.split(/^ {2}renderer: \{$/m)[1] ?? ''

it('ships the renderer minified, because Chromium parses the whole startup chunk before the first paint', () => {
  expect(renderer).toMatch(/^ {6}minify: true,$/m)
})

it('keeps a source map beside the minified renderer, so a stack in the error log can still be traced to its line', () => {
  expect(renderer).toMatch(/^ {6}sourcemap: 'hidden',$/m)
})

const fileLists = builder
  .split(/^ *files:\n/m)
  .slice(1)
  .map((rest) => rest.match(/^( +- .*\n)*/)?.[0] ?? '')

it('packs only the build output on every platform, since a platform list of files replaces the top-level one and would ship the whole source tree, the private auto cue engine included', () => {
  expect(fileLists.length).toBeGreaterThan(1)
  for (const list of fileLists) expect(list).toMatch(/^ +- out\/\*\*$/m)
})

it('leaves the source maps out of the packaged app on every platform, since they carry every source line, the private auto cue engine included', () => {
  for (const list of fileLists) expect(list).toMatch(/^ +- '!out\/\*\*\/\*\.map'$/m)
})
