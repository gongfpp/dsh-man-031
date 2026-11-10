// Separately authorized MAN-only pilot: 3 TTS + 3 ASR, never a bulk amount pack.
// Dry run: node scripts/mimo-voice-man-samples.mjs
// Execute with private credentials loaded only in memory: add --run.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'dev/voice-pilot-man')
const referenceFile = join(root, 'dev/voice/kobe-original-kimmel-man-what-long.mp3')
const sourceFile = join(root, 'dev/voice/reference-man-source.json')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const save = (f, value) => writeFileSync(f, JSON.stringify(value, null, 2) + '\n')
const baseStyle = 'Speak only the supplied word as a standalone English interjection. Preserve the reference speaker\'s original deep, low vocal identity and natural vocal register. Do not append any other words. Do not sing, use a throat scream, imitate another speaker, or alter pitch or speed to disguise the voice. Aim for a clearly articulated complete Man lasting approximately 0.6 to 1.2 seconds, followed by a natural pause. Emphasize the vowel and finish the final n clearly.'
const samples = [
  { id: 'man-firm', text: 'Man!', targetASR: 'man', direction: 'firm emphatic', instruction: `${baseStyle} Deliver a firm, decisive, strongly stressed exclamation: MAN! Grounded and full-bodied, not casual conversation.` },
  { id: 'man-astonished', text: 'Man!', targetASR: 'man', direction: 'astonished exclamation', instruction: `${baseStyle} Deliver a genuinely astonished, emphatic exclamation, as a spontaneous reaction of disbelief: MAN! Retain the same deep voice, not a high-pitched shout.` },
  { id: 'man-extended', text: 'Maaaan!', targetASR: 'man', direction: 'extended emphasis', instruction: `${baseStyle} Deliver one extended emphatic Maaaan! Sustain the ah vowel naturally, with conviction and surprise, then clearly close the final n. One word only, no extra syllables.` },
]
const requestBudget = 6
const perKindBudget = 3
const ref = readFileSync(referenceFile)
const referenceSha256 = sha(ref)
const source = JSON.parse(readFileSync(sourceFile, 'utf8'))
if (source.speaker !== 'Kobe Bryant' || source.url !== 'https://www.youtube.com/watch?v=t8eoIKiDTw8' || source.provenanceReviewed !== true || source.pilotOnlyUnlistened !== true || source.userSelectedReference !== false || source.startSeconds !== 113.32 || source.endSeconds !== 123.82 || source.sha256 !== referenceSha256) throw new Error('FIXED_REFERENCE_PROVENANCE_REQUIRED')
const plan = { id: 'kobe-mimo-man-v1', standaloneWordOnly: true, output: out, reference: { file: referenceFile, sha256: referenceSha256, source: source.url, rangeSeconds: [source.startSeconds, source.endSeconds], userSelected: false }, samples, maximumRequests: 6, ttsMaximum: 3, asrMaximum: 3, retries: 0, targetWordDurationSeconds: [0.6, 1.2], humanListeningReviewed: false, affectsRuntimeManifest: false }
async function main() {
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); return }
  const secrets = { tts: loadMiMoSecret('tts'), asr: loadMiMoSecret('asr') }
  if (!secrets.tts.found || !secrets.asr.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  mkdirSync(out, { recursive: true })
  const ledgerFile = join(out, 'calls.json')
  const reportFile = join(out, 'samples.json')
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : { round: plan.id, budget: 6, referenceSha256, calls: [] }
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : { schemaVersion: 1, id: plan.id, status: 'candidate', synthetic: true, reference: plan.reference, attribution: source, plannedSamples: samples, samples: [], priorCalls: { total: 13, tts: 7, asr: 6, responseErrors: 1 }, quality: { asrVerified: false, listeningVerified: false, identitySimilarityVerified: false, emotionVerified: false }, notice: 'AI-synthesized candidate, not a new authentic Kobe Bryant recording or endorsement. This trial reference was not selected by the user.' }
  if (ledger.round !== plan.id || ledger.budget !== 6 || ledger.referenceSha256 !== referenceSha256 || !Array.isArray(ledger.calls) || report.reference.sha256 !== referenceSha256 || JSON.stringify(report.plannedSamples) !== JSON.stringify(samples)) throw new Error('FIXED_PILOT_STATE_CHANGED')
  const commit = () => { save(ledgerFile, ledger); save(reportFile, report) }
  async function call(kind, id, body) {
    if (ledger.calls.length >= requestBudget || ledger.calls.filter((c) => c.kind === kind).length >= perKindBudget) throw new Error('PILOT_BUDGET_EXHAUSTED_NO_AUTOMATIC_RETRY')
    const entry = { index: ledger.calls.length + 1, kind, id, at: new Date().toISOString(), status: 'started', phase: 'fetch', referenceSha256 }
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
  for (const sample of samples) {
    if (report.samples.some((s) => s.id === sample.id)) continue // Failed and started rows are never automatically retried.
    const row = { ...sample, file: `${sample.id}.mp3`, listeningVerified: false, emotionVerified: false }
    report.samples.push(row); commit()
    try {
      const parsed = await call('tts', sample.id, { model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'user', content: sample.instruction }, { role: 'assistant', content: sample.text }], audio: { format: 'mp3', voice }, stream: false })
      const data = parsed?.choices?.[0]?.message?.audio?.data
      if (typeof data !== 'string' || !data) throw new Error('TTS_AUDIO_MISSING')
      const bytes = Buffer.from(data, 'base64')
      if (!bytes.length) throw new Error('TTS_AUDIO_EMPTY')
      writeFileSync(join(out, row.file), bytes)
      row.sha256 = sha(bytes); row.bytes = bytes.length
      commit()
      try { row.fileDurationSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', resolve(out, row.file)], { encoding: 'utf8' }).trim()) } catch { row.durationMeasurementError = 'FFPROBE_FAILED' }
      await new Promise((r) => setTimeout(r, 4000))
      const asr = await call('asr', sample.id, { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${bytes.toString('base64')}` } }] }] })
      row.heard = asr?.choices?.[0]?.message?.content || ''
      row.asrTextMatch = String(row.heard).toLowerCase().replace(/[^a-z]/g, '').replace(/ma+n/g, 'man') === 'man'
    } catch (error) {
      row.error = /^(?:HTTP_\d+|TTS_AUDIO_MISSING|TTS_AUDIO_EMPTY|PILOT_BUDGET_EXHAUSTED_NO_AUTOMATIC_RETRY|RESPONSE_JSON_PARSE_FAILED|REQUEST_OR_RESPONSE_TIMEOUT|RESPONSE_BODY_READ_FAILED|NETWORK_FETCH_FAILED)$/.test(error.message) ? error.message : 'PILOT_PROCESSING_FAILED'
      commit(); break
    }
    commit()
    if (sample !== samples.at(-1)) await new Promise((r) => setTimeout(r, 4000))
  }
  report.quality.asrVerified = report.samples.length === samples.length && report.samples.every((s) => s.asrTextMatch === true)
  report.actualCalls = { total: ledger.calls.length, tts: ledger.calls.filter((s) => s.kind === 'tts').length, asr: ledger.calls.filter((s) => s.kind === 'asr').length, responseErrors: ledger.calls.filter((s) => s.status === 'error').length, processingErrors: report.samples.filter((s) => s.error).length }
  commit()
  console.log(JSON.stringify({ output: out, referenceSha256, actualCalls: report.actualCalls, samples: report.samples.map(({ id, file, fileDurationSeconds, heard, asrTextMatch, error }) => ({ id, file, fileDurationSeconds, heard, asrTextMatch, error })), humanListeningReviewed: false, emotionVerified: false, affectsRuntimeManifest: false }, null, 2))
}
main().catch((error) => { console.error(JSON.stringify({ error: ['MIMO_SECRET_NOT_FOUND', 'FIXED_PILOT_STATE_CHANGED'].includes(error.message) ? error.message : 'MAN_PILOT_SETUP_FAILED', noAutomaticRetry: true })); process.exitCode = 1 })
