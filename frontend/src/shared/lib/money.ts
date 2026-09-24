/** Number of digits after the decimal point in the currency's minor unit (USD 2, JPY 0, BHD 3). */
export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/**
 * Parses what a person typed into integer minor units without any floating-point arithmetic.
 * Returns null for anything ambiguous or too precise; it never rounds.
 */
export function toMinorUnits(input: string, currency: string): number | null {
  const digits = minorUnitDigits(currency)
  let text = input.trim().replace(/\s/g, '')

  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, '')
  } else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+,\d+$/.test(text)) {
    text = text.replace(',', '.')
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null

  const whole = match[1] ?? ''
  const fraction = match[2] ?? ''
  if (fraction.length > digits) return null

  const minor = Number(whole + fraction.padEnd(digits, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

/** For display and chart plotting only. Stored and transmitted amounts stay integers. */
export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** minorUnitDigits(currency)
}

export function formatMinorUnits(minor: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minorToMajor(minor, currency),
  )
}
