import { ViteReactSSG } from 'vite-react-ssg'
import { routes } from './routes'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'

export const createRoot = ViteReactSSG({ routes })
