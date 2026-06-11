import type { Api } from './api'

declare global {
  interface Window {
    api: Api
  }
}
