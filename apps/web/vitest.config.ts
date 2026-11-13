import { defineConfig } from 'vitest/config'
import { jsonDigests } from './vite.config'

export default defineConfig({
  plugins: [jsonDigests()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // spectrumDuotone builds its ramp from index.css?raw; vitest empties CSS modules unless
    // they are listed here.
    css: { include: [/index\.css/] },
  },
})
