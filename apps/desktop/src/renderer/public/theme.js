// Sets the colour theme before first paint so a light-mode system never flashes the
// dark default. Lives as a static file (not an inline <script>) so the renderer's
// Content-Security-Policy can forbid inline scripts in the packaged build.
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'
