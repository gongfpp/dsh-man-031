// Independent two-request phrase extension. Dry-run default. Never retries.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { phraseVoicePlan } from './plan-amount-voice-phrases.mjs'
import { bridgeVoicePlan } from './plan-amount-voice-bridge.mjs'
const bridgeRound = process.argv.includes('--bridge-round')
const plan = bridgeRound ? bridgeVoicePlan : phraseVoicePlan
import { normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, bridgeRound ? 'dev/voice-pilot-en-b-bridge' : 'dev/voice-pilot-en-b-phrases')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const save = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2) + '\n')
async function main() {
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, output: out, ...plan }, null, 2)); return }
  const reference = readFileSync(join(root, plan.reference))
  const source = JSON.parse(readFileSync(join(root, 'dev/voice/reference-man-source.json'), 'utf8'))
  if (sha(reference) !== plan.referenceSha256 || source.sha256 !== plan.referenceSha256 || !source.provenanceReviewed) throw new Error('FIXED_REFERENCE_PROVENANCE_REQUIRED')
  const secrets = { tts: loadMiMoSecret('tts'), asr: loadMiMoSecret('asr') }
  if (!secrets.tts.found || !secrets.asr.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  mkdirSync(out, { recursive: true })
  const ledgerFile = join(out, 'calls.json'), reportFile = join(out, 'samples.json')
  if (existsSync(ledgerFile)) throw new Error('EXISTING_LEDGER_NO_RERUN_OR_RETRY')
  const manifestBytes = readFileSync(join(root, 'assets/voices/manifest.json')), base = JSON.parse(manifestBytes)
  if (base.status !== 'candidate' || Object.keys(base.clips).length !== (bridgeRound ? 45 : 40) || (bridgeRound ? JSON.stringify(base.phrases) !== JSON.stringify(phraseVoicePlan.phrases) : !!base.phrases) || base.clips.prefix.text !== "It's been" || base.reference.sha256 !== plan.referenceSha256) throw new Error('APPROVED_40_CLIP_BASE_REQUIRED')
  for (const c of Object.values(base.clips)) if (sha(readFileSync(join(root, 'assets/voices', c.file))) !== c.sha256) throw new Error('BASE_CLIP_HASH_CHANGED')
  if (!bridgeRound) {
  const prior = JSON.parse(readFileSync(join(root, 'dev/voice-pack-audition/manifest.json'), 'utf8'))
  const preview = prior.previews.find((p) => p.id === 'CNY-0.31-classic')
  if (sha(readFileSync(join(root, 'dev/voice-pack-audition', preview.file))) !== preview.sha256 || prior.sourceManifestSha256 !== sha(manifestBytes)) throw new Error('APPROVED_COMPOSITE_EVIDENCE_CHANGED')
  save(join(out, 'base-manifest.json'), base)
  save(join(out, 'prior-composite-approval.json'), { schemaVersion: 1, recordedAt: new Date().toISOString(), relayedBy: 'lead', sourceMessageRef: 'm00841', reportedUserResponse: '可以', scope: 'User accepted the prior classic MAN + legacy Its been + CNY 0.31 composite only. No new phrase or full-pack approval is inferred.', userApprovedComposite: true, sourceManifestSha256: sha(manifestBytes), preview: { ...preview, speechplan: preview.speechplan }, notApproved: ['new five phrase clips', 'four new phrase composites', 'human-reviewed individual token boundaries', 'new generation budget beyond the separate authorized two requests'], identitySimilarityExplicitlyReviewed: false, promotesManifestStatus: false })
  }
  if (bridgeRound) save(join(out, 'base-manifest.json'), base)
  const ledger = { round: plan.id, budget: 2, referenceSha256: plan.referenceSha256, calls: [] }
  const report = { schemaVersion: 1, id: plan.id, status: 'candidate', synthetic: true, plan, reference: { sha256: plan.referenceSha256 }, baseManifestSha256: sha(manifestBytes), priorCalls: { total: bridgeRound ? 29 : 27, tts: bridgeRound ? 15 : 14, asr: bridgeRound ? 14 : 13, responseErrors: 1 }, file: bridgeRound ? 'bridge-thats-about.mp3' : 'phrases.mp3', quality: { asrVerified: false, listeningVerified: false, boundaryHumanReviewed: false } }
  const commit = () => { save(ledgerFile, ledger); save(reportFile, report) }
  async function call(kind, body) {
    if (ledger.calls.length >= 2 || ledger.calls.some((c) => c.kind === kind)) throw new Error('CALL_BUDGET_EXHAUSTED')
    const e = { index: ledger.calls.length + 1, kind, at: new Date().toISOString(), status: 'started', phase: 'fetch', referenceSha256: plan.referenceSha256 }
    ledger.calls.push(e); commit()
    try {
      const s = secrets[kind]
      const response = await fetch(`${s.base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${s.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
      e.httpStatus = response.status
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      e.phase = 'response-body'; commit()
      const result = await response.json()
      e.status = 'received'; e.phase = 'complete'; commit(); return result
    } catch (error) {
      e.status = 'error'
      e.error = /^HTTP_\d+$/.test(error.message) ? error.message : error.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : e.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_FETCH_FAILED'
      e.errorName = ['SyntaxError', 'TypeError', 'TimeoutError', 'AbortError', 'Error'].includes(error.name) ? error.name : 'OtherError'
      const code = error.cause?.code || error.code
      if (['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) e.transportCode = code
      commit(); throw new Error(e.error)
    }
  }
  commit()
  try {
    const tts = await call('tts', { model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'user', content: plan.instruction }, { role: 'assistant', content: plan.text }], audio: { format: 'mp3', voice: `data:audio/mpeg;base64,${reference.toString('base64')}` }, stream: false })
    const data = tts?.choices?.[0]?.message?.audio?.data
    if (typeof data !== 'string' || !data) throw new Error('TTS_AUDIO_MISSING')
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length) throw new Error('TTS_AUDIO_EMPTY')
    writeFileSync(join(out, report.file), bytes); report.sha256 = sha(bytes); report.bytes = bytes.length; commit()
    const asr = await call('asr', { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${bytes.toString('base64')}` } }] }] })
    report.heard = asr?.choices?.[0]?.message?.content || ''
    report.quality.asrVerified = normalizeEnglishASR(report.heard) === normalizeEnglishASR(plan.text)
    if (!report.quality.asrVerified) report.validationError = 'ASR_SEQUENCE_MISMATCH'
  } catch (error) {
    report.error = /^(?:HTTP_\d+|TTS_AUDIO_MISSING|TTS_AUDIO_EMPTY|CALL_BUDGET_EXHAUSTED|RESPONSE_JSON_PARSE_FAILED|REQUEST_OR_RESPONSE_TIMEOUT|RESPONSE_BODY_READ_FAILED|NETWORK_FETCH_FAILED)$/.test(error.message) ? error.message : 'PHRASE_PROCESSING_FAILED'
  }
  report.actualCalls = { total: ledger.calls.length, tts: ledger.calls.filter((c) => c.kind === 'tts').length, asr: ledger.calls.filter((c) => c.kind === 'asr').length, responseErrors: ledger.calls.filter((c) => c.status === 'error').length, processingErrors: report.error ? 1 : 0, validationErrors: report.validationError ? 1 : 0 }
  commit(); console.log(JSON.stringify({ output: out, actualCalls: report.actualCalls, heard: report.heard, quality: report.quality, error: report.error, validationError: report.validationError }, null, 2))
}
main().catch((error) => { const allowed = ['FIXED_REFERENCE_PROVENANCE_REQUIRED', 'MIMO_SECRET_NOT_FOUND', 'EXISTING_LEDGER_NO_RERUN_OR_RETRY', 'APPROVED_40_CLIP_BASE_REQUIRED', 'BASE_CLIP_HASH_CHANGED', 'APPROVED_COMPOSITE_EVIDENCE_CHANGED']; console.error(JSON.stringify({ error: allowed.includes(error.message) ? error.message : 'PHRASE_PILOT_SETUP_FAILED', noAutomaticRetry: true })); process.exitCode = 1 })
