// Explicit post-processing of FAILED raw TTS. Never edits the raw ledger/ASR report.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'dev/voice-bridge-edit')
const rawDir = join(root, 'dev/voice-pilot-en-b-bridge'), raw = join(rawDir, 'bridge-thats-about.mp3'), target = join(dir, 'bridge-thats-about-processed.mp3')
const json = (p) => JSON.parse(readFileSync(p, 'utf8')), sha = (b) => createHash('sha256').update(b).digest('hex')
const rawReport = json(join(rawDir, 'samples.json')), rawAsr = json(join(dir, 'bridge-raw-local-asr.json'))
if (rawReport.validationError !== 'ASR_SEQUENCE_MISMATCH' || rawReport.quality.asrVerified !== false || sha(readFileSync(raw)) !== rawReport.sha256 || rawAsr.sourceSha256 !== rawReport.sha256 || normalizeEnglishASR(rawAsr.segments[0].text) !== normalizeEnglishASR("That's about") || rawAsr.segments.length !== 2) throw new Error('FAILED_RAW_AND_SEPARATE_LOCAL_ASR_REQUIRED')
const words = rawAsr.segments[0].words, next = rawAsr.segments[1].words
const end = 1.1
if (words.length !== 2 || words.at(-1).end + 0.15 > end || next[0].start - 0.15 < end) throw new Error('CLEAR_WORD_SEPARATION_REQUIRED')
const detection = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-af', 'silencedetect=n=-38dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
if (detection.error || detection.status !== 0) throw new Error('LOCAL_SILENCE_EVIDENCE_REQUIRED')
const gaps = []; let from
for (const m of detection.stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) { if (m[1] === 'start') from = Number(m[2]); else { if (from !== undefined) gaps.push({ start: from, end: Number(m[2]) }); from = undefined } }
const gap = gaps.find((g) => g.start < end - 0.1 && g.end > end + 0.1 && g.end - g.start > 1)
if (!gap || words.at(-1).end >= gap.start || next[0].start <= gap.start) throw new Error('CLEAR_OBSERVED_POST_PHRASE_SILENCE_REQUIRED')
const metadataPath = join(dir, 'processed-bridge.source.json')
if (process.argv.includes('--verify')) {
  const row = json(metadataPath), asr = json(join(dir, 'bridge-processed-local-asr.json'))
  if (sha(readFileSync(target)) !== row.sha256 || asr.sourceSha256 !== row.sha256 || normalizeEnglishASR(asr.heard) !== normalizeEnglishASR("That's about")) throw new Error('PROCESSED_BRIDGE_LOCAL_ASR_MISMATCH')
  row.asrVerified = true; row.asrScope = 'this exact processed file, existing cached offline base.en'; row.localAsrReport = 'bridge-processed-local-asr.json'; row.localAsrReportSha256 = sha(readFileSync(join(dir, row.localAsrReport))); row.localAsrHeard = asr.heard
  writeFileSync(metadataPath, JSON.stringify(row, null, 2) + '\n')
  console.log(JSON.stringify({ calls: 0, status: 'candidate', processedFile: target, processedSha256: row.sha256, processedAsrVerified: true, heard: asr.heard, rawValidationErrorPreserved: rawReport.validationError, noRawStatusChanged: true }, null, 2))
} else if (!process.argv.includes('--run')) console.log(JSON.stringify({ dryRun: true, calls: 0, rawASR: rawReport.heard, rawLocalASR: rawAsr.heard, processing: 'remove-extra-trailing-word', keepRangeSeconds: [0, end], clearGap: gap, keptWords: words, removedWords: next }, null, 2))
else {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', `atrim=start=0:end=${end},asetpts=PTS-STARTPTS`, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', target], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
  if (r.error || r.status !== 0) throw new Error('LOCAL_BRIDGE_PROCESSING_FAILED')
  const row = { text: "That's about", synthetic: true, status: 'candidate', sha256: sha(readFileSync(target)), referenceSha256: rawReport.reference.sha256, sourceFile: target, rawFile: raw, rawSha256: rawReport.sha256, rawAsrHeard: rawReport.heard, rawValidationError: rawReport.validationError, rawAsrVerified: false, processing: { operation: 'remove-extra-trailing-word', keepRangeSeconds: [0, end], observedSilence: gap, keptLocalAsrWords: words, removedLocalAsrWords: next, rawLocalAsrReportSha256: sha(readFileSync(join(dir, 'bridge-raw-local-asr.json'))), pitchModified: false, speedModified: false, gainNormalizationApplied: false, sampleRate: 24000, channels: 1, codec: 'MP3 96kbps' }, boundaryReviewed: false, boundaryReviewMethod: 'offline-ASR-word-timestamps+observed-2-second-gap', asrVerified: false, listeningVerified: false, notice: 'A processed excerpt of a failed raw TTS attempt. Raw failure remains immutable; this processed clip must pass its own local ASR and listening review.' }
  writeFileSync(metadataPath, JSON.stringify(row, null, 2) + '\n')
  console.log(JSON.stringify({ calls: 0, target, decodedTargetDurationSeconds: end, boundaryHumanReviewed: false, asrVerified: false, rawValidationErrorPreserved: true }, null, 2))
}
