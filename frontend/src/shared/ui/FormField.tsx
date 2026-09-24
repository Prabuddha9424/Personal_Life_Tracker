import type { ReactNode } from 'react'

interface FormFieldProps {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

/** Wraps a control in its label. Pass the input, select or textarea as children. */
export function FormField({ label, error, hint, children }: FormFieldProps) {
  return (
    <div className="field">
      <label className="field__label">
        <span>{label}</span>
        {children}
      </label>
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
