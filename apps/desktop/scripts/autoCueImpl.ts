import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function autoCueImpl(root: string, env: NodeJS.ProcessEnv): string {
  const brain = join(root, 'brain', 'index.ts')
  if (existsSync(brain)) return brain
  if (env.SURCO_REQUIRE_BRAIN === '1') {
    throw new Error('SURCO_REQUIRE_BRAIN is set but brain/index.ts is missing')
  }
  return join(root, 'src', 'shared', 'autoCue', 'basic.ts')
}
