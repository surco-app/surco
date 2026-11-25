import { useState } from 'react'

// Drops the playlist's disk check in the render that switches to another playlist (or back
// to one), not in an effect: an effect would commit a frame with the old check showing.
export function useCheckedPlaylist(
  showingPlaylist: string | null,
  setCheckedPlaylist: (checked: string | null) => void,
): void {
  const [checkedShowing, setCheckedShowing] = useState(showingPlaylist)
  if (checkedShowing !== showingPlaylist) {
    setCheckedShowing(showingPlaylist)
    setCheckedPlaylist(null)
  }
}
