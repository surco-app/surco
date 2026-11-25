import type { TFunction } from 'i18next'
import type React from 'react'
import type { PlaylistSource, Settings, SourceNode } from '../../../shared/types'
import type { useColumnLayout } from '../hooks/useColumnLayout'
import type { useCopies } from '../hooks/useCopies'
import type { SourceBrowser } from '../hooks/useSourceBrowser'
import { railWidth } from '../lib/columnLayout'
import { railAlert } from '../lib/copiesView'
import type { CopiesOpening } from '../lib/overlayLayers'
import type { Selection } from '../lib/selection'
import type { ProgramEdits } from '../lib/sourcePrograms'
import { SourceRail } from './SourceRail'
import { SourceTree } from './SourceTree'

const SIDEBAR_PEEK_DELAY_MS = 150
const PEEK_TREE_WIDTH = 240

export function SidebarPanel({
  showSidebar,
  sidebarPeek,
  setSidebarPeek,
  peekTimer,
  dragging,
  browser,
  toggleSidebar,
  showRailNames,
  toggleRailNames,
  setCopiesOpen,
  selectSource,
  saveSettings,
  hiddenSources,
  copiesOpen,
  libraryCopies,
  openCopies,
  columns,
  tr,
  runningNote,
  programRunning,
  selectTreePlaylist,
  editableSource,
  treeEdit,
  fixed,
  treeUsbProgram,
  exportTreeToUsb,
  newPlaylistRef,
}: {
  showSidebar: boolean
  sidebarPeek: boolean
  setSidebarPeek: React.Dispatch<React.SetStateAction<boolean>>
  peekTimer: React.RefObject<ReturnType<typeof setTimeout> | undefined>
  dragging: boolean
  browser: SourceBrowser
  toggleSidebar: () => void
  showRailNames: boolean
  toggleRailNames: () => void
  setCopiesOpen: React.Dispatch<React.SetStateAction<CopiesOpening | null>>
  selectSource: (next: PlaylistSource | null) => Selection
  saveSettings: (patch: Partial<Settings>) => void
  hiddenSources: PlaylistSource[]
  copiesOpen: CopiesOpening | null
  libraryCopies: ReturnType<typeof useCopies>
  openCopies: (openMusic: boolean, query: string) => void
  columns: ReturnType<typeof useColumnLayout>
  tr: TFunction
  runningNote: ProgramEdits['runningNote']
  programRunning: boolean
  selectTreePlaylist: (node: SourceNode, folders: string[]) => void
  editableSource: ProgramEdits['editableSource']
  treeEdit: NonNullable<React.ComponentProps<typeof SourceTree>['edit']>
  fixed: React.ComponentProps<typeof SourceTree>['fixed']
  treeUsbProgram: ProgramEdits['treeUsbProgram']
  exportTreeToUsb: () => void
  newPlaylistRef: React.ComponentProps<typeof SourceTree>['newPlaylistRef']
}): React.JSX.Element {
  return (
    <>
      {!showSidebar && !sidebarPeek && (
        <div
          data-testid="sidebar-edge"
          aria-hidden="true"
          onPointerEnter={() => {
            peekTimer.current = setTimeout(() => setSidebarPeek(true), SIDEBAR_PEEK_DELAY_MS)
          }}
          onPointerLeave={() => clearTimeout(peekTimer.current)}
          className="absolute inset-y-0 left-0 z-30 w-2"
        />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the rail and tree inside take the keys, this only closes the overlay */}
      <div
        data-testid={showSidebar ? undefined : 'sidebar-peek'}
        data-open={(!showSidebar && sidebarPeek) || undefined}
        inert={!showSidebar && !sidebarPeek}
        onPointerLeave={showSidebar ? undefined : () => setSidebarPeek(false)}
        onKeyDown={
          showSidebar
            ? undefined
            : (e) => {
                if (e.key !== 'Escape') return
                e.stopPropagation()
                setSidebarPeek(false)
              }
        }
        className={
          showSidebar
            ? 'contents'
            : 'sidebar-peek absolute inset-y-0 left-0 z-30 flex bg-[var(--color-ink)]'
        }
      >
        <SourceRail
          dropsInTracks={dragging && browser.source !== null}
          sidebarShown={showSidebar}
          onToggleSidebar={() => {
            setSidebarPeek(false)
            toggleSidebar()
          }}
          width={railWidth({ names: showRailNames })}
          showNames={showRailNames}
          onToggleNames={toggleRailNames}
          sources={browser.sources}
          active={browser.source}
          onSelect={(next) => {
            setCopiesOpen(null)
            selectSource(next)
          }}
          onHide={(hidden) =>
            saveSettings({
              hiddenSources: [...hiddenSources, hidden],
            })
          }
          copies={{
            active: copiesOpen !== null,
            alert: railAlert(libraryCopies.programs),
            onOpen: () => {
              setSidebarPeek(false)
              if (!copiesOpen) openCopies(false, '')
            },
          }}
        />
        {!copiesOpen && browser.source && (
          <SourceTree
            key={browser.source}
            width={showSidebar ? columns.widths.tree : PEEK_TREE_WIDTH}
            title={tr(`sources.${browser.source}`)}
            source={browser.source}
            nodes={browser.tree}
            failed={browser.treeFailed}
            missing={browser.libraryMissing}
            notice={runningNote && programRunning ? tr(runningNote.key) : undefined}
            selectedId={browser.playlist?.id ?? null}
            onSelect={selectTreePlaylist}
            edit={editableSource ? treeEdit : undefined}
            fixed={fixed}
            onExportUsb={treeUsbProgram ? exportTreeToUsb : undefined}
            newPlaylistRef={newPlaylistRef}
          />
        )}
      </div>
    </>
  )
}
