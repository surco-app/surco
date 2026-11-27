import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')

function reducedMotionBlock() {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  return css.slice(start)
}

describe('index.css', () => {
  it('stops the FAQ answer from sliding under reduced motion, since the catch-all rule cannot reach ::details-content', () => {
    const rule = /details::details-content\s*\{([^}]*)\}/.exec(reducedMotionBlock())?.[1] ?? ''
    expect(rule).toContain('transition: none')
  })
})

describe('family typography', () => {
  const main = readFileSync(fileURLToPath(new URL('./main.tsx', import.meta.url)), 'utf8')
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('\n}', css.indexOf('@theme')))

  it('sets the site in Geist, the face Cuts and Nada share, so Surco reads as their sibling', () => {
    expect(main).toContain("import '@fontsource-variable/geist'")
    expect(theme).toMatch(/--font-sans:\s*"Geist Variable"/)
  })

  it('keeps meta lines, keys and code in Geist Mono, as the family does', () => {
    expect(main).toContain("import '@fontsource-variable/geist-mono'")
    expect(theme).toMatch(/--font-mono:\s*"Geist Mono Variable"/)
  })
})
