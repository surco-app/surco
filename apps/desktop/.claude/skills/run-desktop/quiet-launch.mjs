import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const foreground = process.env.SURCO_TEST_FOREGROUND === '1'

export function quietLaunch(mainEntry) {
  if (foreground) return { entry: mainEntry, env: {} }
  return {
    entry: join(here, 'background-entry.mjs'),
    env: { SURCO_MAIN_ENTRY: pathToFileURL(mainEntry).href },
  }
}
