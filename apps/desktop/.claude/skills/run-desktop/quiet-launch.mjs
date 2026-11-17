import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const foreground = process.env.SURCO_TEST_FOREGROUND === '1' || process.platform !== 'darwin'

function backgroundElectron(electronPath) {
  const bundle = electronPath.slice(0, electronPath.indexOf('.app/') + '.app'.length)
  const version = readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8').match(
    /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1]
  const dir = join(tmpdir(), `surco-background-electron-${version ?? 'unknown'}`)
  const copy = join(dir, 'Electron.app')
  if (!existsSync(join(dir, 'ready'))) {
    mkdirSync(dir, { recursive: true })
    execFileSync('rm', ['-rf', copy])
    execFileSync('cp', ['-c', '-R', bundle, copy])
    execFileSync('plutil', ['-replace', 'LSUIElement', '-bool', 'true', join(copy, 'Contents', 'Info.plist')])
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', copy], { stdio: 'ignore' })
    writeFileSync(join(dir, 'ready'), version ?? '')
  }
  return join(copy, electronPath.slice(bundle.length + 1))
}

export function quietLaunch(mainEntry, electronPath) {
  if (foreground) return { executablePath: electronPath, entry: mainEntry, env: {} }
  return {
    executablePath: backgroundElectron(electronPath),
    entry: join(here, 'background-entry.mjs'),
    env: { SURCO_MAIN_ENTRY: pathToFileURL(mainEntry).href },
  }
}
