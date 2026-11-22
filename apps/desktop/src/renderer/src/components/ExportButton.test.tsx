// @vitest-environment jsdom
import { hoverTooltip } from '../test/tooltip'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ExportButton } from './ExportButton'

afterEach(cleanup)

const baseProps = {
  status: 'idle' as const,
  stale: false,
  done: false,
  outputFormat: 'aiff' as const,
  exportedFormat: null,
  inPlace: false,
  destination: 'folder' as const,
  destinations: ['folder', 'appleMusic', 'beside'] as const,
  onProcess: () => {},
  onSelectFormat: () => {},
  onSelectDestination: () => {},
}

// jsdom's synthetic PointerEvent drops clientX/clientY, so drive the listener with a
// real MouseEvent (which carries them) dispatched as a pointermove.
const hover = (el: HTMLElement): void => {
  // Enter then move, as a real pointer does: the Tooltip binds its cursor tracking lazily
  // on pointerenter, so a bare pointermove now lands on nothing.
  for (const type of ['pointerenter', 'pointermove']) {
    el.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
  }
}

describe('ExportButton', () => {
  // In a 262 px editor the words pushed the format menu's button off the panel, so the
  // tick alone stays in sight and the words are still read out.
  it('shows only the tick of an up-to-date track when the editor is narrow, so the buttons beside it stay on the panel', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        inPlace
        tagsOnly
        sameFormat
        upToDate
        narrow
        onProcess={vi.fn()}
      />,
    )
    expect(screen.getByText('No changes').className).toContain('sr-only')
    expect(screen.getByTestId('convert-update-anyway')).toBeInTheDocument()
  })

  it('spells out that a track is up to date when there is room', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        inPlace
        tagsOnly
        sameFormat
        upToDate
        onProcess={vi.fn()}
      />,
    )
    expect(screen.getByText('No changes').className).not.toContain('sr-only')
  })

  it('goes quiet when there is nothing to write', () => {
    const onProcess = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        inPlace
        tagsOnly
        sameFormat
        upToDate
        onProcess={onProcess}
      />,
    )
    expect(screen.getByTestId('convert-up-to-date')).toHaveTextContent('No changes')
    expect(screen.queryByTestId('process-btn')).toBeNull()
    fireEvent.click(screen.getByTestId('convert-update-anyway'))
    expect(onProcess).toHaveBeenCalledWith('aiff')
  })

  // The branch rule: the up-to-date row's dropdown reads like the split button's, the chosen
  // format beside the chevron, sized by the same stacked names.
  it('shows the chosen format on the up-to-date row dropdown, as on the split button', () => {
    render(<ExportButton {...baseProps} incomplete={false} inPlace tagsOnly sameFormat upToDate />)
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF')
    expect(screen.getByTestId('process-format-toggle')).toHaveAccessibleName(
      'Format and destination, AIFF',
    )
  })

  it('keeps the format menu on the quiet face', () => {
    render(<ExportButton {...baseProps} incomplete={false} inPlace tagsOnly sameFormat upToDate />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-format-mp3')).toBeInTheDocument()
  })

  it('brings the accent button back with an edit', () => {
    const props = {
      ...baseProps,
      incomplete: false,
      inPlace: true,
      tagsOnly: true,
      sameFormat: true,
    }
    const { rerender } = render(<ExportButton {...props} upToDate />)
    rerender(<ExportButton {...props} upToDate={false} />)
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
    expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
  })

  it('shows an already converted track as up to date without a rise, since the footer remounts on every track switch and an arrow key held through the list would replay it each step', () => {
    render(<ExportButton {...baseProps} incomplete={false} inPlace tagsOnly sameFormat upToDate />)
    expect(screen.getByTestId('convert-up-to-date-row').className).not.toContain(
      'animate-footer-swap',
    )
  })

  it('rises into up to date when the track becomes up to date while on screen', () => {
    const props = {
      ...baseProps,
      incomplete: false,
      inPlace: true,
      tagsOnly: true,
      sameFormat: true,
    }
    const { rerender } = render(<ExportButton {...props} upToDate={false} />)
    rerender(<ExportButton {...props} upToDate />)
    expect(screen.getByTestId('convert-up-to-date-row').className).toContain('animate-footer-swap')
  })

  // A disabled convert with no explanation leaves the user guessing; the tooltip must
  // name the empty required fields. The button itself fires no events while disabled, so
  // the wrapper carries the hover — this guards that wiring, not just the copy.
  it('explains on hover why a blocked convert is disabled', () => {
    vi.useFakeTimers()
    try {
      render(
        <ExportButton
          {...baseProps}
          incomplete
          incompleteReason="Missing required fields: Year, Genre"
        />,
      )
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
      hover(screen.getByTestId('process-btn-wrap'))
      act(() => vi.advanceTimersByTime(400))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Missing required fields: Year, Genre')
    } finally {
      vi.useRealTimers()
    }
  })

  // What blocks the convert is said on the button's own face, so it never takes width from
  // the button beside it. The action stays in the name, voiced after the visible words so
  // voice control still finds the button by what it shows.
  it('says what blocks it on its face and keeps the action in its name', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete
        incompleteReason="Missing required fields: Title, Artist, Year"
        blockedLabel="3 required fields missing"
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(screen.getByTestId('process-blocked-face')).toHaveTextContent(
      '3 required fields missing',
    )
    expect(btn).toContainElement(screen.getByTestId('process-blocked-face'))
    expect(btn).toHaveAccessibleName(/^3 required fields missing · Convert/)
  })

  it('shows the action on its face once nothing blocks it', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    expect(screen.queryByTestId('process-blocked-face')).toBeNull()
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName(/^Convert/)
  })

  // Pressing the blocked button is the user asking "what now?": it reports the press so
  // the editor can lead them to the field, and still never converts.
  it('reports a press on the blocked button without converting', () => {
    const onProcess = vi.fn()
    const onBlockedPress = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete
        blockedLabel="Missing Grouping"
        onProcess={onProcess}
        onBlockedPress={onBlockedPress}
      />,
    )
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onBlockedPress).toHaveBeenCalledOnce()
    expect(onProcess).not.toHaveBeenCalled()
  })

  // A natively disabled button drops out of the Tab order, and the reason lived in a hover
  // tooltip on a wrapper nothing can focus: a keyboard or screen reader user never learnt
  // why Convert was unavailable, or that it was there at all. It stays focusable, refuses
  // to convert, and carries the reason as its description.
  it('keeps a blocked convert focusable, inert, and described by its reason', () => {
    const onProcess = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete
        incompleteReason="Missing required fields: Year, Genre"
        onProcess={onProcess}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAccessibleDescription('Missing required fields: Year, Genre')
    fireEvent.click(btn)
    expect(onProcess).not.toHaveBeenCalled()
  })

  // The format hid behind a bare chevron and the verb carried it ("Convert to AIFF"): the
  // dropdown half now shows what is chosen, and only the verb is left on the main half.
  it('says the verb on the main half and the chosen format on the dropdown half', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/)
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF')
    expect(screen.getByTestId('process-format-toggle')).toHaveAccessibleName(
      'Format and destination, AIFF',
    )
  })

  // A width that followed the text made the verb half jump each time the format changed, so
  // every name sits in the dropdown's one stacked cell and only which one shows changes.
  it('stacks every format name in the dropdown whatever format is chosen', () => {
    const { rerender } = render(<ExportButton {...baseProps} incomplete={false} />)
    const sized = screen.getByTestId('process-format-toggle').textContent
    rerender(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('FLAC')
    expect(screen.getByTestId('process-format-toggle').textContent).toBe(sized)
    rerender(<ExportButton {...baseProps} incomplete={false} outputFormat="source" />)
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('Original')
    expect(screen.getByTestId('process-format-toggle').textContent).toBe(sized)
  })

  // The chevron menu now carries both halves of the button's promise ("Convert to
  // AIFF + Apple Music"): picking a destination must behave exactly like picking a
  // format — relabel only, never convert — so a misclick can't write a file or push
  // a track into a library the user didn't mean.
  it('reports a destination pick without converting', () => {
    const onProcess = vi.fn()
    const onSelectDestination = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destination="appleMusic"
        onProcess={onProcess}
        onSelectDestination={onSelectDestination}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-destination-beside'))
    expect(onSelectDestination).toHaveBeenCalledWith('beside')
    expect(onProcess).not.toHaveBeenCalled()
    expect(screen.queryByTestId('process-destination-beside')).toBeNull()
  })

  it('marks the current destination in the menu', () => {
    render(<ExportButton {...baseProps} incomplete={false} destination="beside" />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-beside')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('process-destination-folder')).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  // "Edit the original" sat in the menu looking like the folder beside it, though it is the
  // one choice that rewrites the user's own file; the warning lives where the choice is made,
  // not only in the confirmation that comes after pressing Convert.
  it('says in the menu that only "edit the original" overwrites the file', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destinations={['folder', 'appleMusic', 'beside', 'overwrite'] as const}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-overwrite')).toHaveTextContent(
      'Overwrites the file',
    )
    expect(screen.getByTestId('process-destination-beside')).not.toHaveTextContent('Overwrites')
    expect(screen.getByTestId('process-destination-folder')).not.toHaveTextContent('Overwrites')
  })

  // The chevron opened a plain stack of buttons: no announced popup, focus left behind on
  // the chevron, no arrows and no Escape, so from the keyboard the menu was a trap of Tab
  // presses. It has to behave like the app's other menus (TrackContextMenu).
  it('runs the format menu as a keyboard menu of radio items', () => {
    render(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    const toggle = screen.getByTestId('process-format-toggle')
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const flac = screen.getByTestId('process-format-flac')
    expect(flac).toHaveAttribute('role', 'menuitemradio')
    expect(flac).toHaveAttribute('aria-checked', 'true')
    expect(flac).toHaveFocus()
    fireEvent.keyDown(flac, { key: 'ArrowDown' })
    expect(flac).not.toHaveFocus()
    expect(screen.getByRole('menu')).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  // Tab leaves a native menu and closes it. Left open, it floated over the editor while the
  // focus was already on the next control, and the next click landed on the stale menu.
  it('closes the format menu when Tab leaves it', () => {
    render(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.keyDown(screen.getByTestId('process-format-flac'), { key: 'Tab' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  // Picking an item closes the menu; without handing focus back, it fell to <body>.
  it('returns focus to the chevron after a pick', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    const toggle = screen.getByTestId('process-format-toggle')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(toggle).toHaveFocus()
  })

  // Music can't ingest FLAC, so with FLAC picked the Apple Music destination must grey
  // out — the same pin the Settings radio applies — instead of promising an add that
  // the conversion would silently skip.
  it('disables the Apple Music destination while FLAC is the picked format', () => {
    render(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-appleMusic')).toBeDisabled()
    expect(screen.getByTestId('process-destination-beside')).toBeEnabled()
  })

  // While a track converts, the button mirrors the row in the track list: the
  // current stage as its label and a fill marking where in the pipeline the export
  // is — the same honest phase progress (STAGE_PROGRESS), not a fake percentage.
  it('shows the stage label and its progress fill while processing', () => {
    render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="appleMusic" />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Adding to Apple Music…')
    expect(screen.getByTestId('process-progress')).toHaveStyle({ transform: 'scaleX(0.85)' })
  })

  // Reported 21/11: in compact density the button grew taller the moment a convert started,
  // nudging the footer. Idle, blocked and converting must share one height in every density.
  it('keeps the same vertical padding whether idle, blocked or converting', () => {
    const paddingOf = () =>
      screen
        .getByTestId('process-btn')
        .className.split(/\s+/)
        .filter((c) => /(^|:)py-/.test(c))
        .sort()
    const { rerender } = render(<ExportButton {...baseProps} incomplete={false} />)
    const idle = paddingOf()
    rerender(<ExportButton {...baseProps} incomplete />)
    expect(paddingOf()).toEqual(idle)
    rerender(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(paddingOf()).toEqual(idle)
  })

  // Reported 02/11: editing a track already in Music read "Adding to Apple Music…" under
  // an "Update" button. Each step names what the job really does.
  it.each([
    ['tags', 'Writing tags…'],
    ['appleMusicUpdate', 'Updating in Apple Music…'],
    ['appleMusicReplace', 'Replacing in Apple Music…'],
  ] as const)('names the %s step for what it does', (stage, label) => {
    render(<ExportButton {...baseProps} incomplete={false} status="processing" stage={stage} />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent(label)
  })

  it('lets a tags write be cancelled like an encode', () => {
    const onCancel = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="tags"
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  // A long single convert used to be a dead progress bar with no escape. With a cancel
  // handler the button stays live while converting: clicking it stops the job instead of
  // firing another convert, so the single flow has the escape a batch always had.
  it('cancels the in-flight convert on click instead of staying a dead bar', () => {
    const onProcess = vi.fn()
    const onCancel = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onProcess={onProcess}
        onCancel={onCancel}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onProcess).not.toHaveBeenCalled()
  })

  // Only the encode can be stopped. Offered while the cover was written or the file went
  // to Apple Music, the cancel was swallowed and the job finished anyway.
  it('offers no cancel in a stage the job cannot be stopped in', () => {
    const onCancel = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="appleMusic"
        onCancel={onCancel}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toBeDisabled()
    expect(btn).not.toHaveAccessibleName(/cancel/i)
  })

  // A double-click on Convert lands its second click on the live bar, which had just
  // become the cancel control: the convert stopped the moment it started.
  it('does not cancel on the second click of the double-click that started it', () => {
    const onCancel = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('process-btn'), { detail: 2 })
    expect(onCancel).not.toHaveBeenCalled()
  })

  // The live bar cancels on press, but its name was only the stage ("Converting to
  // AIFF…") and "Cancel" appeared on mouse hover alone: a keyboard or screen reader user
  // pressed it not knowing it would stop the job. The name must say so, keep the visible
  // stage in it, and the "Cancel" swap must also show when the keyboard focus is there.
  it('names the live bar as a cancel control and shows "Cancel" on keyboard focus too', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onCancel={vi.fn()}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toHaveAccessibleName(
      i18n.t('export.cancelWhile', {
        stage: `Converting to AIFF… ${i18n.t('trackList.progress', { percent: 55 })}`,
      }),
    )
    expect(btn).toHaveAccessibleName(/Converting to AIFF…/)
    expect(screen.getByText(i18n.t('common.cancel')).className).toContain(
      'group-focus-within:inline',
    )
  })

  // The fill is a bare aria-hidden span, so a screen reader heard the stage but never how
  // far along it was. A button flattens any role inside it, so the amount is in its name.
  it('speaks the progress of the converting button, live or inert', () => {
    const percent = i18n.t('trackList.progress', { percent: 55 })
    const { unmount } = render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName(new RegExp(percent))
    unmount()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName(new RegExp(percent))
  })

  // Without a cancel handler the processing button stays the inert progress bar it was —
  // the cancel affordance is opt-in, so the multi/quiet uses are unaffected.
  it('stays a disabled bar while processing when no cancel handler is given', () => {
    render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(screen.getByTestId('process-btn')).toBeDisabled()
  })

  it('names the picked format in the converting stage label', () => {
    render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Converting to AIFF…')
    expect(screen.getByTestId('process-progress')).toHaveStyle({ transform: 'scaleX(0.55)' })
  })

  // The first progress event may not have landed yet: no stage, no fill — the
  // button falls back to the generic processing label instead of an empty bar.
  it('falls back to the plain processing label before the first stage lands', () => {
    render(<ExportButton {...baseProps} incomplete={false} status="processing" />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Converting…')
    expect(screen.queryByTestId('process-progress')).not.toBeInTheDocument()
  })

  describe('the fill arriving', () => {
    const animate = vi.fn()
    afterEach(() => {
      animate.mockReset()
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate
    })

    // The press turned a full accent button into a 40% track with a fifth already filled, in
    // one frame: the bar seemed to empty out. Growing the first fill from nothing makes the
    // press read as the job starting. It grows towards the live fill, not a fixed one, so a
    // short file whose next phase lands mid-grow is not held at 20%.
    it('grows the first fill from empty when the conversion starts under the open button', () => {
      HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
      const { rerender } = render(
        <ExportButton {...baseProps} incomplete={false} status="processing" />,
      )
      rerender(<ExportButton {...baseProps} incomplete={false} status="processing" stage="cover" />)

      expect(animate).toHaveBeenCalledOnce()
      expect(animate.mock.contexts[0]).toBe(screen.getByTestId('process-progress'))
      expect(animate.mock.calls[0][0]).toEqual([{ transform: 'scaleX(0)', offset: 0 }])
    })

    // Opening a track that is already converting is not the job starting: replaying the
    // grow on every track stepped through would be an entrance toll.
    it('shows the fill where it is when the track opens mid-conversion', () => {
      HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
      render(
        <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
      )
      expect(animate).not.toHaveBeenCalled()
    })

    it('lets the next phases ease on from the fill already drawn', () => {
      HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
      const { rerender } = render(
        <ExportButton {...baseProps} incomplete={false} status="processing" stage="cover" />,
      )
      rerender(
        <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
      )
      expect(animate).not.toHaveBeenCalled()
    })
  })

  it('shows no blocked-reason tooltip once the convert is allowed', () => {
    vi.useFakeTimers()
    try {
      render(<ExportButton {...baseProps} incomplete={false} />)
      expect(screen.getByTestId('process-btn')).toBeEnabled()
      hover(screen.getByTestId('process-btn-wrap'))
      act(() => vi.advanceTimersByTime(400))
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // "Same as source" only means something over files of more than one format: over one
  // track, or a selection all in one format, it is that format under a second name. The
  // caller works that out from the files; a selection alone no longer earns it.
  it('offers "Same as source" in the format menu only when the caller says it applies', () => {
    const { rerender } = render(<ExportButton {...baseProps} incomplete={false} count={2} />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.queryByTestId('process-format-source')).not.toBeInTheDocument()
    rerender(<ExportButton {...baseProps} incomplete={false} count={2} offerSource />)
    expect(screen.getByTestId('process-format-source')).toBeInTheDocument()
  })

  it('does not offer "Same as source" in the single-track format menu', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.queryByTestId('process-format-source')).not.toBeInTheDocument()
  })

  // Picking 'source' must reach the caller unresolved — the whole point is that
  // processAll resolves it per track, not the editor resolving it against one.
  it('reports a "source" pick without resolving it', () => {
    const onSelectFormat = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        count={2}
        offerSource
        onSelectFormat={onSelectFormat}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-source'))
    expect(onSelectFormat).toHaveBeenCalledWith('source')
  })

  // With 'source' picked, the dropdown must show the translated short name ("Original"),
  // never the raw setting uppercased ("SOURCE" means nothing to the user).
  it('shows the translated label for "Same as source", not the raw setting', () => {
    render(<ExportButton {...baseProps} incomplete={false} count={2} outputFormat="source" />)
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('Original')
    expect(screen.getByTestId('process-format-toggle')).not.toHaveTextContent('SOURCE')
  })
})

// Opened in the app with a track's end trim near the footer, the trim handle (z-10) and its
// scissors (z-20) drew over Apple Music and Engine DJ and took the click meant for them: a
// menu with no layer of its own loses to any positioned control with one.
describe('ExportButton menu layer', () => {
  const layer = (el: Element): number => Number(/\bz-\[?(\d+)\]?/.exec(el.className)?.[1] ?? 0)

  it('opens over the trim lane controls it can cover', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(layer(screen.getByRole('menu'))).toBeGreaterThan(20)
  })

  // The label may be cut with an ellipsis at the narrowest editor, so the full text must
  // stay reachable: by name for a screen reader and on hover for everyone else.
  it('keeps the full update-anyway label on hover and in its name when it is cut short', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        inPlace
        tagsOnly
        sameFormat
        upToDate
        narrow
        onProcess={vi.fn()}
      />,
    )
    const button = screen.getByTestId('convert-update-anyway')
    expect(button).toHaveAccessibleName('Update anyway')
    expect(hoverTooltip(button)).toBe('Update anyway')
  })

  it('dims the format half with the body when a held-back selection cannot convert, while its menu still opens since another format can unblock it', () => {
    render(<ExportButton {...baseProps} incomplete count={38} incompleteReason="Separate them" />)
    const toggle = screen.getByTestId('process-format-toggle')
    expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
    expect(toggle).toBeEnabled()
    expect(screen.getByTestId('process-format-fill')).not.toHaveAttribute('data-on')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the format half filled while the selection can convert', () => {
    render(<ExportButton {...baseProps} incomplete={false} count={38} />)
    expect(screen.getByTestId('process-format-fill')).toHaveAttribute('data-on', 'true')
  })
})
