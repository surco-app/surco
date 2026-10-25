import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { APP_DIR, caseDir, ELECTRON, HERE, ROOT } from '../../kit.mjs'

execFileSync(ELECTRON, [join(HERE, 'cases/cues/rekordbox.cjs'), ROOT, APP_DIR, join(caseDir('cues'), 'rekordbox')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
})
