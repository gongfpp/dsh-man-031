import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply, reduce, initialState, normalizeCost } from '../index.js'
const start = (turn = 2, seq = 5) => ({ type: 'turn/start', seq, time: 100, data: { turn } })
const end = (kind = 'completed', seq = 7, turn = 2) => ({ type: 'turn/end', seq, time: 123, data: { turn, reason: { kind } } })
const blank = initialState({ origin: 'main' }, 5)
assert.equal(reduce(blank, start(2, 4)), blank)
assert.equal(reduce(blank, { ...start(), type: 'assistant/message' }), blank)
assert.equal(reduce(blank, { ...start(), seq: NaN }), blank)
assert.equal(reduce(blank, { ...start(), time: NaN }), blank)
assert.equal(reduce(initialState({ origin: 'subagent' }, 0), start()).active, null)
assert.equal(reduce(blank, end()).latest, null, 'unmatched end is not a completion')
const running = reduce(blank, start())
for (const kind of ['aborted', 'error', 'interrupted', 'blocked', 'forked', 'max-tokens']) {
  const stopped = reduce(running, end(kind))
  assert.equal(stopped.latest, null); assert.equal(stopped.active, null)
}
assert.equal(reduce(running, end('completed', 7, 3)).latest, null, 'wrong turn cannot borrow a start')
const next = reduce(running, end())
assert.deepEqual(next.latest, { turn: 2, time: 123, seq: 7, startSeq: 5, startTime: 100 })
assert.equal(reduce(next, end()), next)
assert.equal(reduce(next, start(2, 6)), next)
let recent = next
for (let n = 3; n < 15; n++) recent = reduce(reduce(recent, start(n, n * 10)), end('completed', n * 10 + 2, n))
assert.equal(recent.recent.length, 8)
assert.deepEqual(recent.recent.at(-1), { ...recent.latest, samples: [], incomplete: false })

const paid = (amount = 0.0031) => ({ found: true, apiCost: amount, cost: amount, calls: [{ apiCost: amount, plan: false, priced: true, rows: [{ priced: true, plan: false }] }] })
assert.equal(normalizeCost(paid(), 'CNY').amount, 0.0031, 'do not floor sub-cent fees')
assert.equal(normalizeCost(paid(0), 'USD').status, 'estimated')
assert.equal(normalizeCost({ found: false }, 'CNY').amount, null)
assert.equal(normalizeCost({ ...paid(), calls: [] }, 'CNY').status, 'unknown')
assert.equal(normalizeCost({ ...paid(), calls: [{ apiCost: 0.0031, priced: false, plan: false }] }, 'CNY').status, 'unknown')
assert.equal(normalizeCost({ ...paid(), apiCost: NaN }, 'CNY').status, 'unknown')
assert.equal(normalizeCost({ ...paid(), apiCost: -1 }, 'CNY').status, 'unknown')
assert.equal(normalizeCost({ ...paid(), apiCost: 12 }, 'CNY').status, 'unknown')
const plan = { found: true, cost: 12, apiCost: 0, calls: [{ apiCost: 0, plan: true, priced: false, rows: [{ plan: true, priced: false }] }] }
assert.equal(normalizeCost(plan, 'CNY').status, 'plan')
assert.equal(normalizeCost(plan, 'CNY').amount, 0, 'not the subscription-equivalent 12')
assert.equal(normalizeCost({ ...plan, apiCost: 1, calls: [{ ...plan.calls[0], apiCost: 1 }] }, 'CNY').status, 'unknown')

