// Local trim of the USER-SELECTED context file, not a cloned reference.
// Default dry-run; --run trims and adds the original-source opener to candidate manifest.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'dev/classic-man/retirement-opening-context.mp3')
const downloaded = join(root, 'dev/classic-man/BV17TD7BuEZF.m4a')
const output = join(root, 'dev/voice/classic-man-clean.mp3')
const manifestFile = join(root, 'assets/voices/manifest.json')
const hash = (b) => createHash('sha256').update(b).digest('hex')
const start = 0.08, end = 1.15, fade = 0.008
const evidence = JSON.parse(readFileSync(join(root, 'dev/classic-man/retirement-opening-context.asr.json'), 'utf8'))
const candidate = JSON.parse(readFileSync(join(root, 'dev/classic-man/candidates.json'), 'utf8')).candidates.find((c) => c.id === 'retirement-opening-man')
if (candidate?.url !== 'https://www.bilibili.com/video/BV17TD7BuEZF/' || JSON.stringify(candidate.contextRangeSeconds) !== JSON.stringify([0, 4.1]) || evidence.segments[0]?.words[0]?.word.trim().toLowerCase() !== 'man!') throw new Error('EXISTING_CONTEXT_PROVENANCE_AND_LOCAL_ASR_REQUIRED')
const row = { file: 'clips/man-classic.mp3', text: 'Man!', synthetic: false, sourceURL: candidate.url, sourceTitle: 'User-selected Kobe retirement opening, captioned public repost', sourceFile: 'retirement-opening-context.mp3', sourceSha256: hash(readFileSync(source)), recordingSourceSha256: hash(readFileSync(downloaded)), contextRangeSeconds: [start, end], sourceRangeSeconds: [start, end], referenceType: 'original-recording-excerpt-not-cloned-reference', processing: { trimStartSeconds: start, trimEndSeconds: end, tailFadeSeconds: fade, sampleRate: 24000, channels: 1, codec: 'MP3 96kbps', pitchModified: false, speedModified: false, gainNormalizationApplied: false }, boundaryReviewed: false, boundaryReviewMethod: 'existing-local-ASR+waveform-review', asrVerified: false, asrScope: 'source-context-local-ASR-only-not-retrimmed-file', sourceAsrEvidence: { word: 'Man!', startSeconds: 0, endSeconds: 1, probability: evidence.segments[0].words[0].probability, limitation: 'Word timestamp is approximate, not a human phonetic boundary; crop retains 150ms beyond ASR end.' }, listeningVerified: false, userSelectedSource: true, userApprovedTrim: false, rightsConfirmed: false, notice: 'Original-source excerpt from a user-selected captioned repost, not new TTS. We only remove the later crowd tail with a short cut-end fade. Crowd/reverberation overlapping MAN remains; the repost itself is not proven unprocessed or licensed for redistribution.' }
if (!process.argv.includes('--run')) console.log(JSON.stringify({ dryRun: true, calls: 0, output, decodedTargetDurationSeconds: end - start, opener: row }, null, 2))
else {
  mkdirSync(join(root, 'dev/voice'), { recursive: true })
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:st=${(end - start - fade).toFixed(3)}:d=${fade}`, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', output], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
  if (r.error || r.status !== 0) throw new Error('LOCAL_FFMPEG_TRIM_FAILED')
  const bytes = readFileSync(output)
  row.sha256 = hash(bytes)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  if (probe.error || probe.status !== 0) throw new Error('TRIM_DURATION_CHECK_FAILED')
  row.duration = Number(probe.stdout.trim())
  row.decodedTargetDurationSeconds = end - start
  writeFileSync(join(root, 'dev/voice/classic-man-clean.source.json'), JSON.stringify(row, null, 2) + '\n')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.status !== 'candidate' || manifest.language !== 'en') throw new Error('ENGLISH_CANDIDATE_REQUIRED')
  mkdirSync(join(root, 'assets/voices/clips'), { recursive: true })
  writeFileSync(join(root, 'assets/voices', row.file), bytes)
  for (const c of Object.values(manifest.clips)) c.synthetic = true
  manifest.clips['man-classic'] = row
  manifest.quality.asrScope = '37-synthesized-token-groups; original opener has separate source-context evidence'
  manifest.openers = ['man-firm', 'man-extended', 'man-classic']
  manifest.notice = 'Contains AI-synthesized number clips and declared original-source opener excerpts. Not a new authentic Kobe recording or endorsement; clip.synthetic distinguishes sources.'
  manifest.originalOpeners = ['man-classic']
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(root, 'assets/voices/readable-text.txt'), [...Object.entries(manifest.clips), ...Object.entries(manifest.amounts)].map(([key, c]) => `${key}\t${c.file}\t${c.text}${c.synthetic === false ? '\tORIGINAL SOURCE EXCERPT, NOT TTS' : ''}`).join('\n') + '\n')
  console.log(JSON.stringify({ calls: 0, status: manifest.status, output, originalSourceSha256: row.sourceSha256, containerDurationSeconds: row.duration, decodedTargetDurationSeconds: row.decodedTargetDurationSeconds, openers: manifest.openers, totalClips: Object.keys(manifest.clips).length }, null, 2))
}
