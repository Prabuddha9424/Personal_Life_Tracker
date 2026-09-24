import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react'

interface FormFieldProps {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

interface ControlAriaProps {
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/**
 * Wraps a control in its label. Pass the input, select or textarea as the only child: it is linked
 * to the error (or hint) so a screen reader announces the message together with the control.
 */
export function FormField({ label, error, hint, children }: FormFieldProps) {
  const messageId = useId()
  const message = error ?? hint
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null

  let control = children
  if (isValidElement<ControlAriaProps>(only)) {
    const describedBy = [only.props['aria-describedby'], message ? messageId : undefined]
      .filter(Boolean)
      .join(' ')
    control = cloneElement(only, {
      'aria-describedby': describedBy || undefined,
      'aria-invalid': error ? true : only.props['aria-invalid'],
    })
  }

  return (
    <div className="field">
      <label className="field__label">
        <span>{label}</span>
        {control}
      </label>
      {hint && !error && (
        <span id={messageId} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={messageId} className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
