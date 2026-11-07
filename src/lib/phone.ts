export interface Country {
  iso: string
  name: string
  dial: string // without "+"
}

// Lebanon first, then where most Lebanese travelers fly in from.
export const COUNTRIES: Country[] = [
  { iso: 'LB', name: 'Lebanon', dial: '961' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966' },
  { iso: 'QA', name: 'Qatar', dial: '974' },
  { iso: 'KW', name: 'Kuwait', dial: '965' },
  { iso: 'TR', name: 'Türkiye', dial: '90' },
  { iso: 'CY', name: 'Cyprus', dial: '357' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'SE', name: 'Sweden', dial: '46' },
  { iso: 'US', name: 'United States / Canada', dial: '1' },
  { iso: 'BR', name: 'Brazil', dial: '55' },
  { iso: 'AU', name: 'Australia', dial: '61' },
  { iso: 'CI', name: "Côte d'Ivoire", dial: '225' },
  { iso: 'NG', name: 'Nigeria', dial: '234' },
  { iso: 'EG', name: 'Egypt', dial: '20' },
  { iso: 'JO', name: 'Jordan', dial: '962' },
]

// Lebanese mobiles: 03 xxx xxx, 70/71/76/78/79/81 xxx xxx (local trunk "0" dropped).
const LB_MOBILE = /^(3\d{6}|7[0-9]\d{6}|8[0-9]\d{6})$/

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string }

/**
 * Turns what the user typed into E.164 (+9613123456).
 * Accepts local Lebanese formats ("03 123 456", "70-123-456") and full
 * international numbers typed with "+" or "00" regardless of the selected country.
 */
export function toE164(input: string, dial: string): PhoneResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Enter your phone number' }

  let digits = raw.replace(/[^\d+]/g, '')
  let fullDial = dial

  if (digits.startsWith('+') || digits.startsWith('00')) {
    digits = digits.replace(/^\+|^00/, '').replace(/\D/g, '')
    const match = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => digits.startsWith(c.dial))
    if (match) {
      fullDial = match.dial
      digits = digits.slice(match.dial.length)
    } else {
      const e164 = `+${digits}`
      return /^\+[1-9]\d{7,14}$/.test(e164) ? { ok: true, e164 } : { ok: false, error: 'That number looks incomplete' }
    }
  } else {
    digits = digits.replace(/\D/g, '')
    if (digits.startsWith(dial) && digits.length > dial.length + 6) digits = digits.slice(dial.length)
  }

  digits = digits.replace(/^0+/, '')

  if (fullDial === '961' && !LB_MOBILE.test(digits)) {
    return { ok: false, error: 'Use a Lebanese mobile number, e.g. 03 123 456 or 71 123 456' }
  }

  const e164 = `+${fullDial}${digits}`
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return { ok: false, error: 'That number looks incomplete' }
  return { ok: true, e164 }
}

/** "+96171123456" → "+961 71 123 456" (Lebanon) or grouped generically. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = e164.match(/^\+961(3|\d{2})(\d{3})(\d{3})$/)
  if (m) return `+961 ${m[1]} ${m[2]} ${m[3]}`
  return e164.replace(/^(\+\d{1,3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4')
}
