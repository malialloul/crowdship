import { invokeFunction } from '../lib/errors'

export interface ShopOption {
  shop: string
  website: string
  item_title: string
  item_url: string
  price: number | null
  currency: string | null
  price_label: string | null
  image_url: string | null
  address: string | null
  maps_url: string | null
  rating: number | null
}

export interface Store {
  shop: string
  address: string | null
  website: string | null
  search_url: string | null
  maps_url: string | null
  rating: number | null
  category: string | null
}

export interface SearchResult {
  query: string
  country: string
  options: ShopOption[]
  stores: Store[]
}

export function searchProducts(q: string, country: string): Promise<SearchResult> {
  return invokeFunction<SearchResult>('product-search', { q, country })
}

/** What "Request this" hands to the new-order form. */
export interface OrderPrefill {
  url: string
  title: string
  image_url: string | null
  country: string
  price: number | null
  currency: string | null
  price_label: string | null
  shop: string
}

const COUNTRY_KEY = 'crowdship.searchCountry'

export function rememberedCountry(): string {
  try {
    return localStorage.getItem(COUNTRY_KEY) ?? 'AE'
  } catch {
    return 'AE'
  }
}

export function rememberCountry(code: string): void {
  try {
    localStorage.setItem(COUNTRY_KEY, code)
  } catch {
    // storage can be unavailable (private mode); the default still works
  }
}
