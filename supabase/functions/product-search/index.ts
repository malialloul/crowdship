// Supabase Edge Function: product-search  (smart search for shoppers)
//
//   POST { q, country }  →  { options: ShopOption[], stores: Store[] }
//
// Looks the item up in the chosen country through Serper (Google results API):
// web + shopping results give direct item links, Places gives shop names,
// addresses and websites. Results are merged per shop so each option can show
// the shop, its address when known, its website and a link to the item.
//
// Secrets: SERPER_API_KEY (serper.dev). Deploy with JWT verification ON (default).

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.trim().replace(/\/$/, '') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// ---------- Countries ----------
// Google's country codes (gl) mostly match ISO, except the UK.
const COUNTRIES: Record<string, { name: string; gl: string }> = {
  AE: { name: 'United Arab Emirates', gl: 'ae' }, TR: { name: 'Turkey', gl: 'tr' }, FR: { name: 'France', gl: 'fr' },
  GB: { name: 'United Kingdom', gl: 'uk' }, US: { name: 'United States', gl: 'us' }, DE: { name: 'Germany', gl: 'de' },
  SA: { name: 'Saudi Arabia', gl: 'sa' }, QA: { name: 'Qatar', gl: 'qa' }, KW: { name: 'Kuwait', gl: 'kw' },
  CY: { name: 'Cyprus', gl: 'cy' }, IT: { name: 'Italy', gl: 'it' }, ES: { name: 'Spain', gl: 'es' },
  NL: { name: 'Netherlands', gl: 'nl' }, SE: { name: 'Sweden', gl: 'se' }, CA: { name: 'Canada', gl: 'ca' },
  BR: { name: 'Brazil', gl: 'br' }, AU: { name: 'Australia', gl: 'au' }, EG: { name: 'Egypt', gl: 'eg' },
  JO: { name: 'Jordan', gl: 'jo' }, CI: { name: "Côte d'Ivoire", gl: 'ci' }, NG: { name: 'Nigeria', gl: 'ng' },
}

// ---------- Serper ----------
interface SerperOrganic { title?: string; link?: string; snippet?: string; price?: number; currency?: string; imageUrl?: string; attributes?: Record<string, string> }
interface SerperShopping { title?: string; source?: string; link?: string; price?: string; imageUrl?: string; rating?: number }
interface SerperPlace { title?: string; address?: string; website?: string; rating?: number; ratingCount?: number; category?: string; phoneNumber?: string; cid?: string; latitude?: number; longitude?: number }

