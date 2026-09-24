import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useServerStatus } from '@/shared/api/serverStatus'
import { ServerStatusBanner } from './ServerStatusBanner'

describe('ServerStatusBanner', () => {
  beforeEach(() => {
    useServerStatus.getState().setWaking(false)
  })

  it('appears only while the server is waking up', () => {
    render(<ServerStatusBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => useServerStatus.getState().setWaking(true))

    expect(screen.getByRole('status')).toHaveTextContent(/waking up the server/i)
  })
})
