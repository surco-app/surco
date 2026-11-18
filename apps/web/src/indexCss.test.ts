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
