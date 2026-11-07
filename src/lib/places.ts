export interface Origin {
  code: string
  name: string
  cities: string[]
}

// Where travelers usually fly into Beirut from.
export const ORIGINS: Origin[] = [
  { code: 'AE', name: 'United Arab Emirates', cities: ['Dubai', 'Abu Dhabi', 'Sharjah'] },
  { code: 'TR', name: 'Türkiye', cities: ['Istanbul', 'Antalya', 'Ankara'] },
  { code: 'FR', name: 'France', cities: ['Paris', 'Lyon', 'Marseille', 'Nice'] },
  { code: 'GB', name: 'United Kingdom', cities: ['London', 'Manchester'] },
  { code: 'US', name: 'United States', cities: ['New York', 'Detroit', 'Los Angeles', 'Houston', 'Miami'] },
  { code: 'DE', name: 'Germany', cities: ['Berlin', 'Frankfurt', 'Munich', 'Düsseldorf'] },
  { code: 'SA', name: 'Saudi Arabia', cities: ['Riyadh', 'Jeddah', 'Dammam'] },
  { code: 'QA', name: 'Qatar', cities: ['Doha'] },
  { code: 'KW', name: 'Kuwait', cities: ['Kuwait City'] },
  { code: 'CY', name: 'Cyprus', cities: ['Larnaca', 'Limassol', 'Paphos'] },
  { code: 'IT', name: 'Italy', cities: ['Rome', 'Milan'] },
  { code: 'ES', name: 'Spain', cities: ['Madrid', 'Barcelona'] },
  { code: 'NL', name: 'Netherlands', cities: ['Amsterdam'] },
  { code: 'SE', name: 'Sweden', cities: ['Stockholm', 'Gothenburg'] },
  { code: 'CA', name: 'Canada', cities: ['Montreal', 'Toronto', 'Ottawa'] },
  { code: 'BR', name: 'Brazil', cities: ['São Paulo', 'Rio de Janeiro'] },
  { code: 'AU', name: 'Australia', cities: ['Sydney', 'Melbourne'] },
  { code: 'EG', name: 'Egypt', cities: ['Cairo'] },
  { code: 'JO', name: 'Jordan', cities: ['Amman'] },
  { code: 'CI', name: "Côte d'Ivoire", cities: ['Abidjan'] },
  { code: 'NG', name: 'Nigeria', cities: ['Lagos', 'Abuja'] },
]

export function countryName(code: string | null | undefined): string {
  return ORIGINS.find((o) => o.code === code)?.name ?? code ?? ''
}

/** Today in Beirut as YYYY-MM-DD (for date inputs). */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date())
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  )
}
