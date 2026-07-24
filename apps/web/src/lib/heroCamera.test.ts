import { describe, expect, it } from 'vitest'
import { cameraTransform } from './heroCamera'

describe('cameraTransform', () => {
  it('returns the resting full view when no frame is active', () => {
    expect(cameraTransform(null)).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('treats the full image as the resting view', () => {
    expect(cameraTransform({ top: 0, left: 0, width: 100, height: 100 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    })
  })

  it('scales so the frame fills the viewport width, cropping tall frames', () => {
    const { scale } = cameraTransform({ top: 60, left: 47.5, width: 51, height: 32 })
    expect(scale).toBeCloseTo(100 / 51, 5)
  })

  it('caps the zoom so narrow frames never pixelate', () => {
    const { scale } = cameraTransform({ top: 5, left: 0.5, width: 22, height: 92 })
    expect(scale).toBe(2.2)
  })

  it('centres the frame in the viewport', () => {
    const { scale, x, y } = cameraTransform({ top: 25, left: 25, width: 50, height: 50 })
    expect(scale).toBe(2)
    expect(x).toBe(-25)
    expect(y).toBe(-25)
  })

  it('clamps the pan so image edges never enter the viewport', () => {
    const { scale, x, y } = cameraTransform({ top: 5, left: 0.5, width: 22, height: 92 })
    expect(x).toBe(0)
    expect(y).toBeGreaterThanOrEqual(100 * (1 / scale - 1))
    expect(y).toBeLessThanOrEqual(0)
  })
})
