import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(__dirname, '../../../../.github/workflows/release.yml'), 'utf8')

// A job runs from its "  name:" line to the next top-level job.
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  if (start === -1) return ''
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

describe('Microsoft Store submission in the release', () => {
  it('submits only after the release is public, so the Store never gets a build GitHub withdrew', () => {
    expect(job('store')).toMatch(/needs:.*\bpublish\b/)
  })

  it('never sends a beta to the Store', () => {
    expect(job('store')).toContain("!contains(github.ref_name, '-beta.')")
  })

  it('stays off until the first submission is made by hand', () => {
    expect(job('store')).toContain("vars.STORE_PUBLISH == '1'")
  })

  it('cannot fail the release', () => {
    expect(job('store')).toContain('continue-on-error: true')
    expect(job('update-tap')).not.toMatch(/needs:.*\bstore\b/)
  })

  it('builds the Store package next to the installer', () => {
    const release = job('release')
    expect(release).toContain('--win appx')
    expect(release).toContain('name: surco-store-appx')
  })
})
