import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { createQueryClient } from './lib/queryClient'
import './i18n'
import './index.css'

// macOS draws the window over a live vibrancy material; tag the document so the CSS
// drops the chrome to translucent and lets it show through. A no-op on other platforms,
// where the window stays opaque.
if (window.api?.platform === 'darwin') document.documentElement.dataset.vibrancy = 'on'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

const queryClient = createQueryClient()

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
