import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@surco/auto-cue-impl': resolve(__dirname, 'src/shared/autoCue/trained/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/testTmpRoot.ts', 'src/renderer/src/test/setup.ts'],
  },
})
