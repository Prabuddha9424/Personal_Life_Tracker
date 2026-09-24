import { useToastStore } from './toast'

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : undefined}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
