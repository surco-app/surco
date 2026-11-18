import { describe, expect, it } from 'vitest'
import { edgeScrollStep } from './edgeScroll'

describe('edgeScrollStep', () => {
  it('stays still while the pointer is in the middle of the list, so a drag between visible rows never moves them', () => {
    expect(edgeScrollStep(300, 100, 600)).toBe(0)
  })

  it('scrolls up near the top edge and faster the closer the pointer gets, so a row can be carried above the first one on screen', () => {
    const near = edgeScrollStep(140, 100, 600)
    const atEdge = edgeScrollStep(100, 100, 600)
    expect(near).toBeLessThan(0)
    expect(atEdge).toBeLessThan(near)
  })

  it('scrolls down near the bottom edge and faster the closer the pointer gets', () => {
    const near = edgeScrollStep(560, 100, 600)
    const atEdge = edgeScrollStep(600, 100, 600)
    expect(near).toBeGreaterThan(0)
    expect(atEdge).toBeGreaterThan(near)
  })

  it('never goes faster than its top speed, however far past the edge the pointer is', () => {
    expect(edgeScrollStep(-500, 100, 600)).toBe(edgeScrollStep(100, 100, 600))
    expect(edgeScrollStep(5000, 100, 600)).toBe(edgeScrollStep(600, 100, 600))
  })
})
