import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useState,
} from 'react'
import { barsPath } from '../../lib/envelope'

// The pieces of the desktop app's window the walkthrough scenes are drawn from: the
// toolbar, the track row, an editor field, the split convert button and a pointer.
// They copy the app's classes and states so every scene looks like the window a
// visitor will open, and a change to the app's look has one place to follow it here.

export const EASE = 'cubic-bezier(0.19, 1, 0.22, 1)'

export function Glyph({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      {children}
    </svg>
  )
}

export const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  stats: (
    <>
      <path d="M3 3v18h18" />
      <path d="M8 17V9M13 17V5M18 17v-4" />
    </>
  ),
  radio: (
    <>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  convert: (
    <>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  note: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 12v6M9 15h6" />
    </>
  ),
  spin: <path d="M21 12a9 9 0 1 1-6.2-8.6" />,
  sparkle: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  ),
  play: <path d="M7 4v16l13-8z" />,
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </>
  ),
  vinyl: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
}

export function Spinner({ size = 13 }: { size?: number }) {
  return (
    <span className="inline-flex" style={{ animation: 'spin 0.8s linear infinite' }}>
      <Glyph size={size}>{ICONS.spin}</Glyph>
    </span>
  )
}

export function Swap({
  on,
  from,
  to,
  className = '',
}: {
  on: boolean
  from: ReactNode
  to: ReactNode
  className?: string
}) {
  const leg = (shown: boolean, y: number): CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? 'none' : `translateY(${y}px)`,
    transition: `opacity 0.3s ease, transform 0.5s ${EASE}`,
  })
  return (
    <span className={`grid ${className}`}>
      <span className="col-start-1 row-start-1 truncate" style={leg(!on, -6)}>
        {from}
      </span>
      <span className="col-start-1 row-start-1 truncate" style={leg(on, 6)}>
        {to}
      </span>
    </span>
  )
}

export function AppWindow({
  windowRef,
  status,
  activity,
  action,
  children,
}: {
  windowRef?: RefObject<HTMLDivElement | null>
  status?: ReactNode
  activity?: { ref?: RefObject<HTMLSpanElement | null>; open?: boolean; running?: boolean }
  action: ReactNode
  children: ReactNode
}) {
  return (
    <div
      ref={windowRef}
      aria-hidden="true"
      className="inset-shadow-edge relative min-w-0 overflow-hidden rounded-xl border border-line bg-bg text-left shadow-2xl shadow-black/40"
    >
      <div className="flex h-11 items-center gap-1 border-b border-line bg-bg2 pr-2.5 pl-3.5">
        <span className="mr-auto flex gap-[7px]">
          <i className="block size-[11px] rounded-full bg-red" />
          <i className="block size-[11px] rounded-full bg-amber" />
          <i className="block size-[11px] rounded-full bg-green" />
        </span>
        {status}
        <span className="grid size-[30px] place-items-center text-muted">
          <Glyph>{ICONS.search}</Glyph>
        </span>
        <span className="hidden size-[30px] place-items-center text-muted sm:grid">
          <Glyph>{ICONS.stats}</Glyph>
        </span>
        <span
          ref={activity?.ref}
          className={`relative grid size-[30px] place-items-center rounded-lg transition-colors ${
            activity?.open ? 'bg-[#292e42] text-fg' : 'text-muted'
          }`}
        >
          <Glyph>{ICONS.radio}</Glyph>
          <i
            className="absolute top-1.5 right-1.5 block size-1.5 rounded-full bg-green transition-[opacity,transform] duration-300"
            style={{
              opacity: activity?.running ? 1 : 0,
              transform: activity?.running ? 'none' : 'scale(0.5)',
            }}
          />
        </span>
        <span className="hidden size-[30px] place-items-center text-muted sm:grid">
          <Glyph>{ICONS.gear}</Glyph>
        </span>
        <span className="mx-1.5 h-[18px] w-px bg-line" />
        {action}
      </div>
      {children}
    </div>
  )
}

export function ToolbarButton({
  children,
  quiet = false,
}: {
  children: ReactNode
  quiet?: boolean
}) {
  return (
    <span
      className={`flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium whitespace-nowrap ${
        quiet ? 'text-faint' : 'bg-blue/15 text-blue'
      }`}
    >
      {children}
    </span>
  )
}

export function SearchBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 overflow-hidden rounded-lg border border-line bg-bg2 px-2.5 text-[12.5px] whitespace-nowrap text-faint">
      <Glyph size={13}>{ICONS.search}</Glyph>
      {children}
    </div>
  )
}

export type FormatTone = 'good' | 'bad' | 'plain'

