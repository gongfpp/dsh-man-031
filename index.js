import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { createPriceStore, usageTotals } from './lib/public-pricing.js'
export const name = 'man-031'
export const inject = ['connection', 'sessionProjections', 'sessions']
export const KEY = 'man031Completion'
const boundary = z.object({ turn: z.number().int().positive(), time: z.number(), seq: z.number().int().nonnegative() })
const completion = boundary.extend({ startSeq: z.number().int().nonnegative(), startTime: z.number() })
const sampleSchema = z.object({ key: z.string(), provider: z.string(), model: z.string(), time: z.number(), input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), reasoning: z.number() })
const recordSchema = completion.extend({ samples: z.array(sampleSchema).optional(), incomplete: z.boolean().optional() })
const stateSchema = z.object({ excluded: z.boolean(), floor: z.number(), lastSeq: z.number(), active: boundary.nullable(), latest: completion.nullable(), recent: z.array(recordSchema).max(8), provider: z.string(), model: z.string(), samples: z.array(sampleSchema).max(2048), incomplete: z.boolean() })
export const initialState = (header, inheritedEventCount) => ({ excluded: header.origin === 'subagent', floor: inheritedEventCount, lastSeq: -1, active: null, latest: null, recent: [], provider: '', model: '', samples: [], incomplete: false })
export function reduce(state, event) {
  if (state.excluded || !Number.isSafeInteger(event.seq) || event.seq < state.floor || event.seq <= state.lastSeq || !Number.isFinite(event.time)) return state
  const data = event.data ?? {}
  if (event.type === 'request/context' || event.type === 'request/header') {
    const config = event.type === 'request/header' ? data.header?.config : data
    return { ...state, lastSeq: event.seq, provider: config?.provider ?? state.provider, model: config?.model ?? state.model }
  }
  if (event.type === 'assistant/message' || event.type === 'compaction/summary') {
    if (!state.active || (data.turn !== undefined && data.turn !== state.active.turn)) return state
    const u = data.usage
    if (!u || !['inputTokens', 'outputTokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0) || ['cacheReadTokens','cacheWriteTokens','reasoningTokens'].some(k => u[k] !== undefined && (!Number.isSafeInteger(u[k]) || u[k] < 0))) return { ...state, lastSeq: event.seq, incomplete: true }
    const source = data.message?.source ?? data
    const sample = { key: event.type === 'assistant/message' && Number.isSafeInteger(data.step) ? `step:${data.step}` : `${event.type}:${event.seq}`, provider: source.provider ?? state.provider, model: source.model ?? state.model, time: event.time, input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens ?? 0, cacheWrite: u.cacheWriteTokens ?? 0, reasoning: u.reasoningTokens ?? 0 }
    const samples = state.samples.filter(row => row.key !== sample.key)
    if (samples.length >= 2048) return { ...state, lastSeq: event.seq, incomplete: true }
    return { ...state, lastSeq: event.seq, samples: [...samples, sample] }
  }
  if (event.type !== 'turn/start' && event.type !== 'turn/end') return state
  const turn = data.turn
  if (!Number.isSafeInteger(turn) || turn < 1) return state
  if (event.type === 'turn/start') return { ...state, lastSeq: event.seq, active: { turn, time: event.time, seq: event.seq }, samples: [], incomplete: false }
  const active = state.active, next = { ...state, lastSeq: event.seq, active: null }
  if (!active || active.turn !== turn || event.seq <= active.seq || data.reason?.kind !== 'completed') return next
  const latest = { turn, time: event.time, seq: event.seq, startSeq: active.seq, startTime: active.time }
  return { ...next, latest, recent: [...state.recent, { ...latest, samples: state.samples, incomplete: state.incomplete }].slice(-8) }
}

const resultBase = currency => ({ currency, scope: 'turn', source: 'cost-meter', includesSubagents: false })
const unknown = (currency, reason) => ({ ...resultBase(currency), status: 'unknown', amount: null, reason })
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

// cost includes subscription-equivalent value; apiCost is the extra API-charge bucket.
// Even found:true may contain unpriced calls. Never announce that as a free turn.
export function normalizeCost(raw, currency) {
  if (!raw?.found || !Array.isArray(raw.calls) || raw.calls.length === 0) return unknown(currency, 'missing-usage')
  if (!nonnegative(raw.apiCost)) return unknown(currency, 'invalid-cost')
  if (raw.calls.some(call => !nonnegative(call.apiCost) || (call.plan !== true && call.priced !== true))) return unknown(currency, 'unpriced-usage')
  if (raw.calls.some(call => Array.isArray(call.rows) && call.rows.some(row => row.plan !== true && row.priced !== true))) return unknown(currency, 'unpriced-usage')
  const total = raw.calls.reduce((sum, call) => sum + call.apiCost, 0)
  if (Math.abs(total - raw.apiCost) > Math.max(1e-9, Math.abs(total) * 1e-9)) return unknown(currency, 'inconsistent-cost')
  const plan = raw.calls.every(call => call.plan === true)
  if (raw.calls.some(call => call.plan === true && call.apiCost !== 0)) return unknown(currency, 'inconsistent-plan')
  return { ...resultBase(currency), status: plan ? 'plan' : 'estimated', amount: raw.apiCost }
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (value, status = 200) => Response.json(value, { status, headers })
const audioPath = value => typeof value === 'string' && /^(clips|amounts)\/[A-Za-z0-9_-]+(?:\.[0-9]+)?\.(mp3|wav)$/.test(value)

export async function apply(ctx) {
  const projection = await ctx.sessionProjections.register({
    key: KEY, stateVersion: 3, stateSchema,
    init: initialState, apply: reduce,
    wire: { viewSchema: completion.nullable(), view: state => state.latest, summary: false },
  })
  const register = (path, fetch, methods = ['GET']) => ctx.effect(() => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch }))
  const serve = (path, bytes, type) => register(path, async () => new Response(bytes, { headers: { ...headers, 'content-type': type } }))
  serve('/api/man-031/kobe.png', await readFile(new URL('./assets/kobe.png', import.meta.url)), 'image/png')

  // Only files explicitly listed in the local manifest are exposed, never a directory route.
  let manifest = { schemaVersion: 1, id: 'kobe-mimo-v1', status: 'unavailable', synthetic: true, clips: {}, amounts: {}, quality: { asrVerified: false, listeningVerified: false } }
  try { manifest = JSON.parse(await readFile(new URL('./assets/voices/manifest.json', import.meta.url), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (manifest.schemaVersion !== 1 || !manifest.clips || !manifest.amounts) throw new Error('Invalid man-031 voice manifest')
  const paths = new Set([...Object.values(manifest.clips), ...Object.values(manifest.amounts)].map(clip => clip.file))
  if (paths.size > 256) throw new Error('Too many man-031 voice assets')
  let totalBytes = 0
  for (const file of paths) {
    if (!audioPath(file)) throw new Error('Invalid man-031 voice asset path')
    const bytes = await readFile(new URL(`./assets/voices/${file}`, import.meta.url))
    totalBytes += bytes.length
    if (totalBytes > 30 * 1024 * 1024) throw new Error('Man-031 voice pack exceeds 30 MiB')
    serve(`/api/man-031/voices/${file}`, bytes, file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg')
  }
  register('/api/man-031/voices/manifest.json', async () => json(manifest))

  const prices = createPriceStore(); await prices.init()
  ctx.effect(() => () => prices.dispose())
  const cache = new Map(), pending = new Map()
  let disposed = false
  ctx.effect(() => () => { disposed = true; cache.clear(); pending.clear() })
  const costHandler = async request => {
    const url = new URL(request.url)
    const id = url.searchParams.get('sessionId'), seqText = url.searchParams.get('endSeq'), currency = url.searchParams.get('currency') ?? 'CNY'
    if (!id || id.length > 512 || !/^\d{1,15}$/.test(seqText ?? '') || !['CNY', 'USD'].includes(currency)) return json({ error: 'invalid-request' }, 400)
    const endSeq = Number(seqText)
    const session = ctx.sessions.get(id)
    if (!session) return json({ error: 'session-not-open' }, 404)
    const state = projection.stateOf(session)
    const turn = state?.recent.find(item => item.seq === endSeq)
    if (!turn || state.excluded) return json({ error: 'completion-not-found' }, 404)
    const usage = usageTotals(turn.samples, turn.incomplete ?? true)
    if (url.searchParams.get('mode') === 'tokens') return json({ ...unknown(currency, 'token-mode'), source: 'native-usage', usage })
    const fallback = () => prices.quote(turn.samples ?? [], turn.incomplete ?? true, currency)
    const key = JSON.stringify([id, endSeq, currency]), cached = cache.get(key)
    if (cached && Date.now() - cached.time < 10_000) return json(cached.value)
    const meter = ctx.get('costMeter')
    if (typeof meter?.getTurnCost !== 'function') return json(fallback())
    if (!pending.has(key)) {
      if (pending.size >= 16) return json(fallback())
      const job = (async () => {
        let timer
        try {
          // Bound the response wait; a late service result is never cached or announced.
          const raw = await Promise.race([
            Promise.resolve().then(() => meter.getTurnCost(id, turn.startSeq, turn.seq, currency)),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cost-timeout')), 8_000); timer.unref?.() }),
          ])
          const normalized = normalizeCost(raw, currency)
          const value = normalized.status === 'unknown' ? fallback() : { ...normalized, usage }
          if (!disposed && value.status !== 'unknown') {
            cache.set(key, { time: Date.now(), value })
            if (cache.size > 128) cache.delete(cache.keys().next().value)
          }
          return value
        } catch { return fallback() }
        finally { clearTimeout(timer) }
      })()
      pending.set(key, job)
      void job.finally(() => { if (pending.get(key) === job) pending.delete(key) })
    }
    return json(await pending.get(key))
  }
  register('/api/man-031/cost', costHandler)

}
