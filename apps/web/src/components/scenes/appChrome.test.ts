import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Spinner } from './AppChrome'

describe('scene spinner', () => {
  it('spins through the animate-spin utility so it does not depend on another component having pulled the keyframe in', () => {
    const html = renderToStaticMarkup(createElement(Spinner))
    const tag = /<span [^>]*data-testid="scene-spinner"[^>]*>/.exec(html)?.[0] ?? ''
    expect(tag).toContain('animate-spin')
    expect(tag).toContain('[animation-duration:0.8s]')
    expect(tag).not.toContain('animation:')
  })
})
