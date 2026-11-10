// Audit first; makes an immutable local backup, never changes assets.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { measureVoice, range, SETTINGS, LOUDNESS_VERSION } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), assets = join(root, 'assets/voices'), dir = join(root, 'dev/voice-loudness-v2'), before = join(dir, 'before')
const sha = (b) => createHash('sha256').update(b).digest('hex'), bytes = readFileSync(join(assets, 'manifest.json')), manifest = JSON.parse(bytes)
if (manifest.status !== 'candidate' || Object.keys(manifest.clips).length !== 44) throw new Error('EXACT_44_CANDIDATE_REQUIRED')
mkdirSync(join(before, 'clips'), { recursive: true }); mkdirSync(join(before, 'sources'), { recursive: true })
if (existsSync(join(before, 'manifest.json')) && sha(readFileSync(join(before, 'manifest.json'))) !== sha(bytes)) throw new Error('IMMUTABLE_PRE_NORMALIZATION_BASELINE_DIFFERS')
writeFileSync(join(before, 'manifest.json'), bytes)
for (const name of ['readable-text.txt', 'sources/original-quotes.json', 'sources/processed-bridge.json']) writeFileSync(join(before, name), readFileSync(join(assets, name)))
const clips = []
for (const [key, row] of Object.entries(manifest.clips)) {
  const audio = readFileSync(join(assets, row.file))
  if (sha(audio) !== row.sha256) throw new Error('BASELINE_AUDIO_SHA_MISMATCH:' + key)
  if (existsSync(join(before, row.file)) && sha(readFileSync(join(before, row.file))) !== row.sha256) throw new Error('IMMUTABLE_BASELINE_AUDIO_DIFFERS')
  writeFileSync(join(before, row.file), audio)
  clips.push({ key, text: row.text, synthetic: row.synthetic, sourceSha256: row.sha256, path: join(before, row.file), metrics: measureVoice(join(before, row.file)) })
}
const previewDir = join(root, 'dev/voice-quote-audition'), previews = JSON.parse(readFileSync(join(previewDir, 'manifest.json')))
if (previews.sourceManifestSha256 !== sha(bytes) || previews.previews.length !== 9) throw new Error('EXACT_CURRENT_NINE_COMPOSITES_REQUIRED')
const composites = previews.previews.map((p) => { const path = join(previewDir, p.file); if (sha(readFileSync(path)) !== p.sha256) throw new Error('COMPOSITE_SHA_MISMATCH'); return { id: p.id, path, sourceSha256: p.sha256, metrics: measureVoice(path) } })
const summary = (rows) => Object.fromEntries(['activeRmsDb', 'activeFrameRmsP75Db', 'integratedLUFS', 'truePeakDb'].map((key) => [key, range(rows.map((r) => r.metrics), key)]))
const report = { schemaVersion: 2, version: LOUDNESS_VERSION, calls: 0, assetsModified: false, sourceManifestSha256: sha(bytes), settings: SETTINGS, activityGateNotice: '20ms acoustic activity frames / 10ms hop, >=max(-48dBFS,p95-18dB); not speaker-only VAD. Speech-overlapping noise is not isolated or denoised. LUFS non-finite values remain null, never zero.', clips, composites, summary: { clips: summary(clips), composites: summary(composites) } }
writeFileSync(join(dir, 'audit-before.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ report: join(dir, 'audit-before.json'), clips: clips.length, composites: composites.length, nullOrShortIntegrated: clips.filter((c) => !c.metrics.integratedUsable).map((c) => c.key), summary: report.summary, calls: 0, assetsModified: false }, null, 2))
