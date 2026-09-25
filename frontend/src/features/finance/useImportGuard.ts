import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { pushToast } from '@/shared/ui/toast'

/**
 * Keeps the person on the page while an import is running: in-app navigation is refused with a
 * message, and closing or reloading the tab asks the browser to confirm. Both are active only
 * while `importing` is true. Needs a data router (`createBrowserRouter`).
 */
export function useImportGuard(importing: boolean): void {
  const blocker = useBlocker(importing)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    blocker.reset()
    pushToast(
      'The import is still running. Wait for it to finish before leaving this page.',
      'error',
    )
  }, [blocker])

  useEffect(() => {
    if (!importing) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [importing])
}
