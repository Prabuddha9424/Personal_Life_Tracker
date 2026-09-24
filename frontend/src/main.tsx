import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { initTheme } from '@/shared/theme/themeStore'
import './index.css'
import '@/shared/ui/ui.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

initTheme()
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
