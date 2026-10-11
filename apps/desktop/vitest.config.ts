import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/testTmpRoot.ts', 'src/renderer/src/test/setup.ts'],
  },
})
