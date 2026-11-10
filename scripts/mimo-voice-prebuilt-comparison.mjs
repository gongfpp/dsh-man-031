// Explicit six-request pilot only. No assets/promotion. Dry-run by default.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { englishAmountText, normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-prebuilt-comparison'), referenceSha256 = '20742b25564e131ef5ed8207f72dfbf6bcb284a573dfb7ed89b9f149db178b79'
const amounts = ['0', '0.01', '0.31', '1.27'], common = 'Speak only the supplied English text in the original reference speaker voice, natural deep register, steady relaxed confidence and conversational rhythm. Preserve reference timbre. No introduction, explanation, additional words, background music or imitation of crowd. Do not shout or change character. Read each amount accurately as written; yuan is the currency unit.'
const plans = [
  { id: 'A', kind: 'whole-notification-all-AI', texts: ["Man! That's about zero point three one yuan. Job's not finished."], amounts: ['0.31'], instruction: common + ' Say the whole notification continuously as one natural utterance, with normal sentence pauses. The complete output is synthetic, including Man and the final quote.' },
  { id: 'B', kind: 'whole-amount-main-sentences', texts: amounts.map((a) => `That's about ${englishAmountText(a)} yuan.`), amounts, instruction: common + ' Read all four complete sentences in the given order. Leave one full second of natural silence between complete sentences to permit offline splitting. Never separate words or digits within a sentence.' },
  { id: 'C', kind: 'whole-amount-segments', texts: amounts.map((a) => `${englishAmountText(a)} yuan.`), amounts, instruction: common + ' Read all four complete amount phrases in the given order. Leave one full second of natural silence between complete amount phrases to permit offline splitting. Never separate digits within an amount.' },
]
const sha = (b) => createHash('sha256').update(b).digest('hex'), save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n')
const usage = (x) => { if (!x || typeof x !== 'object') return null; const o = {}; for (const [k, v] of Object.entries(x)) if (/^[a-z_]+$/.test(k) && typeof v === 'number' && Number.isFinite(v)) o[k] = v; return o }
async function main() {
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, hardBudget: 6, tts: 3, asr: 3, callsBeforePilot: 31, referenceSha256, output: out, plans }, null, 2)); return }
  const reference = readFileSync(join(root, 'dev/voice/kobe-original-kimmel-man-what-long.mp3'))
  if (sha(reference) !== referenceSha256) throw new Error('FIXED_REFERENCE_SHA_REQUIRED')
  const secrets = { tts: loadMiMoSecret('tts'), asr: loadMiMoSecret('asr') }
  if (!secrets.tts.found || !secrets.asr.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  mkdirSync(out, { recursive: true }); if (existsSync(join(out, 'calls.json'))) throw new Error('EXISTING_LEDGER_NO_RERUN_OR_RETRY')
  const ledger = { id: 'prebuilt-ABC-v1', hardBudget: 6, perKindBudget: 3, referenceSha256, calls: [] }, report = { schemaVersion: 1, status: 'candidate', referenceSha256, priorCalls: 31, assetsModified: false, noRetries: true, quality: { listeningVerified: false, identityVerified: false }, plans: [] }
  const commit = () => { save('calls.json', ledger); save('samples.json', report) }
  async function call(kind, id, body) {
    if (ledger.calls.length >= 6 || ledger.calls.filter((r) => r.kind === kind).length >= 3 || ledger.calls.some((r) => r.id === id && r.kind === kind)) throw new Error('CALL_BUDGET_EXHAUSTED')
    const row = { index: ledger.calls.length + 1, id, kind, at: new Date().toISOString(), status: 'started', phase: 'fetch' }; ledger.calls.push(row); commit()
    try {
      const s = secrets[kind], r = await fetch(`${s.base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${s.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
      row.httpStatus = r.status; if (!r.ok) throw new Error(`HTTP_${r.status}`)
      row.phase = 'response-body'; commit(); const data = await r.json(); row.status = 'received'; row.phase = 'complete'; row.usage = usage(data.usage); commit(); return data
    } catch (e) {
      row.status = 'error'; row.error = /^HTTP_\d+$/.test(e.message) ? e.message : e.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(e.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : row.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_FETCH_FAILED'
      row.errorName = ['Error', 'TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(e.name) ? e.name : 'OtherError'
      const code = e.cause?.code || e.code; if (['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) row.transportCode = code
      commit(); throw new Error(row.error)
    }
  }
  commit()
  for (const p of plans) {
    const row = { ...p, text: p.texts.join('\n\n'), file: `raw-${p.id}.mp3`, synthetic: true, candidate: true, asrVerified: false, listeningVerified: false }; report.plans.push(row); commit()
    try {
      const tts = await call('tts', p.id, { model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'user', content: p.instruction }, { role: 'assistant', content: row.text }], audio: { format: 'mp3', voice: `data:audio/mpeg;base64,${reference.toString('base64')}` }, stream: false })
      const data = tts?.choices?.[0]?.message?.audio?.data; if (typeof data !== 'string' || !data) throw new Error('TTS_AUDIO_MISSING')
      const audio = Buffer.from(data, 'base64'); if (!audio.length) throw new Error('TTS_AUDIO_EMPTY')
      writeFileSync(join(out, row.file), audio); row.sha256 = sha(audio); row.bytes = audio.length; row.ttsUsage = usage(tts.usage)
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(out, row.file)], { encoding: 'utf8', windowsHide: true }); if (probe.status !== 0) throw new Error('LOCAL_PROBE_FAILED'); row.durationSeconds = Number(probe.stdout.trim()); commit()
      const asr = await call('asr', p.id, { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${audio.toString('base64')}` } }] }] })
      row.heard = asr?.choices?.[0]?.message?.content || ''; row.asrUsage = usage(asr.usage); row.expectedNormalized = normalizeEnglishASR(row.text); row.heardNormalized = normalizeEnglishASR(row.heard); row.asrVerified = row.expectedNormalized === row.heardNormalized
      if (!row.asrVerified) row.validationError = 'ASR_SEQUENCE_MISMATCH'
      commit()
    } catch (e) { row.error = /^(?:HTTP_\d+|TTS_AUDIO_MISSING|TTS_AUDIO_EMPTY|LOCAL_PROBE_FAILED|CALL_BUDGET_EXHAUSTED|RESPONSE_JSON_PARSE_FAILED|REQUEST_OR_RESPONSE_TIMEOUT|RESPONSE_BODY_READ_FAILED|NETWORK_FETCH_FAILED)$/.test(e.message) ? e.message : 'PREBUILT_PROCESSING_FAILED'; commit(); break }
  }
  report.actualCalls = { total: ledger.calls.length, tts: ledger.calls.filter((r) => r.kind === 'tts').length, asr: ledger.calls.filter((r) => r.kind === 'asr').length, responseErrors: ledger.calls.filter((r) => r.status === 'error').length, validationErrors: report.plans.filter((r) => r.validationError).length, processingErrors: report.plans.filter((r) => r.error).length }
  commit(); console.log(JSON.stringify({ output: out, actualCalls: report.actualCalls, plans: report.plans.map((p) => ({ id: p.id, bytes: p.bytes, durationSeconds: p.durationSeconds, heard: p.heard, asrVerified: p.asrVerified, validationError: p.validationError, error: p.error })), assetsModified: false, noPromotion: true }, null, 2))
}
main().catch((e) => { console.error(JSON.stringify({ error: ['FIXED_REFERENCE_SHA_REQUIRED', 'MIMO_SECRET_NOT_FOUND', 'EXISTING_LEDGER_NO_RERUN_OR_RETRY'].includes(e.message) ? e.message : 'PREBUILT_SETUP_FAILED', noRetry: true })); process.exitCode = 1 })
