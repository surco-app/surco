// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../../shared/types'
import i18n from '../../i18n'
import { PAYPAL_ME_URL } from '../../lib/donate'
import { ToastProvider } from '../../lib/toastContext'
import { installApi } from '../../test/api'
import { hoverTooltip } from '../../test/tooltip'
import { StatsTab } from './StatsTab'

afterEach(cleanup)

const zeroStats = {
  imported: 0,
  listened: 0,
  analyzed: 0,
  discogsMatches: 0,
  bandcampMatches: 0,
  deezerMatches: 0,
  beatportMatches: 0,
  musicbrainzMatches: 0,
  itunesMatches: 0,
}

function withStats(over: Partial<Settings> = {}): Settings {
  return { conversionCount: 0, stats: zeroStats, ...over } as Settings
}

describe('StatsTab', () => {
  // The lifetime counter is the tab's centerpiece: it turns "I used the app" into a
  // number the user can feel good about, right next to the donate ask.
  it('shows the lifetime conversion counter and time saved', () => {
    render(<StatsTab settings={withStats({ conversionCount: 3 })} />)
    expect(screen.getByTestId('stats-count')).toHaveTextContent('3')
    expect(screen.getByTestId('stats-time-saved')).toBeInTheDocument()
    expect(screen.getByTestId('stats-donate')).toBeInTheDocument()
  })

  // The hosted donate button takes a PayPal fee; some users asked to send the money
  // friend-to-friend instead so all of it arrives. That route must sit right next to
  // the button, in an external tab like it.
  it('offers the fee-free paypal.me route next to the donate button', () => {
    render(<StatsTab settings={withStats({ conversionCount: 3 })} />)
    const link = screen.getByTestId('stats-paypal-me')
    expect(link).toHaveAttribute('href', PAYPAL_ME_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveTextContent('paypal.me/vicentgozalbes')
  })

  // The activity grid answers "what has Surco done for me" beyond conversions —
  // loads, listens, analyses and per-provider match finds each get their own tally.
  it('shows every lifetime activity counter', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 385,
          stats: {
            imported: 812,
            listened: 240,
            analyzed: 512,
            discogsMatches: 301,
            bandcampMatches: 17,
            deezerMatches: 44,
            beatportMatches: 0,
            musicbrainzMatches: 9,
            itunesMatches: 0,
          },
        })}
      />,
    )
    expect(screen.getByTestId('stats-imported')).toHaveTextContent('812')
    expect(screen.getByTestId('stats-listened')).toHaveTextContent('240')
    expect(screen.getByTestId('stats-analyzed')).toHaveTextContent('512')
    expect(screen.getByTestId('stats-discogsMatches')).toHaveTextContent('301')
    expect(screen.getByTestId('stats-bandcampMatches')).toHaveTextContent('17')
    expect(screen.getByTestId('stats-deezerMatches')).toHaveTextContent('44')
    expect(screen.getByTestId('stats-musicbrainzMatches')).toHaveTextContent('9')
  })

  it('counts Apple Music finds in the grid and in the source split, so its matches are not credited to another catalog', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 10,
          stats: { ...zeroStats, discogsMatches: 6, itunesMatches: 4 },
        })}
      />,
    )
    expect(screen.getByTestId('stats-itunesMatches')).toHaveTextContent('4')
    expect(screen.getByTestId('stats-match-itunes')).toHaveStyle({ width: '40%' })
    expect(screen.getByTestId('stats-match-split')).toHaveTextContent('Apple Music4')
  })

  // The match tallies aren't independent trivia — together they answer "where did my
  // metadata come from", so they read as one proportion. The split bar sizes each
  // source to its share of the matches found, with the raw counts still legible.
  it('splits the match sources by their share of the matches found', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 50,
          stats: {
            ...zeroStats,
            discogsMatches: 30,
            bandcampMatches: 10,
            deezerMatches: 5,
            beatportMatches: 0,
            musicbrainzMatches: 5,
          },
        })}
      />,
    )
    const split = screen.getByTestId('stats-match-split')
    // Discogs is 30 of 50 matches → its segment fills three-fifths of the bar.
    const discogs = screen.getByTestId('stats-match-discogs')
    expect(discogs).toHaveStyle({ width: '60%' })
    const deezer = screen.getByTestId('stats-match-deezer')
    expect(deezer).toHaveStyle({ width: '10%' })
    const musicbrainz = screen.getByTestId('stats-match-musicbrainz')
    expect(musicbrainz).toHaveStyle({ width: '10%' })
    expect(split).toHaveTextContent('30')
    expect(split).toHaveTextContent('10')
  })

  // "Found on Discogs" wrapped onto two lines in each quarter of the legend, and the count
  // ran into the next source's swatch ("11●"). The heading already says where the matches
  // came from, so each entry is just the catalog's name and its count.
  it('names each source in the legend by its catalog alone', () => {
    render(
      <StatsTab
        settings={withStats({ conversionCount: 5, stats: { ...zeroStats, discogsMatches: 11 } })}
      />,
    )
    const split = screen.getByTestId('stats-match-split')
    expect(split).not.toHaveTextContent('Found on')
    expect(split).toHaveTextContent('Discogs11')
  })

  // Reported 29/09 with a screenshot: the legend listed the catalogs in a fixed order, so
  // MusicBrainz (3) sat after Beatport (2). Read left to right, the bar and the legend have
  // to rank where the matches came from.
  it('orders the bar and the legend from the most matches to the fewest', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 5,
          stats: {
            ...zeroStats,
            discogsMatches: 213,
            bandcampMatches: 185,
            deezerMatches: 92,
            beatportMatches: 2,
            musicbrainzMatches: 3,
            itunesMatches: 1,
          },
        })}
      />,
    )
    const split = screen.getByTestId('stats-match-split')
    const order = (prefix: string): string[] =>
      Array.from(split.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)).map(
        (el) => el.dataset.testid?.slice(prefix.length) ?? '',
      )
    expect(order('stats-match-')).toEqual([
      'discogs',
      'bandcamp',
      'deezer',
      'musicbrainz',
      'beatport',
      'itunes',
    ])
    expect(split.textContent).toMatch(
      /Discogs213.*Bandcamp185.*Deezer92.*MusicBrainz3.*Beatport2.*Apple Music1/,
    )
  })

  // Before the first match the card was a flat empty bar over six catalogs at 0: a chart of
  // nothing. It is status, not a setting, so it simply appears with the first match.
  it('shows no match card until some match has landed', () => {
    render(<StatsTab settings={withStats({ conversionCount: 5 })} />)
    expect(screen.queryByTestId('stats-match-split')).toBeNull()
  })

  // A catalog with no matches says nothing about where the metadata came from, so the bar
  // and the legend carry only the sources that found something.
  it('lists only the catalogs that have matches', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 20,
          stats: { ...zeroStats, discogsMatches: 14, beatportMatches: 6 },
        })}
      />,
    )
    const split = screen.getByTestId('stats-match-split')
    expect(split.textContent).toMatch(/Discogs14.*Beatport6/)
    for (const key of ['bandcamp', 'deezer', 'musicbrainz', 'itunes']) {
      expect(screen.queryByTestId(`stats-match-${key}`)).toBeNull()
      expect(screen.queryByTestId(`stats-${key}Matches`)).toBeNull()
    }
  })

  // A shortened count must not cost the exact figure: it stays one hover away.
  it('shortens a four-digit count and keeps the exact one on hover', () => {
    render(
      <StatsTab
        settings={withStats({ conversionCount: 5, stats: { ...zeroStats, discogsMatches: 1234 } })}
      />,
    )
    const count = screen.getByTestId('stats-discogsMatches')
    expect(count).toHaveTextContent('1.2K')
    expect(hoverTooltip(count)).toEqual('1234')
  })

  // A five-digit lifetime count is the tab's headline; ungrouped it reads as raw output.
  it('groups the thousands of the counters', () => {
    render(
      <StatsTab
        settings={withStats({ conversionCount: 29215, stats: { ...zeroStats, imported: 3071 } })}
      />,
    )
    expect(screen.getByTestId('stats-count')).toHaveTextContent('29,215')
    expect(screen.getByTestId('stats-imported')).toHaveTextContent('3,071')
    expect(screen.getByTestId('stats-time-saved')).toHaveTextContent('243 workdays')
  })

  // The milestone bar gives the counter a goal — 385 of the way to 500 must read as
  // real progress toward a named target, the hook that keeps the tab worth reopening.
  it('shows progress toward the next conversion milestone', () => {
    render(<StatsTab settings={withStats({ conversionCount: 385 })} />)
    const milestone = screen.getByTestId('stats-milestone')
    expect(milestone).toHaveTextContent('500')
    expect(milestone).toHaveTextContent('115')
  })

  // Before any activity there is nothing to celebrate, only an invitation.
  it('shows the empty state until anything has happened', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-count')).toBeNull()
    expect(screen.queryByTestId('stats-imported')).toBeNull()
  })

  // Activity without conversions (listened, analyzed, matched but never converted)
  // must still show the grid — otherwise those tallies stay invisible forever.
  it('shows the grid without the conversion hero when only other activity exists', () => {
    render(<StatsTab settings={withStats({ stats: { ...zeroStats, listened: 9 } })} />)
    expect(screen.getByTestId('stats-listened')).toHaveTextContent('9')
    expect(screen.queryByTestId('stats-count')).toBeNull()
    expect(screen.queryByTestId('stats-empty')).toBeNull()
  })

  // The share card exists so the numbers can leave the app (Instagram, forums) — but
  // only once there is something to show; an all-zero card would be an empty brag.
  it('offers the share-image button only once there is activity', () => {
    render(<StatsTab settings={withStats({ conversionCount: 3 })} />)
    expect(screen.getByTestId('stats-share')).toBeInTheDocument()
    cleanup()
    render(<StatsTab settings={withStats()} />)
    expect(screen.queryByTestId('stats-share')).toBeNull()
  })

  // The support line asks for help without itemizing what the app cost to build —
  // publishing internal figures read as oversharing, so the cost/donations bars are
  // deliberately gone and only the plea plus the donate button remain.
  it('shows the support line without any cost figures', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-roi-donate')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-roi-cost')).toBeNull()
    expect(screen.queryByTestId('stats-roi-donations')).toBeNull()
  })

  // Present even in the empty state — the plea isn't tied to this install's own
  // activity, so it must survive alongside (not depend on) stats-empty.
  it('shows the support line even with no activity yet', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.getByTestId('stats-roi-donate')).toBeInTheDocument()
  })
})

