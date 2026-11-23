import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@surco/auto-cue-impl': resolve(__dirname, 'src/shared/autoCue/basic.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['src/testTmpRoot.ts', 'src/renderer/src/test/setup.ts'],
  },
})
