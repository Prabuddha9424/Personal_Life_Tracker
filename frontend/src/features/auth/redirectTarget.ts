/** Where to go after login: the page the user was sent away from, if it is a local path. */
export function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = state.from
    if (
      typeof from === 'string' &&
      from.startsWith('/') &&
      !from.startsWith('//') &&
      !from.startsWith('/\\')
    ) {
      return from
    }
  }
  return '/'
}
