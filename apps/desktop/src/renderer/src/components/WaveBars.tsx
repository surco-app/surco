import type React from 'react'

const WAVE_HEIGHT = 20

function wavePath(bars: number[]): string {
  return bars
    .map((v, i) => {
      const h = Math.max(1, v * WAVE_HEIGHT)
      return `M${i} ${(WAVE_HEIGHT - h) / 2}h0.7v${h}h-0.7Z`
    })
    .join('')
}

export function WaveBars({
  bars,
  testId,
  className,
  style,
  fill = 'var(--color-accent)',
}: {
  bars: number[]
  testId: string
  className: string
  style?: React.CSSProperties
  fill?: string
}): React.JSX.Element {
  return (
    <svg
      data-testid={testId}
      aria-hidden="true"
      viewBox={`0 0 ${bars.length} ${WAVE_HEIGHT}`}
      preserveAspectRatio="none"
      opacity={0.7}
      className={className}
      style={style}
    >
      <path d={wavePath(bars)} fill={fill} />
    </svg>
  )
}
