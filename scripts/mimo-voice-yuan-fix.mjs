// Two ordinary synchronous TTS takes; only spoken yuan -> 元 differs from B-tags.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { measureVoice, media } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), matchB = process.argv.includes('--match-b')
const out = join(root, matchB ? 'dev/voice-yuan-performance' : 'dev/voice-yuan-fix')
const baseline = matchB ? { total: 57, tts: 37, asr: 20 } : { total: 55, tts: 35, asr: 20 }
const sha = value => createHash('sha256').update(value).digest('hex')
const load = file => JSON.parse(readFileSync(file, 'utf8'))
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n')
const endpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
const base = load(join(root, 'dev/voice-whole-man-plan/plan.json')).candidates.find(x => x.id === 'B-tags')
if (sha(readFileSync(base.referenceFile)) !== '3a88ae891940ea9f056e3996444dac080de71ee6df390d5f9858fea4e5a01f7d' || sha(base.instruction) !== '69df5e747b13a5f7fb69c2f3b16234b710432ed21f077f8f3306865e537ba414' || sha(base.assistantContent) !== '21cd06ab6dcca646e18c9cad04f11649ed70946290028236ee88b6bfdadacda2') throw new Error('BASELINE_INPUT_CHANGED')
const referenceFile = matchB ? join(root, 'dev/voice-whole-man-trial/audition/B-tags.wav') : base.referenceFile
const reference = readFileSync(referenceFile)
if (matchB && sha(reference) !== '4abcb3f851e18b4b260c32f1da56935ec8b62117016d43f3997bb2f1254d134b') throw new Error('BASELINE_INPUT_CHANGED')
const content = base.assistantContent.replace('one yuan.', 'one 元.')
if (content.replace('one 元.', 'one yuan.') !== base.assistantContent || content === base.assistantContent) throw new Error('UNIT_ONLY_CHANGE_REQUIRED')
const messages = [{ role: 'user', content: base.instruction }, { role: 'assistant', content }]
const input = { model: base.model, endpoint, referenceFile, referenceSha256: sha(reference), referenceIsSynthesized: matchB, messages, assistantSha256: sha(content), onlyChange: matchB ? 'Use user-liked synthesized B-tags performance as reference; keep prior Chinese 元 text and all instructions' : 'spoken yuan -> 元', target: "MAN! That's about zero point three one 元. Job's not finished.", baseline, hardTtsCap: 2, cloudAsrCap: 0, retries: 0, batch: false }
const manifestFile = join(root, 'assets/voices/manifest.json')
function render() {
  const report = load(join(out, 'calls.json')), outputs = []
  mkdirSync(join(out, 'audition'), { recursive: true })
  for (const row of report.calls.filter(x => x.status === 'received')) {
    const raw = join(out, row.file), file = join(out, 'audition', `${row.id}.wav`)
    if (existsSync(file)) throw new Error('AUDITION_ALREADY_EXISTS')
    if (sha(readFileSync(raw)) !== row.sha256) throw new Error('RAW_HASH_MISMATCH')
    const before = measureVoice(raw), score = (before.activeRmsDb + before.activeFrameRmsP75Db) / 2
    const gainDb = Math.min(-23.855086777926918 - score, -2.2 - before.truePeakDb)
    if (!Number.isFinite(gainDb)) throw new Error('LEVEL_MEASUREMENT_FAILED')
    // A single volume filter over the entire generated performance. No crops or joins.
    media(['-v', 'error', '-y', '-i', raw, '-af', `volume=${gainDb}dB`, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', file])
    const after = measureVoice(file)
    if (before.decodedDurationSeconds !== after.decodedDurationSeconds) throw new Error('DURATION_CHANGED')
    const result = { id: row.id, file, sha256: sha(readFileSync(file)), rawSha256: row.sha256, durationSeconds: after.decodedDurationSeconds, gainDb, before, after, wholeUtterance: true, originalSpeechAppended: false, crops: false, speedPitchChange: false, currencyVerified: false, humanListeningVerified: false }
    outputs.push(result)
    console.log(JSON.stringify({ id: row.id, file, durationSeconds: result.durationSeconds, gainDb }))
  }
  save('auditions.json', { outputs, runtimeManifestUnchanged: report.runtimeManifestShaBefore === sha(readFileSync(manifestFile)), noPromotion: true, cloudAsrCalls: 0 })
}
async function run() {
  if (process.argv.includes('--render')) { render(); return }
  if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, newCalls: 0, ...input }, null, 2)); return }
  for (const exe of ['ffmpeg', 'ffprobe']) if (spawnSync(exe, ['-version'], { stdio: 'ignore', windowsHide: true }).status !== 0) throw new Error('LOCAL_MEDIA_TOOL_MISSING')
  const secret = loadMiMoSecret('tts')
  if (!secret.found || secret.base !== 'https://api.xiaomimimo.com/v1') throw new Error('OFFICIAL_TTS_SECRET_REQUIRED')
  mkdirSync(out, { recursive: true })
  const report = { input, runtimeManifestShaBefore: sha(readFileSync(manifestFile)), humanFeedback: { source: '2026-11-09 user audition response', BTags: 'Everything good except yuan pronunciation', ADirector: 'Only yuan correct; other aspects rejected, mysterious drumming at ending', firstChineseYuanTake: 'Currency pronunciation correct but other performance regressed; not approved as a whole' }, calls: [] }
  // Exclusive creation prevents a second run from sending more requests.
  writeFileSync(join(out, 'calls.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  const commit = () => { report.actualCalls = { tts: report.calls.length, cloudAsr: 0 }; report.cumulative = { total: baseline.total + report.calls.length, tts: baseline.tts + report.calls.length, asr: baseline.asr }; save('calls.json', report) }
  for (const id of ['take-1', 'take-2']) {
    const row = { id, at: new Date().toISOString(), status: 'started', file: `raw-${id}.wav` }
    report.calls.push(row); commit() // Reserve before network. No retries, including failures.
    try {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model, messages, audio: { format: 'wav', voice: `data:audio/wav;base64,${reference.toString('base64')}` }, stream: false }), signal: AbortSignal.timeout(180000) })
      row.httpStatus = response.status
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      const data = await response.json(), encoded = data.choices?.[0]?.message?.audio?.data
      if (typeof encoded !== 'string' || !encoded.length) throw new Error('AUDIO_MISSING')
      const bytes = Buffer.from(encoded, 'base64')
      writeFileSync(join(out, row.file), bytes)
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name', '-of', 'json', join(out, row.file)], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      if (probe.status !== 0) throw new Error('WAV_PROBE_FAILED')
      const info = JSON.parse(probe.stdout)
      if (info.format?.format_name !== 'wav' || !(Number(info.format.duration) > 0)) throw new Error('INVALID_WAV')
      Object.assign(row, { status: 'received', sha256: sha(bytes), bytes: bytes.length, durationSeconds: Number(info.format.duration), finishReason: data.choices?.[0]?.finish_reason ?? null, semanticVerified: false, humanListeningVerified: false })
      commit(); console.log(JSON.stringify({ id, status: row.status, durationSeconds: row.durationSeconds, finishReason: row.finishReason, cumulative: report.cumulative }))
    } catch (e) {
      row.status = 'error'; row.error = /^HTTP_\d+$/.test(e.message) || ['AUDIO_MISSING', 'WAV_PROBE_FAILED', 'INVALID_WAV'].includes(e.message) ? e.message : 'REQUEST_OR_RESPONSE_FAILED'
      commit(); console.error(JSON.stringify({ id, error: row.error, cumulative: report.cumulative, noRetry: true })); process.exitCode = 1; return
    }
  }
  render()
}
run().catch(e => { console.error(JSON.stringify({ error: ['BASELINE_INPUT_CHANGED', 'UNIT_ONLY_CHANGE_REQUIRED', 'LOCAL_MEDIA_TOOL_MISSING', 'OFFICIAL_TTS_SECRET_REQUIRED', 'AUDITION_ALREADY_EXISTS', 'RAW_HASH_MISMATCH', 'DURATION_CHANGED', 'LEVEL_MEASUREMENT_FAILED'].includes(e.message) ? e.message : e.code === 'EEXIST' ? 'EXISTING_LEDGER_NO_NEW_REQUESTS' : 'LOCAL_SETUP_OR_RENDER_FAILED', noRetry: true })); process.exitCode = 1 })
