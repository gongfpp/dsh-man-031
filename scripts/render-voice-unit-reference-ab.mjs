// Reuse exactly the previously heard classic MAN stage; static gain per complete new body only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { measureVoice, media } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-unit-reference-ab'), json = (p) => JSON.parse(readFileSync(p, 'utf8')), sha = (b) => createHash('sha256').update(b).digest('hex')
const report = json(join(out, 'samples.json')), previous = json(join(root, 'dev/voice-hybrid-v1/auditions.json')), man = previous.sources.find((s) => s.id === 'man-classic')
if (sha(readFileSync(man.matchedFile)) !== man.outputSha256) throw new Error('ACCEPTED_MAN_STAGE_SHA_MISMATCH')
const manPcm = media(['-v', 'error', '-i', man.matchedFile, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout
mkdirSync(join(out, 'audition'), { recursive: true }); mkdirSync(join(out, 'level-matched'), { recursive: true })
const outputs = []
for (const s of report.samples.filter((s) => s.sha256 && !s.error)) {
  const file = join(out, s.file); if (sha(readFileSync(file)) !== s.sha256) throw new Error('RAW_SHA_MISMATCH')
  const before = measureVoice(file), scoreDb = (before.activeRmsDb + before.activeFrameRmsP75Db) / 2, targetDb = previous.normalization.targetScoreDb
  const gainDb = Math.min(targetDb - scoreDb, -2.2 - before.truePeakDb), pcm = media(['-v', 'error', '-i', file, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout, gain = 10 ** (gainDb / 20)
  if (![scoreDb, gainDb].every(Number.isFinite)) throw new Error('LEVEL_MEASUREMENT_FAILED')
  for (let i = 0; i < pcm.length; i += 4) pcm.writeFloatLE(pcm.readFloatLE(i) * gain, i)
  const stageRaw = join(out, 'level-matched', `${s.id}.f32`), stage = join(out, 'level-matched', `${s.id}.wav`); writeFileSync(stageRaw, pcm)
  media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', stageRaw, '-c:a', 'pcm_s16le', stage])
  const complete = Buffer.concat([Buffer.alloc(720 * 4), manPcm, pcm]), raw = join(out, 'audition', `${s.id}-classic.f32`), output = join(out, 'audition', `${s.id}-classic.wav`); writeFileSync(raw, complete)
  media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', output])
  const row = { id: s.id, referenceId: s.referenceId, referenceSha256: s.referenceSha256, unitText: s.unitText, bodyText: s.text, file: output, sha256: sha(readFileSync(output)), durationSeconds: complete.length / 4 / 24000, rawBodyFile: file, rawBodySha256: s.sha256, rawBodySamples: pcm.length / 4, bodyStageFile: stage, bodyStageSha256: sha(readFileSync(stage)), before, targetScoreDb: targetDb, achievedScoreDb: scoreDb + gainDb, wholeBodyStaticGainDb: gainDb, truePeakGainCapped: gainDb < targetDb - scoreDb - .0001, unchangedManStage: man.matchedFile, manStageSha256: man.outputSha256, manAdditionalGainDb: 0, manSamples: manPcm.length / 4, startSilenceSeconds: .03, interPartGapSeconds: 0, syntheticMan: false, originalQuoteAppended: false, limiter: false, compressor: false, wordEdits: false, crop: false, pitchOrSpeedChange: false, currencyVerified: false, humanListeningVerified: false, qualityPassed: false }
  outputs.push(row); console.log(JSON.stringify({ id: row.id, file: output, durationSeconds: row.durationSeconds, unit: row.unitText, bodyGainDb: gainDb, sha256: row.sha256 }))
}
writeFileSync(join(out, 'auditions.json'), JSON.stringify({ status: 'unreviewed-2x2-single-samples', priorBatchQualityRejectedByUser: true, apiCallsForRendering: 0, outputs, runtimeManifestUnchanged: report.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))), noPromotion: true, causalProof: false }, null, 2) + '\n')
