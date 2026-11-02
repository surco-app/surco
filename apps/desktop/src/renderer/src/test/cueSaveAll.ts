import { fireEvent, screen, waitFor } from '@testing-library/react'

export async function saveAllItem(): Promise<HTMLElement> {
  await waitFor(() => {
    if (!screen.queryByTestId('cues-save-all') && !screen.queryByTestId('cues-save-more'))
      throw new Error('no save-all control yet')
  })
  const shown = screen.queryByTestId('cues-save-all')
  if (shown) return shown
  fireEvent.click(screen.getByTestId('cues-save-more'))
  return screen.getByTestId('cues-save-all')
}
