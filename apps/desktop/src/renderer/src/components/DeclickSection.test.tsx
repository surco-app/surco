// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { runKeyClaim } from '../lib/spaceClaim'
import { DeclickSection } from './DeclickSection'
import { AFTER_COLOR } from './WaveformCompare'

afterEach(cleanup)

const play = vi.fn()
const pause = vi.fn()
// Every <audio> the A/B builds, so the tests can assert on the PAIR — the whole point
// of the feature is that two elements run in lockstep and only the volume switches.
let elements: FakeAudio[] = []

class FakeAudio {
  src: string
  volume = 1
  currentTime = 0
  // The drift-correcting frame loop skips a paused pair, so the sync tests have to say
  // the audio is actually rolling.
  paused = true
  onloadedmetadata: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  onended: (() => void) | null = null
  play = play
  pause = pause
  constructor(src: string) {
    this.src = src
    elements.push(this)
  }
}

// jsdom does no layout, so every element measures 0 wide and a scrub ratio would divide
// by zero. Give the wave a width so the pointer maths has real geometry to work with.
function stubWidth(el: HTMLElement, width = 1000): void {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      width,
      right: width,
      top: 0,
      bottom: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

// jsdom's synthetic pointer events drop clientX unless the event is built as a mouse
// event, and a scrub with no clientX is a scrub to NaN.
function pointerAt(el: HTMLElement, type: 'pointerDown' | 'pointerMove', clientX: number): void {
  const e = new MouseEvent(type === 'pointerDown' ? 'pointerdown' : 'pointermove', {
    clientX,
    bubbles: true,
  })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

// One turn of the requestAnimationFrame loop that pins the silent leg to the audible one.
const tick = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

// What a browser does once both elements know their duration: it unlocks Play (a seek is
// illegal before metadata lands) and applies the cursor the user had already aimed.
const loadPair = (): void => {
  for (const el of elements) el.onloadedmetadata?.()
}

let client: QueryClient
beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  elements = []
  client = createQueryClient()
  vi.stubGlobal('Audio', FakeAudio)
  ;(window as unknown as { api: unknown }).api = {
    declickPreview: vi.fn().mockResolvedValue({ path: '/tmp/repaired.wav' }),
    onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
    cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
    clicks: vi.fn().mockResolvedValue({ count: 23, marks: [10, 20, 30], scannedSec: 240 }),
    waveform: vi.fn().mockResolvedValue({ peaks: [0.5, 0.5], durationSec: 240 }),
    waveformWindow: vi.fn().mockResolvedValue(null),
    loudness: vi.fn().mockResolvedValue(null),
  }
})

function section(
  over: Partial<React.ComponentProps<typeof DeclickSection>> = {},
): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <DeclickSection
        value="off"
        open
        onToggle={() => {}}
        onChange={() => {}}
        inputPath="/in/track.wav"
        isMulti={false}
        format="wav"
        {...over}
      />
    </QueryClientProvider>
  )
}

// Renders the preview and waits for both the A/B pair and the click probe to land —
// the marks and the click-walking depend on the latter.
async function withPreview(
  over: Partial<React.ComponentProps<typeof DeclickSection>> = {},
): Promise<void> {
  render(section({ value: 'standard', ...over }))
  await screen.findByTestId('declick-estimate-pill')
  await act(async () => {
    fireEvent.click(await screen.findByTestId('declick-render'))
  })
  await screen.findByTestId('declick-ab')
}

