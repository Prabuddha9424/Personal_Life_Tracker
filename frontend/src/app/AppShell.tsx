import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { ThemeToggle } from '@/shared/theme/ThemeToggle'
import { navItems } from './navigation'
import './shell.css'

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="shell">
      <aside className={`shell__sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Primary">
        <div className="shell__brand">Tracker</div>
        <nav>
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
      {drawerOpen && <div className="shell__scrim" onClick={() => setDrawerOpen(false)} />}
      <div className="shell__main">
        <header className="shell__topbar">
          <button
            type="button"
            className="btn btn--ghost shell__menu"
            aria-label="Open navigation"
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
