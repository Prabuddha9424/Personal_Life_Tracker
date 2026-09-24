/** A request URL without its query string, which can carry personal data (search text, filters). */
export function pathOnly(url: string): string {
  const queryStart = url.indexOf('?')
  return queryStart === -1 ? url : url.slice(0, queryStart)
}
