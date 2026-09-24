import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useServerStatus } from '@/shared/api/serverStatus'
import { ServerStatusBanner } from './ServerStatusBanner'

describe('ServerStatusBanner', () => {
  beforeEach(() => {
    useServerStatus.getState().setWaking(false)
  })

  it('keeps an empty polite live region present and fills it only while waking', () => {
    render(<ServerStatusBanner />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()

    act(() => useServerStatus.getState().setWaking(true))

    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent(/waking up the server/i)

    act(() => useServerStatus.getState().setWaking(false))

    expect(screen.getByRole('status')).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })
})
