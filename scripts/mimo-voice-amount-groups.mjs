// Separate eight-request English token pilot. Default dry-run; no hidden retries.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { englishVoiceGroupPlan as plan } from './plan-amount-voice-english.mjs'
import { normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'dev/voice-pilot-en-b-groups')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const save = (f, x) => writeFileSync(f, JSON.stringify(x, null, 2) + '\n')
async function main() {
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, output: out, ...plan }, null, 2)); return }
  const ref = readFileSync(join(root, plan.reference))
  if (sha(ref) !== plan.referenceSha256) throw new Error('FIXED_REFERENCE_CHANGED')
  const source = JSON.parse(readFileSync(join(root, 'dev/voice/reference-man-source.json'), 'utf8'))
  if (source.sha256 !== plan.referenceSha256 || source.provenanceReviewed !== true || source.speaker !== 'Kobe Bryant') throw new Error('REFERENCE_PROVENANCE_REQUIRED')
  const secrets = { tts: loadMiMoSecret('tts'), asr: loadMiMoSecret('asr') }
  if (!secrets.tts.found || !secrets.asr.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  mkdirSync(out, { recursive: true })
  const ledgerFile = join(out, 'calls.json'), reportFile = join(out, 'samples.json')
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : { round: plan.id, budget: 8, referenceSha256: plan.referenceSha256, calls: [] }
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : { schemaVersion: 1, id: plan.id, status: 'candidate', synthetic: true, plan, attribution: source, reference: { sha256: plan.referenceSha256 }, samples: [], priorCalls: { total: 19, tts: 10, asr: 9, responseErrors: 1 }, quality: { asrVerified: false, listeningVerified: false, identitySimilarityVerified: false, boundaryHumanReviewed: false }, notice: 'AI-synthesized offline candidate; not a new authentic Kobe recording or endorsement. Do not mix previous ESPN-reference whole-amount samples into this pack.' }
  if (ledger.round !== plan.id || ledger.budget !== 8 || !Array.isArray(ledger.calls) || ledger.referenceSha256 !== plan.referenceSha256 || JSON.stringify(report.plan) !== JSON.stringify(plan)) throw new Error('FIXED_PILOT_STATE_CHANGED')
  const commit = () => { save(ledgerFile, ledger); save(reportFile, report) }
  async function call(kind, id, body) {
    if (ledger.calls.length >= 8 || ledger.calls.filter((x) => x.kind === kind).length >= 4) throw new Error('CALL_BUDGET_EXHAUSTED')
    const entry = { index: ledger.calls.length + 1, kind, id, at: new Date().toISOString(), status: 'started', phase: 'fetch', referenceSha256: plan.referenceSha256 }
    ledger.calls.push(entry); commit()
    try {
      const secret = secrets[kind]
      const response = await fetch(`${secret.base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
      entry.httpStatus = response.status
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      entry.phase = 'response-body'; commit()
      const parsed = await response.json()
      entry.phase = 'complete'; entry.status = 'received'; commit()
      return parsed
    } catch (error) {
      entry.status = 'error'
      entry.error = /^HTTP_\d+$/.test(error.message) ? error.message : error.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : entry.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_FETCH_FAILED'
      entry.errorName = ['SyntaxError', 'TypeError', 'TimeoutError', 'AbortError', 'Error'].includes(error.name) ? error.name : 'OtherError'
      const code = error.cause?.code || error.code
      if (['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) entry.transportCode = code
      commit(); throw new Error(entry.error)
    }
  }
  const voice = `data:audio/mpeg;base64,${ref.toString('base64')}`
  for (const group of plan.groups) {
    if (report.samples.some((s) => s.id === group.id)) continue
    const row = { ...group, file: `${group.id}.mp3`, referenceSha256: plan.referenceSha256, listeningVerified: false, boundaryHumanReviewed: false }
    report.samples.push(row); commit()
    try {
      const parsed = await call('tts', group.id, { model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'user', content: plan.instruction }, { role: 'assistant', content: group.text }], audio: { format: 'mp3', voice }, stream: false })
      const data = parsed?.choices?.[0]?.message?.audio?.data
      if (typeof data !== 'string' || !data) throw new Error('TTS_AUDIO_MISSING')
      const bytes = Buffer.from(data, 'base64')
      if (!bytes.length) throw new Error('TTS_AUDIO_EMPTY')
      writeFileSync(join(out, row.file), bytes)
      row.sha256 = sha(bytes); row.bytes = bytes.length; commit()
      try { row.fileDurationSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(out, row.file)], { encoding: 'utf8' }).trim()) } catch { row.durationMeasurementError = 'FFPROBE_FAILED' }
      await new Promise((r) => setTimeout(r, 4000))
      const asr = await call('asr', group.id, { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${bytes.toString('base64')}` } }] }] })
      row.heard = asr?.choices?.[0]?.message?.content || ''
      row.asrTextMatch = normalizeEnglishASR(row.heard) === normalizeEnglishASR(group.text)
      if (!row.asrTextMatch) { row.validationError = 'ASR_SEQUENCE_MISMATCH'; commit(); break }
    } catch (error) {
      row.error = /^(?:HTTP_\d+|TTS_AUDIO_MISSING|TTS_AUDIO_EMPTY|CALL_BUDGET_EXHAUSTED|RESPONSE_JSON_PARSE_FAILED|REQUEST_OR_RESPONSE_TIMEOUT|RESPONSE_BODY_READ_FAILED|NETWORK_FETCH_FAILED)$/.test(error.message) ? error.message : 'GROUP_PROCESSING_FAILED'
      commit(); break
    }
    commit()
    if (group !== plan.groups.at(-1)) await new Promise((r) => setTimeout(r, 4000))
  }
  report.quality.asrVerified = report.samples.length === plan.groups.length && report.samples.every((s) => s.asrTextMatch === true)
  report.actualCalls = { total: ledger.calls.length, tts: ledger.calls.filter((s) => s.kind === 'tts').length, asr: ledger.calls.filter((s) => s.kind === 'asr').length, responseErrors: ledger.calls.filter((s) => s.status === 'error').length, processingErrors: report.samples.filter((s) => s.error).length, validationErrors: report.samples.filter((s) => s.validationError).length }
  commit()
  console.log(JSON.stringify({ output: out, actualCalls: report.actualCalls, groups: report.samples.map(({ id, file, fileDurationSeconds, heard, asrTextMatch, error, validationError }) => ({ id, file, fileDurationSeconds, heard, asrTextMatch, error, validationError })), quality: report.quality }, null, 2))
}
main().catch((error) => { console.error(JSON.stringify({ error: ['MIMO_SECRET_NOT_FOUND', 'FIXED_PILOT_STATE_CHANGED', 'FIXED_REFERENCE_CHANGED', 'REFERENCE_PROVENANCE_REQUIRED'].includes(error.message) ? error.message : 'GROUP_PILOT_SETUP_FAILED', noAutomaticRetry: true })); process.exitCode = 1 })