const routes = new Map(), effects = [], calls = [], registeredTools = [], records = new Map()
let voiceService, updatedConfig, toolDisposed = 0
let definition, raw = paid(), meterAvailable = true, throwMeter = false, queryState = next, disposedRoutes = 0
const session = {}
await apply({
  sessions: { get: id => id === 'test-session' ? session : undefined },
  sessionProjections: { register: async d => { definition = d; return { stateOf: value => { assert.equal(value, session); return queryState } } } },
  fiber: { entry: { id: 'test-entry' } },
  provide: (name, service) => { assert.equal(name, 'man031Voice'); voiceService = service },
  get: key => {
    if (key === 'costMeter' && meterAvailable) return { getTurnCost: async (...args) => { calls.push(args); if (throwMeter) throw new Error('test'); return raw } }
    if (key === 'tools') return { register: tool => { registeredTools.push(tool); return () => { toolDisposed++ } } }
    if (key === 'credentials') return { readRecord: async id => records.get(id), modifyRecord: async (id, mutate) => { const record = await mutate(records.get(id)); records.set(id, record); return record } }
    if (key === 'configEditor') return { edit: async (entry, change) => { assert.equal(entry.id, 'test-entry'); updatedConfig = change({ untouched: true }) } }
  },
  connection: { fetch: { register: route => { assert.equal(routes.has(route.path), false); routes.set(route.path, route); return async () => { disposedRoutes++ } } } },
  effect: fn => effects.push(fn()),
})
assert.equal(definition.key, 'man031Completion'); assert.equal(definition.stateVersion, 3)
definition.stateSchema.parse(next); definition.wire.viewSchema.parse(next.latest)
assert.equal(definition.wire.view(next), next.latest)
const image = await routes.get('/api/man-031/kobe.png').fetch()
assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png')
assert.ok((await image.arrayBuffer()).byteLength > 500)
assert.equal(routes.has('/api/man-031/man-031.mp3'), false, 'no misleading generic fixed-amount TTS')
const manifest = await (await routes.get('/api/man-031/voices/manifest.json').fetch()).json()
assert.equal(manifest.schemaVersion, 1)
for (const clip of [...Object.values(manifest.clips), ...Object.values(manifest.amounts)]) {
  const res = await routes.get(`/api/man-031/voices/${clip.file}`).fetch()
  assert.equal(res.headers.get('content-type'), clip.file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg')
  assert.ok((await res.arrayBuffer()).byteLength > 100)
}
const cost = async query => routes.get('/api/man-031/cost').fetch(new Request(`https://local/api/man-031/cost?${query}`))
const query = 'sessionId=test-session&endSeq=7&currency='
const cny = await cost(query + 'CNY'); assert.equal(cny.headers.get('cache-control'), 'no-store')
assert.equal((await cny.json()).amount, 0.0031)
assert.deepEqual(calls[0], ['test-session', 5, 7, 'CNY'])
await cost(query + 'CNY'); assert.equal(calls.length, 1, 'brief successful result cache')
raw = paid(0.0004)
assert.equal((await (await cost(query + 'USD')).json()).amount, 0.0004)
assert.deepEqual(calls[1], ['test-session', 5, 7, 'USD'], 'currency forwarded, never hard-coded conversion')
for (const query of ['sessionId=x&endSeq=7&currency=CNY', 'sessionId=test-session&endSeq=6', 'sessionId=test-session&endSeq=7&currency=EUR', 'sessionId=test-session&endSeq=-1', 'sessionId=test-session&endSeq=1e3', 'endSeq=7']) assert.ok((await cost(query)).status >= 400)
queryState = { ...next, recent: [{ ...next.latest, seq: 8 }] }
meterAvailable = false
assert.equal((await (await cost('sessionId=test-session&endSeq=8')).json()).reason, 'missing-usage')
meterAvailable = true; raw = { found: false }
assert.equal((await (await cost('sessionId=test-session&endSeq=8')).json()).amount, null)
raw = plan
assert.equal((await (await cost('sessionId=test-session&endSeq=8')).json()).status, 'plan', 'unknown must be retryable, not cached')
throwMeter = true
assert.equal((await (await cost('sessionId=test-session&endSeq=8&currency=USD')).json()).reason, 'missing-usage')
for (const path of ['/api/man-031/voice/resolve','/api/man-031/voice/configure','/api/man-031/voice/status','/api/man-031/voice/audio']) assert.equal(routes.has(path), false, 'offline plugin exposes no provider or key endpoint')
assert.equal(registeredTools.length, 0); assert.equal(voiceService, undefined); assert.equal(records.size, 0)
await Promise.all(effects.map(fn => fn()))
assert.equal(toolDisposed, 0)
assert.equal(disposedRoutes, routes.size)
console.log('host smoke: passed (paired durable boundaries, inherited/subagent exclusion, pricing coverage, plan/API, precision, currency, routes, cache and disposal)')
