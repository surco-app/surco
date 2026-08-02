import type { AppStore } from './appStore'
import { pushToast } from './toastQueue'

// The two things an import reports after the fact. Separate keys so a drop that both
// skips duplicates and fails a read still shows both cards.
type ImportNotice = 'meta-read-failed' | 'duplicates-skipped'

// A folder walk streams one batch per DIRECTORY (see expand.ts), and every batch closes
// its own counter cycle — so these fired once per folder, not once per import. On a crate
// living on a network share that is hundreds of cards stacking up in the corner while the
// import runs, each one hiding the UI behind it. Keying them collapses the re-raises onto
// one card per kind, which updates in place as later batches revise the count.
export function pushImportNotice(store: AppStore, notice: ImportNotice, message: string): void {
  pushToast(store, { key: notice, tone: 'neutral', message, duration: 4000, testid: 'app-notice' })
}
