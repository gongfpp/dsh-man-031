// Entire generated utterance -> a single static gain -> audition WAV. No appended original speech.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { measureVoice, media } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-whole-man-trial'), report = JSON.parse(readFileSync(join(out, 'samples.json'), 'utf8')), sha = (b) => createHash('sha256').update(b).digest('hex')
if (existsSync(join(out, 'auditions.json'))) throw new Error('NO_SECOND_GAIN_PASS_OR_OVERWRITE')
if (report.actualCalls.tts !== 4 || report.actualCalls.cloudAsr !== 0) throw new Error('AWAIT_FOUR_TERMINAL_REQUESTS')
const targetScoreDb = -23.855086777926918, outputs = []
mkdirSync(join(out, 'audition'), { recursive: true })
for (const sample of report.samples.filter((r) => r.sha256 && !r.error)) {
  const rawFile = join(out, sample.file); if (sha(readFileSync(rawFile)) !== sample.sha256) throw new Error('RAW_SHA_MISMATCH')
  const before = measureVoice(rawFile), scoreDb = (before.activeRmsDb + before.activeFrameRmsP75Db) / 2, gainDb = Math.min(targetScoreDb - scoreDb, -2.2 - before.truePeakDb)
  if (![scoreDb, gainDb].every(Number.isFinite)) throw new Error('LEVEL_MEASUREMENT_FAILED')
  const pcm = media(['-v', 'error', '-i', rawFile, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout, samples = pcm.length / 4, gain = 10 ** (gainDb / 20)
  for (let i = 0; i < pcm.length; i += 4) pcm.writeFloatLE(pcm.readFloatLE(i) * gain, i)
  const rawStage = join(out, 'audition', `${sample.id}.f32`), file = join(out, 'audition', `${sample.id}.wav`); writeFileSync(rawStage, pcm)
  media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', rawStage, '-c:a', 'pcm_s16le', file])
  const decodedAfter = media(['-v', 'error', '-i', file, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout
  if (decodedAfter.length !== pcm.length) throw new Error('OUTPUT_SAMPLE_COUNT_CHANGED')
  const row = { id: sample.id, file, sha256: sha(readFileSync(file)), rawFile, rawSha256: sample.sha256, instructionSha256: sample.instructionSha256, referenceSha256: sample.referenceSha256, durationSeconds: samples / 24000, before, targetScoreDb, achievedScoreDb: scoreDb + gainDb, wholeUtteranceStaticGainDb: gainDb, truePeakGainCapped: gainDb < targetScoreDb - scoreDb - .0001, decodedSamplesBefore: samples, decodedSamplesAfter: decodedAfter.length / 4, noAddedStartOrTailSilence: true, addedOriginalMan: false, originalQuoteAppended: false, wholeManAndBodyGeneratedTogether: true, crop: false, wordEdits: false, pitchOrSpeedChange: false, limiter: false, compressor: false, semanticCompletenessVerified: false, currencyVerified: false, manPerformanceVerified: false, humanListeningVerified: false, qualityPassed: false }
  outputs.push(row); console.log(JSON.stringify({ id: row.id, file, durationSeconds: row.durationSeconds, rawSha256: row.rawSha256, sha256: row.sha256, wholeUtteranceGainDb: gainDb, acousticActivityApproxSeconds: before.activeDurationApproxSeconds, truePeakGainCapped: row.truePeakGainCapped }))
}
writeFileSync(join(out, 'auditions.json'), JSON.stringify({ status: 'four-whole-utterance-candidates-await-human-review', outputs, newApiCallsForRendering: 0, ordinaryTtsCallsThisTrial: report.actualCalls.tts, cloudAsrCalls: 0, noPriorHumanApprovalInherited: true, runtimeManifestUnchanged: report.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))), noPromotion: true, acousticActivityCaveat: 'Frame energy proxy, not speaker-only VAD or words-per-minute. Long container duration is not evidence of a slow or complete performance.' }, null, 2) + '\n')
