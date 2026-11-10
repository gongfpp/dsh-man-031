window.__ModuleLoader__.load({ id: 'dsh-man-031', factory: require => {
  const React = require('react')
  const { createElement: h, useState, useEffect, useRef, useSyncExternalStore } = React
  const KEY = 'man031Completion', PREF = 'man-031.preferences.v2', SEEN = 'man-031.seen.v2'
  const memorySeen = new Set()
  const defaults = { enabled: true, sound: true, volume: .85, currency: 'CNY', side: 'right' }
  function preferences(value) {
    return { enabled: value?.enabled !== false, sound: value?.sound !== false,
      volume: Number.isFinite(value?.volume) ? Math.max(0, Math.min(1, value.volume)) : defaults.volume,
      currency: value?.currency === 'USD' ? 'USD' : 'CNY', side: value?.side === 'left' ? 'left' : 'right' }
  }
  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false } }
  function seen(id) { const data = read(SEEN, {}); return memorySeen.has(id) || !!data?.[id] }
  function markSeen(id) {
    memorySeen.add(id)
    while (memorySeen.size > 500) memorySeen.delete(memorySeen.values().next().value)
    const raw = read(SEEN, {}), data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    data[id] = Date.now()
    return save(SEEN, Object.fromEntries(Object.entries(data).slice(-500)))
  }
  function fresh(event, now = Date.now()) {
    return event && Number.isSafeInteger(event.turn) && Number.isSafeInteger(event.seq) &&
      Number.isSafeInteger(event.startSeq) && event.seq > event.startSeq &&
      Number.isFinite(event.time) && Number.isFinite(event.startTime) && event.time >= event.startTime &&
      now - event.time >= -5000 && now - event.time < 30000
  }
  function formatAmount(amount) {
    if (!Number.isFinite(amount) || amount < 0 || amount >= 1e12) throw new Error('unsupported-amount')
    return amount.toFixed(amount > 0 && amount < 1e-4 ? 8 : 4).replace(/\.?0+$/, '') || '0'
  }
  function displayAmount(amount) {
    formatAmount(amount) // Validate the supported range; do not use its legacy rounding.
    const [mantissa, exponent] = String(amount).split('e-')
    return exponent ? `0.${'0'.repeat(Number(exponent) - 1)}${mantissa.replace('.', '')}` : mantissa
  }
  function billingAmount(amount) {
    const [whole, fraction = ''] = displayAmount(amount).split('.')
    // Decimal half-up, avoiding binary floating-point boundary errors.
    const digits = (fraction + '0000').slice(0, 4)
    const mills = BigInt(whole) * 1000n + BigInt(digits.slice(0, 3)) + (digits[3] >= '5' ? 1n : 0n)
    return `${mills / 1000n}.${String(mills % 1000n).padStart(3, '0')}`
  }
  function parsePreviewAmount(value) {
    const text = value.trim()
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null
    const amount = Number(text), [whole, fraction = ''] = text.split('.')
    const digits = fraction.replace(/0+$/, '')
    const normalized = (whole.replace(/^0+(?=\d)/, '') || '0') + (digits ? `.${digits}` : '')
    try { return displayAmount(amount) === normalized ? amount : null } catch { return null }
  }
  function numberTokens(amount) {
    const [whole, cents] = billingAmount(amount).split('.')
    const fraction = cents.replace(/0+$/, '')
    function group(n) {
      const result = []
      if (n >= 100) { result.push(String(Math.floor(n / 100)), 'hundred'); n %= 100 }
      if (n >= 20) { result.push(String(Math.floor(n / 10) * 10)); n %= 10 }
      if (n) result.push(String(n))
      return result
    }
    let remaining = Number(whole)
    const result = []
    for (const [scale, key] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
      const value = Math.floor(remaining / scale)
      if (value) result.push(...group(value), key)
      remaining %= scale
    }
    result.push(...group(remaining))
    if (!result.length) result.push('0')
    // The manifest's stable "dot" file key is spoken as English "point".
    if (fraction) result.push('dot', ...fraction)
    return result
  }
  // Manifest adapter: no speech synthesis and no guessed clip names.
  function getAudioPlan(manifest, amount, currency, openerKey, phraseId) {
    if (manifest?.schemaVersion !== 1 || !['candidate', 'verified'].includes(manifest.status)) throw new Error('unavailable')
    let phrase
    if (Array.isArray(manifest.phrases) && manifest.phrases.length) {
      const id = phraseId ?? manifest.phrases[0]?.id
      phrase = manifest.phrases.find(item => typeof id === 'string' && item?.id === id)
      if (!phrase || typeof phrase.prefix !== 'string' || (phrase.suffix !== undefined && typeof phrase.suffix !== 'string')) throw new Error('unavailable')
    }
    const amountKey = String(Number(billingAmount(amount)))
    const sample = manifest.amounts?.[`${currency}:${amountKey}`]
    const exact = sample && (!phrase || sample.phraseId === phrase.id) ? sample : undefined
    if (manifest.exactOnly === true && !exact) return null
    // Old whole samples remain compatible only without a phrase selection, or when
    // explicitly tagged with its matching phrase. Never reuse another sentence.
    let clips
    if (exact) clips = [exact]
    else {
      if (manifest.language !== 'en') throw new Error('unavailable')
      const unit = manifest.units ? (currency === 'USD' ? (billingAmount(amount) === '1.000' ? manifest.units.USD_SINGULAR : manifest.units.USD) : manifest.units.CNY) : currency === 'USD' ? (billingAmount(amount) === '1.000' && manifest.clips?.['singular-dollar'] ? 'singular-dollar' : manifest.clips?.dollars ? 'dollars' : 'dollar') : 'yuan'
      const keys = [phrase?.prefix ?? 'prefix', ...numberTokens(amount), unit]
      if (phrase?.suffix !== undefined) keys.push(phrase.suffix)
      clips = keys.map(key => manifest.clips?.[key])
    }
    if (exact?.fullUtterance !== true && Array.isArray(manifest.openers) && manifest.openers.length) {
      // A full utterance already contains MAN; legacy bodies still use a separate opener.
      // Pure planning/probing is deterministic; playback supplies one popup-scoped choice.
      const key = openerKey ?? manifest.openers[0]
      if (typeof key !== 'string' || !manifest.openers.includes(key)) throw new Error('unavailable')
      clips.unshift(manifest.clips?.[key])
    }
    return clips.map(clip => {
      const path = clip?.file
      if (typeof path !== 'string' || !/^(clips|amounts)\/[A-Za-z0-9_-]+(?:\.[0-9]+)?\.(mp3|wav)$/.test(path)) throw new Error('unavailable')
      return `/api/man-031/voices/${path}`
    })
  }
  function previewAmount(manifest, currency, fallback = .31) {
    const amountText = displayAmount
    if (manifest?.amounts?.[`${currency}:${amountText(fallback)}`] && getAudioPlan(manifest, fallback, currency)) return fallback
    for (const key of Object.keys(manifest?.amounts ?? {})) {
      if (!key.startsWith(`${currency}:`)) continue
      const amount = Number(key.slice(currency.length + 1))
      try {
        if (`${currency}:${amountText(amount)}` !== key) continue
        if (getAudioPlan(manifest, amount, currency)) return amount
      } catch {}
    }
    return fallback
  }
  async function json(url, signal) {
    const response = await fetch(url, { signal, cache: 'no-store' })
    if (!response.ok) throw new Error('network')
    return response.json()
  }
  function validateCost(cost, currency) {
    if (!cost || cost.currency !== currency || cost.scope !== 'turn' || cost.source !== 'cost-meter' || !['estimated', 'plan', 'unknown'].includes(cost.status)) throw new Error('network')
    if (cost.status === 'estimated') formatAmount(cost.amount)
    if (cost.status === 'plan' && cost.amount !== 0) throw new Error('network')
    return cost
  }
  function speakableCost(cost) { return cost.status === 'estimated' || (cost.status === 'plan' && cost.amount === 0) }
  const CSS = `
.man031{pointer-events:none;color:var(--dsw-alias-label-primary);font-family:inherit}
.man031-peek:where([popover]){inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;color:var(--dsw-alias-label-primary)}
.man031-peek{position:fixed;right:-24px;top:clamp(80px,28vh,260px);width:min(230px,38vw);z-index:90;pointer-events:none;animation:man031-in .45s ease-out both;filter:drop-shadow(-5px 7px 12px #0004)}
.man031-peek[data-side=left]{right:auto;left:-24px;--man031-direction:-1}.man031-peek img{display:block;width:100%;height:clamp(120px,25vh,270px);object-fit:contain;object-position:bottom right;transform:rotate(-9deg)}
.man031-peek[data-side=left] img{transform:rotate(9deg)}
.man031-line{margin:0 30px 0 5px;padding:9px 11px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);font-size:14px;font-weight:650;line-height:1.4;overflow-wrap:anywhere}
.man031-line small{display:block;margin-top:4px;font-size:11px;font-weight:400}.man031-peek[data-side=left] .man031-line{margin:0 5px 0 30px}
.man031 button,.man031 input,.man031 select{font:inherit;color:var(--dsw-alias-label-primary);accent-color:var(--dsw-alias-brand-primary)}.man031 button,.man031 select{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 8px}.man031-close,.man031-retry{pointer-events:auto;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:5px 8px}
.man031-close{position:absolute;right:30px;top:0}.man031-peek[data-side=left] .man031-close{right:auto;left:30px}.man031-retry{margin:6px 30px;font-size:12px}
.man031-cost-retry{position:fixed;right:12px;bottom:12px;max-width:calc(100vw - 24px);min-height:44px;pointer-events:auto;z-index:91;cursor:pointer}
.man031-settings{width:100%;max-width:520px;box-sizing:border-box;padding:16px 0;pointer-events:auto}
.man031-preview-amount{box-sizing:border-box;width:140px;padding:5px 8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px}
.man031-settings label{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;margin-bottom:12px;font-size:14px}.man031-settings input[type=range]{width:min(200px,45vw)}.man031-settings select{min-width:140px}.man031-settings button{min-height:40px;cursor:pointer}.man031-note{font-size:12px;margin-top:12px;line-height:1.5}
@keyframes man031-in{from{transform:translateX(calc(var(--man031-direction,1)*110%))}to{transform:translateX(0)}}
@media(max-width:600px){.man031-peek{width:150px;top:85px;right:-24px}.man031-peek img{height:150px}.man031-line{font-size:12px;padding:7px}.man031-line small{font-size:10px}.man031-close,.man031-retry{min-width:44px;min-height:44px}}
@media(prefers-reduced-motion:reduce){.man031-peek{animation:none}}
`
  return { name: 'man-031', inject: ['slots', 'sessions', 'uiSession', 'locale', 'layout'], apply(ctx) {
    // Both native settings and the overlay use one browser-local preference store.
    // Keep the existing storage key, so moving the controls does not reset preferences.
    let state = { prefs: preferences(read(PREF, defaults)), degraded: false }, previewHandler
    const listeners = new Set()
    const snapshot = () => state
    const publish = patch => { state = { ...state, ...patch }; for (const fn of [...listeners]) fn() }
    const storage = event => { if (event.key === PREF || event.key === null) publish({ prefs: preferences(read(PREF, defaults)) }) }
    function subscribe(fn) {
      listeners.add(fn)
      if (listeners.size === 1) window.addEventListener('storage', storage)
      return () => { listeners.delete(fn); if (!listeners.size) window.removeEventListener('storage', storage) }
    }
    function update(patch) {
      const prefs = preferences({ ...state.prefs, ...patch })
      publish({ prefs, degraded: !save(PREF, prefs) || state.degraded })
    }
    function Settings() {
      const { prefs, degraded } = useSyncExternalStore(subscribe, snapshot)
      const [amountText, setAmountText] = useState('0.31')
      const [phraseId, setPhraseId] = useState(''), [phrases, setPhrases] = useState([])
      useEffect(() => {
        const abort = new AbortController()
        void json('/api/man-031/voices/manifest.json', abort.signal).then(pack => {
          if (!abort.signal.aborted) setPhrases(Array.isArray(pack.phrases) ? pack.phrases : [])
        }).catch(() => {})
        return () => abort.abort()
      }, [])
      const amount = parsePreviewAmount(amountText)
      const locale = useSyncExternalStore(React.useCallback(fn => ctx.locale.subscribe(fn), []), React.useCallback(() => ctx.locale.getSnapshot(), []))
      const zh = /^zh/i.test(locale.active)
      return h('section', { className: 'man031 man031-settings', 'aria-label': zh ? 'Man 提醒设置' : 'Man notification settings' }, h('style', null, CSS),
        h('label', null, zh ? '启用' : 'Enabled', h('input', { type: 'checkbox', checked: prefs.enabled, onChange: e => update({ enabled: e.target.checked }) })),
        h('label', null, zh ? '语音' : 'Voice', h('input', { type: 'checkbox', checked: prefs.sound, onChange: e => update({ sound: e.target.checked }) })),
        h('label', null, zh ? '音量' : 'Volume', h('input', { type: 'range', min: 0, max: 1, step: .05, value: prefs.volume, onChange: e => update({ volume: Number(e.target.value) }) })),
        h('label', null, zh ? '币种' : 'Currency', h('select', { value: prefs.currency, onChange: e => update({ currency: e.target.value }) }, h('option', { value: 'CNY' }, zh ? '人民币（元）' : 'Chinese yuan'), h('option', { value: 'USD' }, zh ? '美元' : 'US dollar'))),
        h('label', null, zh ? '探头位置' : 'Side', h('select', { value: prefs.side, onChange: e => update({ side: e.target.value }) }, h('option', { value: 'right' }, zh ? '右' : 'Right'), h('option', { value: 'left' }, zh ? '左' : 'Left'))),
        h('label', null, zh ? '试听金额' : 'Preview amount', h('input', { className: 'man031-preview-amount', type: 'text', inputMode: 'decimal', value: amountText, 'aria-invalid': amount === null, onChange: e => setAmountText(e.target.value) })),
        h('label', null, zh ? '试听句子' : 'Preview phrase', h('select', { className: 'man031-preview-phrase', value: phraseId, onChange: e => setPhraseId(e.target.value) }, h('option', { value: '' }, zh ? '随机' : 'Random'), ...phrases.map(p => h('option', { key: p.id, value: p.id }, (zh ? p.labelZh : p.labelEn) || p.id)))),
        h('button', { disabled: amount === null, onClick: () => { if (amount !== null) previewHandler?.(amount, phraseId || undefined) } }, zh ? '试听' : 'Preview'),
        amount === null && h('div', { className: 'man031-note', role: 'status' }, zh ? '请输入有效金额，不会自动舍入或替换。' : 'Enter a valid amount. It will not be rounded or substituted.'),
        degraded && h('div', { className: 'man031-note', role: 'status' }, zh ? '此浏览器存储或锁不可用，跨窗口严格去重已降级。' : 'Storage or Locks unavailable: strict cross-window deduplication is degraded.'))
    }
    function Overlay({ usePanelInfo }) {
      const current = ctx.uiSession.adapter.current
      const selected = useSyncExternalStore(React.useCallback(fn => current.subscribe(fn), [current]), React.useCallback(() => current.getSnapshot(), [current]))
      const inConversation = usePanelInfo(info => info.activePanelId === null)
      const sessionId = inConversation ? selected?.key : undefined
      const { prefs } = useSyncExternalStore(subscribe, snapshot)
      const setDegraded = value => publish({ degraded: value })
      const [popup, setPopup] = useState(null), [error, setError] = useState(null)
      const [costRetry, setCostRetry] = useState(null)
      const popupElement = useRef(null)
      useEffect(() => {
        // A native top-layer popover keeps Preview above the Settings modal,
        // without moving or recreating React-owned DOM or changing normal alerts.
        const element = popupElement.current
        if (!popup?.preview || !element?.showPopover) return
        try { element.showPopover() } catch { return }
        return () => { try { element.hidePopover() } catch {} }
      }, [popup])
      const prefsRef = useRef(prefs), sessionRef = useRef(sessionId), popupRef = useRef(null), alive = useRef(false)
      const timer = useRef(null), ticket = useRef(0), audio = useRef(null), sources = useRef([]), playAbort = useRef(null), pending = useRef(null), cancelLoad = useRef(() => {})
      prefsRef.current = prefs; sessionRef.current = sessionId
      const locale = useSyncExternalStore(React.useCallback(fn => ctx.locale.subscribe(fn), []), React.useCallback(() => ctx.locale.getSnapshot(), []))
      const zh = /^zh/i.test(locale.active)
      function stop() {
        ticket.current++; playAbort.current?.abort(); playAbort.current = null
        for (const source of sources.current) { source.onended = null; try { source.stop() } catch {} try { source.disconnect() } catch {} }
        sources.current = []; clearTimeout(timer.current); timer.current = null
      }
      function dismiss() {
        stop(); popupRef.current?.commit?.(false); popupRef.current = null
        if (alive.current) { setPopup(null); setError(null) }
      }
      function eligible(id) {
        return alive.current && prefsRef.current.enabled && sessionRef.current === id && current.getSnapshot()?.key === id &&
          ctx.layout.panelInfo.getSnapshot().activePanelId === null && document.visibilityState === 'visible' && document.hasFocus()
      }
      function later(ms) { clearTimeout(timer.current); timer.current = setTimeout(dismiss, ms) }
      async function play(value, manual = false) {
        stop(); setError(null)
        const myTicket = ticket.current, abort = new AbortController(); playAbort.current = abort
        const valid = () => alive.current && ticket.current === myTicket && popupRef.current === value && prefsRef.current.sound && speakableCost(value.cost) && (value.preview || eligible(value.sessionId))
        try {
          const AC = window.AudioContext || window.webkitAudioContext
          if (!AC) throw new Error('decode')
          const ac = audio.current ?? (audio.current = new AC())
          if (ac.state !== 'running') {
            // resume() can remain pending until a gesture. Do not let that hide Retry.
            const resumed = ac.resume()
            if (!manual && ac.state !== 'running') { resumed.catch(() => {}); throw new Error('permission') }
            if (ac.state !== 'running') setError('permission')
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => { cleanup(); reject(new Error('permission')) }, 1600)
              const onAbort = () => { cleanup(); reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })) }
              const cleanup = () => { clearTimeout(timeout); abort.signal.removeEventListener('abort', onAbort) }
              abort.signal.addEventListener('abort', onAbort, { once: true })
              resumed.then(() => { cleanup(); resolve() }, () => { cleanup(); reject(new Error('permission')) })
            })
          }
          if (!valid()) return
          if (ac.state !== 'running') throw new Error('permission')
          const manifest = await json('/api/man-031/voices/manifest.json', abort.signal)
          if (!valid()) return
          if (manifest.status === 'candidate' && !manual) throw new Error('candidate')
          if (value.openerKey === undefined && Array.isArray(manifest.openers) && manifest.openers.length) {
            value.openerKey = manifest.openers[Math.floor(Math.random() * manifest.openers.length)]
          }
          if (value.phraseId === undefined && Array.isArray(manifest.phrases) && manifest.phrases.length) {
            value.phraseId = manifest.phrases[Math.floor(Math.random() * manifest.phrases.length)]?.id
          }
          const paths = getAudioPlan(manifest, value.cost.amount, value.cost.currency, value.openerKey, value.phraseId)
          if (!paths) throw new Error('missing-sample')
          const buffers = await Promise.all(paths.map(async path => {
            let response
            try { response = await fetch(path, { signal: abort.signal, cache: 'no-store' }) } catch (e) { if (e.name === 'AbortError') throw e; throw new Error('network') }
            if (!response.ok) throw new Error('network')
            const bytes = await response.arrayBuffer()
            try { return await ac.decodeAudioData(bytes) } catch { throw new Error('decode') }
          }))
          if (!valid()) return
          if (buffers.some(buffer => !Number.isFinite(buffer.duration) || buffer.duration <= 0)) throw new Error('decode')
          let when = ac.currentTime + .03, duration = 0
          const gain = ac.createGain(); gain.gain.value = prefsRef.current.volume; gain.connect(ac.destination)
          sources.current.push(gain)
          for (const buffer of buffers) {
            const source = ac.createBufferSource(); source.buffer = buffer; source.connect(gain)
            sources.current.push(source); source.start(when); when += buffer.duration; duration += buffer.duration
          }
          // Actual decoded duration, no speed/pitch shift. Blocked/errors never get a dismissal timer.
          setError(null); later((duration + .03) * 1000 + 1200)
        } catch (e) {
          if (valid() && e.name !== 'AbortError') { clearTimeout(timer.current); setError(['permission', 'network', 'decode', 'candidate', 'unavailable', 'missing-sample'].includes(e.message) ? e.message : 'network') }
        }
      }
      async function present(value, check) {
        dismiss()
        return new Promise(resolve => {
          let done = false
          value.commit = ok => { if (!done) { done = true; resolve(ok && check()) } }
          popupRef.current = value; setPopup(value); setError(null)
        })
      }
      useEffect(() => {
        alive.current = true
        previewHandler = preview
        return () => {
          if (previewHandler === preview) previewHandler = undefined
          alive.current = false; cancelLoad.current(); dismiss(); void audio.current?.close().catch(() => {}); audio.current = null
        }
      }, [])
      // Commit acknowledgement occurs only after React has actually rendered the popup.
      useEffect(() => { popup?.commit?.(true) }, [popup])
      useEffect(() => {
        let cancelled = false, loadTicket = 0, abort, face, unsubscribeFace = () => {}, busy = false, retryExpiry = null
        const enteredAt = Date.now(); let baselineSeq = null, lastSeq = null, baselineRunning = false
        dismiss(); pending.current = null
        function clearRetry() { clearTimeout(retryExpiry); retryExpiry = null; if (alive.current) setCostRetry(null) }
        function invalidate() { loadTicket++; abort?.abort(); busy = false; clearRetry() }
        cancelLoad.current = invalidate
        async function pump() {
          const event = pending.current
          if (cancelled || !event || busy || !sessionId || !eligible(sessionId) || !fresh(event)) return
          busy = true
          setCostRetry(value => value?.event === event ? { ...value, loading: true } : value)
          const generation = ++loadTicket, currency = prefsRef.current.currency
          abort = new AbortController()
          const valid = () => !cancelled && generation === loadTicket && pending.current === event && prefsRef.current.currency === currency && eligible(sessionId) && fresh(event)
          let cost
          try { cost = validateCost(await json(`/api/man-031/cost?sessionId=${encodeURIComponent(sessionId)}&endSeq=${event.seq}&currency=${currency}`, abort.signal), currency) }
          catch (e) {
            if (generation === loadTicket) busy = false
            if (e.name === 'AbortError' || !valid()) return
            // Transport, JSON and invalid responses are not authoritative unknown costs.
            setCostRetry({ event, loading: false, retry: () => void pump() })
            clearTimeout(retryExpiry)
            retryExpiry = setTimeout(() => { if (pending.current === event) { invalidate(); pending.current = null } }, Math.max(0, event.time + 30000 - Date.now()))
            return
          }
          if (!valid()) { if (generation === loadTicket) busy = false; return }
          clearRetry()
          const id = `${sessionId}:${event.seq}`
          let lockEntered = false
          const run = async () => {
            lockEntered = true
            // These checks are inside the cross-tab lock, after any queue wait.
            if (!valid()) return
            if (seen(id)) { pending.current = null; return }
            const value = { id, sessionId, endSeq: event.seq, cost, preview: false }
            if (!await present(value, valid) || !valid()) { if (popupRef.current === value) dismiss(); return }
            if (!markSeen(id)) setDegraded(true)
            pending.current = null
            if (speakableCost(cost) && prefsRef.current.sound) void play(value)
            else later(4200)
          }
          try {
            if (navigator.locks?.request) await navigator.locks.request('man-031.completion.v2', run)
            else { setDegraded(true); await run() }
          } catch {
            setDegraded(true)
            if (!lockEntered) await run()
          } finally { if (generation === loadTicket) busy = false }
        }
        function inspect() {
          const event = face.getSnapshot()
          if (!event || (lastSeq !== null && event.seq <= lastSeq)) return
          lastSeq = event.seq
          // A delayed first projection may be a live first turn, not necessarily history.
          // Existing baselines never replay; unknown baselines require a post-entry live start.
          const live = event.time >= enteredAt && (event.startTime >= enteredAt || baselineRunning || (baselineSeq !== null && event.seq > baselineSeq))
          if (!live || !fresh(event)) return
          invalidate(); pending.current = event; void pump()
        }
        function bind() {
          const binding = sessionId ? ctx.sessions.binding(sessionId) : undefined
          const next = binding?.session.projections.faceOf(KEY)
          if (next === face) return
          baselineRunning = binding?.session.getSnapshot().running === true
          unsubscribeFace(); face = next
          if (!face) return
          const initial = face.getSnapshot()
          baselineSeq = initial?.seq ?? (initial === null ? -1 : null)
          if (initial && initial.time < enteredAt) lastSeq = initial.seq
          unsubscribeFace = face.subscribe(inspect); inspect()
        }
        function focus() { void pump() }
        function blur() { invalidate(); if (popupRef.current) dismiss() }
        function visibility() { if (document.visibilityState === 'visible') focus(); else blur() }
        // Formal readiness channel: retained generations are published through sessions.list.
        const unsubscribeList = ctx.sessions.list.subscribe(bind)
        bind()
        window.addEventListener('focus', focus); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
        return () => {
          cancelled = true; invalidate(); unsubscribeFace(); unsubscribeList(); pending.current = null; dismiss()
          window.removeEventListener('focus', focus); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility)
        }
      }, [sessionId, prefs.currency])
      useEffect(() => {
        if (!prefs.enabled) { cancelLoad.current(); pending.current = null; dismiss() }
        if (!prefs.sound) { stop(); setError(null); if (popupRef.current) later(4200) }
      }, [prefs.enabled, prefs.sound])
      function preview(amount = .31, phraseId) {
        try { displayAmount(amount) } catch { return }
        dismiss()
        const value = { id: `preview-${Date.now()}`, preview: true, phraseId, cost: { status: 'estimated', amount, currency: prefsRef.current.currency, includesSubagents: false } }
        popupRef.current = value; setPopup(value)
        if (prefsRef.current.sound) void play(value, true); else later(4200)
      }
      const message = popup?.cost.status === 'estimated' ? (zh ? `MAN！本轮约花了${billingAmount(popup.cost.amount)}${popup.cost.currency === 'USD' ? '美元' : '元'}！` : `MAN! This round cost about ${billingAmount(popup.cost.amount)} ${popup.cost.currency === 'USD' ? (billingAmount(popup.cost.amount) === '1.000' ? 'dollar' : 'dollars') : 'yuan'}!`)
        : popup?.cost.status === 'plan' ? (zh ? `套餐无额外扣费 · 0.000${popup.cost.currency === 'USD' ? '美元' : '元'}` : `No additional plan charge · 0.000 ${popup.cost.currency === 'USD' ? 'dollars' : 'yuan'}`) : (zh ? '费用暂不可用' : 'Cost unavailable')
      const errorText = { permission: zh ? '允许播放 · 重试' : 'Allow audio · Retry', network: zh ? '音频网络失败 · 重试' : 'Audio network error · Retry', decode: zh ? '音频解码失败 · 重试' : 'Audio decode error · Retry', candidate: zh ? '候选声线 · 点击试听' : 'Candidate voice · Preview', unavailable: zh ? '声线尚未就绪 · 重试' : 'Voice unavailable · Retry', 'missing-sample': zh ? '暂无这个金额的整段语音 · 重试' : 'No full voice for this amount · Retry' }
      return h('div', { className: 'man031', 'data-plugin': 'man-031' }, h('style', null, CSS),
        popup && h('div', { ref: popupElement, popover: popup.preview ? 'manual' : undefined, className: 'man031-peek', 'data-side': prefs.side, role: 'status', 'aria-live': 'polite' },
          h('img', { src: '/api/man-031/kobe.png', alt: '', draggable: false }),
          h('div', { className: 'man031-line' }, message,
            h('small', null, popup.preview ? (zh ? '试听示例 · 非本轮费用' : 'Preview · not this turn’s cost') : popup.cost.status === 'estimated' ? (zh ? '本轮主会话 · 花费估算' : 'Main session · estimated cost') : null)),
          h('button', { className: 'man031-close', onClick: dismiss, 'aria-label': zh ? '关闭' : 'Dismiss' }, '×'),
          error && h('button', { className: 'man031-retry', onClick: () => void play(popup, true) }, errorText[error])),
        costRetry && h('button', { className: 'man031-cost-retry', onClick: costRetry.retry, disabled: costRetry.loading, 'aria-live': 'polite' }, costRetry.loading ? (zh ? '正在查询费用…' : 'Loading cost…') : (zh ? '费用查询失败 · 重试' : 'Cost request failed · Retry')))
    }
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) {
        const message = String(error?.message || 'Client unavailable').replace(/(?:Bearer\s+|sk-)[A-Za-z0-9_.-]+/gi, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 160)
        return { error: message }
      }
      render() {
        if (!this.state.error) return this.props.children
        return h('div', { 'data-man031-error': true, role: 'status', style: { position: 'fixed', bottom: 12, right: 12, maxWidth: 240, padding: 8, borderRadius: 8, zIndex: 91, pointerEvents: 'auto', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', fontSize: 12 } },
          h('div', null, 'Man · ', this.state.error), h('button', { onClick: () => this.setState({ error: null }), style: { background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '5px 8px', font: 'inherit' } }, '重试 / Retry'))
      }
    }
    const SafeOverlay = props => h(Boundary, null, h(Overlay, props))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'man-031', order: 65 }, SafeOverlay))
    // The left navigation's plugin detail page, not the built-in Settings dialog.
    const BundleSettings = ({ view }) => view === 'page' ? h(Settings) : null
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-man-031' }, BundleSettings))
  } }
} })
