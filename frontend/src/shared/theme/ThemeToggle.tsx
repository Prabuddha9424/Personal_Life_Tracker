import { Button } from '@/shared/ui/Button'
import { useThemeStore } from './themeStore'

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button variant="ghost" onClick={toggleTheme} aria-label={`Switch to ${next} theme`}>
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </Button>
  )
}
