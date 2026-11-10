// One isolated 40-body capacity request. No cloud ASR, retries, max-token guesses or publication.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { englishAmountText } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-batch40-capacity'), sha = (x) => createHash('sha256').update(x).digest('hex')
const referenceFile = 'dev/classic-quotes/hybrid-reference/kimmel-reference-clean-candidate-12s.wav', referenceSha256 = 'c8801e244195e79de49d6b070b64a4c925dcb26307111664f099a370d816c7f3'
const sentences = Array.from({ length: 40 }, (_, i) => ({ amount: String(i + 1), currency: 'USD', text: `That's about ${englishAmountText(i + 1)} ${i === 0 ? 'dollar' : 'dollars'}. Job's not finished.` }))
const instruction = 'Match only the actual reference speaker, with a natural confident conversational pace. Read the numbers and units exactly. Say only the target text. Each paragraph is one complete independent utterance with normal sentence pauses. Leave approximately one second of silence between paragraphs. Do not speak paragraph numbers or labels.'
const save = (n, x) => writeFileSync(join(out, n), JSON.stringify(x, null, 2) + '\n')
function probe(f) { const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', f], { encoding: 'utf8', windowsHide: true }); if (p.status !== 0) throw new Error('LOCAL_PROBE_FAILED'); return JSON.parse(p.stdout) }
async function main() {
  const reference = readFileSync(join(root, referenceFile)); if (sha(reference) !== referenceSha256 || reference.toString('base64').length > 10000000) throw new Error('REFERENCE_MISMATCH')
  const plan = { id: 'batch40-capacity-one-tts', referenceFile, referenceSha256, model: 'mimo-v2.5-tts-voiceclone', audioFormat: 'wav', instruction, sentences, requestHardCap: 1, cloudAsrHardCap: 0, outputLengthRequestSettings: { max_tokens: 'not set', max_completion_tokens: 'not set', otherOutputLengthParameters: [] }, timeoutMs: 300000, baseline: { total: 42, tts: 22, asr: 20 }, runtimeManifestShaBefore: sha(readFileSync(join(root, 'assets/voices/manifest.json'))), noRetries: true, noPublication: true, noCutsOrNewAuditions: true, humanListeningVerified: false }
  mkdirSync(out, { recursive: true })
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); return }
  if (!process.argv.includes('--lead-approval=m02158')) throw new Error('APPROVAL_REQUIRED')
  if (existsSync(join(out, 'calls.json'))) throw new Error('NO_RERUN_OR_RETRY')
  const secret = loadMiMoSecret('tts'); if (!secret.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  const row = { index: 1, kind: 'tts', status: 'started', phase: 'fetch', at: new Date().toISOString() }, ledger = { hardTtsCap: 1, hardCloudAsrCap: 0, approvalMessageRef: 'm02158', referenceSha256, calls: [row] }, report = { ...plan, status: 'started' }
  const commit = () => { save('calls.json', ledger); save('samples.json', report) }; commit()
  writeFileSync(join(out, 'readable-text.txt'), sentences.map((s) => `USD ${s.amount}\n${s.text}`).join('\n\n') + '\n')
  try {
    const response = await fetch(`${secret.base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: plan.model, messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: sentences.map((s) => s.text).join('\n\n') }], audio: { format: 'wav', voice: `data:audio/wav;base64,${reference.toString('base64')}` }, stream: false }), signal: AbortSignal.timeout(plan.timeoutMs) })
    row.httpStatus = response.status; if (!response.ok) throw new Error(`HTTP_${response.status}`)
    row.phase = 'response-body'; commit(); const data = await response.json(); row.status = 'received'; row.phase = 'complete'
    report.finishReasons = (data.choices || []).map((c) => ({ index: c.index ?? null, finishReason: typeof c.finish_reason === 'string' ? c.finish_reason : null })); row.usage = Object.fromEntries(Object.entries(data.usage || {}).filter(([k, v]) => /^[a-z_]+$/.test(k) && typeof v === 'number' && Number.isFinite(v))); report.usage = row.usage; commit()
    const encoded = data.choices?.[0]?.message?.audio?.data; if (typeof encoded !== 'string' || !encoded) throw new Error('TTS_AUDIO_MISSING')
    const audio = Buffer.from(encoded, 'base64'); if (!audio.length) throw new Error('TTS_AUDIO_EMPTY')
    const f = join(out, 'raw-batch40.wav'); writeFileSync(f, audio); report.raw = { file: 'raw-batch40.wav', sha256: sha(audio), bytes: audio.length, media: probe(f) }; report.raw.durationSeconds = Number(report.raw.media.format.duration)
    report.status = 'raw-received-completeness-unverified'; report.actualCalls = { tts: 1, cloudAsr: 0 }; report.cumulative = { total: 43, tts: 23, asr: 20 }; report.runtimeManifestUnchanged = plan.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))); commit()
    console.log(JSON.stringify({ output: out, raw: report.raw, finishReasons: report.finishReasons, outputLengthRequestSettings: plan.outputLengthRequestSettings, actualCalls: report.actualCalls, cumulative: report.cumulative, runtimeManifestUnchanged: report.runtimeManifestUnchanged, completeness: 'requires local amount and full-ending review; stop is not proof of all forty paragraphs' }, null, 2))
  } catch (e) {
    row.status = row.status === 'received' ? 'received-processing-error' : 'error'; row.error = /^HTTP_\d+$/.test(e.message) ? e.message : ['TTS_AUDIO_MISSING', 'TTS_AUDIO_EMPTY', 'LOCAL_PROBE_FAILED'].includes(e.message) ? e.message : e.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(e.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : row.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_OR_PROCESSING_FAILED'
    report.status = 'failed-no-retry'; report.actualCalls = { tts: 1, cloudAsr: 0 }; report.cumulative = { total: 43, tts: 23, asr: 20 }; commit(); console.log(JSON.stringify({ error: row.error, noRetry: true, actualCalls: report.actualCalls, cumulative: report.cumulative }))
  }
}
main().catch((e) => { console.error(JSON.stringify({ error: ['REFERENCE_MISMATCH', 'APPROVAL_REQUIRED', 'NO_RERUN_OR_RETRY', 'MIMO_SECRET_NOT_FOUND'].includes(e.message) ? e.message : 'BATCH_SETUP_FAILED', noRetry: true })); process.exitCode = 1 })
