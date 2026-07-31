// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { drawWaveform } from '../lib/waveform'

// TrimSection reads window.api.platform (isMacOS) at module scope; install a stub
// before importing it.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import { TrimSection } from './TrimSection'

// jsdom has no canvas 2D context, so the real drawer bails early anyway; spying on it
// is what lets a test assert WHICH slice of the decoded peaks the lane asked for.
vi.mock('../lib/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/waveform')>()),
  drawWaveform: vi.fn(),
}))

afterEach(cleanup)

// 100 s track with 10 s of surface noise on each side of the music: the detector
// (pad 0.3 s) should suggest cutting ~9.7 s from the start and ~9.7 s from the end.
function noisyEndsWave(): WaveformResult {
  const peaks = Array.from({ length: 200 }, (_, i) => (i >= 20 && i < 180 ? 0.3 : 0.0005))
  return { peaks, rms: peaks, durationSec: 100 }
}

function musicOnlyWave(): WaveformResult {
  const peaks = Array.from({ length: 200 }, () => 0.3)
  return { peaks, rms: peaks, durationSec: 100 }
}

const play = vi.fn()
const pause = vi.fn()
const audios: { onloadedmetadata: (() => void) | null; currentTime: number }[] = []

let client: QueryClient
beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  // jsdom has no audio pipeline; the audition only needs seek/play/pause and the
  // loadedmetadata hook the component waits on before seeking.
  vi.stubGlobal(
    'Audio',
    class {
      onloadedmetadata: (() => void) | null = null
      ontimeupdate: (() => void) | null = null
      onended: (() => void) | null = null
      currentTime = 0
      play = play
      pause = pause
      constructor() {
        audios.push(this)
      }
    },
  )
  client = createQueryClient()
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue(noisyEndsWave()),
    // The magnet's precision pass; null keeps tests on the coarse onsets.
    waveformWindow: vi.fn().mockResolvedValue(null),
  }
})

const bindings = resolveBindings()

function section(over: Partial<React.ComponentProps<typeof TrimSection>> = {}): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <TrimSection
        value={undefined}
        open
        onToggle={() => {}}
        onChange={() => {}}
        inputPath="/in/track.wav"
        bindings={bindings}
        {...over}
      />
    </QueryClientProvider>
  )
}

