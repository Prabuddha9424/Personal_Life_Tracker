import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/shared/ui/toast'
import { useImportGuard } from './useImportGuard'

function Page({ initial }: { initial: boolean }) {
  const [importing, setImporting] = useState(initial)
  useImportGuard(importing)
  return (
    <>
      <Link to="/other">Leave</Link>
      <button type="button" onClick={() => setImporting((current) => !current)}>
        Toggle import
      </button>
    </>
  )
}

function setup(importing: boolean) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Page initial={importing} /> },
      { path: '/other', element: <p>Other page</p> },
    ],
    { initialEntries: ['/'] },
  )
  const view = render(<RouterProvider router={router} />)
  return { router, view }
}

const toggle = () => userEvent.click(screen.getByRole('button', { name: 'Toggle import' }))

function beforeUnload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useImportGuard', () => {
  it('lets the person leave when nothing is importing', async () => {
    const { router } = setup(false)

    await userEvent.click(screen.getByRole('link', { name: 'Leave' }))

    expect(router.state.location.pathname).toBe('/other')
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('keeps the person on the page and says why while an import is running', async () => {
    const { router } = setup(true)

    await userEvent.click(screen.getByRole('link', { name: 'Leave' }))

    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByText('Other page')).not.toBeInTheDocument()
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'error',
        message: expect.stringMatching(/import is still running/i),
      }),
    ])
  })

  it('stops blocking once the import has finished', async () => {
    const { router } = setup(true)
    await userEvent.click(screen.getByRole('link', { name: 'Leave' }))
    expect(router.state.location.pathname).toBe('/')

    await toggle()
    await userEvent.click(screen.getByRole('link', { name: 'Leave' }))

    expect(router.state.location.pathname).toBe('/other')
  })

  it('asks the browser to confirm closing or reloading the tab only while importing', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    setup(false)
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0)
    expect(beforeUnload().defaultPrevented).toBe(false)

    await toggle()
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
    expect(beforeUnload().defaultPrevented).toBe(true)

    await toggle()
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
    expect(beforeUnload().defaultPrevented).toBe(false)
  })

  it('removes the tab warning when the page goes away mid-import', () => {
    const { view } = setup(true)
    expect(beforeUnload().defaultPrevented).toBe(true)

    view.unmount()

    expect(beforeUnload().defaultPrevented).toBe(false)
  })
})
