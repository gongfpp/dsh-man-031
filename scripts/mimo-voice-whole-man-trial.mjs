// Ordinary synchronous TTS only. Sends ONE explicitly selected candidate per invocation.
// Independent four-request ledger; failed/unknown requests count and cannot be retried.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-whole-man-trial'), planFile = join(root, 'dev/voice-whole-man-plan/plan.json')
const sha = (b) => createHash('sha256').update(b).digest('hex'), json = (file) => JSON.parse(readFileSync(file, 'utf8')), save = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n')
const planBytes = readFileSync(planFile), plan = JSON.parse(planBytes), planSha256 = sha(planBytes), endpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
const expectedReferences = { 'classic-man-safe-driver': 'eb68b89174e03ddc7bf18c5f6a1bf75485eb285b1470299ec01ab7e8f2578fec', 'kimmel-man-safe-driver': '3a88ae891940ea9f056e3996444dac080de71ee6df390d5f9858fea4e5a01f7d' }
const expectedInstructions = { director: 'f84971707d2b1f701ff66fdc0f5729bf3a3139a6393e2d40fc2f936817c788e1', tags: '69df5e747b13a5f7fb69c2f3b16234b710432ed21f077f8f3306865e537ba414' }
const expectedAssistant = { director: '51f4cba6cb289f95ba0ecc354b4d3b4d525848c75e749c7ac3a5d02af35c3a8a', tags: '21cd06ab6dcca646e18c9cad04f11649ed70946290028236ee88b6bfdadacda2' }
const expectedIds = ['A-director', 'A-tags', 'B-director', 'B-tags']
if (JSON.stringify(plan.candidates.map((r) => r.id)) !== JSON.stringify(expectedIds)) throw new Error('FROZEN_CANDIDATE_SET_MISMATCH')
for (const row of plan.candidates) {
  const kind = row.id.endsWith('-tags') ? 'tags' : 'director'
  if (row.endpoint !== endpoint || row.model !== 'mimo-v2.5-tts-voiceclone' || expectedReferences[row.referenceId] !== row.referenceSha256 || sha(readFileSync(row.referenceFile)) !== row.referenceSha256 || sha(row.instruction) !== expectedInstructions[kind] || sha(row.assistantContent) !== expectedAssistant[kind] || JSON.stringify(row.messages) !== JSON.stringify([{ role: 'user', content: row.instruction }, { role: 'assistant', content: row.assistantContent }]) || row.spokenText !== "MAN! That's about zero point three one yuan. Job's not finished.") throw new Error('FROZEN_INPUT_MISMATCH')
  if (readFileSync(row.referenceFile).toString('base64').length > 10000000) throw new Error('REFERENCE_BASE64_TOO_LARGE')
}
function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  if (result.error || result.status !== 0) throw new Error('LOCAL_WAV_PROBE_FAILED')
  const data = JSON.parse(result.stdout); if (data.format.format_name !== 'wav' || !Number.isFinite(Number(data.format.duration)) || Number(data.format.duration) <= 0) throw new Error('INVALID_WAV_OUTPUT')
  return data
}
async function main() {
  const id = process.argv.find((arg) => arg.startsWith('--id='))?.slice(5), selected = plan.candidates.find((row) => row.id === id)
  if (!process.argv.includes('--run') || process.argv.includes('--dry-run')) { console.log(JSON.stringify({ dryRun: true, newCalls: 0, endpoint, batch: false, hardBudget: { tts: 4, cloudAsr: 0, retries: 0 }, sendsOneExplicitIdPerRun: true, planFile, planSha256, candidates: plan.candidates.map(({ id, referenceSha256, instructionSha256, assistantContentSha256 }) => ({ id, referenceSha256, instructionSha256, assistantContentSha256 })), selectedId: id || null }, null, 2)); return }
  if (!process.argv.includes('--lead-approval=m02424') || !selected) throw new Error('APPROVAL_AND_ONE_CANDIDATE_REQUIRED')
  mkdirSync(out, { recursive: true })
  if (existsSync(join(out, 'STOP'))) throw new Error('LOCAL_STOP_REQUESTED')
  const old = existsSync(join(out, 'calls.json')), ledger = old ? json(join(out, 'calls.json')) : { hardTtsCap: 4, hardCloudAsrCap: 0, retryCap: 0, planSha256, endpoint, calls: [] }
  const report = old ? json(join(out, 'samples.json')) : { approvalMessageRef: 'm02424', planFile, planSha256, baseline: { total: 51, tts: 31, asr: 20 }, model: selected.model, endpoint, batch: false, wholeUtteranceGeneratedIncludingMan: true, originalAudioAppendedToOutput: false, referencesAndMessagesSnapshot: plan.candidates, samples: [], runtimeManifestShaBefore: sha(readFileSync(join(root, 'assets/voices/manifest.json'))), humanListeningVerified: false, currencyVerified: false, manPerformanceVerified: false, qualityPassed: false, noPromotion: true }
  if (ledger.planSha256 !== planSha256 || ledger.calls.length >= 4 || ledger.calls.some((r) => r.id === id) || ledger.calls.some((r) => r.status === 'started')) throw new Error('BUDGET_DUPLICATE_OR_PENDING_REQUEST')
  const secret = loadMiMoSecret('tts'); if (!secret.found || secret.base !== 'https://api.xiaomimimo.com/v1') throw new Error('ORDINARY_OFFICIAL_ENDPOINT_SECRET_REQUIRED')
  if (!old) { writeFileSync(join(out, 'approved-plan-snapshot.json'), planBytes); save('approval.json', { leadMessageRef: 'm02424', ttsCap: 4, cloudAsrCap: 0, retries: 0, planSha256, notHumanQualityApproval: true, draftAuthorisationFlagsAreHistorical: true }) }
  const row = { index: ledger.calls.length + 1, id, kind: 'tts', at: new Date().toISOString(), phase: 'fetch', status: 'started', endpoint }, sample = { id, referenceSha256: selected.referenceSha256, instructionSha256: selected.instructionSha256, assistantContentSha256: selected.assistantContentSha256, text: selected.spokenText, file: `raw-${id}.wav`, responseJsonParsed: false, audioDataReceived: false, wavContainerProbePassed: false, semanticCompletenessVerified: false, manPerformanceVerified: false, currencyVerified: false, humanListeningVerified: false, qualityPassed: false }
  const commit = () => { report.actualCalls = { tts: ledger.calls.length, cloudAsr: 0, errors: ledger.calls.filter((r) => !['started', 'received'].includes(r.status)).length }; report.cumulative = { total: 51 + ledger.calls.length, tts: 31 + ledger.calls.length, asr: 20 }; report.runtimeManifestUnchanged = report.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))); save('calls.json', ledger); save('samples.json', report) }
  ledger.calls.push(row); report.samples.push(sample); commit() // Reserve BEFORE the first network byte.
  try {
    const reference = readFileSync(selected.referenceFile)
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: selected.model, messages: selected.messages, audio: { format: 'wav', voice: `data:audio/wav;base64,${reference.toString('base64')}` }, stream: false }), signal: AbortSignal.timeout(300000) })
    row.httpStatus = response.status; if (!response.ok) throw new Error(`HTTP_${response.status}`)
    row.phase = 'response-body'; commit(); const data = await response.json(); sample.responseJsonParsed = true; sample.finishReason = data.choices?.[0]?.finish_reason ?? null
    row.usage = Object.fromEntries(Object.entries(data.usage || {}).filter(([key, value]) => /^[a-z_]+$/.test(key) && typeof value === 'number' && Number.isFinite(value)))
    const encoded = data.choices?.[0]?.message?.audio?.data; if (typeof encoded !== 'string' || !encoded) throw new Error('TTS_AUDIO_MISSING')
    const bytes = Buffer.from(encoded, 'base64'); if (!bytes.length) throw new Error('TTS_AUDIO_EMPTY')
    sample.audioDataReceived = true; writeFileSync(join(out, sample.file), bytes); sample.sha256 = sha(bytes); sample.bytes = bytes.length; sample.media = probe(join(out, sample.file)); sample.wavContainerProbePassed = true; sample.durationSeconds = Number(sample.media.format.duration)
    row.phase = 'complete'; row.status = 'received'
  } catch (error) {
    row.status = 'error'; row.error = /^HTTP_\d+$/.test(error.message) ? error.message : ['TTS_AUDIO_MISSING', 'TTS_AUDIO_EMPTY', 'LOCAL_WAV_PROBE_FAILED', 'INVALID_WAV_OUTPUT'].includes(error.message) ? error.message : error.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : row.phase === 'response-body' ? 'RESPONSE_BODY_OR_PROCESSING_FAILED' : 'NETWORK_FETCH_FAILED'
    sample.error = row.error
  }
  commit(); console.log(JSON.stringify({ id, endpoint, httpStatus: row.httpStatus, status: row.status, finishReason: sample.finishReason, durationSeconds: sample.durationSeconds, rawSha256: sample.sha256, responseJsonParsed: sample.responseJsonParsed, audioDataReceived: sample.audioDataReceived, wavContainerProbePassed: sample.wavContainerProbePassed, semanticCompletenessVerified: false, error: sample.error, actualCalls: report.actualCalls, cumulative: report.cumulative, runtimeManifestUnchanged: report.runtimeManifestUnchanged, remainingBudget: 4 - ledger.calls.length, noRetry: true }))
}
main().catch((error) => { const safe = ['APPROVAL_AND_ONE_CANDIDATE_REQUIRED', 'LOCAL_STOP_REQUESTED', 'BUDGET_DUPLICATE_OR_PENDING_REQUEST', 'ORDINARY_OFFICIAL_ENDPOINT_SECRET_REQUIRED']; console.error(JSON.stringify({ error: safe.includes(error.message) ? error.message : 'WHOLE_MAN_TRIAL_SETUP_FAILED', noRetry: true })); process.exitCode = 1 })
