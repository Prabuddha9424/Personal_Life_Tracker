import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

/**
 * Reads `?token=` once and removes it from the address bar, so it does not linger in history,
 * screenshots or the Referer header. The ref guards against StrictMode running the effect twice.
 */
export function useUrlToken(): string | null {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [token] = useState(() => searchParams.get('token'))
  const cleaned = useRef(false)

  useEffect(() => {
    if (cleaned.current) return
    cleaned.current = true
    navigate({ search: '' }, { replace: true })
  }, [navigate])

  return token
}
