import { useCallback, useMemo } from 'react'
import { type AppStore, useAppStore } from '../lib/appStore'
import type { FilterSelection } from '../lib/triage'

interface TriageFilters {
  // The six axes bundled for the filter bar, which toggles one per click.
  filterSelection: FilterSelection
  filterActive: boolean
  // The format axis alone: the header's tally needs to clear it when the last track
  // of the filtered format leaves the list.
  formatFilter: string | null
  setFilterSelection: (next: FilterSelection) => void
  setFormatFilter: (f: string | null) => void
}

// The quality-triage filter axes, read from the store one slice each (field comments
// live in appStore) and re-bundled for the bar. Split back onto the store fields on
// write so each axis stays an independently-readable slice.
export function useTriageFilters(store: AppStore): TriageFilters {
  const qualityFilter = useAppStore(store, (s) => s.qualityFilter)
  const conversionFilter = useAppStore(store, (s) => s.conversionFilter)
  const libraryFilter = useAppStore(store, (s) => s.libraryFilter)
  const duplicatesFilter = useAppStore(store, (s) => s.duplicatesFilter)
  const attentionFilter = useAppStore(store, (s) => s.attentionFilter)
  const formatFilter = useAppStore(store, (s) => s.formatFilter)
  const filterSelection = useMemo<FilterSelection>(
    () => ({
      quality: qualityFilter,
      conversion: conversionFilter,
      library: libraryFilter,
      duplicates: duplicatesFilter,
      attention: attentionFilter,
      format: formatFilter,
    }),
    [
      qualityFilter,
      conversionFilter,
      libraryFilter,
      duplicatesFilter,
      attentionFilter,
      formatFilter,
    ],
  )
  const filterActive =
    qualityFilter !== null ||
    conversionFilter !== null ||
    libraryFilter !== null ||
    duplicatesFilter !== null ||
    attentionFilter !== null ||
    formatFilter !== null
  const setFilterSelection = useCallback(
    (next: FilterSelection) =>
      store.setState({
        qualityFilter: next.quality,
        conversionFilter: next.conversion,
        libraryFilter: next.library,
        duplicatesFilter: next.duplicates,
        attentionFilter: next.attention,
        formatFilter: next.format,
      }),
    [store],
  )
  const setFormatFilter = useCallback(
    (f: string | null) => store.setState({ formatFilter: f }),
    [store],
  )
  return { filterSelection, filterActive, formatFilter, setFilterSelection, setFormatFilter }
}
