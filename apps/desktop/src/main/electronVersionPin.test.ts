import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it('packages the same Electron the main process is built and tested against, or the shipped app crashes on APIs it lacks', () => {
  const config = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')
  const pinned = config.match(/^electronVersion:\s*(\S+)/m)?.[1]
  const installed = (require('electron/package.json') as { version: string }).version

  expect(pinned).toBe(installed)
})
