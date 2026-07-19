// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ForeignTagsInspector } from './ForeignTagsInspector'

afterEach(cleanup)

describe('ForeignTagsInspector', () => {
  it('no se muestra cuando no hay tags foráneos', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[]}
        foreignRemoved={[]}
        onRemove={vi.fn()}
        open={false}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('foreign-tags-toggle')).toBeNull()
  })

  it('muestra el conteo en el summary de la cabecera', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[
          { name: 'SERATO_MARKERS_V2', value: 'x' },
          { name: 'TRAKTOR4', value: 'y' },
        ]}
        foreignRemoved={[]}
        onRemove={vi.fn()}
        open={false}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tags-summary')).toHaveTextContent('2')
  })

  it('llama onToggle al pulsar la cabecera', () => {
    const onToggle = vi.fn()
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
        foreignRemoved={[]}
        onRemove={vi.fn()}
        open={false}
        onToggle={onToggle}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Other metadata' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('lista los foráneos cuando open y permite borrar uno', () => {
    const onRemove = vi.fn()
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
        foreignRemoved={[]}
        onRemove={onRemove}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tags-list')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('foreign-tag-remove'))
    expect(onRemove).toHaveBeenCalledWith('SERATO_MARKERS_V2')
  })

  it('da al botón de borrar un nombre accesible con acción y tag', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
        foreignRemoved={[]}
        onRemove={vi.fn()}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tag-remove')).toHaveAccessibleName(
      'Remove SERATO_MARKERS_V2',
    )
  })

  it('muestra tachado un tag ya en foreignRemoved', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'TRAKTOR4', value: 'y' }]}
        foreignRemoved={['TRAKTOR4']}
        onRemove={vi.fn()}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tag-row')).toHaveAttribute('data-removed', 'true')
  })
})
