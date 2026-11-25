import type { SourceNode, UsbProgram } from '../../../shared/types'
import type { ActiveModal } from '../hooks/useOverlays'
import type { FillTarget } from '../hooks/useSessionRun'
import type { SourceBrowser } from '../hooks/useSourceBrowser'
import type { TrackItem } from '../types'
import type { ReviewOpening } from './reviewTarget'

export type CopiesOpening = {
  openMusic: boolean
  query: string
  key: number
}

export type UsbOpening = {
  preselect: string | null
  source: UsbProgram
}

export type PasteTracklistOpening = {
  node: SourceNode
  create: boolean
}

export type SessionWizardOpening = {
  parentId: string
  adjust: boolean
  fill?: FillTarget
  start?: { path: string; playlistId: string }
}

export interface OverlayLayers {
  activeModal: ActiveModal
  copiesOpen: CopiesOpening | null
  review: ReviewOpening | null
  usbModal: UsbOpening | null
  pasteTracklist: PasteTracklistOpening | null
  sessionWizard: SessionWizardOpening | null
}

export interface OverlayOpen {
  overlayOpen: boolean
}

// Any open modal/overlay also swallows the global shortcuts, or space/j/k/⌘⏎ would act
// on the list behind the dialog (e.g. start a conversion behind the confirm prompt).
export function overlayOpenOf({
  activeModal,
  copiesOpen,
  review,
  usbModal,
  pasteTracklist,
  sessionWizard,
}: OverlayLayers): OverlayOpen {
  const overlayOpen =
    activeModal !== null ||
    copiesOpen !== null ||
    review !== null ||
    usbModal !== null ||
    pasteTracklist !== null ||
    sessionWizard !== null
  return { overlayOpen }
}

export interface ShowListContext {
  copiesOpen: CopiesOpening | null
  browser: Pick<SourceBrowser, 'source' | 'playlist'>
  filesView: TrackItem[]
  review: ReviewOpening | null
  playerMounted: boolean
}

export interface ShowList {
  showList: boolean
}

export function showListOf({
  copiesOpen,
  browser,
  filesView,
  review,
  playerMounted,
}: ShowListContext): ShowList {
  const showList =
    !copiesOpen &&
    ((browser.source ? browser.playlist !== null : filesView.length > 0) ||
      review !== null ||
      playerMounted)
  return { showList }
}
