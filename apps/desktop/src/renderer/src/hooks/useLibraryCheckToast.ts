import { useEffect } from 'react'
import type { AppStore } from '../lib/appStore'
import type { LibrarySource } from '../lib/librarySource'
import { dismissToast, pushToast } from '../lib/toastQueue'

export function useLibraryCheckToast(
  store: AppStore,
  libraryFailed: boolean,
  librarySource: LibrarySource,
): void {
  // A library that could not be read leaves every row without a verdict, the same blank a
  // check still loading shows; the notice is what tells the two apart. It goes away once
  // a refocus retries the read and it lands.
  useEffect(() => {
    if (!libraryFailed || !librarySource) return
    const id = pushToast(store, {
      key: 'library-check',
      tone: 'danger',
      testid: 'library-check-failed',
      message: {
        key:
          librarySource === 'engineDj'
            ? 'editor.libraryCheckFailedEngine'
            : 'editor.libraryCheckFailed',
      },
    })
    return () => dismissToast(store, id)
  }, [libraryFailed, librarySource, store])
}
