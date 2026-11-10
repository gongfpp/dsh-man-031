// Candidate evidence audit only. Never promotes, writes assets, or calls a service.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { media, LOUDNESS_VERSION } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'dev/voice-loudness-v2'), before = join(dir, 'before'), variant = join(dir, 'variant'), sha = (b) => createHash('sha256').update(b).digest('hex')
const baseBytes = readFileSync(join(before, 'manifest.json')), base = JSON.parse(baseBytes), bytes = readFileSync(join(variant, 'manifest.json')), pack = JSON.parse(bytes), after = JSON.parse(readFileSync(join(dir, 'audit-after-clips.json'))), composite = JSON.parse(readFileSync(join(dir, 'composite-before-after.json')))
assert.equal(pack.status, 'candidate'); assert.equal(pack.normalization.version, LOUDNESS_VERSION)
assert.equal(pack.preNormalizationManifestSha256, sha(baseBytes)); assert.equal(after.variantManifestSha256, sha(bytes)); assert.equal(composite.variantManifestSha256, sha(bytes))
assert.deepEqual(Object.keys(pack.clips), Object.keys(base.clips)); assert.equal(Object.keys(pack.clips).length, 44)
for (const key of ['openers', 'phrases', 'originalQuotes', 'quality', 'amounts', 'reference']) assert.deepEqual(pack[key], base[key])
assert.equal(sha(readFileSync(join(root, 'assets/voices/manifest.json'))), sha(baseBytes), 'active assets must still be the untouched baseline')
function decode(file) { const b = media(['-v', 'error', '-i', file, '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1'], true).stdout, a = new Float32Array(b.length / 4); for (let i = 0; i < a.length; i++) a[i] = b.readFloatLE(i * 4); return a }
function alignment(a, b) {
  assert.equal(a.length, b.length)
  let bestLag = null, bestCorrelation = -Infinity
  for (let lag = -48; lag <= 48; lag++) {
    let xy = 0, xx = 0, yy = 0
    for (let i = 64; i < a.length - 64; i += 4) { const x = a[i], y = b[i + lag]; xy += x * y; xx += x * x; yy += y * y }
    const correlation = xx && yy ? xy / Math.sqrt(xx * yy) : null
    if (correlation !== null && correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag }
  }
  return { bestLagSamples: bestLag, bestLagSeconds: bestLag === null ? null : bestLag / 24000, normalizedCorrelation: bestCorrelation, searchWindowSamples: [-48, 48], correlationStrideSamples: 4 }
}
const clips = []
for (const [key, c] of Object.entries(pack.clips)) {
  const b = base.clips[key], p = c.volumeProcessing, source = join(before, b.file), output = join(variant, c.file), result = after.clips.find((r) => r.key === key)
  assert.equal(p.version, LOUDNESS_VERSION); assert.equal(p.sourceClipSha256, b.sha256); assert.equal(p.sourceManifestSha256, sha(baseBytes)); assert.equal(sha(readFileSync(source)), b.sha256); assert.equal(p.outputSha256, c.sha256); assert.equal(sha(readFileSync(output)), c.sha256)
  assert.equal(sha(Buffer.from(p.filter)), p.filterSha256); assert.ok(Number.isFinite(p.appliedGainDb) && Math.abs(p.appliedGainDb) < 20)
  const limit = Math.pow(10, pack.normalization.internalLimiterCeilingDb / 20)
  const expectedFilter = `aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono,aresample=192000,volume=${p.appliedGainDb.toFixed(9)}dB,alimiter=limit=${limit.toFixed(9)}:attack=5:release=50:level=false:latency=true,aresample=24000`
  assert.equal(p.filter, expectedFilter)
  for (const flag of ['pitchModified', 'speedModified', 'cropped', 'denoised']) assert.equal(p[flag], false)
  assert.ok(p.measuredAfter.truePeakDb <= -1.5); assert.ok(result.modeledTransientReductionDb <= 3.001)
  for (const [field, value] of Object.entries(b)) if (!['sha256', 'duration', 'normalization'].includes(field)) assert.deepEqual(c[field], value, 'source/content evidence changed:' + key + ':' + field)
  assert.deepEqual(c.previousNormalization, b.normalization); assert.equal(c.asrEvidenceSourceClipSha256, b.sha256)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', output], { encoding: 'utf8', windowsHide: true })
  assert.equal(probe.status, 0); const stream = JSON.parse(probe.stdout).streams[0]; assert.equal(Number(stream.sample_rate), 24000); assert.equal(stream.channels, 1)
  const a = decode(source), z = decode(output), timing = alignment(a, z)
  assert.equal(timing.bestLagSamples, 0, 'measured waveform alignment shifted:' + key)
  assert.ok(timing.normalizedCorrelation > .90, 'unexpected waveform difference:' + key)
  clips.push({ key, sourceSha256: b.sha256, filterSha256: p.filterSha256, outputSha256: c.sha256, decodedSourceSamples: a.length, decodedOutputSamples: z.length, ...timing })
}
for (const r of composite.rows) { assert.equal(sha(readFileSync(r.afterFile)), r.afterSha256); assert.equal(sha(readFileSync(r.beforeFile)), r.beforeSha256); assert.equal(r.before.decodedDurationSeconds, r.after.decodedDurationSeconds) }
const report = { schemaVersion: 2, version: LOUDNESS_VERSION, evidencePassed: true, calls: 0, assetsModified: false, canExecutePromotion: false, sourceManifestSha256: sha(baseBytes), variantManifestSha256: sha(bytes), decodedLengthMaxErrorSamples: Math.max(...clips.map((c) => Math.abs(c.decodedSourceSamples - c.decodedOutputSamples))), waveformBestLagMaxAbsoluteSamples: Math.max(...clips.map((c) => Math.abs(c.bestLagSamples))), lowestWaveformCorrelation: Math.min(...clips.map((c) => c.normalizedCorrelation)), originalByteEqualityScope: 'before/ only; output deliberately changes under volume-only v2 with source/filter/output digests', reviewStatus: 'pending user listening; no new verified/identity/boundary attestation', clips, composites: composite.rows.map((r) => ({ id: r.id, sourceSha256: r.beforeSha256, outputSha256: r.afterSha256, beforeLUFS: r.before.integratedLUFS, afterLUFS: r.after.integratedLUFS, beforeTruePeakDb: r.before.truePeakDb, afterTruePeakDb: r.after.truePeakDb })) }
writeFileSync(join(dir, 'evidence-audit.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ evidencePassed: true, clips: clips.length, sourceManifestSha256: report.sourceManifestSha256, variantManifestSha256: report.variantManifestSha256, decodedLengthMaxErrorSamples: report.decodedLengthMaxErrorSamples, waveformBestLagMaxAbsoluteSamples: report.waveformBestLagMaxAbsoluteSamples, lowestWaveformCorrelation: report.lowestWaveformCorrelation, composites: report.composites, calls: 0, assetsModified: false, canExecutePromotion: false, report: join(dir, 'evidence-audit.json') }, null, 2))