describe('TrimSection', () => {
  // The decode is gated behind a ~400ms settle, so the query isn't fetching yet for that
  // window. The section must still show its loading skeleton the instant it opens — before
  // this it rendered an empty body during the settle and looked like it hadn't opened.
  it('shows the loading skeleton immediately on open, before the wave decodes', () => {
    // A waveform that never resolves, so the only thing that can be on screen is the
    // pre-decode loading state.
    ;(window as unknown as { api: { waveform: unknown } }).api.waveform = vi
      .fn()
      .mockReturnValue(new Promise(() => {}))
    render(section())
    // The two-lane placeholder: a START and an END wave, mirroring the split layout.
    expect(screen.getByTestId('trim-skeleton')).toBeInTheDocument()
    const start = screen.getByTestId('trim-loading-start')
    const end = screen.getByTestId('trim-loading-end')
    expect(start).toBeInTheDocument()
    expect(end).toBeInTheDocument()
    // Each wave is `absolute inset-0 h-full`, so it MUST sit in a positioned box with a
    // fixed lane height. Rendered bare it resolved h-full against the scroll pane and painted
    // a full-window wave behind the whole app — the reported "giant wave". The h-24 parent
    // pins the height so that can't happen.
    for (const s of [start, end]) {
      expect(s.parentElement?.className).toContain('relative')
      expect(s.parentElement?.className).toContain('h-24')
    }
  })

  // The detection only suggests — nothing is staged until a scissors marker is
  // clicked, and each side stages alone, so "only the end" is one click. The
  // finding itself rides the header as a pill, the app's one convention for
  // analysis results (like the quality section's verdict).
  it('pills the detected silence and stages each side from its scissors marker', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    const start = await screen.findByTestId('trim-apply-start', undefined, { timeout: 3000 })
    expect(screen.getByTestId('trim-detected-pill')).toHaveTextContent(
      '9.9 s from the start · 9.9 s from the end',
    )
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(start)
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.9 })
    fireEvent.click(screen.getByTestId('trim-apply-end'))
    expect(onChange).toHaveBeenCalledWith({ endSec: 90.1 })
    // A suggestion hugging the track edge must keep its button reachable: the
    // center clamps a half-button inside the strip instead of clipping under
    // the edge handle.
    expect(screen.getByTestId('trim-apply-end').style.left).toContain('clamp(')
  })

  it('says there is nothing to cut when the track starts and ends on music', async () => {
    ;(window as unknown as { api: { waveform: unknown } }).api.waveform = vi
      .fn()
      .mockResolvedValue(musicOnlyWave())
    render(section())
    const detected = await screen.findByTestId('trim-detected', undefined, { timeout: 3000 })
    expect(detected).toHaveTextContent('No leading or trailing silence detected.')
    expect(screen.queryByTestId('trim-detected-pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trim-apply-start')).not.toBeInTheDocument()
  })

  // The whole point of the section: it shows the two places a trim ever happens —
  // the head and the tail — already framed on the cut, so nobody has to zoom and
  // scrub a ten-minute track to reach a spot the detector already found.
  it('frames each lane on its own cut instead of showing the whole track', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    // Default context is ±5 s, so the head lane spans 4.7–14.7 s and the tail
    // lane 85.3–95.3 s. The minutes in between are never drawn.
    expect(
      await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 }),
    ).toHaveAttribute('data-window', '4.70-14.70')
    expect(screen.getByTestId('trim-lane-end')).toHaveAttribute('data-window', '85.30-95.30')
    expect(screen.getByTestId('trim-lane-start')).toBeInTheDocument()
    expect(screen.getByTestId('trim-lane-end')).toBeInTheDocument()
  })

  // With no cut staged, the lanes frame what the DETECTOR found — so opening the
  // section already shows the silence it is telling you about.
  it('frames the lanes on the detected silence when nothing is staged yet', async () => {
    render(section())
    // With nothing staged the handle sits on the track's own edge (0 s), so the
    // window slides to hold it — which also keeps the suggestion at 9.9 s, and its
    // scissors, inside the lane where they can actually be clicked.
    expect(
      await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 }),
    ).toHaveAttribute('data-window', '0.00-10.00')
    expect(screen.getByTestId('trim-lane-end')).toHaveAttribute('data-window', '90.00-100.00')
  })

  // El caso que reportó el usuario con una captura: corte en 0,412 s y lupa a
  // ±0,25 s. La ventana se colocaba desde el foco viejo y se topaba con el inicio
  // de la pista (no puede empezar en negativo), así que salía 0,000–0,500 y el
  // corte quedaba al 82% — casi todo el contexto era el silencio de la izquierda y
  // el ataque del golpe quedaba pegado al borde derecho, medio fuera. Cortando así
  // es facilísimo pasarse y comerse el primer bombo. El corte tiene que quedar
  // centrado siempre que la pista dé margen para ello.
  // El lag que el usuario notó paneando: keepPreviousData mantiene en pantalla la
  // onda de la ventana ANTERIOR mientras se decodifica la nueva, y el carril la
  // dibujaba a lo ancho como si fuera la nueva. La línea del corte se movía al
  // instante y la onda se quedaba atrás hasta pegar un salto al llegar los datos.
  // Los datos vienen sellados con el tramo que cubren de verdad (startSec/durSec),
  // así que el dibujado tiene que mapearlos por ese sello — es justo lo que avisa el
  // comentario de useWaveformWindow.
  it('draws stale window data over the stretch it really covers', async () => {
    // Datos de 0–1 s entregados cuando el carril ya mira 0.5–1.5 s: sólo la segunda
    // mitad de esos picos cae en la ventana visible.
    const stale = {
      peaks: Array.from({ length: 100 }, () => 0.5),
      rms: Array.from({ length: 100 }, () => 0.4),
      startSec: 0,
      durSec: 1,
    }
    ;(window as unknown as { api: { waveformWindow: unknown } }).api.waveformWindow = vi
      .fn()
      .mockResolvedValue(stale)
    vi.mocked(drawWaveform).mockClear()
    render(section({ value: { startSec: 1 } }))
    await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 })

    await vi.waitFor(() => {
      const withStale = vi
        .mocked(drawWaveform)
        .mock.calls.filter((c) => (c[1] as number[])?.length === 100)
      expect(withStale.length).toBeGreaterThan(0)
      // Mapeado por el sello: no puede pintarse el array entero como si cubriera la
      // ventana pedida, porque no la cubre.
      const opts = withStale.at(-1)?.[2] as { window?: { from: number; to: number } }
      expect(opts?.window).toBeDefined()
    })
  })

  // Mirar la onda alrededor del corte sin moverlo: dos dedos en horizontal (o la
  // rueda lateral) desplazan la ventana. Se eligió este gesto justo porque el
  // arrastre sobre el carril YA coloca el corte — cualquier cosa que compartiera el
  // botón izquierdo se arriesgaba a mover el corte al intentar mirar.
  // Paneando lejos del corte, el handle se quedaba clavado al borde del carril: una
  // línea pegada al filo que parece decir "el corte está aquí" cuando el corte está
  // fuera de plano. El usuario lo vio al panear a la izquierda — la línea se plantaba
  // en el borde y sólo volvía a moverse cuando el corte reentraba en la ventana.
  // Fuera de plano no se pinta: la ausencia dice la verdad, un borde no.
  it('hides the cut line when the pan leaves the cut off screen', async () => {
    render(section({ value: { startSec: 9.7 } }))
    await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })

    for (let i = 0; i < 10; i++) {
      fireEvent.wheel(screen.getByTestId('trim-overlay-start'), { deltaX: 300, deltaY: 0 })
    }

    const [from] = (screen.getByTestId('trim-lane-start').getAttribute('data-window') ?? '')
      .split('-')
      .map(Number)
    // Sanidad: el paneo llegó de verdad más allá del corte.
    expect(from).toBeGreaterThan(9.7)
    expect(screen.queryByTestId('trim-handle-start')).not.toBeInTheDocument()
  })

  // El mismo comportamiento en el carril de la cola: Lane se instancia dos veces
  // (start y end), así que el arreglo es compartido por construcción — pero eso hay
  // que comprobarlo, no deducirlo. Aquí se panea hacia la izquierda, alejándose del
  // corte de fin, que es el sentido contrario al del carril de cabeza.
  it('hides the end cut line too when the pan leaves it off screen', async () => {
    render(section({ value: { endSec: 90.3 } }))
    await screen.findByTestId('trim-handle-end', undefined, { timeout: 3000 })

    for (let i = 0; i < 10; i++) {
      fireEvent.wheel(screen.getByTestId('trim-overlay-end'), { deltaX: -300, deltaY: 0 })
    }

    const [, to] = (screen.getByTestId('trim-lane-end').getAttribute('data-window') ?? '')
      .split('-')
      .map(Number)
    expect(to).toBeLessThan(90.3)
    expect(screen.queryByTestId('trim-handle-end')).not.toBeInTheDocument()
  })

  it('pans the lane with a horizontal wheel without touching the cut', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7 }, onChange }))
    await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 })
    const before = screen.getByTestId('trim-lane-start').getAttribute('data-window')

    fireEvent.wheel(screen.getByTestId('trim-overlay-start'), { deltaX: 120, deltaY: 0 })

    const after = screen.getByTestId('trim-lane-start').getAttribute('data-window')
    expect(after).not.toBe(before)
    // El corte no se ha tocado: panear es mirar, no editar.
    expect(onChange).not.toHaveBeenCalled()
  })

  // El paneo tiene que AGUANTAR. La ventana se recentra sola sobre el corte cuando
  // éste se sale de plano (contain), así que un paneo que se alejara del corte se
  // desharía solo en el siguiente render — un gesto que parece funcionar y no
  // funciona, que es peor que no tenerlo.
  it('keeps the panned window even when it leaves the cut behind', async () => {
    render(section({ value: { startSec: 9.7 } }))
    await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 })

    // Varios golpes en la misma dirección: lo bastante para sacar el corte de plano.
    for (let i = 0; i < 8; i++) {
      fireEvent.wheel(screen.getByTestId('trim-overlay-start'), { deltaX: 240, deltaY: 0 })
    }

    const [from] = (screen.getByTestId('trim-lane-start').getAttribute('data-window') ?? '')
      .split('-')
      .map(Number)
    expect(from).toBeGreaterThan(9.7)
  })

  // Un scroll vertical es la página desplazándose, no una intención de panear: el
  // panel de recorte vive en un editor con scroll y robarle la rueda vertical haría
  // que la onda se moviera sola mientras el usuario baja por la ficha.
  it('ignores a vertical wheel so the editor can still scroll', async () => {
    render(section({ value: { startSec: 9.7 } }))
    await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 })
    const before = screen.getByTestId('trim-lane-start').getAttribute('data-window')

    // Con algo de deriva lateral, que es como sale un gesto vertical real en un
    // trackpad: manda el eje dominante, no la presencia de deltaX.
    fireEvent.wheel(screen.getByTestId('trim-overlay-start'), { deltaX: 18, deltaY: 200 })

    expect(screen.getByTestId('trim-lane-start').getAttribute('data-window')).toBe(before)
  })

  it('centres a tight lane on the cut instead of pinning it near the edge', async () => {
    // Como lo hace el usuario: la sección se abre SIN corte (el foco queda en 0),
    // él coloca el corte mirando la onda, y sólo entonces amplía para afinar.
    const { rerender } = render(section({ value: undefined }))
    await screen.findByTestId('trim-context-start', undefined, { timeout: 3000 })
    rerender(section({ value: { startSec: 0.412 } }))
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('trim-zoom-in-start'))

    expect(screen.getByTestId('trim-context-start')).toHaveTextContent('±0.25s')
    expect(screen.getByTestId('trim-lane-start')).toHaveAttribute('data-window', '0.16-0.66')
  })

  // El fallo que el usuario documentó con tres capturas: ajusta el corte pegado al
  // ataque a ±0,5 s, amplía, y la onda aparece corrida — la línea queda ANTES del
  // transitorio, con un hueco. Medido en la app: con la ventana 0,14–0,64 la onda se
  // pintaba 41 ms tarde. La causa es que el decodificado se pedía cuantizado a la
  // décima (0,14 → 0,1) pero se dibujaba como si empezara en 0,14, así que el desfase
  // del redondeo se pintaba tal cual. Ajustando contra esa onda mentirosa se acaba
  // cortando dentro del golpe: el bombo que se comía. Lo que se pide tiene que ser lo
  // que se dibuja.
  it('decodes exactly the window it draws, without rounding the start away', async () => {
    const waveformWindow = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { api: { waveformWindow: unknown } }).api.waveformWindow = waveformWindow
    render(section({ value: { startSec: 0.394 } }))
    await screen.findByTestId('trim-context-start', undefined, { timeout: 3000 })
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('trim-zoom-in-start'))

    // data-window se publica con dos decimales para que el test sea legible, así que
    // la comparación va contra la ventana real: corte 0,394 centrado en ±0,25 s.
    const asked = waveformWindow.mock.calls.at(-1)
    expect(asked).toBeDefined()
    expect(screen.getByTestId('trim-context-start')).toHaveTextContent('±0.25s')
    // Sin margen: el inicio pedido es el inicio dibujado, al milisegundo.
    expect(asked?.[1]).toBeCloseTo(0.394 - 0.25, 3)
    expect(asked?.[2]).toBeCloseTo(0.5, 3)
  })

  // Each lane zooms on its own: a dense head and a silent tail want different
  // windows, and one shared control forced a compromise that fit neither.
  it('zooms each lane independently of the other', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    const context = await screen.findByTestId('trim-context-start', undefined, { timeout: 3000 })
    expect(context).toHaveTextContent('±5s')
    expect(screen.getByTestId('trim-context-end')).toHaveTextContent('±5s')
    // Narrowing the head lane leaves the tail lane exactly where it was.
    fireEvent.click(screen.getByTestId('trim-zoom-in-start'))
    fireEvent.click(screen.getByTestId('trim-zoom-in-start'))
    expect(screen.getByTestId('trim-context-start')).toHaveTextContent('±1s')
    expect(screen.getByTestId('trim-lane-start')).toHaveAttribute('data-window', '8.70-10.70')
    expect(screen.getByTestId('trim-context-end')).toHaveTextContent('±5s')
    expect(screen.getByTestId('trim-lane-end')).toHaveAttribute('data-window', '85.30-95.30')
  })

  // The tightest windows are where a cut is actually judged, and a DJ's trim is
  // usually a hair either side of the first beat: at ±0.05 s the lane spans a tenth
  // of a second, so its 1200 px put a pixel well under the millisecond the cut is
  // stored in. The zoom bottoms out there — one more click must do nothing.
  it('narrows a lane down to fifty milliseconds of context', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    await screen.findByTestId('trim-context-start', undefined, { timeout: 3000 })
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('trim-zoom-in-start'))
    expect(screen.getByTestId('trim-context-start')).toHaveTextContent('±0.05s')
    expect(screen.getByTestId('trim-lane-start')).toHaveAttribute('data-window', '9.65-9.75')
    expect(screen.getByTestId('trim-zoom-in-start')).toBeDisabled()
  })

  // The lane is a FRAME, not a follower: committing a cut must not re-window the
  // lane, because re-windowing re-decodes — the wave jumped and stalled the moment
  // the handle was released. The cut moves inside the window; the window holds.
  it('holds the lane window still when the cut moves', async () => {
    const onChange = vi.fn()
    const { rerender } = render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    expect(
      await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 }),
    ).toHaveAttribute('data-window', '4.70-14.70')
    // The app feeds a moved cut back in as `value` — the window must not follow it.
    rerender(section({ value: { startSec: 6.2, endSec: 90.3 }, onChange }))
    expect(screen.getByTestId('trim-lane-start')).toHaveAttribute('data-window', '4.70-14.70')
    expect(screen.getByTestId('trim-cut-time-start')).toHaveValue('6.200')
    // Zooming IS a request for a new view, so it re-frames on where the cut now is.
    fireEvent.click(screen.getByTestId('trim-zoom-in-start'))
    expect(screen.getByTestId('trim-lane-start')).toHaveAttribute('data-window', '4.20-8.20')
  })

  // The frame must never lose what it frames: nudging a cut far enough (or zooming
  // around an older focus) pushed the handle clean out of view — the lane showed
  // 399.6–401.6 s while the cut sat at 408.3 s, pinned uselessly against the edge,
  // and the scissors went with it. The window slides to hold the cut, with a margin.
  it('slides the window to keep a moved cut inside the lane', async () => {
    const onChange = vi.fn()
    const { rerender } = render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    expect(
      await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 }),
    ).toHaveAttribute('data-window', '4.70-14.70')
    // A cut dragged well past the window's right edge: the lane must follow it.
    rerender(section({ value: { startSec: 20, endSec: 90.3 }, onChange }))
    const lane = screen.getByTestId('trim-lane-start')
    const [from, to] = (lane.getAttribute('data-window') as string).split('-').map(Number)
    expect(20).toBeGreaterThan(from)
    expect(20).toBeLessThan(to)
    // And it keeps the full context span, sliding rather than stretching.
    expect(to - from).toBeCloseTo(10, 5)
  })

  // Dragging must not rebuild the wave. The window follows the COMMITTED cut, never
  // the live draft — fed the draft, the lane re-framed on every pointermove, and a
  // re-framed window is a re-decoded one, so the wave flickered and stalled under
  // the finger.
  it('never re-frames the lane while a handle is being dragged', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const lane = await screen.findByTestId('trim-lane-start', undefined, { timeout: 3000 })
    const before = lane.getAttribute('data-window')
    const handle = screen.getByTestId('trim-handle-start')
    const overlay = screen.getByTestId('trim-overlay-start')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    for (const x of [400, 300, 200, 100]) {
      fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: x }))
      // The window has not moved a hair, so no window decode was ever requested.
      expect(screen.getByTestId('trim-lane-start')).toHaveAttribute('data-window', before)
    }
    fireEvent(handle, new MouseEvent('pointerup', { bubbles: true }))
  })

  // The end cut naturally sits hard against the right edge of its lane — that IS
  // where the music stops. So "near the edge" can never be the trigger for moving
  // the window, or every commit would slide (and re-decode) the wave: the exact
  // "the wave keeps changing when I move the trim line" the user reported.
  it('leaves the window alone when a committed cut moves inside it', async () => {
    const onChange = vi.fn()
    const { rerender } = render(section({ value: { endSec: 90.3 }, onChange }))
    const lane = await screen.findByTestId('trim-lane-end', undefined, { timeout: 3000 })
    const before = lane.getAttribute('data-window')
    // Several commits, each moving the cut but keeping it inside the frame.
    for (const endSec of [90.0, 89.4, 88.2, 86.5]) {
      rerender(section({ value: { endSec }, onChange }))
      expect(screen.getByTestId('trim-lane-end')).toHaveAttribute('data-window', before)
    }
  })

  // A staged trim reads off the strip: shaded discard regions, the cuts readout,
  // and the reset that clears the whole range in one click.
  it('shades the staged cuts and clears them from the reset button', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    expect(
      await screen.findByTestId('trim-shade-start', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('trim-shade-end')).toBeInTheDocument()
    expect(screen.getByTestId('trim-cuts')).toHaveTextContent('9.7 s from the start')
    expect(screen.getByTestId('trim-cuts')).toHaveTextContent('9.7 s from the end')
    // Reset belongs to a lane: clearing the head must leave the tail cut alone —
    // one button for "the trim" used to throw away work at the other end of the
    // track that the user had just dialled in by hand.
    fireEvent.click(screen.getByTestId('trim-clear-start'))
    expect(onChange).toHaveBeenCalledWith({ endSec: 90.3 })
  })

  // Clearing the last remaining cut leaves the track with no trim at all.
  it('drops the trim entirely when the last cut is cleared', async () => {
    const onChange = vi.fn()
    render(section({ value: { endSec: 90.3 }, onChange }))
    fireEvent.click(await screen.findByTestId('trim-clear-end', undefined, { timeout: 3000 }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // Dragging commits once on release (not per pixel), with the seconds read from
  // the handle's position across ITS LANE — the start lane is a window around the
  // cut (9.7 s ± the 5 s context), so 1000 px spans 4.7–14.7 s: 100 px is a second.
  it('commits a handle drag on release', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = screen.getByTestId('trim-overlay-start')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    // jsdom has no PointerEvent, and the plain-Event fallback drops clientX; a
    // MouseEvent with the pointer type carries the coordinate React reads.
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    // 330 px into a 4.7–14.7 s window is 8.0 s.
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: 330 }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 8, endSec: 90.3 })
  })

  // The trackpad-haptics stand-in: dragging near where the music actually starts
  // pulls the handle onto it (the onset, not the padded suggestion) and the handle
  // glows while caught — landing the cut "at the wave" without pixel-hunting.
  it('snaps a dragged handle onto the music onset and glows', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = screen.getByTestId('trim-overlay-start')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    // 528 px is 9.98 s — inside the magnet's catch of the onset at 10.0 s.
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: 528 }))
    expect(screen.getByTestId('trim-snapped-start')).toBeInTheDocument()
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 10, endSec: 90.3 })
  })

  // Placing a cut is one gesture: pressing anywhere in a lane drops THAT lane's
  // handle under the pointer, and releasing commits — no drag needed. Each lane
  // owns one bound, so a press can never move the wrong one.
  it("places a lane's cut where the wave is pressed", async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const overlay = await screen.findByTestId('trim-overlay-start', undefined, { timeout: 3000 })
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    // 130 px into the 4.7–14.7 s window is 6.0 s.
    fireEvent(overlay, new MouseEvent('pointerdown', { bubbles: true, clientX: 130 }))
    fireEvent(overlay, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 6, endSec: 90.3 })
  })

  // Parking the start handle back on the left edge means "cut nothing here": the
  // bound drops rather than persisting a hair's-width trim.
  // El recorte de un DJ suele ser un pelo antes del primer golpe, así que la escala
  // baja hasta ±0,05 s. Ese nivel sólo sirve si un corte de esa magnitud se GUARDA:
  // el umbral que descarta un bound ("lo he devuelto a su borde, aquí no corto")
  // medía 0,05 s en tiempo absoluto, justo el carril entero del zoom más fino, así
  // que cualquier corte colocado ahí se tiraba y la pista arrancaba desde cero.
  it('keeps a cut of a few milliseconds at the head of the track', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 0.02 }, onChange }))
    await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    // Zoomed all the way in, which is where a cut this small is placed: the lane
    // spans 0.1 s, so 20 ms is a fifth of the way across it — plainly a deliberate
    // position, not a handle parked back on the track's edge.
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('trim-zoom-in-start'))

    fireEvent.click(screen.getByTestId('trim-nudge-forward-start'))

    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last).toBeDefined()
    expect(last?.startSec).toBeGreaterThan(0)
  })

  it('drops a bound dragged back to its own edge', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = screen.getByTestId('trim-overlay-start')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    // The lane's left edge is 4.7 s, so dragging past it clamps to the track's
    // own start — a bound that cuts nothing, which must drop entirely.
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: -600 }))
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // The by-ear check: the start audition must open exactly at the cut-in — what
  // the converted file will start with — and a second click stops it.
  it('auditions the track from the cut-in and stops on a second click', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    const btn = await screen.findByTestId('trim-audition-start', undefined, { timeout: 3000 })
    fireEvent.click(btn)
    const audio = audios.at(-1)
    expect(audio).toBeDefined()
    act(() => audio?.onloadedmetadata?.())
    expect(audio?.currentTime).toBe(9.7)
    expect(play).toHaveBeenCalledOnce()
    fireEvent.click(btn)
    expect(pause).toHaveBeenCalledOnce()
  })

  // The arrows give the precision a drag on the coarse strip can't: tenths of a
  // second, a whole second with Shift.
  it('nudges the focused handle with the arrow keys', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    // A bare arrow is the fine step (10 ms) — a cut is judged in milliseconds, and
    // the old tenth was too blunt to place one. Shift takes the coarse tenth.
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.701, endSec: 90.3 })
    fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.6, endSec: 90.3 })
  })

  // The cut's time is a FIELD: type the second you want. It replaced a ‹ time ›
  // stepper whose three controls duplicated the handle and the arrow keys, in a lane
  // that had no room for them — and typing is the only way to land an exact value in
  // one go.
  it('shows the cut time and takes a typed second', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-cut-time-start', undefined, { timeout: 3000 })
    expect(start).toHaveValue('9.700')
    expect(screen.getByTestId('trim-cut-time-end')).toHaveValue('90.300')
    // A half-typed value must not commit mid-keystroke; Enter (or blur) does.
    fireEvent.change(start, { target: { value: '12.345' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(start, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ startSec: 12.345, endSec: 90.3 })
  })

  // The arrows still give the fine step, now from the field where the value is.
  // Left/right AND up/down both nudge: the cut moves along a horizontal wave, so the
  // horizontal arrows are the intuitive ones, but a field's arrows are up/down by
  // habit — so both do the same thing rather than making the user guess.
  it('nudges the cut with the arrows from the time field', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-cut-time-start', undefined, { timeout: 3000 })
    fireEvent.keyDown(start, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 9.701, endSec: 90.3 })
    fireEvent.keyDown(start, { key: 'ArrowDown', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 9.6, endSec: 90.3 })
    onChange.mockClear()
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 9.701, endSec: 90.3 })
    fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 9.6, endSec: 90.3 })
  })

  // The nudge is also two buttons flanking the time, for the mouse-only user who
  // never learns the arrows: back moves the cut earlier, forward moves it later, by
  // the same fine step (10 ms) the arrows use.
  it('nudges the cut with the visible back/forward buttons', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const back = await screen.findByTestId('trim-nudge-back-start', undefined, { timeout: 3000 })
    const forward = screen.getByTestId('trim-nudge-forward-start')
    fireEvent.click(forward)
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.701, endSec: 90.3 })
    fireEvent.click(back)
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 9.699, endSec: 90.3 })
  })

  // Folded with a staged trim, the header badges the total cut, like the
  // click-repair badge; without one the summary states "Off" instead.
  it('badges the total cut only while folded and active', async () => {
    const { rerender } = render(section({ value: { startSec: 9.7, endSec: 90.3 }, open: false }))
    expect(screen.getByTestId('trim-active-badge')).toBeInTheDocument()
    rerender(section({ value: undefined, open: false }))
    expect(screen.queryByTestId('trim-active-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('trim-summary')).toHaveTextContent('Off')
  })

  // The five trim commands, bound to the FOCUSED handle: a macropad key must act on
  // whichever side the user is looking at, never both.
  describe('keyboard shortcuts on the focused handle', () => {
    it('nudges the focused handle, fine on a bare key and coarse with Shift', async () => {
      const onChange = vi.fn()
      render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
      const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
      fireEvent.keyDown(start, { key: 'ArrowRight' })
      expect(onChange).toHaveBeenCalledWith({ startSec: 9.701, endSec: 90.3 })
      fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true })
      expect(onChange).toHaveBeenCalledWith({ startSec: 9.6, endSec: 90.3 })
    })

    it('audiciona el lado cuyo handle tiene el foco', async () => {
      render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
      const end = await screen.findByTestId('trim-handle-end', undefined, { timeout: 3000 })
      end.focus()
      fireEvent.keyDown(end, { key: 'a' })
      const audio = audios.at(-1)
      expect(audio).toBeDefined()
      act(() => audio?.onloadedmetadata?.())
      expect(audio?.currentTime).toBe(Math.max(0, 90.3 - 4))
    })

    it('limpia el lado cuyo handle tiene el foco', async () => {
      const onChange = vi.fn()
      render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
      const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
      start.focus()
      fireEvent.keyDown(start, { key: 'c' })
      expect(onChange).toHaveBeenCalledWith({ endSec: 90.3 })
    })

    it('aplica la sugerencia del lado cuyo handle tiene el foco', async () => {
      const onChange = vi.fn()
      render(section({ onChange }))
      const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
      start.focus()
      fireEvent.keyDown(start, { key: 's' })
      expect(onChange).toHaveBeenCalledWith({ startSec: 9.9 })
    })

    it('no dispara las teclas del trim con el foco fuera del editor', () => {
      const onChange = vi.fn()
      render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()
      fireEvent.keyDown(outside, { key: 'a' })
      expect(onChange).not.toHaveBeenCalled()
      expect(audios).toHaveLength(0)
      outside.remove()
    })

    // A macro keyboard can be rebound to send a shift chord. The direct match must
    // win over the Shift-as-step-size fallback, or a saved rebind would silently do
    // nothing — the worst failure mode for a feature that exists so this can be
    // remapped to whatever the hardware sends.
    it('dispara un comando del trim rebindeado a un chord con shift', async () => {
      const rebound = resolveBindings({ 'trim-audition': ['shift', 'a'] })
      render(section({ value: { startSec: 9.7, endSec: 90.3 }, bindings: rebound }))
      const end = await screen.findByTestId('trim-handle-end', undefined, { timeout: 3000 })
      end.focus()
      fireEvent.keyDown(end, { key: 'a', shiftKey: true })
      const audio = audios.at(-1)
      expect(audio).toBeDefined()
      act(() => audio?.onloadedmetadata?.())
      expect(audio?.currentTime).toBe(Math.max(0, 90.3 - 4))
    })
  })
})
