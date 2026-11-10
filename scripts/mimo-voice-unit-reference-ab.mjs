// Four single-utterance TTS calls: reference x written-unit. No retries, cloud ASR or runtime edits.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-unit-reference-ab'), sha = (x) => createHash('sha256').update(x).digest('hex')
const metadataFile = join(root, 'dev/classic-quotes/hybrid-reference/hybrid-reference.json'), metadata = JSON.parse(readFileSync(metadataFile, 'utf8'))
const safe = metadata.segments.find((s) => s.id === 'safe-driver')
if (safe.sha256 !== '9b2415b0ebe8c6cee1821bb101a0f653975c7351669cb73ca0c1d0e83752d71f' || safe.sourceRangeSeconds.join(',') !== '129.4,135.66' || safe.durationSeconds !== 6.26 || metadata.source.sha256 !== 'b4a88a914de65b29c183e7cd0ed056e5f78a5d0a29a1fdf5089efe9bb2243509') throw new Error('CONTINUOUS_REFERENCE_METADATA_MISMATCH')
const refs = [{ id: 'four-segment', file: metadata.recommendedReference.path, sha256: 'c8801e244195e79de49d6b070b64a4c925dcb26307111664f099a370d816c7f3', durationSeconds: 12.19, continuousOriginalSpeech: false, segmentIds: ['seasoned-vet', 'really-calm', 'safe-driver', 'proud'] }, { id: 'continuous', file: safe.path, sha256: safe.sha256, durationSeconds: 6.26, continuousOriginalSpeech: true, sourceRangeSeconds: safe.sourceRangeSeconds, localRangeSeconds: safe.localRangeSeconds, transcript: safe.actualASRText, boundaryEvidence: safe.limitations, contextTranscript: safe.contextASRText }]
const units = [{ id: 'yuan', text: 'yuan' }, { id: 'hanzi-yuan', text: '元' }]
const instruction = 'Match only the actual reference speaker, with a natural confident conversational pace. Read the numbers and units exactly. English number words and the single Chinese currency character 元 are permitted. Say only the target text as one continuous utterance with normal sentence pauses.'
const probe = (f) => { const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', f], { encoding: 'utf8', windowsHide: true }); if (p.status !== 0) throw new Error('LOCAL_PROBE_FAILED'); return JSON.parse(p.stdout) }
const save = (n, x) => writeFileSync(join(out, n), JSON.stringify(x, null, 2) + '\n')
async function main() {
  for (const ref of refs) { const b = readFileSync(ref.file); if (sha(b) !== ref.sha256 || b.toString('base64').length > 10000000 || Math.abs(Number(probe(ref.file).format.duration) - ref.durationSeconds) > .001) throw new Error('REFERENCE_SHA_OR_DURATION_MISMATCH') }
  const pairs = refs.flatMap((ref) => units.map((unit) => ({ id: `${ref.id}-${unit.id}`, referenceId: ref.id, referenceSha256: ref.sha256, unitId: unit.id, unitText: unit.text, text: `That's about zero point three one ${unit.text}. Job's not finished.` })))
  const plan = { id: 'single-unit-reference-2x2', model: 'mimo-v2.5-tts-voiceclone', instruction, references: refs, pairs, hardBudget: { tts: 4, cloudAsr: 0 }, baseline: { total: 43, tts: 23, asr: 20 }, sourceMetadataSha256: sha(readFileSync(metadataFile)), priorBatchUserVerdict: { relayMessageRef: 'm02227', unitRejected: true, tempoAndTimbreDiscontinuityReported: true, batch10And40PromotionRejected: true }, scientificCausalProof: false, caveat: 'One sample per cell, model randomness uncontrolled; reference length alone does not establish quality. New four samples are unapproved.', runtimeManifestShaBefore: sha(readFileSync(join(root, 'assets/voices/manifest.json'))), noPromotion: true }
  mkdirSync(out, { recursive: true })
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2)); return }
  if (!process.argv.includes('--lead-approval=m02227')) throw new Error('APPROVAL_REQUIRED')
  if (existsSync(join(out, 'calls.json'))) throw new Error('NO_RERUN_OR_RETRY')
  const secret = loadMiMoSecret('tts'); if (!secret.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  const ledger = { approvalMessageRef: 'm02227', hardTtsCap: 4, hardCloudAsrCap: 0, calls: [] }, report = { ...plan, status: 'unreviewed-candidates', samples: [] }, commit = () => { save('calls.json', ledger); save('samples.json', report) }; commit()
  for (const pair of pairs) {
    if (ledger.calls.length >= 4 || ledger.calls.some((c) => c.id === pair.id)) throw new Error('BUDGET_OR_DUPLICATE')
    const ref = refs.find((r) => r.id === pair.referenceId), row = { index: ledger.calls.length + 1, id: pair.id, kind: 'tts', at: new Date().toISOString(), phase: 'fetch', status: 'started' }, sample = { ...pair, file: `raw-${pair.id}.wav`, humanListeningVerified: false, currencyVerified: false, qualityPassed: false }; ledger.calls.push(row); report.samples.push(sample); commit()
    try {
      const response = await fetch(`${secret.base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: plan.model, messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: pair.text }], audio: { format: 'wav', voice: `data:audio/wav;base64,${readFileSync(ref.file).toString('base64')}` }, stream: false }), signal: AbortSignal.timeout(300000) })
      row.httpStatus = response.status; if (!response.ok) throw new Error(`HTTP_${response.status}`)
      row.phase = 'response-body'; commit(); const data = await response.json(); row.status = 'received'; row.phase = 'complete'; sample.finishReason = data.choices?.[0]?.finish_reason ?? null; row.usage = Object.fromEntries(Object.entries(data.usage || {}).filter(([k, v]) => /^[a-z_]+$/.test(k) && typeof v === 'number' && Number.isFinite(v))); commit()
      const encoded = data.choices?.[0]?.message?.audio?.data; if (typeof encoded !== 'string' || !encoded) throw new Error('TTS_AUDIO_MISSING')
      const audio = Buffer.from(encoded, 'base64'); if (!audio.length) throw new Error('TTS_AUDIO_EMPTY')
      writeFileSync(join(out, sample.file), audio); sample.sha256 = sha(audio); sample.bytes = audio.length; sample.media = probe(join(out, sample.file)); sample.durationSeconds = Number(sample.media.format.duration)
    } catch (e) {
      row.status = row.status === 'received' ? 'received-processing-error' : 'error'; row.error = /^HTTP_\d+$/.test(e.message) ? e.message : ['TTS_AUDIO_MISSING', 'TTS_AUDIO_EMPTY', 'LOCAL_PROBE_FAILED'].includes(e.message) ? e.message : e.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(e.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : row.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_OR_PROCESSING_FAILED'; sample.error = row.error
    }
    commit(); console.log(JSON.stringify({ id: sample.id, referenceSha256: sample.referenceSha256, unit: sample.unitText, httpStatus: row.httpStatus, status: row.status, durationSeconds: sample.durationSeconds, rawSha256: sample.sha256, error: sample.error }))
  }
  report.actualCalls = { tts: ledger.calls.length, cloudAsr: 0, errors: ledger.calls.filter((r) => r.status !== 'received').length }; report.cumulative = { total: 43 + ledger.calls.length, tts: 23 + ledger.calls.length, asr: 20 }; report.runtimeManifestUnchanged = plan.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))); commit()
  writeFileSync(join(out, 'readable-text.txt'), pairs.map((p) => `${p.id}\nReference SHA256 ${p.referenceSha256}\n${p.text}`).join('\n\n') + '\n')
  console.log(JSON.stringify({ output: out, actualCalls: report.actualCalls, cumulative: report.cumulative, runtimeManifestUnchanged: report.runtimeManifestUnchanged, qualityPassed: false }))
}
main().catch((e) => { console.error(JSON.stringify({ error: ['REFERENCE_SHA_OR_DURATION_MISMATCH', 'APPROVAL_REQUIRED', 'NO_RERUN_OR_RETRY', 'MIMO_SECRET_NOT_FOUND', 'BUDGET_OR_DUPLICATE'].includes(e.message) ? e.message : 'AB_SETUP_FAILED', noRetry: true })); process.exitCode = 1 })
