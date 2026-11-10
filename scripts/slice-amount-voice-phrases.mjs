// Offline incremental build: full-group ASR + exactly four observed silence gaps.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { phraseVoicePlan as expected } from './plan-amount-voice-phrases.mjs'
import { normalizeEnglishASR } from './amount-voice-english.mjs'
import { buildPack, validatePlan } from './normalize-voice-pack.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'dev/voice-pilot-en-b-phrases'), assets = join(root, 'assets/voices')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n')
const report = JSON.parse(readFileSync(join(dir, 'samples.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(join(dir, 'calls.json'), 'utf8'))
const base = JSON.parse(readFileSync(join(dir, 'base-manifest.json'), 'utf8'))
const manifestBytes = readFileSync(join(assets, 'manifest.json'))
if (report.id !== expected.id || JSON.stringify(report.plan) !== JSON.stringify(expected) || !report.quality.asrVerified || normalizeEnglishASR(report.heard) !== normalizeEnglishASR(expected.text) || ledger.calls.length !== 2 || !ledger.calls.every((c) => c.status === 'received' && c.phase === 'complete' && c.referenceSha256 === expected.referenceSha256) || sha(readFileSync(join(dir, report.file))) !== report.sha256) throw new Error('COMPLETE_PHRASE_GROUP_ASR_AND_LEDGER_REQUIRED')
if (sha(manifestBytes) !== report.baseManifestSha256 || Object.keys(base.clips).length !== 40) throw new Error('UNMODIFIED_APPROVED_40_CLIP_BASE_REQUIRED')
for (const c of Object.values(base.clips)) if (sha(readFileSync(join(assets, c.file))) !== c.sha256) throw new Error('APPROVED_BASE_AUDIO_CHANGED')
function media(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 }); if (r.error || r.status !== 0) throw new Error(`LOCAL_MEDIA_FAILED:${cmd}`); return r }
const source = join(dir, report.file)
const duration = Number(media('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source]).stdout.trim())
const log = media('ffmpeg', ['-hide_banner', '-nostats', '-i', source, '-af', 'silencedetect=n=-38dB:d=0.35', '-f', 'null', '-']).stderr
const silences = []; let start
for (const m of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
  if (m[1] === 'start') start = Number(m[2])
  else { if (start === undefined) throw new Error('UNPAIRED_SILENCE'); silences.push({ start, end: Number(m[2]) }); start = undefined }
}
if (start !== undefined && duration - start > 0.02) silences.push({ start, end: duration })
const gaps = silences.filter((g) => g.start > 0.02 && g.end < duration - 0.02)
if (gaps.length !== 4) throw new Error(`PHRASE_SILENCE_COUNT_MISMATCH:${gaps.length}:4`)
const plan = { language: 'en', reference: base.reference, attribution: base.attribution, phrases: expected.phrases, quality: { asrVerified: true, listeningVerified: false, identitySimilarityVerified: false, crossLanguageVerified: false }, clips: {}, amounts: {}, segmentation: { ...expected.segmentation, observedInternalSilences: gaps, sourceDurationSeconds: duration, groupFileSha256: report.sha256, fullGroupHeard: report.heard, boundaryHumanReviewed: false } }
for (const [i, item] of expected.items.entries()) {
  const from = i ? Math.max(0, gaps[i - 1].end - 0.05) : 0
  const to = i < gaps.length ? Math.min(duration, gaps[i].start + 0.05) : duration
  if (!(to > from && to - from < 10)) throw new Error('INVALID_PHRASE_SEGMENT')
  plan.clips[item.key] = { source: report.file, start: from, end: to, text: item.text, referenceSha256: expected.referenceSha256, boundaryReviewed: false, boundaryReviewMethod: 'silencedetect-count+group-asr', asrVerified: true, asrScope: 'complete-five-phrase-group-sequence-and-four-ordered-silence-gaps', listeningVerified: false }
}
validatePlan(plan)
if (!process.argv.includes('--run')) console.log(JSON.stringify({ dryRun: true, calls: 0, clipCount: 5, fullGroupASR: report.heard, internalSilences: gaps, segments: plan.clips }, null, 2))
else {
  const planFile = join(dir, 'candidate-cut-plan.json'), built = join(dir, 'built')
  save(planFile, plan); buildPack(planFile, built, false)
  const addition = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8'))
  const manifest = JSON.parse(manifestBytes)
  for (const item of expected.items) {
    if (manifest.clips[item.key]) throw new Error('PHRASE_ALREADY_PRESENT')
    copyFileSync(join(built, addition.clips[item.key].file), join(assets, addition.clips[item.key].file))
    manifest.clips[item.key] = addition.clips[item.key]
  }
  for (const [key, c] of Object.entries(base.clips)) if (JSON.stringify(manifest.clips[key]) !== JSON.stringify(c) || sha(readFileSync(join(assets, c.file))) !== c.sha256) throw new Error('APPROVED_BASE_MUTATED')
  manifest.phrases = expected.phrases
  manifest.legacyPrefixKey = 'prefix'
  manifest.status = 'candidate'
  manifest.quality.listeningVerified = false
  manifest.quality.asrScope = '37-number-token-groups plus five-phrase-group; original classic opener source-context ASR separately attributed; no individual new phrase ASR'
  save(join(assets, 'manifest.json'), manifest)
  writeFileSync(join(assets, 'readable-text.txt'), Object.entries(manifest.clips).map(([key, c]) => `${key}\t${c.file}\t${c.text}${c.synthetic === false ? '\tORIGINAL SOURCE EXCERPT, NOT TTS' : ''}`).join('\n') + '\n\nLegacy prefix is retained but must not be selected when phrases are present. New phrases are machine-cut candidates awaiting composite listening.\n')
  save(join(dir, 'publication.json'), { calls: 0, priorBaseManifestSha256: report.baseManifestSha256, manifestSha256: sha(readFileSync(join(assets, 'manifest.json'))), old40ClipsUnchanged: true, newClipCount: 5, totalClipCount: 45, groupAsrVerified: true, internalSilenceCount: 4, boundaryHumanReviewed: false })
  console.log(JSON.stringify({ calls: 0, status: 'candidate', totalClips: Object.keys(manifest.clips).length, phrases: manifest.phrases, old40ClipsUnchanged: true, boundaryHumanReviewed: false }, null, 2))
}
