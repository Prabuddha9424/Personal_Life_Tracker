import type { ReactNode } from 'react'
import '../auth.css'

interface AuthLayoutProps {
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  return (
    <main className="auth">
      <div className="auth__card card">
        <h1>{title}</h1>
        {children}
        {footer && <p className="auth__footer muted">{footer}</p>}
      </div>
    </main>
  )
}
