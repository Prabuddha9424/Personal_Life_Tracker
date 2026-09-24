interface SpinnerProps {
  size?: 'sm' | 'md'
}

/** Decorative. Pair it with visible text (LoadingState) for screen readers. */
export function Spinner({ size = 'md' }: SpinnerProps) {
  return <span className={`spinner spinner--${size}`} aria-hidden="true" />
}
