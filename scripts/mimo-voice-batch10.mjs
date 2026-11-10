// Exactly one TTS request, zero cloud ASR, no retries or runtime changes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { englishAmountText } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-batch10'), sha = (x) => createHash('sha256').update(x).digest('hex')
const refFile = 'dev/classic-quotes/hybrid-reference/kimmel-reference-clean-candidate-12s.wav', referenceSha256 = 'c8801e244195e79de49d6b070b64a4c925dcb26307111664f099a370d816c7f3'
const amounts = ['0', '0.01', '0.10', '0.31', '0.99', '1', '1.27', '10', '31', '100']
const sentences = amounts.map((amount) => ({ amount, currency: 'CNY', text: `That's about ${englishAmountText(amount)} yuan. Job's not finished.` }))
const instruction = 'Match only the actual reference speaker, with a natural confident conversational pace. Read the numbers and units exactly. Yuan is the Chinese currency unit 元 (yuán); enunciate its final n. Say only the target text. Each paragraph is one complete independent utterance with normal sentence pauses. Leave approximately one second of silence between paragraphs. Do not speak paragraph numbers or labels.'
const probe = (f) => { const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', f], { encoding: 'utf8', windowsHide: true }); if (p.status !== 0) throw new Error('LOCAL_PROBE_FAILED'); return JSON.parse(p.stdout) }
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n')
async function main() {
  const reference = readFileSync(join(root, refFile)); if (sha(reference) !== referenceSha256 || reference.toString('base64').length > 10000000) throw new Error('REFERENCE_MISMATCH')
  const plan = { id: 'batch10-one-tts', referenceFile: refFile, referenceSha256, model: 'mimo-v2.5-tts-voiceclone', audioFormat: 'wav', instruction, sentences, paragraphPauseRequestedSeconds: 1, paragraphPauseGuaranteed: false, requestHardCap: 1, cloudAsrHardCap: 0, baseline: { total: 41, tts: 21, asr: 20 }, humanPriorAcceptance: { relayMessageRef: 'm01972', scope: 'previous two exact bodies only; does not approve new batch pronunciation or all amounts', strictAsrWasFalse: true }, runtimeManifestShaBefore: sha(readFileSync(join(root, 'assets/voices/manifest.json'))), noPromotion: true }
  mkdirSync(out, { recursive: true })
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); return }
  if (!process.argv.includes('--lead-approval=m02056')) throw new Error('APPROVAL_REQUIRED')
  if (existsSync(join(out, 'calls.json'))) throw new Error('NO_RERUN_OR_RETRY')
  const secret = loadMiMoSecret('tts'); if (!secret.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  const ledger = { hardTtsCap: 1, hardCloudAsrCap: 0, approvalMessageRef: 'm02056', referenceSha256, calls: [{ index: 1, kind: 'tts', status: 'started', phase: 'fetch', at: new Date().toISOString() }] }, report = { ...plan, status: 'started', strictTextMatch: false, humanListeningVerified: false }
  const row = ledger.calls[0], commit = () => { save('calls.json', ledger); save('samples.json', report) }; commit()
  try {
    const response = await fetch(`${secret.base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: plan.model, messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: sentences.map((x) => x.text).join('\n\n') }], audio: { format: 'wav', voice: `data:audio/wav;base64,${reference.toString('base64')}` }, stream: false }), signal: AbortSignal.timeout(300000) })
    row.httpStatus = response.status; if (!response.ok) throw new Error(`HTTP_${response.status}`)
    row.phase = 'response-body'; commit(); const data = await response.json(); row.status = 'received'; row.phase = 'complete'
    const usage = Object.fromEntries(Object.entries(data.usage || {}).filter(([k, v]) => /^[a-z_]+$/.test(k) && typeof v === 'number' && Number.isFinite(v)))
    row.usage = usage; report.usage = usage; report.finishReasons = (data.choices || []).map((c) => ({ index: c.index ?? null, finishReason: typeof c.finish_reason === 'string' ? c.finish_reason : null })); commit()
    const encoded = data.choices?.[0]?.message?.audio?.data; if (typeof encoded !== 'string' || !encoded) throw new Error('TTS_AUDIO_MISSING')
    const audio = Buffer.from(encoded, 'base64'); if (!audio.length) throw new Error('TTS_AUDIO_EMPTY')
    const file = join(out, 'raw-batch10.wav'); writeFileSync(file, audio); report.raw = { file: 'raw-batch10.wav', sha256: sha(audio), bytes: audio.length, media: probe(file) }; report.raw.durationSeconds = Number(report.raw.media.format.duration)
    report.status = 'raw-received-completeness-unverified'; report.actualCalls = { tts: 1, cloudAsr: 0 }; report.cumulative = { total: 42, tts: 22, asr: 20 }
    report.runtimeManifestUnchanged = plan.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))); commit()
    writeFileSync(join(out, 'readable-text.txt'), sentences.map((s) => `CNY ${s.amount}\n${s.text}`).join('\n\n') + '\n')
    console.log(JSON.stringify({ output: out, raw: report.raw, finishReasons: report.finishReasons, actualCalls: report.actualCalls, cumulative: report.cumulative, completeness: 'requires local word-aligned review; finish_reason alone is not proof', runtimeManifestUnchanged: report.runtimeManifestUnchanged }, null, 2))
  } catch (e) {
    row.status = row.status === 'received' ? 'received-processing-error' : 'error'; row.error = /^HTTP_\d+$/.test(e.message) ? e.message : ['TTS_AUDIO_MISSING', 'TTS_AUDIO_EMPTY', 'LOCAL_PROBE_FAILED'].includes(e.message) ? e.message : e.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(e.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : row.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_OR_PROCESSING_FAILED'
    report.status = 'failed-no-retry'; report.actualCalls = { tts: 1, cloudAsr: 0 }; report.cumulative = { total: 42, tts: 22, asr: 20 }; commit(); console.log(JSON.stringify({ error: row.error, noRetry: true, actualCalls: report.actualCalls, cumulative: report.cumulative }))
  }
}
main().catch((e) => { console.error(JSON.stringify({ error: ['REFERENCE_MISMATCH', 'APPROVAL_REQUIRED', 'NO_RERUN_OR_RETRY', 'MIMO_SECRET_NOT_FOUND'].includes(e.message) ? e.message : 'BATCH_SETUP_FAILED', noRetry: true })); process.exitCode = 1 })
