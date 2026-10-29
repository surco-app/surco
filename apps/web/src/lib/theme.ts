export const THEME_KEY = 'surco_theme'

export function toggleTheme(): void {
  const root = document.documentElement
  const next = root.dataset.theme === 'light' ? 'dark' : 'light'
  root.dataset.theme = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // private mode / storage disabled — the choice just won't persist
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--color-bg').trim())
}
