// One whole-body gain pass, exact same accepted classic MAN stage; never edits words or runtime files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { measureVoice, media } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-continuous-confirmation'), sha = (b) => createHash('sha256').update(b).digest('hex'), report = JSON.parse(readFileSync(join(out, 'samples.json'), 'utf8')), accepted = report.historicalHumanApproval
const targetScoreDb = -23.855086777926918, manFile = accepted.unchangedManStage
if (sha(readFileSync(manFile)) !== accepted.manStageSha256) throw new Error('MAN_STAGE_SHA_MISMATCH')
const manPcm = media(['-v', 'error', '-i', manFile, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout
mkdirSync(join(out, 'audition'), { recursive: true }); mkdirSync(join(out, 'level-matched'), { recursive: true })
const outputs = []
for (const sample of report.samples.filter((r) => r.sha256 && !r.error)) {
  const rawBodyFile = join(out, sample.file); if (sha(readFileSync(rawBodyFile)) !== sample.sha256) throw new Error('RAW_SHA_MISMATCH')
  const before = measureVoice(rawBodyFile), scoreDb = (before.activeRmsDb + before.activeFrameRmsP75Db) / 2, gainDb = Math.min(targetScoreDb - scoreDb, -2.2 - before.truePeakDb), pcm = media(['-v', 'error', '-i', rawBodyFile, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout
  if (![scoreDb, gainDb].every(Number.isFinite)) throw new Error('LEVEL_MEASUREMENT_FAILED')
  const gain = 10 ** (gainDb / 20); for (let i = 0; i < pcm.length; i += 4) pcm.writeFloatLE(pcm.readFloatLE(i) * gain, i)
  const stageRaw = join(out, 'level-matched', `${sample.id}.f32`), bodyStageFile = join(out, 'level-matched', `${sample.id}.wav`); writeFileSync(stageRaw, pcm)
  media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', stageRaw, '-c:a', 'pcm_s16le', bodyStageFile])
  const complete = Buffer.concat([Buffer.alloc(720 * 4), manPcm, pcm]), raw = join(out, 'audition', `${sample.id}-classic.f32`), file = join(out, 'audition', `${sample.id}-classic.wav`); writeFileSync(raw, complete)
  media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', file])
  const row = { id: sample.id, currency: sample.currency, amount: sample.amount, text: sample.text, unit: sample.unit, referenceSha256: report.reference.sha256, rawBodyFile, rawBodySha256: sample.sha256, rawBodySamples: pcm.length / 4, bodyStageFile, bodyStageSha256: sha(readFileSync(bodyStageFile)), wholeBodyStaticGainDb: gainDb, targetScoreDb, achievedScoreDb: scoreDb + gainDb, truePeakGainCapped: gainDb < targetScoreDb - scoreDb - .0001, before, manStageFile: manFile, manStageSha256: accepted.manStageSha256, manAdditionalGainDb: 0, manSamples: manPcm.length / 4, file, sha256: sha(readFileSync(file)), durationSeconds: complete.length / 4 / 24000, startSilenceSeconds: .03, interPartGapSeconds: 0, syntheticMan: false, originalQuoteAppended: false, crop: false, wordEdits: false, pitchOrSpeedChange: false, limiter: false, compressor: false, currencyVerified: false, humanListeningVerified: false, qualityPassed: false }
  outputs.push(row); console.log(JSON.stringify({ id: row.id, file, durationSeconds: row.durationSeconds, rawBodySha256: row.rawBodySha256, sha256: row.sha256, gainDb }))
}
writeFileSync(join(out, 'auditions.json'), JSON.stringify({ status: 'new-amounts-unreviewed', priorApprovalScope: 'Only previous CNY0.31 plus classic C composite', outputs, apiCallsForRendering: 0, runtimeManifestUnchanged: report.runtimeManifestShaBefore === sha(readFileSync(join(root, 'assets/voices/manifest.json'))), noPromotion: true }, null, 2) + '\n')