export function FormatPill({ format, tone = 'good' }: { format: string; tone?: FormatTone }) {
  const look =
    tone === 'good'
      ? 'bg-green/15 font-semibold text-green'
      : tone === 'bad'
        ? 'bg-red/20 font-semibold text-red'
        : 'font-medium text-muted'
  return (
    <span className={`inline-flex h-4 items-center gap-[3px] rounded px-[5px] text-[10px] ${look}`}>
      {tone === 'bad' && <i className="block size-[5px] bg-red" />}
      {format}
    </span>
  )
}

export function Cover({ src, className = '' }: { src?: string; className?: string }) {
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={`size-full object-cover ${className}`}
    />
  ) : (
    <span className={`grid size-full place-items-center bg-[#292e42] text-faint ${className}`}>
      <Glyph size={13}>{ICONS.note}</Glyph>
    </span>
  )
}

export function AppRow({
  title,
  artist,
  duration,
  format,
  tone = 'good',
  cover,
  selected,
  loading = false,
  stage,
  ring,
  done = false,
  stripe = false,
}: {
  title: string
  artist: ReactNode
  duration: string
  format: string
  tone?: FormatTone
  cover?: string
  selected?: 'primary' | 'multi'
  loading?: boolean
  stage?: string | null
  ring?: number | null
  done?: boolean
  stripe?: boolean
}) {
  const working = ring !== null && ring !== undefined
  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-300 ${
        selected === 'primary' ? 'bg-blue/30' : selected === 'multi' ? 'bg-blue/15' : ''
      }`}
    >
      {stripe && (
        <i className="absolute top-1/2 left-0 block h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-red" />
      )}
      <span
        className="relative size-8 flex-none outline outline-fg/10"
        style={{ borderRadius: working ? '50%' : '6px', transition: `border-radius 0.4s ${EASE}` }}
      >
        <span className="block size-full overflow-hidden" style={{ borderRadius: 'inherit' }}>
          <Cover src={loading ? undefined : cover} />
        </span>
        <i
          className="absolute -inset-1 rounded-full transition-opacity duration-300"
          style={{
            opacity: working ? 1 : 0,
            background: `conic-gradient(var(--color-fg) ${ring ?? 0}%, rgb(192 202 245 / 0.2) 0)`,
            mask: 'radial-gradient(circle, transparent 18px, var(--color-bg) 18.5px)',
          }}
        />
        <i
          className="absolute -right-[3px] -bottom-[3px] grid size-[13px] place-items-center rounded-full bg-blue text-[8px] font-bold text-bg ring-2 ring-bg2"
          style={{
            opacity: done ? 1 : 0,
            transform: done ? 'none' : 'scale(0.6)',
            transition: `opacity 0.2s ease, transform 0.4s ${EASE}`,
          }}
        >
          ✓
        </i>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">{title}</span>
          <span className="w-[34px] text-right text-[11.5px] tabular-nums text-muted">
            {loading ? '' : duration}
          </span>
        </span>
        <span className="mt-px flex min-h-4 items-center gap-1.5">
          {loading ? (
            <span
              className="block h-2 w-28 rounded-full bg-[#292e42]"
              style={{ animation: 'glow 1.4s ease-in-out infinite' }}
            />
          ) : (
            <Swap
              on={!!stage}
              from={<span className="text-muted">{artist}</span>}
              to={<span className={selected === 'primary' ? 'text-fg' : 'text-blue'}>{stage}</span>}
              className="min-w-0 flex-1 text-[11.5px]"
            />
          )}
          <span className="flex w-[46px] justify-end">
            {!loading && <FormatPill format={format} tone={tone} />}
          </span>
        </span>
      </span>
    </div>
  )
}

export function AppField({
  label,
  children,
  flash = false,
  short = false,
}: {
  label: string
  children: ReactNode
  flash?: boolean
  short?: boolean
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[12.5px] text-muted">{label}</p>
      <p
        className={`flex h-[34px] items-center truncate rounded-[7px] border bg-bg2 px-[11px] text-[13.5px] text-fg transition-[border-color,box-shadow] duration-300 ${
          short ? 'w-[72px]' : ''
        } ${flash ? 'border-blue shadow-[0_0_0_3px_rgb(122_162_247_/_0.15)]' : 'border-[#737aa2]/45'}`}
      >
        {children}
      </p>
    </div>
  )
}

export function ConvertButton({
  label,
  progress = null,
  pressed = false,
  off = false,
  buttonRef,
}: {
  label: ReactNode
  progress?: number | null
  pressed?: boolean
  off?: boolean
  buttonRef?: RefObject<HTMLDivElement | null>
}) {
  const busy = progress !== null
  const face = off ? 'bg-[#292e42] text-muted' : busy ? 'bg-blue/40 text-fg' : 'bg-blue text-bg'
  return (
    <div className="flex flex-1">
      <div
        ref={buttonRef}
        className={`relative grid h-10 flex-1 place-items-center overflow-hidden rounded-l-lg text-sm font-medium transition-[background-color,transform] duration-150 ${face}`}
        style={{ transform: pressed ? 'scale(0.985)' : 'none' }}
      >
        <span
          className="absolute inset-y-0 left-0 overflow-hidden bg-blue"
          style={{ width: `${busy ? progress : 0}%`, transition: `width 0.9s ${EASE}` }}
        >
          {busy && (
            <span
              className="absolute inset-0 bg-gradient-to-r from-transparent via-fg/30 to-transparent"
              style={{ animation: 'sheen 1.3s linear infinite' }}
            />
          )}
        </span>
        <span className="relative truncate px-3">{label}</span>
      </div>
      <div
        className={`grid h-10 w-10 place-items-center rounded-r-lg border-l border-fg/20 transition-colors ${face}`}
      >
        <Glyph size={12}>{ICONS.chevron}</Glyph>
      </div>
    </div>
  )
}

export function EditorFooter({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-[66px] items-center border-t border-line bg-bg2 px-[22px]">
      {children}
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap text-fg">
      <Glyph size={13}>{ICONS.chevron}</Glyph>
      {children}
      {aside && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-normal text-muted">
          {aside}
        </span>
      )}
    </p>
  )
}

export type CursorTarget = RefObject<HTMLElement | null> | readonly [number, number]

// A pointer that glides between targets inside the scene, measured from the layout so
// it lands on the control it is about to press at any width.
export function SceneCursor({
  container,
  target,
}: {
  container: RefObject<HTMLElement | null>
  target: CursorTarget | null
}) {
  const [pos, setPos] = useState<[number, number]>([0, 0])
  useLayoutEffect(() => {
    const box = container.current?.getBoundingClientRect()
    if (!box || !target) return
    let next: [number, number] | null = null
    if ('current' in target) {
      const r = target.current?.getBoundingClientRect()
      if (r) next = [r.left - box.left + r.width * 0.6, r.top - box.top + r.height * 0.55]
    } else {
      next = [box.width * target[0], box.height * target[1]]
    }
    if (next) {
      const [x, y] = next
      setPos((prev) => (prev[0] === x && prev[1] === y ? prev : [x, y]))
    }
  }, [container, target])
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="pointer-events-none absolute top-0 left-0 z-20 size-[18px] drop-shadow"
      style={{
        opacity: target ? 1 : 0,
        transform: `translate(${pos[0]}px, ${pos[1]}px)`,
        transition: 'transform 0.8s cubic-bezier(0.645, 0.045, 0.355, 1), opacity 0.3s ease',
      }}
    >
      <path
        d="M4 2l16 10-7 1.5L9.5 21z"
        fill="var(--color-fg)"
        stroke="var(--color-bg2)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// One editor section lifted out of the window, for the steps that live entirely inside
// it: the same panel ground, title row and padding as the section in the app.
export function EditorPanel({
  panelRef,
  title,
  aside,
  children,
}: {
  panelRef?: RefObject<HTMLDivElement | null>
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      ref={panelRef}
      aria-hidden="true"
      className="inset-shadow-edge relative h-full min-w-0 overflow-hidden rounded-xl border border-line bg-bg p-4 text-left shadow-2xl shadow-black/40"
    >
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {children}
    </div>
  )
}

export function Segmented({
  options,
  active,
  refs,
}: {
  options: string[]
  active: number
  refs?: Record<number, RefObject<HTMLSpanElement | null>>
}) {
  return (
    <span className="mt-3 inline-flex max-w-full rounded-[9px] border border-line bg-bg2 p-0.5">
      {options.map((label, i) => (
        <span
          key={label}
          ref={refs?.[i]}
          className={`rounded-[7px] px-2.5 py-1 text-[12.5px] whitespace-nowrap transition-colors duration-200 ${
            i === active
              ? 'bg-[#292e42] text-fg shadow-[inset_0_0_0_1px_rgb(192_202_245_/_0.16)]'
              : 'text-[#a9b1d6]'
          }`}
        >
          {label}
        </span>
      ))}
    </span>
  )
}

export function AppWave({
  values,
  className = 'fill-blue/80',
  amp = 44,
  gap = 0.25,
  scale = 1,
}: {
  values: readonly number[]
  className?: string
  amp?: number
  gap?: number
  scale?: number
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
    >
      <path
        d={barsPath([...values], amp, gap)}
        className={className}
        style={{
          transform: `scaleY(${scale})`,
          transformOrigin: '50% 50%',
          transition: `transform 0.6s ${EASE}`,
        }}
      />
    </svg>
  )
}