// jsdom draws nothing, so the card's canvas records the text it is asked to paint: what the
// card says is what someone scrolling past the story reads.
describe('StatsTab share image', () => {
  let drawn: string[] = []

  function recordingContext(): CanvasRenderingContext2D {
    const ignore = (): void => {}
    const ctx: Partial<CanvasRenderingContext2D> = {
      fillStyle: '',
      strokeStyle: '',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      letterSpacing: '0px',
      lineWidth: 1,
      measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics,
      fillText: (text: string) => {
        drawn.push(text)
      },
      fillRect: ignore,
      beginPath: ignore,
      arc: ignore,
      roundRect: ignore,
      fill: ignore,
      stroke: ignore,
    }
    return ctx as CanvasRenderingContext2D
  }

  beforeEach(() => {
    drawn = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(recordingContext)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,CARD')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const busy = withStats({
    conversionCount: 385,
    stats: { ...zeroStats, imported: 812, discogsMatches: 301 },
  })

  // The card is the DJ's own numbers leaving the app; a card that saved but said
  // something else than the tab, or nothing at all, would be a brag about someone else.
  it('saves a card with the numbers and the time saved the tab shows', async () => {
    const exportStatsImage = vi.fn(async () => '/Users/dj/surco.png')
    installApi({ exportStatsImage })
    render(<StatsTab settings={busy} />)

    fireEvent.click(screen.getByTestId('stats-share'))

    await waitFor(() => expect(exportStatsImage).toHaveBeenCalledWith('data:image/png;base64,CARD'))
    expect(drawn).toContain(i18n.t('settings.stats.shareTitle'))
    expect(drawn).toContain('385')
    expect(drawn).toContain('812')
    expect(drawn).toContain(i18n.t('settings.stats.imported'))
    expect(drawn).toContain('301')
    const headline = screen.getByTestId('stats-time-saved').firstChild?.textContent
    expect(headline).toBeTruthy()
    expect(drawn).toContain(headline)
  })

  // Time saved is worked out from conversions; with none, a "0 minutes saved" panel would
  // turn the card into an anti-achievement.
  it('leaves the time saved off the card when nothing was converted yet', async () => {
    const exportStatsImage = vi.fn(async () => null)
    installApi({ exportStatsImage })
    render(<StatsTab settings={withStats({ stats: { ...zeroStats, imported: 40 } })} />)

    fireEvent.click(screen.getByTestId('stats-share'))

    await waitFor(() => expect(exportStatsImage).toHaveBeenCalledTimes(1))
    expect(drawn).toContain('40')
    expect(drawn.some((text) => /saved|ahorrad/i.test(text))).toBe(false)
  })

  // A second click while the save dialog is up would compose and open a second dialog.
  it('ignores a second press while the first card is still being saved', async () => {
    let finish: (path: string | null) => void = () => {}
    const exportStatsImage = vi.fn(
      () =>
        new Promise<string | null>((res) => {
          finish = res
        }),
    )
    installApi({ exportStatsImage })
    render(<StatsTab settings={busy} />)
    const button = screen.getByTestId('stats-share')

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(exportStatsImage).toHaveBeenCalledTimes(1)
    await act(async () => finish(null))
    expect(button).toBeEnabled()
  })

  // The save crosses IPC to write a file; the spinner finishing with no image and no word
  // reads as "it worked".
  it('says so when the card could not be saved, and lets the DJ try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reportError = vi.fn()
    installApi({ exportStatsImage: vi.fn(async () => Promise.reject(new Error('EACCES'))) })
    render(
      <ToastProvider value={{ reportError, reportNotice: vi.fn(), reportUndo: vi.fn() }}>
        <StatsTab settings={busy} />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByTestId('stats-share'))

    await waitFor(() => expect(reportError).toHaveBeenCalledWith(i18n.t('errors.statsImage')))
    expect(screen.getByTestId('stats-share')).toBeEnabled()
  })
})
