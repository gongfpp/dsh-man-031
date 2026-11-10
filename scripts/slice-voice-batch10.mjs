// Local full-body paragraph cuts: ordered words + completed endings + real low-energy seams.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { media, measureVoice } from './voice-loudness.mjs'
import { englishAmountText, normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-batch10'), raw = join(out, 'raw-batch10.wav'), json = (f) => JSON.parse(readFileSync(f, 'utf8')), sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const report = json(join(out, 'samples.json')), asr = json(join(out, 'raw-batch10.local-asr.json')), parts = asr.paragraphCandidates
assert.equal(sha(raw), report.raw.sha256); assert.equal(asr.sourceSha256, report.raw.sha256); assert.equal(parts.length, 10); assert.equal(asr.unassignedTrailingWords.length, 0)
const numericChecks = parts.map((p, i) => {
  const text = p.text.toLowerCase(), match = /^that'?s\s+about\s+(.+?)\s+(yuan|young|un|you\s+want|you\s+on|u1)\s*[, .]*\s*jobs?\s+not\s+finished[. ]*$/.exec(text)
  assert.ok(match, `BODY_STRUCTURE_UNCLEAR:${i}`)
  const expectedNumber = englishAmountText(report.sentences[i].amount), matchNumber = normalizeEnglishASR(match[1]) === normalizeEnglishASR(expectedNumber)
  assert.equal(matchNumber, true, `NUMERIC_SEQUENCE_MISMATCH:${report.sentences[i].amount}`); assert.equal(p.endingExactFinished, true)
  return { amount: report.sentences[i].amount, target: report.sentences[i].text, heard: p.text, expectedNumber, heardNumber: match[1], numericSequenceMatch: matchNumber, humanAmountVerified: false, currencyVerified: false, heardCurrency: match[2], minimumWordProbability: Math.min(...p.words.map((w) => w.probability)), caveat: 'local ASR number sequence only; young is not a currency pass and prior listening approval does not cover this batch' }
})
const detect = media(['-i', raw, '-af', 'silencedetect=noise=-35dB:d=0.08', '-f', 'null', '-']).stderr, gaps = []
let begin
for (const m of detect.matchAll(/silence_(start|end):\s*([0-9.]+)/g)) { if (m[1] === 'start') begin = Number(m[2]); else if (begin !== undefined) { gaps.push({ start: begin, end: Number(m[2]) }); begin = undefined } }
const seams = []
for (let i = 0; i < 9; i++) {
  const p = parts[i], next = parts[i + 1]; assert.match(next.words[0].word.trim().toLowerCase(), /^that/)
  const window = { start: p.end - .02, end: next.words[0].end - .04 }, candidates = gaps.filter((g) => g.start >= window.start && g.end <= window.end && g.end - g.start >= .08)
  assert.equal(candidates.length, 1, `NO_UNAMBIGUOUS_WORD_ALIGNED_SEAM:${i}`)
  const gap = candidates[0], cut = Math.round((gap.start + gap.end) / 2 * 24000) / 24000
  seams.push({ precedingAmount: report.sentences[i].amount, nextAmount: report.sentences[i + 1].amount, endingWords: p.words.slice(-3), nextPrefixWord: next.words[0], searchWindow: window, gap, cutSeconds: cut, method: 'completed ending and next prefix word alignment plus unique actual low-energy interval; midpoint cut only', humanBoundaryReviewed: false })
}
const cuts = parts.map((p, i) => ({ ...numericChecks[i], startSeconds: i ? seams[i - 1].cutSeconds : 0, endSeconds: i === 9 ? report.raw.durationSeconds : seams[i].cutSeconds, asrWordStart: p.start, asrWordEnd: p.end }))
const audit = { sourceSha256: report.raw.sha256, durationSeconds: report.raw.durationSeconds, finishReasons: report.finishReasons, completeBodyCountByLocalAsr: 10, numericChecks, seams, allDetectedGaps: gaps, cuts, noCloudAsr: true, humanListeningVerified: false, currencyVerified: false, runtimeAssetsModified: false, note: '32.48s success does not establish a 100s/hundreds-of-seconds limit. Requested 1s pauses were not obtained.' }
writeFileSync(join(out, 'cut-plan.json'), JSON.stringify(audit, null, 2) + '\n')
if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, completeBodyCount: 10, numericMatches: numericChecks.length, seamRanges: seams.map((s) => s.gap), cuts: cuts.map((p) => ({ amount: p.amount, start: p.startSeconds, end: p.endSeconds })), cloudAsrCalls: 0 }, null, 2)); process.exit(0) }
mkdirSync(join(out, 'bodies'), { recursive: true }); mkdirSync(join(out, 'audition'), { recursive: true })
for (const c of cuts) {
  c.file = `bodies/CNY-${c.amount}.wav`; c.startSample = Math.round(c.startSeconds * 24000); c.endSample = Math.round(c.endSeconds * 24000)
  media(['-v', 'error', '-y', '-i', raw, '-af', `atrim=start_sample=${c.startSample}:end_sample=${c.endSample},asetpts=PTS-STARTPTS`, '-c:a', 'pcm_s16le', join(out, c.file)])
  c.sha256 = sha(join(out, c.file)); c.durationSeconds = (c.endSample - c.startSample) / 24000
}
const previousAuditions = json(join(root, 'dev/voice-hybrid-v1/auditions.json')), man = previousAuditions.sources.find((s) => s.id === 'man-classic')
assert.equal(sha(man.matchedFile), man.outputSha256)
const manPcm = media(['-v', 'error', '-i', man.matchedFile, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout, previews = []
for (const amount of ['0.31', '1.27', '100']) {
  const c = cuts.find((c) => c.amount === amount), bodyFile = join(out, c.file), before = measureVoice(bodyFile), score = (before.activeRmsDb + before.activeFrameRmsP75Db) / 2
  const gainDb = Math.min(previousAuditions.normalization.targetScoreDb - score, -2.2 - before.truePeakDb), data = media(['-v', 'error', '-i', bodyFile, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout, gain = 10 ** (gainDb / 20)
  for (let i = 0; i < data.length; i += 4) data.writeFloatLE(data.readFloatLE(i) * gain, i)
  const complete = Buffer.concat([Buffer.alloc(720 * 4), manPcm, data]), rawPreview = join(out, `audition/CNY-${amount}-classic.f32`), file = join(out, `audition/CNY-${amount}-classic.wav`)
  writeFileSync(rawPreview, complete); media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', rawPreview, '-c:a', 'pcm_s16le', file])
  previews.push({ amount, file, sha256: sha(file), text: `Man! ${c.target}`, durationSeconds: complete.length / 4 / 24000, bodyFile: c.file, bodySha256: c.sha256, bodyGainDb: gainDb, bodyBefore: before, manSourceStage: man.matchedFile, manStageSha256: man.outputSha256, manAdditionalGainDb: 0, wholeBodyStaticGainOnly: true, syntheticMan: false, originalQuoteAppended: false, humanListeningVerified: false, currencyVerified: false, numericSequenceMatch: c.numericSequenceMatch })
  console.log(JSON.stringify({ amount, file, durationSeconds: previews.at(-1).durationSeconds, numericSequenceMatch: true, currencyVerified: false }))
}
writeFileSync(join(out, 'cuts-and-previews.json'), JSON.stringify({ ...audit, cuts, previews, apiCallsThisProcessing: 0, cumulative: report.cumulative, runtimeManifestUnchanged: report.runtimeManifestShaBefore === sha(join(root, 'assets/voices/manifest.json')) }, null, 2) + '\n')
