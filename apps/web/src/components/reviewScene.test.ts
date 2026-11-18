import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { loadI18n } from '../i18n'
import ReviewScene from './scenes/ReviewScene'

const i18n = await loadI18n('en')

function optionDots() {
  const html = renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(ReviewScene)),
  )
  return html.match(/<i [^>]*data-testid="review-option-dot"[^>]*>/g) ?? []
}

describe('review scene option dot', () => {
  it('grows in from half size while fading, never from a zero-size point', () => {
    const dots = optionDots()
    expect(dots.length).toBeGreaterThan(0)
    for (const dot of dots) {
      expect(dot).toContain('transform:scale(0.5)')
      expect(dot).toContain('opacity:0')
      expect(dot).not.toContain('scale(0)')
    }
  })

  it('transitions opacity together with transform so the fade is not a hard cut', () => {
    const dots = optionDots()
    expect(dots.length).toBeGreaterThan(0)
    for (const dot of dots) expect(dot).toContain('transition-[transform,opacity]')
  })
})
