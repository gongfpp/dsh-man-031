import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// Exact Theme.listTokens names, also verified against the Config-resolved theme source.
const themeTokens = new Set(['--dsw-alias-label-primary', '--dsw-alias-bg-overlay', '--dsw-alias-bg-layer-1', '--dsw-alias-border-l1', '--dsw-alias-brand-primary'])
for (const [token] of code.matchAll(/--dsw-[a-z0-9-]+/g)) assert.ok(themeTokens.has(token), `Unverified theme token ${token}`)
assert.doesNotMatch(code, /#282033|#756987|scaleX\(-1\)/, 'no dark-only surface fallback or mirrored packaging')
assert.match(code, /\.man031-close,\.man031-retry\{min-width:44px;min-height:44px\}/, 'mobile interactive targets remain accessible')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const store = initial => {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set: next => { value = next; for (const fn of [...listeners]) fn() }, listeners }
}
const manifest = status => ({ schemaVersion: 1, id: 'kobe-mimo-v1', status, language: 'en',
  clips: Object.fromEntries(['prefix', ...Array.from({ length: 20 }, (_, i) => String(i)), ...[20, 30, 40, 50, 60, 70, 80, 90].map(String), 'dot', 'hundred', 'thousand', 'million', 'billion', 'yuan', 'dollar'].map(key => [key, { file: `clips/${key}.mp3` }])) })
const withOpeners = base => ({ ...base, openers: ['man-firm', 'man-extended'], clips: { ...base.clips, 'man-firm': { file: 'clips/man-firm.mp3' }, 'man-extended': { file: 'clips/man-extended.mp3' }, 'undeclared': { file: 'clips/undeclared.mp3' } } })
const withPhrases = base => ({ ...base, phrases: [
  { id: 'round-cost', prefix: 'phrase-round-cost' }, { id: 'came-to', prefix: 'phrase-came-to' },
  { id: 'you-spent', prefix: 'phrase-you-spent', suffix: 'phrase-this-round' }, { id: 'total', prefix: 'phrase-total' }
], clips: { ...base.clips, ...Object.fromEntries(['phrase-round-cost', 'phrase-came-to', 'phrase-you-spent', 'phrase-this-round', 'phrase-total', 'phrase-undeclared'].map(key => [key, { file: `clips/${key}.mp3` }])) } })
const exactPilot = () => ({ ...withPhrases(withOpeners(manifest('verified'))), exactOnly: true,
  phrases: [{ id: 'round-cost', prefix: 'phrase-round-cost', suffix: 'phrase-this-round' }],
  amounts: { 'CNY:0.31': { file: 'amounts/body-CNY-0.31.mp3', phraseId: 'round-cost' } } })
const locks = () => {
  let tail = Promise.resolve()
  return { request(_name, fn) { const next = tail.then(fn); tail = next.catch(() => {}); return next } }
}
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
async function fixture(options = {}) {
  let now = 100000, bindingReady = options.bindingReady !== false, plugin, Component, SettingsComponent, settingsOpen = false, settingsView = 'page', root, playing = 0, closed = 0, networkFailures = options.networkFailures ?? 0, costFailures = options.costFailures ?? 0
  const current = store(options.noSession ? undefined : { key: 'a' }), panel = store({ activePanelId: null }), localeSource = store({ active: options.locale ?? 'zh-TW' })
  // Production LocaleFace is class-like: the receiver must not be detached by uSES.
  const locale = { source: localeSource, getSnapshot() { return this.source.getSnapshot() }, subscribe(fn) { return this.source.subscribe(fn) } }
  const face = store(options.initial), list = store({ byId: {} }), timers = new Map(), storage = options.storage ?? new Map(), events = new Map(), documentEvents = new Map(), requests = [], durations = [], steps = [], posts = [], gains = []
  const listeners = map => ({ addEventListener(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn) }, removeEventListener(type, fn) { map.get(type)?.delete(fn) } })
  const document = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused }, ...listeners(documentEvents) }
  const window = { ...listeners(events), __ModuleLoader__: { load(def) { plugin = def.factory(name => { assert.equal(name, 'react'); return React }) } }, AudioContext: class {
    state = options.audioState ?? 'running'; currentTime = 0; destination = {}
    resume() { steps.push('resume'); if (options.resumePending) return new Promise(() => {}); if (options.resumeBlocked) return Promise.reject(new Error('NotAllowedError')); this.state = 'running'; return Promise.resolve() }
    close() { closed++; return Promise.resolve() }
    decodeAudioData() { return options.decodeFailure ? Promise.reject(new Error('bad bytes')) : Promise.resolve(options.audioBuffer ?? { duration: .2 }) }
    createGain() { const node = { gain: {}, connect() { gains.push(node.gain.value) }, disconnect() {} }; return node }
    createBufferSource() { return { connect() {}, disconnect() {}, start() { playing++ }, stop() {} } }
  } }
  let timerId = 0
  const ctx = { window, document, navigator: { locks: options.noLocks ? undefined : (options.locks ?? locks()) }, localStorage: {
    getItem: key => { if (options.storageFailure) throw new Error('denied'); return storage.get(key) },
    setItem: (key, value) => { if (options.storageFailure) throw new Error('denied'); storage.set(key, value) }
  }, AbortController, Math: Object.assign(Object.create(Math), { random: options.deterministicRandom ?? (() => 0) }), Date: class extends Date { static now() { return now } }, setTimeout: (fn, ms) => { timers.set(++timerId, fn); durations.push(ms); return timerId }, clearTimeout: id => timers.delete(id),
  fetch: async (url, { signal, body } = {}) => {
    requests.push(url)
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (url.startsWith('/api/man-031/cost?')) {
      if (options.costDeferred) await options.costDeferred.promise
      if (costFailures-- > 0) {
        if (options.costFailure === 'http') return { ok: false }
        if (options.costFailure === 'json') return { ok: true, json: async () => { throw new SyntaxError('invalid JSON') } }
        throw new Error('cost offline')
      }
      const currency = new URL(url, 'https://fixture.invalid').searchParams.get('currency')
      return { ok: true, json: async () => ({ status: 'estimated', amount: options.amount ?? .0001, currency, scope: 'turn', source: 'cost-meter', includesSubagents: false, ...options.cost }) }
    }
    assert.equal(url.includes('/voice/'), false, 'offline playback must never access provider/config endpoints')
    if (url.endsWith('/manifest.json')) { steps.push('manifest'); if (options.manifestDeferred) await options.manifestDeferred.promise; return { ok: true, json: async () => options.manifest ?? manifest('verified') } }
    if (networkFailures-- > 0) throw new Error('offline')
    if (options.audioDeferred) await options.audioDeferred.promise
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(20) }
  }, console }
  vm.runInNewContext(code, ctx)
  plugin.apply({ locale, layout: { panelInfo: panel }, uiSession: { adapter: { current } }, sessions: { list, binding: id => bindingReady ? { session: { getSnapshot: () => ({ running: options.running === true }), projections: { faceOf: key => { assert.equal(key, 'man031Completion'); return face } } } } : undefined }, slots: {
    inject: (name, fn) => { assert.ok(['shell.overlay', 'plugins.bundle.config'].includes(name)); fn() }, register: (entry, component) => { if (entry.name === 'shell.overlay') { assert.equal(entry.id, 'man-031'); Component = component } else { assert.equal(entry.name, 'plugins.bundle.config'); assert.equal(entry.key, 'dsh-man-031'); SettingsComponent = component } }
  } })
  const Props = () => React.createElement(React.Fragment, null, React.createElement(Component, { usePanelInfo: selector => selector(React.useSyncExternalStore(panel.subscribe, panel.getSnapshot)) }), settingsOpen && React.createElement(SettingsComponent, { view: settingsView }))
  const tree = () => React.createElement(React.StrictMode, null, React.createElement(Props))
  await act(async () => { root = TestRenderer.create(tree()) })
  await flush()
  return { root, requests, posts, gains, timers, durations, steps, storage, events, documentEvents, current, panel, face, list, document,
    get playing() { return playing }, get closed() { return closed },
    text: () => JSON.stringify(root.toJSON()), popup: () => root.root.findAllByProps({ className: 'man031-peek' }),
    async event(seq, values = {}) { now += 10; await act(async () => face.set({ turn: seq, seq, startSeq: seq - 1, time: now, startTime: now - 5, ...values })); await flush() },
    async advance(ms) { now += ms; await act(async () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } }); await flush() },
    async ready() { bindingReady = true; await act(async () => list.set({ byId: { a: {} } })); await flush() },
    async emit(type) { await act(async () => { for (const fn of [...(events.get(type) ?? []), ...(documentEvents.get(type) ?? [])]) fn({ key: type }) }); await flush() },
    async openSettings(open = true, view = 'page') { settingsOpen = open; settingsView = view; await act(async () => root.update(tree())); await flush() },
    async click(className) { await act(async () => root.root.findByProps({ className }).props.onClick()); await flush() },
    async previewAmount(value) { await act(async () => root.root.findByProps({ className: 'man031-preview-amount' }).props.onChange({ target: { value } })); await flush() },
    async setting(type, value) { await act(async () => root.root.findAllByType(type)[type === 'select' ? 0 : 0].props.onChange({ target: { value } })); await flush() },
    async unmount() { await act(async () => root.unmount()); await flush(); assert.equal(face.listeners.size, 0); assert.equal(list.listeners.size, 0); assert.equal(current.listeners.size, 0); assert.equal(timers.size, 0); for (const set of [...events.values(), ...documentEvents.values()]) assert.equal(set.size, 0) }
  }
}

