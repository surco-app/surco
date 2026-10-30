// Records today's download totals in the stats file the web's stats page reads. Run daily
// by .github/workflows/stats.yml as `node apps/web/scripts/stats-snapshot.ts <stats.json>`;
// with no file yet it rebuilds the history from the release dates.
import { readFile, writeFile } from 'node:fs/promises'
import { fetchAllReleases } from '../src/lib/downloads.ts'
import { recordSnapshot, type Stats, type StatsRelease } from '../src/lib/stats.ts'

const path = process.argv[2]
if (!path) {
  console.error('Uso: node apps/web/scripts/stats-snapshot.ts <stats.json>')
  process.exit(1)
}

async function readPrevious(): Promise<Stats | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Stats
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

const token = process.env.GITHUB_TOKEN
const releases = (await fetchAllReleases(
  'surco-app/surco-releases',
  token ? { Authorization: `Bearer ${token}` } : {},
)) as StatsRelease[]
const today = new Date().toISOString().slice(0, 10)
await writeFile(path, `${JSON.stringify(recordSnapshot(await readPrevious(), releases, today))}\n`)