async function serper<T>(endpoint: 'search' | 'shopping' | 'places', body: Record<string, unknown>, key: string): Promise<T | null> {
  try {
    const res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[product-search] serper ${endpoint} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[product-search] serper ${endpoint} failed`, String(err))
    return null
  }
}

// ---------- Helpers ----------
// Pages that talk about a product but don't sell it.
const NOT_SHOPS = /(^|\.)(youtube|wikipedia|reddit|facebook|instagram|tiktok|x|twitter|pinterest|quora|linkedin|medium|gsmarena|techradar|theverge|cnet|tomsguide|rtings|9to5mac|macrumors|apple\.com\/newsroom|support\.apple|google|bing)\./i

function unwrapLink(link: string | undefined): string | null {
  if (!link) return null
  try {
    const u = new URL(link)
    // Google redirect wrappers → the merchant URL inside.
    if (/(^|\.)google\./.test(u.hostname)) {
      const inner = u.searchParams.get('url') ?? u.searchParams.get('q') ?? u.searchParams.get('adurl')
      if (inner && /^https?:\/\//.test(inner)) return unwrapLink(inner)
      return null // a Google page, not the shop's item page
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.toString()
  } catch {
    return null
  }
}

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
}

/** "sharafdg.com" → "sharafdg", "Sharaf DG" → "sharafdg". Used to match web shops with map listings. */
function shopKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|net|org|co|shop|store)(\.[a-z]{2})?(\/.*)?$/, '')
    .replace(/\.[a-z]{2}(\/.*)?$/, '')
    .replace(/[^a-z0-9]/g, '')
}

function prettyShop(host: string): string {
  const base = host.split('.')[0]
  return base.length <= 3 ? base.toUpperCase() : base.charAt(0).toUpperCase() + base.slice(1)
}

function parsePrice(raw: string | number | undefined): { price: number | null; currency: string | null; label: string | null } {
  if (raw == null) return { price: null, currency: null, label: null }
  if (typeof raw === 'number') return { price: raw, currency: null, label: String(raw) }
  const label = raw.trim()
  const num = Number(label.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'))
  const cur = label.match(/\b(AED|SAR|QAR|KWD|TRY|TL|EUR|GBP|USD|CAD|AUD|BRL|EGP|JOD|NGN|SEK|XOF)\b/i)?.[1]?.toUpperCase() ??
    (label.includes('$') ? 'USD' : label.includes('€') ? 'EUR' : label.includes('£') ? 'GBP' : label.includes('₺') ? 'TRY' : null)
  return { price: Number.isFinite(num) && num > 0 ? num : null, currency: cur === 'TL' ? 'TRY' : cur, label }
}

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

// Small per-instance cache so repeated searches don't spend credits.
const cache = new Map<string, { at: number; body: unknown }>()
const TTL_MS = 30 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: { q?: unknown; country?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be JSON' }, 400)
  }
  const q = typeof body.q === 'string' ? body.q.trim().replace(/\s+/g, ' ').slice(0, 120) : ''
  const code = typeof body.country === 'string' ? body.country.toUpperCase() : ''
  const country = COUNTRIES[code]
  if (q.length < 2) return json({ error: 'Type what you are looking for' }, 400)
  if (!country) return json({ error: 'Choose a country to search in' }, 400)

  const key = Deno.env.get('SERPER_API_KEY')?.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (!key) {
    return json({ error: 'Search is not set up yet: add the SERPER_API_KEY secret (Edge Functions → Secrets)', code: 'config' }, 500)
  }

  const cacheKey = `${code}|${q.toLowerCase()}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body)

  const base = { gl: country.gl, hl: 'en' }
  const [web, shopping, places] = await Promise.all([
    serper<{ organic?: SerperOrganic[] }>('search', { ...base, q: `${q} buy`, num: 20 }, key),
    serper<{ shopping?: SerperShopping[] }>('shopping', { ...base, q, num: 20 }, key),
    serper<{ places?: SerperPlace[] }>('places', { ...base, q: `${q} store`, location: country.name }, key),
  ])
  if (!web && !shopping && !places) {
    return json({ error: 'Search is unavailable right now. Try again in a minute.', code: 'upstream' }, 502)
  }

  // Map listings, keyed by shop name.
  const storeList: Store[] = (places?.places ?? [])
    .filter((p) => p.title)
    .slice(0, 12)
    .map((p) => {
      const website = unwrapLink(p.website)
      return {
        shop: p.title!,
        address: p.address ?? null,
        website,
        search_url: website ? `https://www.google.com/search?q=${encodeURIComponent(`${q} site:${hostOf(website)}`)}` : null,
        maps_url: p.cid ? `https://maps.google.com/?cid=${p.cid}` : p.latitude && p.longitude ? `https://maps.google.com/?q=${p.latitude},${p.longitude}` : null,
        rating: p.rating ?? null,
        category: p.category ?? null,
      }
    })

  function findStore(shopName: string, host: string): Store | undefined {
    const keys = [shopKey(host), shopKey(shopName)].filter((k) => k.length >= 3)
    return storeList.find((s) => {
      const sk = shopKey(s.shop)
      const wk = s.website ? shopKey(hostOf(s.website)) : ''
      return keys.some((k) => (wk !== '' && wk === k) || sk.startsWith(k) || (k.length >= 5 && sk.includes(k)))
    })
  }

  // Item links from shopping + web results, one per item URL, at most three per shop.
  const seen = new Set<string>()
  const perShop = new Map<string, number>()
  const options: ShopOption[] = []

  function add(title: string | undefined, link: string | undefined, shopName: string | undefined, rawPrice: string | number | undefined, image: string | undefined, rating?: number) {
    const url = unwrapLink(link)
    if (!url || !title) return
    const host = hostOf(url)
    if (NOT_SHOPS.test(host) || NOT_SHOPS.test(url)) return
    const dedupe = url.replace(/[?#].*$/, '')
    if (seen.has(dedupe)) return
    const shopId = shopKey(host)
    if ((perShop.get(shopId) ?? 0) >= 3) return
    seen.add(dedupe)
    perShop.set(shopId, (perShop.get(shopId) ?? 0) + 1)

    const shop = shopName?.trim() || prettyShop(host)
    const store = findStore(shop, host)
    const p = parsePrice(rawPrice)
    options.push({
      shop,
      website: `https://${new URL(url).hostname}`,
      item_title: title.slice(0, 200),
      item_url: url,
      price: p.price,
      currency: p.currency,
      price_label: p.label,
      image_url: image && image.startsWith('https://') ? image : null,
      address: store?.address ?? null,
      maps_url: store?.maps_url ?? null,
      rating: rating ?? store?.rating ?? null,
    })
  }

  for (const s of shopping?.shopping ?? []) add(s.title, s.link, s.source, s.price, s.imageUrl, s.rating)
  for (const o of web?.organic ?? []) {
    const price = o.price ?? o.attributes?.Price ?? o.attributes?.price
    add(o.title, o.link, undefined, price !== undefined ? `${price}${o.currency ? ` ${o.currency}` : ''}` : undefined, o.imageUrl)
  }

  // Shops with an item link first, then the rest of the map listings.
  const matchedStores = new Set(options.filter((o) => o.address).map((o) => o.address))
  const stores = storeList.filter((s) => !matchedStores.has(s.address))

  const result = { query: q, country: code, options: options.slice(0, 24), stores }
  cache.set(cacheKey, { at: Date.now(), body: result })
  if (cache.size > 200) cache.delete(cache.keys().next().value!)
  return json(result)
})