// Native settings tab shares existing preferences and the live overlay's preview controller.
{
  const key = 'man-031.preferences.v2'
  const storage = new Map([[key, JSON.stringify({ enabled: true, sound: true, volume: .25, currency: 'USD', side: 'left' })]])
  const pack = JSON.parse(readFileSync(new URL('../assets/voices/manifest.json', import.meta.url), 'utf8'))
  const f = await fixture({ storage, manifest: pack, noSession: true })
  assert.equal(f.root.root.findAllByProps({ className: 'man031-trigger' }).length, 0, 'no floating settings launcher')
  assert.equal(f.root.root.findAllByType('select').length, 0, 'no settings controls in the overlay')
  await f.openSettings(true, 'summary')
  assert.equal(f.root.root.findAllByType('select').length, 0, 'bundle summaries must not render configuration forms')
  await f.openSettings()
  assert.equal(f.root.root.findAllByType('select')[0].props.value, 'USD', 'existing browser preferences survive migration')
  assert.equal(f.root.root.findAllByType('select')[1].props.value, 'left')
  await f.setting('select', 'CNY')
  await act(async () => f.root.root.findByProps({ type: 'range' }).props.onChange({ target: { value: '.4' } }))
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findByType('button').props.onClick()); await flush()
  assert.equal(f.playing, 7, 'settings preview uses the selected phrase and one shared audio controller')
  assert.ok(f.gains.includes(.4), 'settings volume is applied immediately in the overlay')
  assert.equal(f.popup()[0].props['data-side'], 'left')
  await f.openSettings(false)
  assert.equal(f.popup().length, 1, 'closing the settings tab does not unmount the playback controller')
  await f.openSettings()
  assert.equal(f.root.root.findAllByType('select')[0].props.value, 'CNY')
  assert.equal(JSON.parse(storage.get(key)).volume, .4)
  await f.unmount()
}

// Each published option selects that exact local phrase, not a random or cached other sentence.
for (let i = 0; i < 10; i++) {
  const pack = JSON.parse(readFileSync(new URL('../assets/voices/manifest.json', import.meta.url), 'utf8'))
  let rolls = 0
  const f = await fixture({ manifest: pack, deterministicRandom: () => { rolls++; return 0 } })
  await f.openSettings(); await f.previewAmount('0.3105')
  const phrase = pack.phrases[i]
  const select = f.root.root.findByProps({ className: 'man031-preview-phrase' })
  assert.equal(select.findAllByType('option').length, 11)
  await act(async () => select.props.onChange({ target: { value: phrase.id } }))
  const before = f.requests.length
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findByType('button').props.onClick()); await flush()
  assert.deepEqual(f.requests.slice(before).filter(path => path.endsWith('.wav')).map(path => path.split('/').at(-1)), [phrase.prefix,'0','dot','3','1','1',pack.units.CNY,...(phrase.suffix ? [phrase.suffix] : [])].map(key => pack.clips[key].file.split('/').at(-1)))
  assert.match(f.text(), /0.311元/); assert.equal(rolls, 0)
  await f.unmount()
}
// Custom previews round to three decimal places; selecting a phrase never changes real billing.
{
  const pack = JSON.parse(readFileSync(new URL('../assets/voices/manifest.json', import.meta.url), 'utf8'))
  const f = await fixture({ manifest: pack })
  await f.openSettings()
  const button = () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findByType('button')
  for (const invalid of ['', '-1', 'abc', 'Infinity', '1000000000000', '0.1234567890123456789']) {
    await f.previewAmount(invalid)
    assert.equal(button().props.disabled, true)
    const before = f.requests.length
    await act(async () => button().props.onClick()); await flush()
    assert.equal(f.requests.length, before, 'invalid preview never fetches or plays')
  }
  await f.previewAmount('000.3100400')
  assert.equal(button().props.disabled, false)
  await act(async () => button().props.onClick()); await flush()
  assert.equal(f.playing, 7); assert.match(f.text(), /0.310元/)
  assert.ok(!f.requests.some(path => path.endsWith('CNY-0.31.wav')), 'selected preview must not use a nearby whole sample')
  await f.setting('select', 'USD'); await f.previewAmount('1.27')
  const before = f.requests.length
  await act(async () => button().props.onClick()); await flush()
  assert.match(f.text(), /1.270美元/)
  assert.deepEqual(f.requests.slice(before).filter(path => path.endsWith('.wav')).map(path => path.split('/').at(-1)), ['prefix.wav','1.wav','dot.wav','2.wav','7.wav','unit-dollars.wav','line-next.wav'])
  await f.previewAmount('0'); await act(async () => button().props.onClick()); await flush()
  assert.match(f.text(), /约花了0.000美元/)
  assert.equal(f.storage.has('man-031.seen.v2'), false)
  await f.event(2)
  assert.match(f.text(), /0.000美元/, 'real completed turn still uses its authoritative cost, not the preview input')
  await f.unmount()
}
{
  const pack = exactPilot(), f = await fixture({ manifest: pack })
  await f.openSettings(); await f.previewAmount('0.311')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findByType('button').props.onClick()); await flush()
  assert.equal(f.playing, 0); assert.match(f.text(), /0.311元/); assert.match(f.text(), /暂无这个金额/)
  assert.ok(!f.requests.some(path => path.endsWith('.mp3')), 'no automatic substitution with the available 0.31 whole sample')
  await f.unmount()
}

