// Camera framing for the hero showcase: given a rectangle (percentages of the
// screenshot) it yields the transform that centres it in a viewport with the
// image's own aspect ratio. Zoom is capped so the 2000px asset never pixelates,
// and the pan is clamped so the image edges stay outside the viewport.
export type Frame = { top: number; left: number; width: number; height: number }
export type CameraTransform = { scale: number; x: number; y: number }

const MAX_SCALE = 2.2

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function cameraTransform(frame: Frame | null): CameraTransform {
  if (!frame) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(MAX_SCALE, 100 / frame.width, 100 / frame.height)
  const minPan = 100 * (1 / scale - 1)
  return {
    scale,
    x: clamp(50 / scale - (frame.left + frame.width / 2), minPan, 0),
    y: clamp(50 / scale - (frame.top + frame.height / 2), minPan, 0),
  }
}
