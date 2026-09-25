/** Whether the browser has a real `<input type="month">`; desktop Firefox and Safari show a text field instead. */
export function supportsMonthInput(): boolean {
  const probe = document.createElement('input')
  probe.setAttribute('type', 'month')
  return probe.type === 'month'
}
