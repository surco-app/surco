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
        onToggleRemove={vi.fn()}
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
        onToggleRemove={vi.fn()}
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
        onToggleRemove={vi.fn()}
        open={false}
        onToggle={onToggle}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Other metadata' }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('lista los foráneos cuando open y pide marcar uno al pulsar su botón', () => {
    const onToggleRemove = vi.fn()
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
        foreignRemoved={[]}
        onToggleRemove={onToggleRemove}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tags-list')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('foreign-tag-remove'))
    expect(onToggleRemove).toHaveBeenCalledWith('SERATO_MARKERS_V2')
  })

  it('un tag sin marcar tiene el botón "borrar"', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'SERATO_MARKERS_V2', value: 'x' }]}
        foreignRemoved={[]}
        onToggleRemove={vi.fn()}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tag-remove')).toHaveAccessibleName(
      'Remove SERATO_MARKERS_V2',
    )
  })

  it('un tag ya marcado tiene el botón "restaurar" y al pulsarlo pide desmarcar', () => {
    const onToggleRemove = vi.fn()
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'TRAKTOR4', value: 'y' }]}
        foreignRemoved={['TRAKTOR4']}
        onToggleRemove={onToggleRemove}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    // The button flips to "restore" so the user can tell it now reverts, not re-deletes.
    expect(screen.getByTestId('foreign-tag-remove')).toHaveAccessibleName('Restore TRAKTOR4')
    fireEvent.click(screen.getByTestId('foreign-tag-remove'))
    expect(onToggleRemove).toHaveBeenCalledWith('TRAKTOR4')
  })

  it('muestra tachado un tag ya en foreignRemoved', () => {
    render(
      <ForeignTagsInspector
        foreignTags={[{ name: 'TRAKTOR4', value: 'y' }]}
        foreignRemoved={['TRAKTOR4']}
        onToggleRemove={vi.fn()}
        open={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByTestId('foreign-tag-row')).toHaveAttribute('data-removed', 'true')
  })
})
