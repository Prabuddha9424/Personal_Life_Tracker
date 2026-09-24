import { Button } from '@/shared/ui/Button'
import { useLogout, useSessionUser } from '../api/hooks'
import '../auth.css'

export function UserMenu() {
  const user = useSessionUser()
  const { mutate: logout, isPending } = useLogout()

  if (!user) return null

  return (
    <div className="user-menu">
      <span className="muted">{user.name}</span>
      <Button variant="ghost" loading={isPending} onClick={() => logout()}>
        Log out
      </Button>
    </div>
  )
}
