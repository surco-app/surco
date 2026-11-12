import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const config = readFileSync(resolve(__dirname, '../../electron.vite.config.ts'), 'utf8')
const renderer = config.split(/^ {2}renderer: \{$/m)[1] ?? ''

it('ships the renderer minified, because Chromium parses the whole startup chunk before the first paint', () => {
  expect(renderer).toMatch(/^ {6}minify: true,$/m)
})

it('keeps a source map beside the minified renderer, so a stack in the error log can still be traced to its line', () => {
  expect(renderer).toMatch(/^ {6}sourcemap: 'hidden',$/m)
})
