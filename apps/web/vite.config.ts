import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

type Locale = {
  nav: { languageOffer: unknown }
  useCases: { cases: { id: string; slug: string }[] }
}

const DIGESTS: Record<string, (data: unknown) => unknown> = {
  latest: (releases) => (releases as unknown[])[0],
  slugs: (locale) => (locale as Locale).useCases.cases.map(({ id, slug }) => ({ id, slug })),
  languageOffer: (locale) => (locale as Locale).nav.languageOffer,
}

export function jsonDigests(): Plugin {
  return {
    name: 'surco-json-digests',
    enforce: 'pre',
    async load(id) {
      const [file, query] = id.split('?')
      const digest = query && DIGESTS[query]
      if (!file.endsWith('.json') || !digest) return null
      this.addWatchFile(file)
      return JSON.stringify(digest(JSON.parse(await readFile(file, 'utf8'))))
    },
  }
}

export default defineConfig({
  plugins: [jsonDigests(), react(), tailwindcss()],
})