// Genuine React renderer: effects, dependency updates, commit, StrictMode teardown/remount.
{
  const pack = JSON.parse(readFileSync(new URL('../assets/voices/manifest.json', import.meta.url), 'utf8'))
  const f = await fixture({ amount: .31004, manifest: pack })
  await f.event(2)
  assert.equal(f.playing, 7, 'selected prefix + rounded numeric tokens + bare unit + ending, with no cloud synthesis')
  assert.match(f.text(), /0.310元/)
  assert.equal(f.requests.some(url => url.includes('/voice/')), false)
  assert.ok(f.requests.every(url => url.startsWith('/api/man-031/')))
  await f.unmount()
}
{
  const pack = JSON.parse(readFileSync(new URL('../assets/voices/manifest.json', import.meta.url), 'utf8'))
  if (pack.provider === 'doubao') {
    const f = await fixture({ amount: .31, manifest: pack })
    await f.event(2)
    assert.equal(f.playing, 7, 'published pack uses the selected template, never an unrelated whole sentence')
    assert.equal(f.requests.filter(url => url.endsWith('.wav')).length, 7)
    assert.equal(f.requests.some(url => url.endsWith('.mp3')), false, 'no legacy MiMo or static MAN mixing')
    await f.unmount()
  }
}
{
  const pack = exactPilot(); pack.amounts['CNY:0.31'].fullUtterance = true
  pack.clips = {} // No static MAN or money fragments are needed by a full utterance.
  let rolls = 0
  const f = await fixture({ amount: .31, manifest: pack, deterministicRandom: () => { rolls++; return .99 } })
  await f.event(2)
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), ['/api/man-031/voices/amounts/body-CNY-0.31.mp3'])
  assert.equal(f.playing, 1); assert.equal(rolls, 2); assert.match(f.text(), /本轮约花了0.310元/)
  assert.ok(f.durations.some(ms => Math.abs(ms - 1430) < 1), 'one complete source uses only its decoded duration and UI tail')
  await f.unmount()
}
{
  const pack = exactPilot(); pack.amounts['CNY:0.31'].fullUtterance = true
  let rolls = 0
  const f = await fixture({ amount: .31, manifest: pack, networkFailures: 1, deterministicRandom: () => { rolls++; return .99 } })
  await f.event(2); assert.match(f.text(), /音频网络失败/); assert.equal(f.playing, 0)
  await f.click('man031-retry')
  assert.equal(f.playing, 1); assert.equal(rolls, 2, 'full-utterance Retry retains the popup phrase and legacy opener selection')
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), Array(2).fill('/api/man-031/voices/amounts/body-CNY-0.31.mp3'))
  await f.unmount()
}
for (const stage of ['manifestDeferred', 'audioDeferred']) {
  const pack = exactPilot(); pack.amounts['CNY:0.31'].fullUtterance = true
  const waiting = deferred(), f = await fixture({ amount: .31, manifest: pack, [stage]: waiting })
  await f.event(2); assert.equal(f.playing, 0)
  await f.click('man031-close'); waiting.resolve(); await flush()
  assert.equal(f.playing, 0); assert.equal(f.popup().length, 0, 'late full-utterance work cannot revive a dismissed popup')
  assert.ok(f.requests.filter(path => path.endsWith('.mp3')).every(path => path.endsWith('/amounts/body-CNY-0.31.mp3')))
  await f.unmount()
}
{
  const pack = exactPilot()
  pack.amounts = { 'USD:1.27': { file: 'amounts/full-USD-1.27.mp3', phraseId: 'round-cost', fullUtterance: true } }
  pack.clips = {}
  const f = await fixture({ manifest: pack })
  await f.openSettings(); await f.setting('select', 'USD'); await f.previewAmount('1.27')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findAllByType('button').find(node => ['试听', 'Preview'].includes(node.props.children)).props.onClick()); await flush()
  assert.match(f.text(), /1.270美元/); assert.match(f.text(), /非本轮费用/)
  assert.equal(f.playing, 1)
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), ['/api/man-031/voices/amounts/full-USD-1.27.mp3'])
  assert.equal(f.storage.has('man-031.seen.v2'), false)
  await f.unmount()
}
{
  const pack = exactPilot(); pack.amounts['CNY:0.31'].fullUtterance = true
  pack.amounts['CNY:0.31'].phraseId = 'came-to'
  const f = await fixture({ amount: .31, manifest: pack })
  await f.event(2); assert.match(f.text(), /暂无这个金额的整段语音/)
  assert.equal(f.playing, 0); assert.ok(!f.requests.some(path => path.endsWith('.mp3')), 'a whole sentence flag cannot bypass phrase matching')
  await f.unmount()
}
for (const costFailure of ['network', 'http', 'json']) {
  const f = await fixture({ costFailures: 1, costFailure })
  await f.event(2)
  assert.match(f.text(), /费用查询失败 · 重试/); assert.doesNotMatch(f.text(), /费用暂不可用|本轮约花了/)
  assert.equal(f.popup().length, 0); assert.equal(f.playing, 0); assert.equal(f.storage.has('man-031.seen.v2'), false)
  assert.equal(f.requests.length, 1, 'a failed cost request must not fetch manifest/audio')
  await flush(); assert.equal(f.requests.length, 1, 'no retry polling')
  await f.click('man031-cost-retry')
  assert.equal(f.requests.filter(url => url.startsWith('/api/man-031/cost?')).length, 2)
  assert.match(f.text(), /0.000元/); assert.doesNotMatch(f.text(), /费用查询失败/)
  assert.ok(f.playing > 0); assert.ok(JSON.parse(f.storage.get('man-031.seen.v2'))['a:2'])
  await f.unmount()
}
{
  const f = await fixture({ costFailures: 1, cost: { status: 'unknown', amount: null } })
  await f.event(2); assert.equal(f.storage.has('man-031.seen.v2'), false)
  await f.click('man031-cost-retry')
  assert.match(f.text(), /费用暂不可用/); assert.doesNotMatch(f.text(), /费用查询失败/)
  assert.equal(f.playing, 0); assert.ok(JSON.parse(f.storage.get('man-031.seen.v2'))['a:2'], 'only confirmed unknown can consume the presentation')
  await f.unmount()
}
{
  const options = { cost: { status: 'not-a-cost' }, locale: 'en' }, f = await fixture(options)
  await f.event(2); assert.match(f.text(), /Cost request failed · Retry/)
  assert.equal(f.storage.has('man-031.seen.v2'), false)
  options.cost = undefined
  await f.click('man031-cost-retry'); assert.ok(f.playing > 0)
  await f.unmount()
}
{
  const f = await fixture({ costFailures: 1 })
  await f.event(2)
  f.document.focused = false; await f.emit('blur'); assert.doesNotMatch(f.text(), /费用查询失败/)
  f.document.focused = true; await f.emit('focus')
  assert.match(f.text(), /0.000元/); assert.ok(f.playing > 0, 'retained pending completion may recover on focus without losing its explicit Retry option')
  await f.unmount()
}
for (const cancellation of ['session', 'currency', 'blur', 'hidden', 'disabled', 'expiry', 'unmount']) {
  const options = { costFailures: 1 }, f = await fixture(options)
  await f.event(2)
  const wait = deferred(); options.costDeferred = wait
  const retry = f.root.root.findByProps({ className: 'man031-cost-retry' }).props.onClick
  await act(async () => { retry(); retry() }); await flush()
  assert.equal(f.requests.length, 2, 'busy state prevents duplicate Retry requests')
  assert.equal(f.root.root.findByProps({ className: 'man031-cost-retry' }).props.disabled, true)
  if (cancellation === 'session') await act(async () => f.current.set({ key: 'b' }))
  if (cancellation === 'currency') { await f.openSettings(); await f.setting('select', 'USD') }
  if (cancellation === 'blur') { f.document.focused = false; await f.emit('blur') }
  if (cancellation === 'hidden') { f.document.visibilityState = 'hidden'; await f.emit('visibilitychange') }
  if (cancellation === 'disabled') {
    await f.openSettings()
    await act(async () => f.root.root.findAllByType('input').find(input => input.props.type === 'checkbox').props.onChange({ target: { checked: false } })); await flush()
  }
  if (cancellation === 'expiry') await f.advance(30001)
  if (cancellation === 'unmount') await f.unmount()
  wait.resolve(); await flush()
  if (cancellation !== 'unmount') assert.equal(f.popup().length, 0)
  assert.equal(f.playing, 0); assert.equal(f.storage.has('man-031.seen.v2'), false, `${cancellation}: cancelled cost retry is not consumed`)
  if (cancellation !== 'unmount') {
    assert.doesNotMatch(f.text(), /费用查询失败|正在查询费用/)
    await act(async () => retry()); await flush()
    assert.equal(f.requests.filter(path => path.startsWith('/api/man-031/cost?')).length, 2, 'retired Retry handler cannot start a cancelled or expired cost request')
    await f.unmount()
  }
}
{
  const sharedLocks = locks(), storage = new Map()
  const a = await fixture({ locks: sharedLocks, storage, costFailures: 1 }), b = await fixture({ locks: sharedLocks, storage })
  await a.event(2); assert.equal(storage.has('man-031.seen.v2'), false)
  await b.event(2); assert.ok(b.playing > 0)
  await a.click('man031-cost-retry')
  assert.equal(a.popup().length, 0); assert.equal(a.playing, 0, 'recovered tab cannot replay another tab’s committed completion')
  assert.doesNotMatch(a.text(), /费用查询失败/)
  await a.unmount(); await b.unmount()
}
{
  const f = await fixture({ amount: .31, manifest: exactPilot(), deterministicRandom: () => 0 })
  await f.event(2)
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), ['/api/man-031/voices/clips/man-firm.mp3', '/api/man-031/voices/amounts/body-CNY-0.31.mp3'], 'exact-only body already contains money and quote, so only original MAN is prepended')
  assert.equal(f.playing, 2); assert.match(f.text(), /本轮约花了0.310元/)
  await f.unmount()
}
for (const scenario of ['missing', 'wrong-phrase', 'unrounded', 'plan-zero']) {
  const pack = exactPilot()
  if (scenario === 'missing') pack.amounts = {}
  if (scenario === 'wrong-phrase') pack.amounts['CNY:0.31'].phraseId = 'came-to'
  const amount = scenario === 'unrounded' ? .3105 : .31
  const f = await fixture({ amount, manifest: pack, cost: scenario === 'plan-zero' ? { status: 'plan', amount: 0 } : undefined, deterministicRandom: () => 0 })
  await f.event(2)
  assert.equal(f.playing, 0); assert.ok(!f.requests.some(path => path.endsWith('.mp3')), `${scenario}: exactOnly never fetches even available fragment clips`)
  assert.match(f.text(), /暂无这个金额的整段语音/); assert.equal(f.timers.size, 0, 'missing body retains explicit Retry')
  if (scenario === 'unrounded') { assert.match(f.text(), /0.311元/); assert.doesNotMatch(f.text(), /0.31元/) }
  if (scenario === 'plan-zero') assert.match(f.text(), /套餐无额外扣费/)
  await f.unmount()
}
{
  const pack = exactPilot(); pack.amounts = {}
  let rolls = 0
  const f = await fixture({ amount: .31, manifest: pack, deterministicRandom: () => { rolls++; return .99 } })
  await f.event(2); assert.equal(f.playing, 0); assert.equal(rolls, 2)
  pack.amounts['CNY:0.31'] = { file: 'amounts/body-CNY-0.31.mp3', phraseId: 'round-cost' }
  await f.click('man031-retry')
  assert.equal(rolls, 2, 'a later manifest retry preserves both popup-scoped selections')
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), ['/api/man-031/voices/clips/man-extended.mp3', '/api/man-031/voices/amounts/body-CNY-0.31.mp3'])
  await f.unmount()
}
for (const status of ['estimated', 'plan']) {
  const pack = exactPilot(); pack.amounts['CNY:0'] = { file: 'amounts/body-CNY-0.mp3', phraseId: 'round-cost' }
  const f = await fixture({ manifest: pack, cost: { status, amount: 0 }, deterministicRandom: () => 0 })
  await f.event(2); assert.equal(f.playing, 2); assert.ok(f.requests.includes('/api/man-031/voices/amounts/body-CNY-0.mp3'))
  await f.unmount()
}
{
  const amount = 1.234567891e-8, pack = exactPilot()
  const f = await fixture({ amount, manifest: pack, deterministicRandom: () => 0 })
  await f.event(2); assert.match(f.text(), /0.000元/); assert.equal(f.playing, 0)
  await f.unmount()
}
{
  const pack = withPhrases(withOpeners(manifest('verified')))
  pack.openers.push('man-playful'); pack.clips['man-playful'] = { file: 'clips/man-playful.mp3' }
  const values = [.999, .6, 0, .999]; let rolls = 0
  const f = await fixture({ amount: .31, manifest: pack, networkFailures: 1, deterministicRandom: () => values[rolls++] })
  await f.event(2); assert.equal(rolls, 2); assert.match(f.text(), /本轮约花了0.310元/); assert.doesNotMatch(f.text(), /It's been/)
  const expected = ['man-playful', 'phrase-you-spent', '0', 'dot', '3', '1', 'yuan', 'phrase-this-round'].map(key => `/api/man-031/voices/clips/${key}.mp3`)
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), expected, 'selected prefix replaces classic and suffix follows currency')
  const beforeRetry = f.requests.length; await f.click('man031-retry')
  assert.equal(rolls, 2, 'retry retains both opener and phrase')
  assert.deepEqual(f.requests.slice(beforeRetry).filter(path => path.endsWith('.mp3')), expected)
  const beforeNext = f.requests.length; await f.event(4)
  assert.equal(rolls, 4, 'next popup rolls both declared choices independently')
  assert.deepEqual(f.requests.slice(beforeNext).filter(path => path.endsWith('.mp3')), ['man-firm', 'phrase-total', '0', 'dot', '3', '1', 'yuan'].map(key => `/api/man-031/voices/clips/${key}.mp3`))
  assert.ok(!f.requests.some(path => path.includes('undeclared')))
  await f.unmount()
}
{
  let rolls = 0
  const pack = withPhrases(withOpeners(manifest('candidate')))
  pack.amounts = { 'USD:1.27': { file: 'amounts/USD-1.27.mp3', phraseId: 'round-cost' } }
  const f = await fixture({ manifest: pack, deterministicRandom: () => { rolls++; return .6 } })
  await f.openSettings(); await f.setting('select', 'USD'); await f.previewAmount('1.27')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findAllByType('button').find(node => ['试听', 'Preview'].includes(node.props.children)).props.onClick()); await flush()
  assert.equal(rolls, 2, 'pure amount probing does not roll opener or phrase')
  assert.match(f.text(), /1.270美元/); assert.ok(!f.requests.some(path => path.includes('/amounts/')))
  assert.ok(f.requests.includes('/api/man-031/voices/clips/phrase-you-spent.mp3')); assert.ok(f.requests.at(-1).endsWith('/phrase-this-round.mp3'))
  await f.unmount()
}
for (const status of ['plan', 'unknown']) {
  let rolls = 0
  const f = await fixture({ manifest: withPhrases(withOpeners(manifest('verified'))), cost: { status, amount: null }, deterministicRandom: () => { rolls++; return 0 } })
  await f.event(2); assert.equal(f.playing, 0); assert.equal(rolls, 0, 'unknown or invalid plan costs never select or speak spending phrases')
  assert.doesNotMatch(f.text(), /本轮约花了/); await f.unmount()
}
{
  const f = await fixture({ locale: 'en', amount: 1 })
  await f.openSettings(); await f.setting('select', 'USD'); await f.event(2)
  assert.match(f.text(), /This round cost about 1.000 dollar!/); assert.doesNotMatch(f.text(), /It's been/); await f.unmount()
}
{
  let rolls = 0
  const f = await fixture({ manifest: withOpeners(manifest('verified')), networkFailures: 1, deterministicRandom: () => ++rolls === 1 ? .999 : 0 })
  await f.event(2); assert.match(f.text(), /音频网络失败/); assert.equal(rolls, 1)
  const beforeRetry = f.requests.length
  await f.click('man031-retry')
  assert.equal(rolls, 1, 'retry must reuse the popup opener, not roll again')
  assert.ok(f.requests.slice(beforeRetry).includes('/api/man-031/voices/clips/man-extended.mp3'))
  assert.ok(!f.requests.includes('/api/man-031/voices/clips/man-firm.mp3'))
  await f.event(4)
  assert.equal(rolls, 2, 'a new popup rolls independently')
  assert.ok(f.requests.includes('/api/man-031/voices/clips/man-firm.mp3'))
  assert.ok(!f.requests.some(url => url.includes('undeclared')), 'only manifest.openers keys may be selected')
  await f.unmount()
}
{
  let rolls = 0
  const sample = withOpeners({ schemaVersion: 1, status: 'candidate', language: 'en', amounts: { 'USD:1.27': { file: 'amounts/USD-1.27.mp3' } } })
  const f = await fixture({ manifest: sample, deterministicRandom: () => { rolls++; return .999 } })
  await f.openSettings(); await f.setting('select', 'USD'); await f.previewAmount('1.27')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findAllByType('button').find(node => ['试听', 'Preview'].includes(node.props.children)).props.onClick()); await flush()
  assert.equal(rolls, 1, 'preview amount probing must not consume random choices')
  assert.match(f.text(), /1.270美元/)
  assert.ok(f.requests.includes('/api/man-031/voices/clips/man-extended.mp3')); assert.equal(f.playing, 2)
  await f.unmount()
}
for (const amount of [0, .00001, 1e-8]) {
  const f = await fixture({ amount })
  await f.event(2); assert.match(f.text(), /0.000元/); assert.ok(f.playing > 0)
  await f.unmount()
}
{
  const f = await fixture({ amount: 1e-9 })
  await f.event(2); assert.match(f.text(), /0.000元/); assert.ok(f.playing > 0, 'small positive amounts round under the approved three-decimal policy')
  await f.unmount()
}
{
  const englishSamples = { schemaVersion: 1, status: 'candidate', language: 'en', amounts: { 'CNY:0.31': { file: 'amounts/en-CNY-0.31.mp3' }, 'USD:1.27': { file: 'amounts/en-USD-1.27.mp3' } } }
  const f = await fixture({ manifest: englishSamples, audioState: 'suspended' })
  await f.openSettings(); await f.setting('select', 'USD'); await f.previewAmount('1.27')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findAllByType('button').find(node => ['试听', 'Preview'].includes(node.props.children)).props.onClick()); await flush()
  assert.ok(f.steps.indexOf('resume') >= 0 && f.steps.indexOf('resume') < f.steps.lastIndexOf('manifest'), 'manual gesture unlocks audio before playback manifest loading; settings metadata may preload earlier')
  assert.match(f.text(), /1.270美元/); assert.match(f.text(), /非本轮费用/); assert.doesNotMatch(f.text(), /0.31美元/)
  assert.ok(f.requests.some(url => url.endsWith('/amounts/en-USD-1.27.mp3')))
  assert.equal(f.playing, 1); assert.equal(f.storage.has('man-031.seen.v2'), false, 'preview does not consume any completion')
  await f.unmount()
}
{
  const f = await fixture({ manifest: { schemaVersion: 1, status: 'candidate', language: 'en', amounts: { 'CNY:0.31': { file: 'amounts/en-CNY-0.31.mp3' } } } })
  await f.openSettings(); await f.setting('select', 'USD'); await f.previewAmount('1.27')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findAllByType('button').find(node => ['试听', 'Preview'].includes(node.props.children)).props.onClick()); await flush()
  assert.match(f.text(), /1.270美元/); assert.match(f.text(), /声线尚未就绪/); assert.equal(f.playing, 0); assert.equal(f.timers.size, 0)
  await f.unmount()
}
{
  const wait = deferred(), f = await fixture({ manifestDeferred: wait, manifest: { schemaVersion: 1, status: 'candidate', language: 'en', amounts: { 'USD:1.27': { file: 'amounts/en-USD-1.27.mp3' } } } })
  await f.openSettings(); await f.setting('select', 'USD'); await f.previewAmount('1.27')
  await act(async () => f.root.root.findByProps({ className: 'man031 man031-settings' }).findAllByType('button').find(node => ['试听', 'Preview'].includes(node.props.children)).props.onClick()); await flush()
  await f.click('man031-close'); wait.resolve(); await flush()
  assert.equal(f.popup().length, 0); assert.equal(f.playing, 0, 'dismissed preview cannot reappear or play after delayed manifest')
  await f.unmount()
}
{
  const f = await fixture({ noSession: true })
  assert.equal(f.popup().length, 0); assert.equal(f.root.root.findAllByType('button').length, 0, 'no floating controls without a notification')
  await f.openSettings(); assert.match(f.text(), /人民币/)
  await f.unmount()
}
{
  const f = await fixture()
  await f.event(2)
  assert.equal(f.popup().length, 1, 'first live turn must not be swallowed by undefined baseline')
  assert.match(f.text(), /0.000元/)
  assert.ok(f.playing > 0)
  assert.ok(f.durations.some(ms => Math.abs(ms - 1830) < 1), '3 rounded-zero clips x .2s + .03 + 1.2s tail')
  const played = f.playing
  await f.event(2)
  assert.equal(f.playing, played)
  await f.unmount(); assert.ok(f.closed > 0)
}
{
  const f = await fixture({ initial: { turn: 1, seq: 2, startSeq: 1, time: 99990, startTime: 99000 } })
  assert.equal(f.popup().length, 0, 'historical baseline never replays')
  await f.event(4, { startTime: 99900 }); assert.equal(f.popup().length, 1, 'completion after entry can follow an already-live start')
  await f.unmount()
}
{
  const f = await fixture({ bindingReady: false })
  await f.ready(); await f.event(2); assert.equal(f.popup().length, 1, 'observable binding readiness')
  await f.unmount()
}
{
  const f = await fixture({ cost: { status: 'unknown', amount: null } })
  await f.event(2); assert.match(f.text(), /费用暂不可用/); assert.equal(f.playing, 0); assert.doesNotMatch(f.text(), /0\.31元/)
  await f.unmount()
}
for (const currency of ['CNY', 'USD']) {
  let rolls = 0
  const f = await fixture({ manifest: withPhrases(withOpeners(manifest('verified'))), cost: { status: 'plan', amount: 0, equivalentAmount: 12, subscriptionEquivalent: 12 }, deterministicRandom: () => { rolls++; return 0 } })
  if (currency === 'USD') { await f.openSettings(); await f.setting('select', 'USD') }
  await f.event(2)
  assert.match(f.text(), /套餐无额外扣费/); assert.ok(f.text().includes(`0.000${currency === 'USD' ? '美元' : '元'}`))
  assert.doesNotMatch(f.text(), /12元|12美元|本轮约花了/)
  assert.equal(rolls, 2, 'explicit plan zero uses the same declared opener and phrase selection')
  assert.deepEqual(f.requests.filter(path => path.endsWith('.mp3')), ['man-firm', 'phrase-round-cost', '0', currency === 'USD' ? 'dollar' : 'yuan'].map(key => `/api/man-031/voices/clips/${key}.mp3`), 'only actual additional plan cost zero is spoken, never equivalent amount')
  assert.equal(f.playing, 4); assert.equal(f.requests.filter(path => path.startsWith('/api/man-031/cost?')).length, 1)
  await f.unmount()
}
for (const amount of [null, 12, NaN, undefined, '0']) {
  let rolls = 0
  const f = await fixture({ manifest: withPhrases(withOpeners(manifest('verified'))), cost: { status: 'plan', amount }, deterministicRandom: () => { rolls++; return 0 } })
  await f.event(2); assert.match(f.text(), /费用查询失败/); assert.doesNotMatch(f.text(), /套餐无额外扣费/)
  assert.equal(f.playing, 0); assert.equal(rolls, 0, 'invalid plan response stays unconfirmed without selecting or speaking a cost')
  assert.equal(f.storage.has('man-031.seen.v2'), false)
  await f.unmount()
}
{
  const wait = deferred(), f = await fixture({ costDeferred: wait })
  await f.event(2); assert.equal(f.popup().length, 0)
  await act(async () => f.current.set({ key: 'b' }))
  wait.resolve(); await flush()
  assert.equal(f.popup().length, 0); assert.equal(f.storage.has('man-031.seen.v2'), false, 'cancelled load must not consume')
  await f.unmount()
}
{
  const f = await fixture()
  f.document.focused = false; await f.event(2); assert.equal(f.popup().length, 0)
  f.document.focused = true; await f.emit('focus'); assert.equal(f.popup().length, 1, 'pending completion resumes on focus')
  await f.unmount()
}
for (const costFailures of [0, 1]) {
  const lockWait = deferred(), customLocks = { async request(_key, fn) { await lockWait.promise; return fn() } }, f = await fixture({ locks: customLocks, costFailures })
  await f.event(2)
  if (costFailures) await f.click('man031-cost-retry')
  f.document.focused = false; lockWait.resolve(); await flush()
  assert.equal(f.popup().length, 0); assert.equal(f.storage.has('man-031.seen.v2'), false, 'lock callback must recheck focus')
  await f.unmount()
}
{
  const f = await fixture({ networkFailures: 1 })
  await f.event(2); assert.match(f.text(), /音频网络失败/); assert.equal(f.timers.size, 0, 'failed playback retains Retry indefinitely')
  const attempts = f.requests.length
  await f.click('man031-retry'); assert.ok(f.requests.length > attempts, 'retry refetches failed audio'); assert.ok(f.playing > 0)
  await f.unmount()
}
{
  const f = await fixture({ decodeFailure: true })
  await f.event(2); assert.match(f.text(), /音频解码失败/); assert.equal(f.timers.size, 0)
  await f.unmount()
}
{
  const f = await fixture({ resumeBlocked: true, audioState: 'suspended' })
  await f.event(2); assert.match(f.text(), /允许播放/); assert.equal(f.timers.size, 0)
  await f.unmount()
}
{
  const f = await fixture({ manifest: manifest('candidate') })
  await f.event(2); assert.equal(f.playing, 0); assert.match(f.text(), /候选声线/)
  await f.click('man031-retry'); assert.ok(f.playing > 0, 'candidate may play only after explicit preview click')
  await f.unmount()
}
{
  const f = await fixture({ manifest: { schemaVersion: 1, status: 'unavailable' } })
  await f.event(2); assert.equal(f.playing, 0); assert.match(f.text(), /声线尚未就绪/); assert.equal(f.timers.size, 0)
  await f.unmount()
}
{
  const f = await fixture({ locks: { request() { return Promise.reject(new Error('denied')) } } })
  await f.event(2); assert.equal(f.popup().length, 1, 'Lock API failure explicitly degrades rather than silently dropping the notification')
  await f.openSettings(); assert.match(f.text(), /严格去重已降级/)
  await f.unmount()
}
{
  const f = await fixture({ noLocks: true, storageFailure: true })
  await f.event(2); await f.openSettings(); assert.match(f.text(), /严格去重已降级/)
  await f.unmount()
}
{
  const f = await fixture({ amount: 0 })
  await f.openSettings(); await f.setting('select', 'USD')
  await f.event(2); assert.match(f.text(), /0.000美元/); assert.ok(f.requests.some(url => url.includes('currency=USD'))); assert.ok(f.requests.some(url => url.endsWith('/dollar.mp3')))
  await f.unmount()
}
{
  const f = await fixture()
  await act(async () => f.panel.set({ activePanelId: 'settings' })); await f.event(2)
  assert.equal(f.popup().length, 0, 'global panels do not announce stale retained mainView')
  await f.unmount()
}
{
  const f = await fixture({ running: true })
  await f.event(2, { startTime: 99000 }); assert.equal(f.popup().length, 1, 'undefined baseline with active running turn must not swallow first completion')
  await f.unmount()
}
{
  const f = await fixture({ audioState: 'suspended', resumePending: true })
  await f.event(2); await f.click('man031-retry')
  assert.match(f.text(), /允许播放/, 'manual pending resume retains permission feedback')
  assert.equal(f.timers.size, 1, 'resume has a bounded permission timeout')
  await act(async () => { for (const fn of [...f.timers.values()]) fn() }); await flush()
  assert.equal(f.timers.size, 0); assert.equal(f.popup().length, 1)
  await f.unmount()
}
{
  const sharedLocks = locks(), storage = new Map()
  const a = await fixture({ locks: sharedLocks, storage }), b = await fixture({ locks: sharedLocks, storage })
  await act(async () => {
    const event = { turn: 1, seq: 2, startSeq: 1, time: 100001, startTime: 100000 }
    a.face.set(event); b.face.set(event)
  }); await flush()
  assert.equal(a.popup().length + b.popup().length, 1, 'two windows share atomic commit-then-mark claim')
  await a.unmount(); await b.unmount()
}
{
  const wait = deferred(), f = await fixture({ audioDeferred: wait })
  await f.event(2); await f.click('man031-close'); wait.resolve(); await flush()
  assert.equal(f.playing, 0, 'stale async audio ticket cannot play after dismissal'); assert.equal(f.popup().length, 0)
  await f.unmount()
}
{
  const exact = { ...manifest('candidate'), language: 'zh', clips: {}, amounts: { 'CNY:0.31': { file: 'amounts/CNY-0.31.mp3' } } }
  const f = await fixture({ amount: .31, manifest: exact })
  await f.event(2); assert.equal(f.playing, 0)
  await f.click('man031-retry'); assert.equal(f.playing, 1); assert.ok(f.requests.includes('/api/man-031/voices/amounts/CNY-0.31.mp3'))
  await f.unmount()
}
{
  let internals
  const window = { __ModuleLoader__: { load(def) { def.factory(() => React) } }, test: value => { internals = value } }
  vm.runInNewContext(code.replace("  return { name: 'man-031'", "  window.test({ getAudioPlan, numberTokens, formatAmount, displayAmount, billingAmount, previewAmount, markSeen, memorySeen }); return { name: 'man-031'"), { window, Date, localStorage: { getItem: () => '{}', setItem() {} } })
  const full = exactPilot(); full.amounts['CNY:0.31'].fullUtterance = true
  const fullPath = ['/api/man-031/voices/amounts/body-CNY-0.31.mp3']
  assert.deepEqual(Array.from(internals.getAudioPlan(full, .31, 'CNY', 'man-extended', 'round-cost')), fullPath, 'MAN, prefix, amount and suffix are already inside the full utterance')
  assert.deepEqual(Array.from(internals.getAudioPlan(full, .31004, 'CNY')), fullPath)
  assert.equal(internals.getAudioPlan(full, .31, 'USD'), null)
  full.amounts['CNY:0.31'].phraseId = 'came-to'
  assert.equal(internals.getAudioPlan(full, .31, 'CNY'), null, 'fullUtterance never bypasses the selected phrase')
  assert.throws(() => internals.getAudioPlan(full, .31, 'CNY', 'man-firm', 'undeclared'), /unavailable/)
  full.amounts['CNY:0.31'].phraseId = 'round-cost'
  for (const flag of [false, 'true', 1, undefined]) {
    full.amounts['CNY:0.31'].fullUtterance = flag
    assert.deepEqual(Array.from(internals.getAudioPlan(full, .31, 'CNY')), ['/api/man-031/voices/clips/man-firm.mp3', ...fullPath], 'only the boolean true suppresses a legacy opener')
  }
  full.amounts['CNY:0.31'].fullUtterance = true
  full.clips = {}
  assert.deepEqual(Array.from(internals.getAudioPlan(full, .31, 'CNY')), fullPath, 'full speech needs no separately registered fragments')
  full.amounts['CNY:0.31'].file = '../not-allowlisted.mp3'
  assert.throws(() => internals.getAudioPlan(full, .31, 'CNY'), /unavailable/, 'fullUtterance does not bypass file allowlisting')
  const strict = exactPilot()
  assert.ok(internals.getAudioPlan(strict, .31004, 'CNY').at(-1).endsWith('/body-CNY-0.31.mp3'), 'lookup follows the same rounded amount as the caption')
  assert.equal(internals.getAudioPlan(strict, 0, 'CNY'), null, 'plan or estimated zero requires its own body')
  assert.equal(internals.getAudioPlan(strict, .31, 'USD'), null, 'no cross-currency cache fallback')
  assert.deepEqual(Array.from(internals.getAudioPlan(strict, .31, 'CNY')), ['/api/man-031/voices/clips/man-firm.mp3', '/api/man-031/voices/amounts/body-CNY-0.31.mp3'])
  strict.amounts['CNY:0.31004'] = { file: 'amounts/body-CNY-0.31004.mp3', phraseId: 'round-cost' }
  assert.ok(internals.getAudioPlan(strict, .31004, 'CNY').at(-1).endsWith('/body-CNY-0.31.mp3'))
  strict.amounts['CNY:0.3'] = { file: 'amounts/body-CNY-0.3.mp3', phraseId: 'round-cost' }
  assert.ok(internals.getAudioPlan(strict, .1 + .2, 'CNY').at(-1).endsWith('/body-CNY-0.3.mp3'))
  strict.amounts['CNY:0.31'].phraseId = 'came-to'
  assert.equal(internals.getAudioPlan(strict, .31, 'CNY'), null, 'wrong phrase never reverts to present fragments')
  assert.equal(internals.previewAmount(strict, 'CNY'), .3, 'preview probing skips null plans rather than treating them as playable')
  assert.equal(internals.displayAmount(.31004), '0.31004')
  assert.equal(internals.displayAmount(.1 + .2), '0.30000000000000004')
  assert.equal(internals.displayAmount(1.234567891e-8), '0.00000001234567891')
  assert.equal(internals.displayAmount(0), '0'); assert.equal(internals.displayAmount(1e-8), '0.00000001')
  assert.equal(internals.displayAmount(1e-9), '0.000000001')
  assert.equal(internals.formatAmount(.31004), '0.31', 'legacy planner remains compatible without exactOnly')
  for (const [value, expected] of [[.000749, '0.001'], [.3105, '0.311'], [1.2345, '1.235'], [9.9995, '10.000'], [.29, '0.290'], [0, '0.000'], [1e-12, '0.000']]) assert.equal(internals.billingAmount(value), expected)
  const cases = [
    [0, ['0']], [10, ['10']], [19, ['19']], [20, ['20']], [21, ['20', '1']], [90, ['90']],
    [100, ['1', 'hundred']], [101, ['1', 'hundred', '1']], [120.0001, ['1', 'hundred', '20']],
    [10010, ['10', 'thousand', '10']], [1000001, ['1', 'million', '1']], [1000000010, ['1', 'billion', '10']],
    [.0001, ['0']], [.00001, ['0']],
    [1e-8, ['0']]
  ]
  for (const [amount, expected] of cases) assert.deepEqual(Array.from(internals.numberTokens(amount)), expected, `English cardinal ${amount}`)
  assert.deepEqual(Array.from(internals.getAudioPlan(manifest('verified'), 21.03, 'CNY')), ['prefix', '20', '1', 'dot', '0', '3', 'yuan'].map(key => `/api/man-031/voices/clips/${key}.mp3`))
  assert.deepEqual(Array.from(internals.getAudioPlan(manifest('verified'), 0, 'USD')), ['prefix', '0', 'dollar'].map(key => `/api/man-031/voices/clips/${key}.mp3`))
  const singularPack = manifest('verified'); singularPack.clips['singular-dollar'] = { file: 'clips/singular-dollar.mp3' }
  assert.deepEqual(Array.from(internals.getAudioPlan(singularPack, 1, 'USD')), ['prefix', '1', 'singular-dollar'].map(key => `/api/man-031/voices/clips/${key}.mp3`), 'one dollar, not one dollars')
  assert.deepEqual(Array.from(internals.getAudioPlan(singularPack, 1.01, 'USD')), ['prefix', '1', 'dot', '0', '1', 'dollar'].map(key => `/api/man-031/voices/clips/${key}.mp3`))
  assert.throws(() => internals.getAudioPlan({ ...manifest('candidate'), language: 'zh' }, .31, 'CNY'), /unavailable/, 'Chinese legacy manifests never fragment-fallback')
  assert.throws(() => internals.getAudioPlan({ ...manifest('candidate'), language: undefined }, .31, 'CNY'), /unavailable/, 'unmarked legacy manifests never fragment-fallback')
  const openerPack = withOpeners(manifest('verified'))
  const tail = Array.from(internals.getAudioPlan(manifest('verified'), .31, 'CNY'))
  assert.deepEqual(Array.from(internals.getAudioPlan(openerPack, .31, 'CNY', 'man-extended')), ['/api/man-031/voices/clips/man-extended.mp3', ...tail])
  assert.deepEqual(Array.from(internals.getAudioPlan(openerPack, .31, 'CNY')), ['/api/man-031/voices/clips/man-firm.mp3', ...tail], 'pure planner defaults deterministically for preview probing')
  assert.throws(() => internals.getAudioPlan(openerPack, .31, 'CNY', 'undeclared'), /unavailable/, 'an existing clip not declared in openers cannot be selected')
  const phrasePack = withPhrases(openerPack)
  const phrasePaths = keys => keys.map(key => `/api/man-031/voices/clips/${key}.mp3`)
  assert.deepEqual(Array.from(internals.getAudioPlan(phrasePack, .31, 'CNY', 'man-extended', 'you-spent')), phrasePaths(['man-extended', 'phrase-you-spent', '0', 'dot', '3', '1', 'yuan', 'phrase-this-round']))
  assert.deepEqual(Array.from(internals.getAudioPlan(phrasePack, .31, 'CNY')), phrasePaths(['man-firm', 'phrase-round-cost', '0', 'dot', '3', '1', 'yuan']), 'default phrase is deterministic, classic prefix is not inserted')
  assert.throws(() => internals.getAudioPlan(phrasePack, .31, 'CNY', 'man-firm', 'phrase-undeclared'), /unavailable/, 'phrase clips must be selected through declared phrase IDs only')
  phrasePack.amounts = { 'CNY:0.31': { file: 'amounts/CNY-0.31.mp3', phraseId: 'you-spent' } }
  assert.deepEqual(Array.from(internals.getAudioPlan(phrasePack, .31, 'CNY', 'man-firm', 'you-spent')), ['/api/man-031/voices/clips/man-firm.mp3', '/api/man-031/voices/amounts/CNY-0.31.mp3'], 'matching whole phrase sample is not prefixed or suffixed twice')
  assert.deepEqual(Array.from(internals.getAudioPlan(phrasePack, .31, 'CNY', 'man-firm', 'came-to')), phrasePaths(['man-firm', 'phrase-came-to', '0', 'dot', '3', '1', 'yuan']), 'another phrase exact sample must fall back to the selected clips')
  delete phrasePack.amounts['CNY:0.31'].phraseId
  assert.deepEqual(Array.from(internals.getAudioPlan(phrasePack, .31, 'CNY', 'man-firm', 'total')), phrasePaths(['man-firm', 'phrase-total', '0', 'dot', '3', '1', 'yuan']), 'untagged classic whole sample cannot leak into a new phrase')
  const legacyExact = { ...manifest('verified'), amounts: { 'CNY:0.31': { file: 'amounts/CNY-0.31.mp3' } } }
  assert.ok(internals.getAudioPlan(legacyExact, .31004, 'CNY').some(path => path.includes('/amounts/')))
  const legacy = { schemaVersion: 1, status: 'candidate', amounts: { 'USD:1.27': { file: 'amounts/USD-1.27.mp3' } } }
  assert.deepEqual(Array.from(internals.getAudioPlan(legacy, 1.27, 'USD')), ['/api/man-031/voices/amounts/USD-1.27.mp3'], 'legacy whole sample without openers stays one clip')
  assert.equal(internals.formatAmount(0), '0')
  assert.equal(internals.formatAmount(.00001), '0.00001')
  assert.equal(internals.formatAmount(1e-8), '0.00000001')
  assert.equal(internals.formatAmount(1e-9), '0')
  assert.throws(() => internals.getAudioPlan({ ...manifest('verified'), amounts: { 'CNY:0.31': { file: '../secret.mp3' } } }, .31, 'CNY'))
  assert.throws(() => internals.getAudioPlan({ ...manifest('verified'), amounts: { 'CNY:0.31': { file: 'amounts/test.wav.exe' } } }, .31, 'CNY'))
  for (let i = 0; i < 600; i++) internals.markSeen(`a:${i}`)
  assert.equal(internals.memorySeen.size, 500)
}
console.log('client lifecycle: passed (real React StrictMode; first live/running/historical/readiness; costs/currencies/zero/1e-8; transient cost Retry/success/confirmed-unknown/cancellation/expiry/cross-tab; randomized declared openers/retry-stability/legacy; focus; cancelled cost/audio; cross-window once; lock recheck; retry network/decode/permission/pending resume/candidate; exact-only whole bodies/null fallback/unrounded captions; full-utterance single source/preview/retry/late cancellation/strict metadata; legacy exact clips; number tokens; bounded seen; duration; cleanup)')