describe('DeclickSection', () => {
  it('badges the active mode only while folded', () => {
    const { rerender } = render(section({ value: 'standard', open: false }))
    expect(screen.getByTestId('declick-active-badge')).toBeInTheDocument()
    rerender(section({ value: 'standard', open: true }))
    expect(screen.queryByTestId('declick-active-badge')).not.toBeInTheDocument()
  })

  it('shows no badge while folded and off', () => {
    render(section({ value: 'off', open: false }))
    expect(screen.queryByTestId('declick-active-badge')).not.toBeInTheDocument()
  })

  it('pills the click estimate on the header once measured', async () => {
    render(section({ open: true }))
    const pill = await screen.findByTestId('declick-estimate-pill', undefined, { timeout: 3000 })
    expect(pill).toHaveTextContent('~23 clicks')
  })

  it('summarizes the off state in the header while folded', () => {
    const { rerender } = render(section({ value: 'off', open: false }))
    expect(screen.getByTestId('declick-summary')).toHaveTextContent('Off')
    rerender(section({ value: 'off', open: true }))
    expect(screen.queryByTestId('declick-summary')).not.toBeInTheDocument()
    rerender(section({ value: 'standard', open: false }))
    expect(screen.queryByTestId('declick-summary')).not.toBeInTheDocument()
  })

  it('warns about dropped cues only when the format actually drops them', () => {
    const { rerender } = render(section({ value: 'off', format: 'wav' }))
    expect(screen.queryByTestId('declick-cue-warning')).not.toBeInTheDocument()
    rerender(section({ value: 'strong', format: 'wav' }))
    expect(screen.getByTestId('declick-cue-warning')).toBeInTheDocument()
    rerender(section({ value: 'strong', format: 'aiff' }))
    expect(screen.queryByTestId('declick-cue-warning')).not.toBeInTheDocument()
  })

  it('reports mode picks up through onChange', () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    fireEvent.click(screen.getByTestId('declick-mode-strong'))
    expect(onChange).toHaveBeenCalledWith('strong')
  })

  it('never counts for a multi-selection — the anchor track would misrepresent it', () => {
    render(section({ isMulti: true }))
    expect(screen.queryByTestId('declick-estimate-pill')).not.toBeInTheDocument()
  })

  it('states a clean track outright instead of showing a bare zero', async () => {
    ;(window.api.clicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
      marks: [],
      scannedSec: 240,
    })
    render(section())
    expect(await screen.findByTestId('declick-estimate-pill')).toHaveTextContent('No clicks')
  })

  // Shipped red: the wave's colour becomes a canvas fillStyle, and a canvas silently
  // IGNORES `var(--color-accent)` — it keeps whatever fillStyle was set last, which was
  // the clip red, so a perfectly clean track painted as though every sample clipped.
  // CSS variables are invisible to canvas: the colour must always be a literal.
  // (jsdom has no canvas, so this asserts the property rather than the pixels.)
  it('hands the wave a literal colour, never a CSS variable canvas cannot read', () => {
    expect(AFTER_COLOR).not.toContain('var(')
    expect(AFTER_COLOR).toMatch(/^(#|rgb|hsl)/)
  })

  // The marks are the point of the wave: they say WHERE the damage is, which a count
  // alone never can.
  it('marks each detected click on the wave', async () => {
    render(section({ value: 'standard' }))
    await waitFor(() => expect(screen.getAllByTestId('declick-mark')).toHaveLength(3))
  })

  it('draws no marks for a multi-selection', async () => {
    render(section({ value: 'standard', isMulti: true }))
    await waitFor(() => expect(screen.queryByTestId('declick-marks')).not.toBeInTheDocument())
  })

  // Past the detector's scan limit nothing was analysed. A wave that simply stops marking
  // there would read as a clean tail — the worst kind of wrong, because it looks like an
  // answer.
  it('says where the analysis stopped instead of implying a clean tail', async () => {
    ;(window.api.clicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 5,
      marks: [1],
      scannedSec: 480,
    })
    ;(window.api.waveform as ReturnType<typeof vi.fn>).mockResolvedValue({
      peaks: [0.5],
      durationSec: 900,
    })
    render(section({ value: 'standard' }))
    expect(await screen.findByTestId('declick-unscanned')).toHaveTextContent('first 8 minutes')
  })

  it('renders the preview only for an active mode on a single track', async () => {
    const { rerender } = render(section({ value: 'off' }))
    expect(screen.queryByTestId('declick-render')).not.toBeInTheDocument()
    rerender(section({ value: 'standard' }))
    expect(await screen.findByTestId('declick-render')).toBeInTheDocument()
    rerender(section({ value: 'standard', isMulti: true }))
    expect(screen.queryByTestId('declick-render')).not.toBeInTheDocument()
  })

  it('renders the repaired track for the picked mode', async () => {
    await withPreview({ value: 'strong' })
    expect(window.api.declickPreview).toHaveBeenCalledWith('/in/track.wav', 'strong')
  })

  // The A/B is the whole feature: BOTH legs must exist, so switching between them is a
  // volume change rather than a stop-and-restart. A gap in the audio is what makes a
  // subtle difference — a dulled transient — impossible to hear.
  it('loads the original and the repaired render as one synchronized pair', async () => {
    await withPreview()
    expect(elements).toHaveLength(2)
    expect(elements[0].src).toContain(encodeURIComponent('/in/track.wav'))
    expect(elements[1].src).toContain(encodeURIComponent('/tmp/repaired.wav'))
  })

  it('switches sides by muting, never by stopping the audio', async () => {
    await withPreview()
    const [original, repaired] = elements
    // Starts on the repaired leg — what the user asked to hear.
    expect(screen.getByTestId('declick-ab-state')).toHaveTextContent('repaired')
    expect(repaired.volume).toBe(1)
    expect(original.volume).toBe(0)

    fireEvent.click(screen.getByTestId('declick-ab'))

    expect(screen.getByTestId('declick-ab-state')).toHaveTextContent('original')
    expect(original.volume).toBe(1)
    expect(repaired.volume).toBe(0)
    // The proof it is a real A/B and not two players: nothing was paused to switch.
    expect(pause).not.toHaveBeenCalled()
  })

  // Without this the only reachable points in the track are the click marks: a user who
  // wants to hear how a particular passage came out has no way to get there.
  it('moves the playhead to wherever the wave is clicked', async () => {
    await withPreview()
    const overlay = screen.getByTestId('declick-marks')
    stubWidth(overlay)
    // A quarter of the way across a 240 s track.
    pointerAt(overlay, 'pointerDown', 250)
    expect(elements[1].currentTime).toBe(60)
    expect(elements[0].currentTime).toBe(60)
  })

  // The bug as reported: the section open, nothing rendered yet, Space pressed — and the
  // mini-player started playing the whole track. Claiming the key only once a preview
  // existed was the mistake. The user is looking at THIS wave; Space means "play what I am
  // looking at", so the first press renders it and plays it.
  it('renders the preview when Space is pressed before anything exists', async () => {
    render(section({ value: 'standard' }))
    await screen.findByTestId('declick-render')
    // Claimed even with no preview — otherwise the press falls through to the mini-player.
    await act(async () => {
      expect(runKeyClaim('play')).toBe(true)
    })
    expect(window.api.declickPreview).toHaveBeenCalledWith('/in/track.wav', 'standard')
    await screen.findByTestId('declick-ab')
  })

  // A render is tens of seconds; an impatient second press must not queue a second one.
  it('does not start a second render while one is already running', async () => {
    ;(window.api.declickPreview as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
    render(section({ value: 'standard' }))
    await screen.findByTestId('declick-render')
    await act(async () => {
      runKeyClaim('play')
    })
    await act(async () => {
      runKeyClaim('play')
    })
    expect(window.api.declickPreview).toHaveBeenCalledTimes(1)
  })

  // Off means the repair does nothing, so there is no result to hear: the key belongs to
  // the mini-player again, exactly as it would with the section closed.
  it('leaves Space to the mini-player when the repair is off', () => {
    render(section({ value: 'off' }))
    expect(runKeyClaim('play')).toBe(false)
  })

  // Space is play/pause everywhere in Surco, so it must work here too — but the SAME
  // press would otherwise also start the mini-player, and the user would end up with the
  // whole track blaring underneath the A/B they are trying to judge. The section claims
  // the key while it is open (see spaceClaim), exactly as the beatgrid does.
  it('claims Space for its own transport while it is open', async () => {
    await withPreview()
    act(() => loadPair())
    expect(runKeyClaim('play')).toBe(true)
    expect(play).toHaveBeenCalled()
  })

  it('pauses on a second Space rather than restarting', async () => {
    await withPreview()
    act(() => loadPair())
    // play() resolves a promise before `playing` flips, so the state has to settle before
    // the second press — otherwise the test would press Space at a component that still
    // believes it is stopped.
    await act(async () => {
      runKeyClaim('play')
    })
    play.mockClear()
    await act(async () => {
      runKeyClaim('play')
    })
    expect(pause).toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })

  // If the claim outlived the section, Space would be dead for the mini-player forever
  // after — the key must go back the moment the section folds away.
  it('gives Space back when it closes', async () => {
    await withPreview()
    expect(runKeyClaim('play')).toBe(true)
    cleanup()
    expect(runKeyClaim('play')).toBe(false)
  })

  it('never claims Space while folded — the mini-player still owns it', () => {
    render(section({ value: 'standard', open: false }))
    expect(runKeyClaim('play')).toBe(false)
  })

  // Placing the cursor is not the same gesture as auditioning: a click on the wave says
  // "start from here", and blasting audio at someone who was only aiming would be the
  // kind of surprise that makes people stop touching the wave at all.
  it('does not start playing just because the wave was clicked', async () => {
    await withPreview()
    const overlay = screen.getByTestId('declick-marks')
    stubWidth(overlay)
    pointerAt(overlay, 'pointerDown', 500)
    expect(play).not.toHaveBeenCalled()
    // ...and Play then starts from where the cursor was put, not from the top.
    act(() => loadPair())
    fireEvent.click(screen.getByTestId('declick-play'))
    expect(play).toHaveBeenCalled()
    expect(elements[1].currentTime).toBe(120)
  })

  it('scrubs while the pointer is dragged across the wave', async () => {
    await withPreview()
    const overlay = screen.getByTestId('declick-marks')
    stubWidth(overlay)
    overlay.setPointerCapture = vi.fn()
    overlay.hasPointerCapture = () => true
    pointerAt(overlay, 'pointerDown', 100)
    expect(elements[1].currentTime).toBe(24)
    pointerAt(overlay, 'pointerMove', 750)
    expect(elements[1].currentTime).toBe(180)
  })

  it('clamps a scrub that runs off either end of the wave', async () => {
    await withPreview()
    const overlay = screen.getByTestId('declick-marks')
    stubWidth(overlay)
    pointerAt(overlay, 'pointerDown', -40)
    expect(elements[1].currentTime).toBe(0)
    pointerAt(overlay, 'pointerDown', 1400)
    expect(elements[1].currentTime).toBe(240)
  })

  // Caught in the real app, not here: the two elements buffer and schedule independently,
  // so play() on both does NOT start them together — measured ~450 ms apart. A drifted
  // A/B compares two different moments of the song while still *sounding* like a
  // comparison, which is the one failure this feature cannot afford.
  it('re-aligns the silent leg when it drifts out of sync with the audible one', async () => {
    await withPreview()
    fireEvent.click(screen.getByTestId('declick-play'))
    const [original, repaired] = elements
    repaired.paused = false
    repaired.currentTime = 12
    original.currentTime = 11.55
    await act(async () => {
      await tick()
    })
    expect(original.currentTime).toBeCloseTo(12, 2)
  })

  it('leaves a leg that is merely a few milliseconds off alone, rather than stuttering it', async () => {
    // Correcting on every frame regardless would re-seek the audio it keeps smooth.
    await withPreview()
    fireEvent.click(screen.getByTestId('declick-play'))
    const [original, repaired] = elements
    repaired.paused = false
    repaired.currentTime = 12
    original.currentTime = 11.995
    await act(async () => {
      await tick()
    })
    expect(original.currentTime).toBe(11.995)
  })

  // Clicks last milliseconds — dragging a playhead onto one is hopeless, so a mark you
  // cannot jump to is decoration.
  it('seeks BOTH legs to the same instant when a mark is clicked', async () => {
    await withPreview()
    fireEvent.click(screen.getAllByTestId('declick-mark')[1])
    const [original, repaired] = elements
    expect(repaired.currentTime).toBe(20)
    expect(original.currentTime).toBe(20)
  })

  it('walks to the next click from wherever the playhead is', async () => {
    await withPreview()
    fireEvent.click(screen.getByTestId('declick-skip'))
    expect(elements[1].currentTime).toBe(10)
    fireEvent.click(screen.getByTestId('declick-skip'))
    expect(elements[1].currentTime).toBe(20)
  })

  it('offers no click-walking on a clean track', async () => {
    ;(window.api.clicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
      marks: [],
      scannedSec: 240,
    })
    await withPreview()
    expect(screen.queryByTestId('declick-skip')).not.toBeInTheDocument()
  })

  // A render is tens of seconds. Without a way out, a user who picked the wrong preset
  // is stuck watching audio they no longer want.
  it('can abandon a running render', async () => {
    ;(window.api.declickPreview as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
    render(section({ value: 'standard' }))
    await act(async () => {
      fireEvent.click(await screen.findByTestId('declick-render'))
    })
    expect(screen.getByTestId('declick-rendering')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('declick-cancel'))
    expect(window.api.cancelDeclickPreview).toHaveBeenCalled()
    expect(screen.queryByTestId('declick-rendering')).not.toBeInTheDocument()
  })

  // A preset change invalidates the audio: playing on would tell the user that Gentle
  // sounds exactly like Strong, which is the one lie this feature cannot afford.
  it('drops the rendered preview when the preset changes', async () => {
    const { rerender } = render(section({ value: 'standard' }))
    await act(async () => {
      fireEvent.click(await screen.findByTestId('declick-render'))
    })
    expect(await screen.findByTestId('declick-ab')).toBeInTheDocument()
    rerender(section({ value: 'strong' }))
    await waitFor(() => expect(screen.queryByTestId('declick-ab')).not.toBeInTheDocument())
    expect(window.api.cancelDeclickPreview).toHaveBeenCalled()
    expect(screen.getByTestId('declick-render')).toBeInTheDocument()
  })

  it('surfaces a failed render instead of staying silent', async () => {
    ;(window.api.declickPreview as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(section({ value: 'standard' }))
    await act(async () => {
      fireEvent.click(await screen.findByTestId('declick-render'))
    })
    expect(screen.getByTestId('declick-failed')).toBeInTheDocument()
  })
})
