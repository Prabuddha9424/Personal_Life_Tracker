import { useServerStatus } from '@/shared/api/serverStatus'

export function ServerStatusBanner() {
  const waking = useServerStatus((state) => state.waking)
  if (!waking) return null

  return (
    <div className="server-banner" role="status">
      Waking up the server. This can take up to a minute the first time…
    </div>
  )
}
