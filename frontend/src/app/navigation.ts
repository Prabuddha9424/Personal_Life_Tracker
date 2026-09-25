export interface NavItem {
  to: string
  label: string
}

/** Each milestone appends its own entry when its pages exist. */
export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/board', label: 'Board' },
  { to: '/finance', label: 'Finance' },
]
