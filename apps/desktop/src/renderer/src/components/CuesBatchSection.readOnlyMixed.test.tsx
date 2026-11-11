// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesBatchSection } from './CuesBatchSection'

vi.mock('../../../shared/djProgram', async (actual) => {
  const real = await actual<typeof import('../../../shared/djProgram')>()
  return {
    ...real,
    readsCuesOnly: (program: string) =>
      program === 'serato' || real.readsCuesOnly(program as never),
  }
})

afterEach(() => {
  cleanup()
  resetCueSession()
})

it('names no single program when the selection mixes two programs Surco can only read', () => {
  installApi({})
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsProvider settings={{}}>
        <CuesBatchSection
          targets={[
            { contentId: 'virtualdj:/m/a.wav', path: '/m/a.wav', label: 'A' },
            { contentId: 'serato:/m/b.mp3', path: '/m/b.mp3', label: 'B' },
          ]}
          onMark={vi.fn()}
          onFlow={vi.fn()}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByTestId('cues-auto-mark-all')).toBeDisabled()
  expect(screen.getByTestId('cues-batch-read-only')).toHaveTextContent(
    i18n.t('editor.cues.batch.readOnly'),
  )
})
