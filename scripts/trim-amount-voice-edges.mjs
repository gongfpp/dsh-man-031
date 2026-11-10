// Offline edge audit. Default writes only dev evidence; --run applies audited trims.
// No paid calls. Preserve complete speech; never compress time or silence inside a word.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { ENGLISH_CLIP_TEXT } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const voices = join(root, 'assets/voices'), dev = join(root, 'dev/voice-edge-trim')
const manifestFile = join(voices, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const hash = (b) => createHash('sha256').update(b).digest('hex')
function media(command, args, binary = false) {
  const r = spawnSync(command, args, { encoding: binary ? undefined : 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw new Error(`MEDIA_COMMAND_FAILED:${command}`)
  return r
}
if (manifest.language !== 'en' || manifest.status !== 'candidate') throw new Error('ENGLISH_CANDIDATE_REQUIRED')
const rows = Object.keys(ENGLISH_CLIP_TEXT).map((key) => {
  const c = manifest.clips[key], source = join(voices, c.file), bytes = readFileSync(source)
  if (hash(bytes) !== c.sha256) throw new Error(`SOURCE_DIGEST_MISMATCH:${key}`)
  const raw = media('ffmpeg', ['-v', 'error', '-i', source, '-f', 'f32le', '-ar', '24000', '-ac', '1', 'pipe:1'], true).stdout
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
  const duration = samples.length / 24000
  const bins = []
  for (let s = 0; s < samples.length; s += 240) {
    let power = 0, peak = 0; const n = Math.min(240, samples.length - s)
    for (let i = 0; i < n; i++) { const a = samples[s + i]; power += a * a; peak = Math.max(peak, Math.abs(a)) }
    const rmsDb = 10 * Math.log10(Math.max(1e-20, power / n)), peakDb = 20 * Math.log10(Math.max(1e-10, peak))
    bins.push({ start: s / 24000, end: (s + n) / 24000, rmsDb: Number(rmsDb.toFixed(2)), peakDb: Number(peakDb.toFixed(2)) })
  }
  // Compensate the existing static gain so silence is judged in original model level.
  // A bin counts as active if either conservative RMS or peak criterion says so.
  const gainDb = c.gainDb || 0
  const active = bins.filter((b) => b.rmsDb - gainDb > -48 || b.peakDb - gainDb > -42)
  if (!active.length) throw new Error(`NO_ACTIVE_AUDIO:${key}`)
  const start = Math.max(0, active[0].start - 0.05)
  const end = Math.min(duration, active.at(-1).end + 0.05)
  const apply = start >= 0.04 || duration - end >= 0.04
  const proposedStart = apply ? start : 0, proposedEnd = apply ? end : duration
  return { key, source, file: c.file, sourceSha256: c.sha256, previousContainerDuration: c.duration, decodedDuration: duration, priorGainDb: gainDb, voiceActiveStart: active[0].start, voiceActiveEnd: active.at(-1).end, proposedStart, proposedEnd, proposedDecodedDuration: proposedEnd - proposedStart, removedSeconds: duration - (proposedEnd - proposedStart), apply, bins }
})
const report = { schemaVersion: 1, calls: 0, method: '10ms RMS/peak edge-only detector, existing gain compensated; no internal edits', rmsThresholdDb: -48, peakThresholdDb: -42, paddingSeconds: 0.05, sourceManifestSha256: hash(readFileSync(manifestFile)), beforeSeconds: rows.reduce((s, r) => s + r.decodedDuration, 0), proposedSeconds: rows.reduce((s, r) => s + r.proposedDecodedDuration, 0), changedClips: rows.filter((r) => r.apply).length, humanBoundaryReviewed: false, rows }
mkdirSync(dev, { recursive: true })
const auditFile = join(dev, 'edge-audit.json')
if (process.argv.includes('--run')) {
  if (!existsSync(auditFile)) throw new Error('PRIOR_DRY_RUN_AUDIT_REQUIRED')
  const prior = JSON.parse(readFileSync(auditFile, 'utf8'))
  if (prior.sourceManifestSha256 !== report.sourceManifestSha256 || JSON.stringify(prior.rows) !== JSON.stringify(rows)) throw new Error('AUDITED_SOURCES_CHANGED')
  for (const row of rows) {
    if (!row.apply) continue
    const c = manifest.clips[row.key], backup = join(dev, 'before', `${row.key}.mp3`)
    mkdirSync(join(dev, 'before'), { recursive: true }); writeFileSync(backup, readFileSync(row.source))
    const target = join(dev, `${row.key}.mp3`)
    media('ffmpeg', ['-y', '-v', 'error', '-i', row.source, '-af', `atrim=start=${row.proposedStart}:end=${row.proposedEnd},asetpts=PTS-STARTPTS`, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', target])
    const bytes = readFileSync(target)
    c.edgeTrim = { sourceSha256: row.sourceSha256, sourceDecodedDuration: row.decodedDuration, startSeconds: row.proposedStart, endSeconds: row.proposedEnd, paddingSeconds: 0.05, method: report.method, gainModified: false, pitchModified: false, speedModified: false }
    c.sha256 = hash(bytes)
    c.duration = Number(media('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target]).stdout.trim())
    writeFileSync(row.source, bytes)
  }
  manifest.edgeTrimming = { calls: 0, method: report.method, changedClips: report.changedClips, paddingSeconds: 0.05, humanBoundaryReviewed: false }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(dev, 'applied.json'), JSON.stringify(report, null, 2) + '\n')
} else writeFileSync(auditFile, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ dryRun: !process.argv.includes('--run'), calls: 0, audit: auditFile, beforeSeconds: report.beforeSeconds, proposedSeconds: report.proposedSeconds, changedClips: report.changedClips, rows: rows.map(({ key, decodedDuration, proposedDecodedDuration, removedSeconds, proposedStart, proposedEnd, apply }) => ({ key, decodedDuration, proposedDecodedDuration, removedSeconds, proposedStart, proposedEnd, apply })) }, null, 2))
