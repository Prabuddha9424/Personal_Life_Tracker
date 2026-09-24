import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as taskApi from '../api/taskApi'
import { BoardToolbar } from './BoardToolbar'

vi.mock('../api/taskApi')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
})

describe('BoardToolbar', () => {
  it('filters by the chosen tag', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={onChange} onNew={() => {}} />)
    await screen.findByRole('option', { name: 'work' })

    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), 'work')

    expect(onChange).toHaveBeenLastCalledWith({ tag: 'work' })
  })

  it('clears the tag filter but keeps the search', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <BoardToolbar filters={{ tag: 'work', q: 'milk' }} onChange={onChange} onNew={() => {}} />,
    )
    await screen.findByRole('option', { name: 'work' })

    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), '')

    expect(onChange).toHaveBeenLastCalledWith({ q: 'milk' })
  })

  it('searches when the form is submitted, keeping the tag filter', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <BoardToolbar filters={{ tag: 'home' }} onChange={onChange} onNew={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText('Search tasks'), 'milk{Enter}')

    expect(onChange).toHaveBeenLastCalledWith({ tag: 'home', q: 'milk' })
  })

  it('drops a blank search', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <BoardToolbar filters={{ q: 'milk' }} onChange={onChange} onNew={() => {}} />,
    )

    await userEvent.clear(screen.getByLabelText('Search tasks'))
    await userEvent.type(screen.getByLabelText('Search tasks'), '   {Enter}')

    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('sends no search at all for whitespace-only text', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={onChange} onNew={() => {}} />)

    await userEvent.type(screen.getByLabelText('Search tasks'), '   {Enter}')

    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('trims the search text before sending it', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={onChange} onNew={() => {}} />)

    await userEvent.type(screen.getByLabelText('Search tasks'), '  foo {Enter}')

    expect(onChange).toHaveBeenLastCalledWith({ q: 'foo' })
    expect(screen.getByLabelText('Search tasks')).toHaveValue('foo')
  })

  it('never carries a blank tag or search filter forward', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <BoardToolbar filters={{ tag: '  ', q: ' ' }} onChange={onChange} onNew={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText('Search tasks'), 'milk{Enter}')

    expect(onChange).toHaveBeenLastCalledWith({ q: 'milk' })
  })

  it('limits the search box to what the server accepts', () => {
    renderWithProviders(<BoardToolbar filters={{}} onChange={() => {}} onNew={() => {}} />)

    expect(screen.getByLabelText('Search tasks')).toHaveAttribute('maxlength', '100')
  })

  it('cuts a pasted 150-character search to 100 characters', async () => {
    const onChange = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={onChange} onNew={() => {}} />)

    await userEvent.click(screen.getByLabelText('Search tasks'))
    await userEvent.paste('x'.repeat(150))
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenLastCalledWith({ q: 'x'.repeat(100) })
  })

  it('never passes on more than 100 characters, even from a value set programmatically', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <BoardToolbar
        filters={{ q: `${'y'.repeat(99)}   z` }}
        onChange={onChange}
        onNew={() => {}}
      />,
    )
    await screen.findByRole('option', { name: 'work' })

    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), 'work')

    expect(onChange).toHaveBeenLastCalledWith({ tag: 'work', q: 'y'.repeat(99) })
  })

  it('exposes the search as a labelled landmark', () => {
    renderWithProviders(<BoardToolbar filters={{}} onChange={() => {}} onNew={() => {}} />)

    expect(screen.getByRole('search', { name: 'Board search' })).toBeInTheDocument()
  })

  it('opens the new-task dialog', async () => {
    const onNew = vi.fn()
    renderWithProviders(<BoardToolbar filters={{}} onChange={() => {}} onNew={onNew} />)

    await userEvent.click(screen.getByRole('button', { name: 'New task' }))

    expect(onNew).toHaveBeenCalledTimes(1)
  })
})
