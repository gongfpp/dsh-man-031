// Offline only: exact group ASR plus silence-count evidence -> candidate token cuts.
// node scripts/slice-amount-voice-english.mjs [--run] (no service calls)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { englishVoiceGroupPlan as expected } from './plan-amount-voice-english.mjs'
import { buildPack, validatePlan } from './normalize-voice-pack.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = join(root, 'dev/voice-pilot-en-b-groups')
const report = JSON.parse(readFileSync(join(dir, 'samples.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(join(dir, 'calls.json'), 'utf8'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
function media(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 })
  if (r.error || r.status !== 0) throw new Error(`MEDIA_COMMAND_FAILED:${command}`)
  return r
}
if (report.id !== expected.id || JSON.stringify(report.plan) !== JSON.stringify(expected) || report.quality.asrVerified !== true || report.samples.length !== 4 || ledger.calls.length !== 8 || !ledger.calls.every((c) => c.status === 'received' && c.phase === 'complete' && c.referenceSha256 === expected.referenceSha256)) throw new Error('COMPLETE_GROUP_ASR_AND_LEDGER_REQUIRED')
const plan = { language: 'en', reference: { sha256: expected.referenceSha256 }, attribution: report.attribution, quality: { asrVerified: true, listeningVerified: false, identitySimilarityVerified: false, crossLanguageVerified: false }, openers: [...expected.approvedOpeners], clips: {}, amounts: {}, segmentation: { thresholdDb: -38, minimumSilenceSeconds: 0.35, prePaddingSeconds: 0.08, postPaddingSeconds: 0.12, humanReviewed: false, groups: [] } }
for (const group of expected.groups) {
  const row = report.samples.find((s) => s.id === group.id)
  if (!row?.asrTextMatch || row.referenceSha256 !== expected.referenceSha256 || sha(readFileSync(join(dir, row.file))) !== row.sha256) throw new Error('GROUP_AUDIO_OR_ASR_NOT_VALID')
  const duration = Number(media('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, row.file)]).stdout.trim())
  const log = media('ffmpeg', ['-hide_banner', '-nostats', '-i', join(dir, row.file), '-af', 'silencedetect=n=-38dB:d=0.35', '-f', 'null', '-']).stderr
  const silences = []; let pending
  for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    if (match[1] === 'start') pending = Number(match[2])
    else { if (pending === undefined) throw new Error('UNPAIRED_SILENCE_BOUNDARY'); silences.push({ start: pending, end: Number(match[2]) }); pending = undefined }
  }
  if (pending !== undefined) throw new Error('UNPAIRED_SILENCE_BOUNDARY')
  const internal = silences.filter((s) => s.start > 0.02 && s.end < duration - 0.02)
  if (internal.length !== group.keys.length - 1) throw new Error(`SILENCE_SEGMENT_COUNT_MISMATCH:${group.id}:${internal.length + 1}:${group.keys.length}`)
  // Never split inside speech: each cut uses only an observed >=.35s gap.
  const segments = group.expectedTokens.map(({ key, text }, i) => {
    const start = i ? Math.max(0, internal[i - 1].end - 0.08) : 0
    const end = i < internal.length ? Math.min(duration, internal[i].start + 0.12) : duration
    if (!(end > start && end - start < 4)) throw new Error(`INVALID_WORD_SEGMENT:${key}`)
    plan.clips[key] = { source: row.file, start, end, text, referenceSha256: expected.referenceSha256, boundaryReviewed: false, boundaryReviewMethod: 'silencedetect-count+group-asr', asrVerified: true, asrScope: 'complete-group-sequence-and-ordered-silence-count' }
    return { key, text, start, end }
  })
  plan.segmentation.groups.push({ id: group.id, source: row.file, sourceDurationSeconds: duration, heard: row.heard, asrTextMatch: true, observedInternalSilences: internal, segmentCount: segments.length, segments })
}
const manDir = join(root, 'dev/voice-pilot-man')
const man = JSON.parse(readFileSync(join(manDir, 'samples.json'), 'utf8'))
if (man.reference.sha256 !== expected.referenceSha256) throw new Error('OPENERS_MUST_SHARE_REFERENCE')
for (const key of plan.openers) {
  const row = man.samples.find((s) => s.id === key)
  if (!row?.asrTextMatch || sha(readFileSync(join(manDir, row.file))) !== row.sha256) throw new Error('APPROVED_OPENER_FILE_NOT_VALID')
  // User accepted these complete files; preserve their original bytes, not a fresh trim.
  plan.clips[key] = { source: `../voice-pilot-man/${row.file}`, start: 0, end: row.fileDurationSeconds, text: row.text, referenceSha256: expected.referenceSha256, boundaryReviewed: true, boundaryReviewMethod: 'user-approved-complete-original-file', asrVerified: true, listeningVerified: true, preserveOriginal: true }
}
if (Object.keys(plan.clips).length !== 39) throw new Error('COMPLETE_39_CLIPS_REQUIRED')
validatePlan(plan)
if (!process.argv.includes('--run')) console.log(JSON.stringify({ dryRun: true, calls: 0, status: 'candidate', clipCount: Object.keys(plan.clips).length, openers: plan.openers, groupSegments: plan.segmentation.groups.map(({ id, segmentCount, sourceDurationSeconds }) => ({ id, segmentCount, sourceDurationSeconds })), listeningVerified: false, boundaryHumanReviewed: false }, null, 2))
else {
  const file = join(dir, 'candidate-cut-plan.json')
  writeFileSync(file, JSON.stringify(plan, null, 2) + '\n')
  console.log(JSON.stringify(buildPack(file, join(root, 'assets/voices'), false), null, 2))
}
