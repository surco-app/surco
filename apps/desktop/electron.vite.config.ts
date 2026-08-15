import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // A sandboxed preload (webPreferences.sandbox: true) must be CommonJS — the
        // sandbox can't load an ESM preload — so emit index.cjs instead of the
        // default .mjs this "type": "module" package would otherwise produce.
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
        output: {
          // The key-claim registry holds module-level state: the open section registers
          // its handlers there and the global keydown listener reads them back. The
          // listener ships in the entry chunk and the sections in the lazy Editor one,
          // so left to itself Rollup COPIED the module into both — two stacks, and every
          // claim registered in one was invisible to the other. The section's keys did
          // nothing while its tests (one module graph, no chunks) stayed green.
          manualChunks: (id) => (id.includes('lib/spaceClaim') ? 'key-claims' : undefined),
        },
      },
    },
  },
})
