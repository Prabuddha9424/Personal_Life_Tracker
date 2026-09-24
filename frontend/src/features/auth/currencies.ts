export interface CurrencyOption {
  code: string
  label: string
}

const names = new Intl.DisplayNames(['en'], { type: 'currency' })

export const CURRENCY_OPTIONS: CurrencyOption[] = Intl.supportedValuesOf('currency').map(
  (code) => ({
    code,
    label: `${code} – ${names.of(code) ?? code}`,
  }),
)
