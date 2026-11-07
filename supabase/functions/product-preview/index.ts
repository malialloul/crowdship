// Supabase Edge Function: product-preview  (Story 2.1 · paste a shop link)
//
//   POST { url }  →  { title, image_url, price, currency, site, country }
//
// Reads the page's Open Graph / JSON-LD product data so the order form can be
// prefilled. Best effort: many shops block bots, so every field may be null
// and the shopper fills in the rest. Deploy with JWT verification ON (default).

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const MAX_BYTES = 1_500_000
const MAX_REDIRECTS = 3

// ---------- URL safety: only public http(s) hosts ----------
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (h.includes(':')) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::'
  return !h.includes('.')
}

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password || isPrivateHost(u.hostname)) return null
    return u
  } catch {
    return null
  }
}

async function fetchPage(start: URL): Promise<{ html: string; finalUrl: URL } | null> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CrowdshipPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      const nextUrl = next ? safeUrl(new URL(next, url).toString()) : null
      if (!nextUrl) return null
      url = nextUrl
      continue
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html') || !res.body) return null

    // Read at most MAX_BYTES.
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
    await reader.cancel().catch(() => undefined)
    const buf = new Uint8Array(size)
    let off = 0
    for (const c of chunks) {
      buf.set(c.subarray(0, Math.min(c.length, size - off)), off)
      off += c.length
      if (off >= size) break
    }
    return { html: new TextDecoder().decode(buf), finalUrl: url }
  }
  return null
}

// ---------- Parsing ----------
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function meta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i')
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, 'i')
    const m = html.match(re1) ?? html.match(re2)
    if (m?.[1]?.trim()) return decodeEntities(m[1])
  }
  return null
}

interface LdProduct {
  name?: string
  image?: unknown
  offers?: unknown
}

function jsonLdProduct(html: string): LdProduct | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const [, raw] of blocks) {
    try {
      const data = JSON.parse(raw.trim())
      const stack: unknown[] = [data]
      while (stack.length) {
        const node = stack.pop()
        if (Array.isArray(node)) stack.push(...node)
        else if (node && typeof node === 'object') {
          const o = node as Record<string, unknown>
          const type = o['@type']
          if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return o as LdProduct
          if (o['@graph']) stack.push(o['@graph'])
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null
}

function ldOffer(p: LdProduct | null): { price: number | null; currency: string | null } {
  let offers = p?.offers
  if (Array.isArray(offers)) offers = offers[0]
  const o = (offers ?? {}) as Record<string, unknown>
  const raw = o.price ?? o.lowPrice
  const price = raw == null ? null : Number(String(raw).replace(/[^\d.]/g, ''))
  return { price: price && Number.isFinite(price) ? price : null, currency: typeof o.priceCurrency === 'string' ? o.priceCurrency : null }
}

function ldImage(p: LdProduct | null): string | null {
  const img = p?.image
  if (typeof img === 'string') return img
  if (Array.isArray(img) && typeof img[0] === 'string') return img[0]
  if (img && typeof img === 'object' && typeof (img as { url?: unknown }).url === 'string') return (img as { url: string }).url
  return null
}

const TLD_COUNTRY: Record<string, string> = {
  ae: 'AE', sa: 'SA', qa: 'QA', kw: 'KW', tr: 'TR', cy: 'CY', fr: 'FR', de: 'DE', uk: 'GB', se: 'SE',
  au: 'AU', br: 'BR', eg: 'EG', jo: 'JO', ca: 'CA', it: 'IT', es: 'ES', nl: 'NL', be: 'BE',
}

function guessCountry(host: string): string | null {
  const h = host.toLowerCase()
  if (/(^|\.)amazon\.com$/.test(h) || /(^|\.)(ebay|walmart|bestbuy|target)\.com$/.test(h)) return 'US'
  const tld = h.split('.').pop() ?? ''
  return TLD_COUNTRY[tld] ?? null
}

function absolute(src: string | null, base: URL): string | null {
  if (!src) return null
  try {
    const u = new URL(src, base)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be JSON' }, 400)
  }
  const target = typeof body.url === 'string' ? safeUrl(body.url.trim()) : null
  if (!target) return json({ error: 'Paste a full shop link starting with https://' }, 400)

  const site = target.hostname.replace(/^www\./, '')
  const empty = { title: null, image_url: null, price: null, currency: null, site, country: guessCountry(target.hostname) }

  let page: Awaited<ReturnType<typeof fetchPage>> = null
  try {
    page = await fetchPage(target)
  } catch (err) {
    console.warn('[product-preview] fetch failed', site, String(err))
  }
  if (!page) return json({ ...empty, note: "This shop didn't share product details. Fill them in below." })

  const { html, finalUrl } = page
  const ld = jsonLdProduct(html)
  const offer = ldOffer(ld)
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]

  const title = (meta(html, 'og:title', 'twitter:title') ?? (ld?.name ? decodeEntities(ld.name) : null) ??
    (titleTag ? decodeEntities(titleTag) : null))?.slice(0, 200) ?? null
  const priceRaw = meta(html, 'product:price:amount', 'og:price:amount', 'price')
  const price = offer.price ?? (priceRaw ? Number(priceRaw.replace(/[^\d.]/g, '')) || null : null)
  const currency = (offer.currency ?? meta(html, 'product:price:currency', 'og:price:currency', 'priceCurrency'))?.toUpperCase() ?? null

  return json({
    title,
    image_url: absolute(meta(html, 'og:image:secure_url', 'og:image', 'twitter:image') ?? ldImage(ld), finalUrl),
    price,
    currency,
    site: meta(html, 'og:site_name') ?? site,
    country: guessCountry(finalUrl.hostname),
  })
})
