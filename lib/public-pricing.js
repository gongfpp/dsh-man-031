import { readFile } from 'node:fs/promises'
export const PRICE_URL = 'https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/master/docs/provider-pricing.json'
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const good = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
// Native input/cacheRead/cacheWrite are disjoint; reasoning is already in output.
export function usageTotals(samples = [], incomplete = false) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  for (const sample of samples) for (const key of Object.keys(totals)) totals[key] += sample[key] ?? 0
  const total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  return { ...totals, total: Number.isSafeInteger(total) ? total : null, available: !incomplete && samples.length > 0 && Number.isSafeInteger(total), calls: samples.length }
}
function resolve(table, sample, currency) {
  const provider = sample.provider.toLowerCase(), model = sample.model.toLowerCase()
  const aliases = { codex: 'openai', 'openai-codex': 'openai', 'claude-code': 'anthropic', 'gemini': 'google', mimo: 'xiaomi', qwen: 'alibaba', 'zhipu': 'z-ai' }
  let key = aliases[provider] ?? provider
  let group = table.providers[key]
  // Unknown proxy routes may use a model's official reference price, never a guessed reseller price.
  if (!group) {
    key = model.startsWith('gpt-') || /^o[134](?:-|$)/.test(model) ? 'openai' : model.startsWith('claude-') ? 'anthropic' : model.startsWith('deepseek-') ? 'deepseek' : model.startsWith('mimo-') ? 'xiaomi' : model.startsWith('gemini-') ? 'google' : ''
    group = table.providers[key]
  }
  const usd = group?.models?.[model]
  const nativeCny = currency === 'CNY' && (group?.cnyModels?.[model] ?? usd?.cny)
  const entry = nativeCny || usd
  return entry && !entry.unpriced && !usd?.unpriced ? { entry, nativeCny: !!nativeCny, provider: key } : null
}
function tierFor(entry, sample, provider, holidays) {
  let row = entry
  for (const history of entry.rateHistory ?? []) if (sample.time < Date.parse(history.before)) { row = { ...entry, ...history }; break }
  if (row.peak && row.offPeak) {
    const d = new Date(sample.time), h = d.getUTCHours(), day = d.getUTCDay()
    const beijing = new Date(sample.time + 8 * 3600_000)
    const date = beijing.toISOString().slice(0, 10), bjDay = beijing.getUTCDay()
    const utcPeak = row.billingMode === 'utc-peak'
    const holiday = !utcPeak && provider === 'deepseek' && (bjDay === 0 || bjDay === 6 || holidays?.includes(date))
    const high = !holiday && (!utcPeak || (day > 0 && day < 6)) && ((h >= 1 && h < 4) || (h >= 6 && h < 10))
    row = { ...row, ...(high ? row.peak : row.offPeak) }
  }
  if (row.longContext && sample.input + sample.cacheRead + sample.cacheWrite > row.longContext.aboveInputTokens) row = { ...row, ...row.longContext }
  return row
}
export function estimate(samples, incomplete, table, currency) {
  const usage = usageTotals(samples, incomplete)
  const base = { source: 'public-pricing', scope: 'turn', includesSubagents: false, currency, usage, priceDate: table.generatedAt, fxDate: table.fx?.checkedAt }
  const unavailable = reason => ({ ...base, status: 'unknown', amount: null, reason })
  if (!usage.available) return unavailable('missing-usage')
  let amount = 0
  for (const sample of samples) {
    const resolved = resolve(table, sample, currency)
    if (!resolved) return unavailable('unpriced-model')
    const r = tierFor(resolved.entry, sample, resolved.provider, table.holidays)
    const input = r.cacheMiss ?? r.input, output = r.output, read = r.cacheHit ?? r.cachedInput ?? r.cacheRead ?? input
    const write = r.cacheWrite ?? (resolved.provider === 'deepseek' ? read : undefined)
    if (!good(input) || !good(output) || !good(read) || (sample.cacheWrite > 0 && !good(write)) || (r.reasoning ?? 0) !== 0) return unavailable('unsupported-price')
    let cost = (sample.input * input + sample.output * output + sample.cacheRead * read + sample.cacheWrite * (write ?? 0)) / 1e6
    if (currency === 'CNY' && !resolved.nativeCny) {
      if (!good(table.fx?.CNY) || table.fx.CNY === 0) return unavailable('exchange-rate-unavailable')
      cost *= table.fx.CNY
    }
    amount += cost
  }
  return Number.isFinite(amount) ? { ...base, status: 'estimated', amount } : unavailable('invalid-cost')
}
export function createPriceStore({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let table, refreshedAt = 0, pending, closed = false
  const controllers = new Set()
  async function bounded(url) {
    const c = new AbortController(); controllers.add(c)
    const timeout = setTimeout(() => c.abort(), 2500); timeout.unref?.()
    try {
      const response = await fetchImpl(url, { signal: c.signal, redirect: 'error', headers: { accept: 'application/json' } })
      if (!response.ok) { await response.body?.cancel(); throw Error('price-unavailable') }
      let text = '', bytes = 0
      const decoder = new TextDecoder('utf-8', { fatal: true })
      for await (const part of response.body) { bytes += part.byteLength; if (bytes > 1_000_000) { c.abort(); throw Error('price-too-large') }; text += decoder.decode(part, { stream: true }) }
      return JSON.parse(text + decoder.decode())
    } finally { clearTimeout(timeout); controllers.delete(c) }
  }
  function refresh() {
    if (closed || pending || now() - refreshedAt < 86400_000) return
    refreshedAt = now()
    pending = Promise.allSettled([bounded(PRICE_URL), bounded(FX_URL)]).then(([prices, fx]) => {
      if (closed) return
      const p = prices.status === 'fulfilled' ? prices.value : null
      if (p && typeof p.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.generatedAt) && p.generatedAt >= table.generatedAt && p.providers && Object.keys(p.providers).length <= 100) {
        const entries = Object.values(p.providers).flatMap(group => Object.values(group?.models ?? {}))
        if (entries.length > 0 && entries.length <= 5000 && entries.every(row => row && typeof row === 'object' && [row.input ?? row.cacheMiss ?? 0, row.output ?? 0].every(good))) table = { ...table, generatedAt: p.generatedAt, providers: { ...table.providers, ...p.providers } }
      }
      const f = fx.status === 'fulfilled' ? fx.value : null
      if (f?.result === 'success' && good(f.rates?.CNY) && f.rates.CNY >= 1 && f.rates.CNY <= 100) table = { ...table, fx: { CNY: f.rates.CNY, checkedAt: new Date(now()).toISOString().slice(0, 10), source: FX_URL } }
    }).finally(() => { pending = undefined })
  }
  return {
    async init() { table = JSON.parse(await readFile(new URL('../assets/provider-pricing.json', import.meta.url), 'utf8')) },
    quote(samples, incomplete, currency) { refresh(); return estimate(samples, incomplete, table, currency) },
    async dispose() { closed = true; for (const c of controllers) c.abort(); await pending },
  }
}
