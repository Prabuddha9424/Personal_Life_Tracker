import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { ThemeToggle } from '@/shared/theme/ThemeToggle'
import { navItems } from './navigation'
import './shell.css'

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (drawerOpen) {
      navRef.current?.querySelector('a')?.focus()
    } else if (wasOpenRef.current) {
      menuButtonRef.current?.focus()
    }
    wasOpenRef.current = drawerOpen
  }, [drawerOpen])

  useEffect(() => {
    if (!drawerOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [drawerOpen])

  return (
    <div className="shell">
      <aside className={`shell__sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Primary">
        <div className="shell__brand">Tracker</div>
        <nav ref={navRef} aria-label="Main">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `shell__link${isActive ? ' is-active' : ''}`}
              onClick={() => setDrawerOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {drawerOpen && (
        <div className="shell__scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      )}
      <div className="shell__main">
        <header className="shell__topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="btn btn--ghost shell__menu"
            aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            ☰
          </button>
          <div className="shell__actions">
            <ThemeToggle />
          </div>
        </header>
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
