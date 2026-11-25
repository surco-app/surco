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

const SHIPPED = ['out/**', 'package.json', 'build/icon.png']

const blockOf = (key: string): string =>
  key === '' ? builder : (builder.split(new RegExp(`^${key}:\\n`, 'm'))[1] ?? '').split(/^\S/m)[0]

const filesOf = (key: string): string[] =>
  (blockOf(key).match(/^ *files:\n((?: +(?:- |#).*\n)*)/m)?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(/^'(.*)'$/, '$1'))

const PLATFORMS = ['', 'mac', 'win', 'linux']

it('packs only the build output on every platform, since a platform list of files replaces the top-level one and would ship the whole source tree, the private auto cue engine included', () => {
  for (const key of PLATFORMS) {
    const included = filesOf(key).filter((entry) => !entry.startsWith('!'))
    expect(included, key || 'top level').toEqual(SHIPPED)
  }
})

it('leaves the source maps out of the packaged app on every platform, since they carry every source line, the private auto cue engine included', () => {
  for (const key of PLATFORMS) expect(filesOf(key), key || 'top level').toContain('!out/**/*.map')
})
