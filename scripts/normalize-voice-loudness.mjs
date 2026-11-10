// Local candidate variant only. NEVER overwrites assets. No dynamic compression/denoise.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { measureVoice, media, range, LOUDNESS_VERSION, SETTINGS } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'dev/voice-loudness-v2'), before = join(dir, 'before'), out = join(dir, 'variant'), audit = JSON.parse(readFileSync(join(dir, 'audit-before.json'))), baseBytes = readFileSync(join(before, 'manifest.json')), base = JSON.parse(baseBytes)
const sha = (b) => createHash('sha256').update(b).digest('hex'), score = (m) => (m.activeRmsDb + m.activeFrameRmsP75Db) / 2
if (sha(baseBytes) !== audit.sourceManifestSha256) throw new Error('IMMUTABLE_BASELINE_DIGEST_REQUIRED')
const tuning = { version: LOUDNESS_VERSION, strategy: 'measured-LUFS-seed+gated-active-level-static-calibration+oversampled-transient-protection', targetLUFSSeed: -18, targetActiveLevelDb: -18.5, activeLevelDefinition: 'arithmetic mean in dB of gated active RMS and gated 20ms-frame RMS P75; not LUFS', openerEmphasisDb: .5, internalLimiterCeilingDb: -2.2, encodedTruePeakCeilingDb: -1.5, maximumModeledTransientReductionDb: 3, oversamplingRate: 192000, limiterAttackMs: 5, limiterReleaseMs: 50, limiterAutoLevel: false, limiterLatencyCompensation: true, dynamicLoudnorm: false, speechCompressor: false, denoise: false, speedModified: false, pitchModified: false, preserveAllDecodedSamples: true }
const plan = audit.clips.map((c) => {
  const target = tuning.targetActiveLevelDb + (base.openers.includes(c.key) ? tuning.openerEmphasisDb : 0), seed = c.metrics.integratedUsable ? tuning.targetLUFSSeed - c.metrics.integratedLUFS : 0, correction = target - (score(c.metrics) + seed), desired = seed + correction, maximum = tuning.internalLimiterCeilingDb - c.metrics.truePeakDb + tuning.maximumModeledTransientReductionDb
  const gain = Math.min(desired, maximum)
  return { key: c.key, sourceSha256: c.sourceSha256, targetActiveLevelDb: target, measuredActiveLevelDb: score(c.metrics), integratedLUFS: c.metrics.integratedLUFS, integratedUsable: c.metrics.integratedUsable, seedMethod: c.metrics.integratedUsable ? 'measured -18 LUFS static-gain seed; folded into final single gain with active correction' : 'short/non-finite EBU; no LUFS gain, gated-active fallback only', seedGainDb: seed, activeCorrectionDb: correction, desiredGainDb: desired, plannedGainDb: gain, conservativePeakConstraintDb: desired - gain, modeledTransientReductionDb: Math.max(0, c.metrics.truePeakDb + gain - tuning.internalLimiterCeilingDb) }
})
writeFileSync(join(dir, 'normalization-plan.json'), JSON.stringify({ calls: 0, assetsModified: false, sourceManifestSha256: sha(baseBytes), tuning, clips: plan }, null, 2) + '\n')
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ dryRun: true, calls: 0, assetsModified: false, tuning, plannedGains: range(plan.map((p) => ({ gain: p.plannedGainDb })), 'gain'), modeledMaxTransientReductionDb: Math.max(...plan.map((p) => p.modeledTransientReductionDb)), constrainedClips: plan.filter((p) => p.conservativePeakConstraintDb > .01), plan: join(dir, 'normalization-plan.json') }, null, 2))
} else {
  mkdirSync(join(out, 'clips'), { recursive: true }); mkdirSync(join(out, 'sources'), { recursive: true })
  for (const f of ['sources/original-quotes.json', 'sources/processed-bridge.json']) writeFileSync(join(out, f), readFileSync(join(before, f)))
  const manifest = { ...base, status: 'candidate', normalization: tuning, preNormalizationManifestSha256: sha(baseBytes), preNormalizationApprovalNotice: 'Earlier approvals/byte equality describe the immutable source baseline only. Volume-only processing was explicitly requested; no new listening acceptance is implied.', clips: {} }, results = []
  for (const p of plan) {
    const row = base.clips[p.key], source = join(before, row.file), target = join(out, row.file), original = audit.clips.find((c) => c.key === p.key)
    if (sha(readFileSync(source)) !== p.sourceSha256) throw new Error('BASELINE_CLIP_CHANGED:' + p.key)
    let gain = p.plannedGainDb, metrics, filter, attempts = []
    for (let pass = 0; pass < 3; pass++) {
      const limit = Math.pow(10, tuning.internalLimiterCeilingDb / 20)
      filter = `aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono,aresample=${tuning.oversamplingRate},volume=${gain.toFixed(9)}dB,alimiter=limit=${limit.toFixed(9)}:attack=5:release=50:level=false:latency=true,aresample=24000`
      media(['-y', '-v', 'error', '-i', source, '-af', filter, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', target])
      metrics = measureVoice(target)
      if (Math.abs(metrics.decodedDurationSeconds - original.metrics.decodedDurationSeconds) > 1 / 24000) throw new Error('DECODED_DURATION_CHANGED:' + p.key)
      attempts.push({ pass: pass + 1, appliedGainDb: gain, measuredActiveLevelDb: score(metrics), encodedTruePeakDb: metrics.truePeakDb })
      if (metrics.truePeakDb > tuning.encodedTruePeakCeilingDb) { gain -= metrics.truePeakDb - tuning.encodedTruePeakCeilingDb + .08; continue }
      const error = p.targetActiveLevelDb - score(metrics), safeMaximum = tuning.internalLimiterCeilingDb - original.metrics.truePeakDb + tuning.maximumModeledTransientReductionDb
      if (Math.abs(error) <= .18 || pass === 2 || error > 0 && gain >= safeMaximum - .05) break
      gain = Math.min(safeMaximum, gain + Math.max(-1, Math.min(1, error)))
    }
    if (metrics.truePeakDb === null || metrics.truePeakDb > tuning.encodedTruePeakCeilingDb + .01) throw new Error('ENCODED_TRUE_PEAK_EXCEEDS_CEILING:' + p.key)
    const outputSha = sha(readFileSync(target)), duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target], { encoding: 'utf8', windowsHide: true }).stdout.trim())
    const provenance = { version: LOUDNESS_VERSION, sourceClipSha256: p.sourceSha256, sourceManifestSha256: sha(baseBytes), outputSha256: outputSha, appliedGainDb: gain, filter, filterSha256: sha(Buffer.from(filter)), sampleRate: 24000, channels: 1, pitchModified: false, speedModified: false, cropped: false, denoised: false, measuredBefore: original.metrics, measuredAfter: metrics, matchingTargetDb: p.targetActiveLevelDb, matchingScoreBeforeDb: score(original.metrics), matchingScoreAfterDb: score(metrics), sourceAsrEvidencePreserved: true, sourceBoundaryEvidencePreserved: true, attempts }
    manifest.clips[p.key] = { ...row, sha256: outputSha, duration, decodedDurationSeconds: metrics.decodedDurationSeconds, normalization: 'volume-only-v2; original/reference attribution preserved, original bytes retained in baseline backup', previousNormalization: row.normalization, asrEvidenceSourceClipSha256: row.sha256, volumeProcessing: provenance }
    results.push({ key: p.key, text: row.text, synthetic: row.synthetic, before: original.metrics, after: metrics, levelBeforeDb: score(original.metrics), levelAfterDb: score(metrics), appliedGainDb: gain, modeledTransientReductionDb: Math.max(0, original.metrics.truePeakDb + gain - tuning.internalLimiterCeilingDb), outputSha256: outputSha, attempts: attempts.length })
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(out, 'readable-text.txt'), Object.entries(manifest.clips).map(([key, c]) => `${key}\t${c.file}\t${c.text}`).join('\n') + '\nCandidate volume-only v2. Not user approved. No extra API calls. No speed/pitch/crop/denoise.\n')
  const summary = (side) => Object.fromEntries(['activeRmsDb', 'activeFrameRmsP75Db', 'integratedLUFS', 'truePeakDb'].map((key) => [key, range(results.map((r) => r[side]), key)]))
  const report = { schemaVersion: 2, version: LOUDNESS_VERSION, calls: 0, assetsModified: false, baselineManifestSha256: sha(baseBytes), variantManifestSha256: sha(readFileSync(join(out, 'manifest.json'))), tuning, summary: { before: summary('before'), after: summary('after'), matchingScoreBefore: range(results.map((r) => ({ value: r.levelBeforeDb })), 'value'), matchingScoreAfter: range(results.map((r) => ({ value: r.levelAfterDb })), 'value') }, clips: results }
  writeFileSync(join(dir, 'audit-after-clips.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ output: out, calls: 0, assetsModified: false, clips: results.length, summary: report.summary, peakProtection: results.filter((r) => r.modeledTransientReductionDb > .1).map((r) => ({ key: r.key, modeledReductionDb: r.modeledTransientReductionDb, encodedTruePeakDb: r.after.truePeakDb })), note: 'No assets overwritten. All original decoded durations retained; source hashes and volume filter/output hashes explicit. Matching score is an acoustic proxy, not human listening proof.' }, null, 2))
}
