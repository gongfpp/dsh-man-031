// Isolated four-request hybrid pilot. No assets, retries, synthetic MAN, or original quote suffixes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-hybrid-v1')
const referenceFile = 'dev/classic-quotes/hybrid-reference/kimmel-reference-clean-candidate-12s.wav'
const referenceSha256 = 'c8801e244195e79de49d6b070b64a4c925dcb26307111664f099a370d816c7f3'
const sourceSha256 = 'b4a88a914de65b29c183e7cd0ed056e5f78a5d0a29a1fdf5089efe9bb2243509'
const instruction = 'Match only the actual reference speaker, with a natural confident conversational pace. Read the numbers and units exactly. Yuan is the Chinese currency unit 元 (yuán); enunciate its final n. Say only the target text as one continuous utterance with normal sentence pauses.'
const plans = [
  { id: 'CNY-0.31', amount: '0.31', currency: 'CNY', text: "That's about zero point three one yuan. Job's not finished." },
  { id: 'USD-1.27', amount: '1.27', currency: 'USD', text: "That's about one point two seven dollars. Job's not finished." },
]
const sha = (b) => createHash('sha256').update(b).digest('hex')
const save = (name, x) => writeFileSync(join(out, name), JSON.stringify(x, null, 2) + '\n')
const usage = (x) => Object.fromEntries(Object.entries(x || {}).filter(([k, v]) => /^[a-z_]+$/.test(k) && typeof v === 'number' && Number.isFinite(v)))
function probe(file) {
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  if (p.status !== 0) throw new Error('LOCAL_PROBE_FAILED')
  return JSON.parse(p.stdout)
}
async function main() {
  const reference = readFileSync(join(root, referenceFile)), encoded = reference.toString('base64')
  if (sha(reference) !== referenceSha256 || encoded.length > 10000000) throw new Error('REFERENCE_SHA_OR_BASE64_SIZE_FAILED')
  const refInfo = probe(join(root, referenceFile))
  const metadataFile = join(root, 'dev/classic-quotes/hybrid-reference/hybrid-reference.json'), metadata = JSON.parse(readFileSync(metadataFile, 'utf8'))
  if (metadata.recommendedReference.sha256 !== referenceSha256 || metadata.source.sha256 !== sourceSha256 || metadata.recommendedReference.segmentIds.join(',') !== 'seasoned-vet,really-calm,safe-driver,proud') throw new Error('REFERENCE_PROVENANCE_FAILED')
  const approvalMessageRef = process.argv.find((x) => x.startsWith('--lead-approval='))?.split('=')[1]
  const plan = { id: 'hybrid-v1-clean-reference', referenceFile, referenceSha256, sourceSha256, referenceInfo: refInfo, referenceBytes: reference.length, referenceBase64Characters: encoded.length, referenceIsOneConcatenatedFile: true, referenceContinuousOriginalSpeech: false, referenceSegments: metadata.recommendedReference.segmentIds, humanListeningVerified: false, instruction, plans, hardBudget: { total: 4, tts: 2, asr: 2 }, historicalBaseline: { total: 37, tts: 19, asr: 18 }, assetsModified: false, noPromotion: true, noRetries: true }
  mkdirSync(out, { recursive: true })
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); return }
  if (!/^m\d{5,}$/.test(approvalMessageRef || '')) throw new Error('EXPLICIT_LEAD_START_CONFIRMATION_REQUIRED')
  if (existsSync(join(out, 'calls.json'))) throw new Error('EXISTING_LEDGER_NO_RERUN_OR_RETRY')
  const secrets = { tts: loadMiMoSecret('tts'), asr: loadMiMoSecret('asr') }
  if (!secrets.tts.found || !secrets.asr.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  const ledger = { id: plan.id, hardBudget: 4, perKindBudget: 2, referenceSha256, approvalMessageRef, calls: [] }
  const report = { ...plan, approvalMessageRef, status: 'candidate', referenceMetadataSha256: sha(readFileSync(metadataFile)), quality: { listeningVerified: false, identityVerified: false }, samples: [] }
  const commit = () => { save('calls.json', ledger); save('samples.json', report) }
  async function call(kind, id, body) {
    if (ledger.calls.length >= 4 || ledger.calls.filter((r) => r.kind === kind).length >= 2 || ledger.calls.some((r) => r.id === id && r.kind === kind)) throw new Error('CALL_BUDGET_EXHAUSTED')
    const row = { index: ledger.calls.length + 1, kind, id, at: new Date().toISOString(), status: 'started', phase: 'fetch' }; ledger.calls.push(row); commit()
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
    const row = { ...p, file: `body-${p.id}.wav`, synthetic: true, includesSyntheticQuote: true, includesMan: false, asrVerified: false, listeningVerified: false }; report.samples.push(row); commit()
    try {
      const tts = await call('tts', p.id, { model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: p.text }], audio: { format: 'wav', voice: `data:audio/wav;base64,${encoded}` }, stream: false })
      const data = tts?.choices?.[0]?.message?.audio?.data; if (typeof data !== 'string' || !data) throw new Error('TTS_AUDIO_MISSING')
      const audio = Buffer.from(data, 'base64'); if (!audio.length) throw new Error('TTS_AUDIO_EMPTY')
      writeFileSync(join(out, row.file), audio); row.sha256 = sha(audio); row.bytes = audio.length; row.ttsUsage = usage(tts.usage); row.media = probe(join(out, row.file)); row.durationSeconds = Number(row.media.format.duration); commit()
      const asr = await call('asr', p.id, { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audio.toString('base64')}` } }] }] })
      row.heard = asr?.choices?.[0]?.message?.content || ''; row.asrUsage = usage(asr.usage); row.expectedNormalized = normalizeEnglishASR(p.text); row.heardNormalized = normalizeEnglishASR(row.heard); row.asrVerified = row.expectedNormalized === row.heardNormalized
      if (!row.asrVerified) row.validationError = 'ASR_SEQUENCE_MISMATCH'
      commit()
    } catch (e) { row.error = /^(?:HTTP_\d+|TTS_AUDIO_MISSING|TTS_AUDIO_EMPTY|LOCAL_PROBE_FAILED|CALL_BUDGET_EXHAUSTED|RESPONSE_JSON_PARSE_FAILED|REQUEST_OR_RESPONSE_TIMEOUT|RESPONSE_BODY_READ_FAILED|NETWORK_FETCH_FAILED)$/.test(e.message) ? e.message : 'HYBRID_PROCESSING_FAILED'; commit(); break }
  }
  report.actualCalls = { total: ledger.calls.length, tts: ledger.calls.filter((r) => r.kind === 'tts').length, asr: ledger.calls.filter((r) => r.kind === 'asr').length, responseErrors: ledger.calls.filter((r) => r.status === 'error').length, validationErrors: report.samples.filter((r) => r.validationError).length, processingErrors: report.samples.filter((r) => r.error).length }
  report.cumulativeCalls = { total: 37 + report.actualCalls.total, tts: 19 + report.actualCalls.tts, asr: 18 + report.actualCalls.asr }
  commit(); console.log(JSON.stringify({ output: out, actualCalls: report.actualCalls, cumulativeCalls: report.cumulativeCalls, samples: report.samples.map((p) => ({ id: p.id, bytes: p.bytes, durationSeconds: p.durationSeconds, heard: p.heard, asrVerified: p.asrVerified, validationError: p.validationError, error: p.error })), assetsModified: false, noPromotion: true }, null, 2))
}
main().catch((e) => { console.error(JSON.stringify({ error: ['REFERENCE_SHA_OR_BASE64_SIZE_FAILED', 'REFERENCE_PROVENANCE_FAILED', 'EXPLICIT_LEAD_START_CONFIRMATION_REQUIRED', 'EXISTING_LEDGER_NO_RERUN_OR_RETRY', 'MIMO_SECRET_NOT_FOUND', 'LOCAL_PROBE_FAILED'].includes(e.message) ? e.message : 'HYBRID_SETUP_FAILED', noRetry: true })); process.exitCode = 1 })
