import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installGlobalErrorLogging } from './lib/logGlobalErrors'
import { createQueryClient } from './lib/queryClient'
import './i18n'
import './index.css'

installGlobalErrorLogging(window, window.api.logError)

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
