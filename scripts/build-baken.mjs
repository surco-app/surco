#!/usr/bin/env node
// Builds Surco's patched baken for THIS machine into apps/desktop/resources/baken/.
// Source is pinned (apps/desktop/vendor/baken/UPSTREAM: url, tag, commit), the Rust version
// too (RUST_TOOLCHAIN), and Surco's patches are applied on top, so the shipped binary always
// matches the repo. Nothing is downloaded prebuilt: a release asset in surco-releases would
// be seen by the website's download button and by the updater. On Linux only the licences
// are written, since the export exists on macOS and Windows only.
// BAKEN_TEST=1 also runs baken's export tests (the patches' own tests among them).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'apps/desktop/vendor/baken')
const out = join(root, 'apps/desktop/resources/baken')
const [url, tag, commit] = readFileSync(join(vendor, 'UPSTREAM'), 'utf8').trim().split('\n')
const toolchain = readFileSync(join(vendor, 'RUST_TOOLCHAIN'), 'utf8').trim()
const work = process.env.BAKEN_BUILD_DIR ?? join(root, 'apps/desktop/.baken-build')
const exe = process.platform === 'win32' ? 'baken.exe' : 'baken'

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(join(vendor, 'LICENSE'), join(out, 'LICENSE'))
copyFileSync(join(vendor, 'THIRD_PARTY_LICENSES.md'), join(out, 'THIRD_PARTY_LICENSES.md'))
if (process.platform !== 'darwin' && process.platform !== 'win32') {
  console.log(`baken: not built on ${process.platform} (the USB export is macOS and Windows only)`)
  process.exit(0)
}

// A cached clone (CI restores it with the cargo cache) may hold a `git am` that failed last
// time; left there it blocks every later build, so it is aborted first. The clone is then
// reset to the pinned commit and the patches are re-applied, so an edited patch is never
// skipped. Line endings are never converted: a patch applied with CRLF would not match.
if (!existsSync(join(work, '.git'))) {
  run('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--branch', tag, url, work])
}
try {
  execFileSync('git', ['am', '--abort'], { cwd: work, stdio: 'ignore' })
} catch {}
run('git', ['fetch', '--quiet', '--tags', 'origin'], work)
run('git', ['checkout', '--quiet', '--force', commit], work)
run('git', ['clean', '-fdq'], work)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work }).toString().trim()
if (head !== commit) throw new Error(`baken ${tag} is ${head}, expected ${commit}`)
const patches = readdirSync(join(vendor, 'patches'))
  .filter((f) => f.endsWith('.patch'))
  .sort()
run(
  'git',
  [
    '-c', 'user.name=surco',
    '-c', 'user.email=surco@localhost',
    '-c', 'core.autocrlf=false',
    'am', '--quiet',
    ...patches.map((p) => join(vendor, 'patches', p)),
  ],
  work,
)
// rustup reads this file and installs the pinned version if the machine lacks it.
writeFileSync(join(work, 'rust-toolchain.toml'), `[toolchain]\nchannel = "${toolchain}"\n`)
if (process.env.BAKEN_TEST === '1') run('cargo', ['test', '--release', '--locked', '-p', 'baken-export'], work)
run('cargo', ['build', '--release', '--locked', '-p', 'baken'], work)
copyFileSync(join(work, 'target/release', exe), join(out, exe))
console.log(`baken ${tag} + ${patches.length} patches (Rust ${toolchain}) -> ${join(out, exe)}`)
