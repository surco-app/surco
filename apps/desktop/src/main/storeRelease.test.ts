import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(__dirname, '../../../../.github/workflows/release.yml'),
  'utf8',
)

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

  // msstore's first argument is a project folder; handed a folder with no project in it,
  // it goes looking for one instead of using the package, and every submission fails.
  it('hands msstore the package file itself', () => {
    expect(job('store')).toContain('msstore publish store/Surco.msix')
  })

  // A beta and its stable both turn into the same four-part Windows version (1.10.0-beta.1
  // and 1.10.0 are both 1.10.0.0), and the Store only takes a higher one, so a beta
  // package that reached Partner Center would block the stable release after it.
  it('never builds a Store package from a beta', () => {
    const release = job('release')
    const step = release.slice(release.indexOf('Build the Microsoft Store package'))
    expect(step.slice(0, step.indexOf('run:'))).toContain("!contains(github.ref_name, '-beta.')")
  })

  // The job cannot fail the release, so a broken submission leaves the run green; it has to
  // say so in the summary or the Store copy goes stale without anyone noticing.
  it('says in the run summary when the submission fails', () => {
    const store = job('store')
    expect(store).toContain('if: failure()')
    expect(store).toContain('Microsoft Store submission failed')
  })
})
