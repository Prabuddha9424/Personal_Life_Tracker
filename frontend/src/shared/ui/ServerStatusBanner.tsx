import { useServerStatus } from '@/shared/api/serverStatus'

export function ServerStatusBanner() {
  const waking = useServerStatus((state) => state.waking)

  return (
    <div role="status" aria-live="polite" className="server-banner-region">
      {waking && (
        <div className="server-banner">
          Waking up the server. This can take up to a minute the first time…
        </div>
      )}
    </div>
  )
}
