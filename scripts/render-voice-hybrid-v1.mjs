// Local whole-part static gain only. Never edits words, pitch, speed, assets, or failed ASR evidence.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { measureVoice, media } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/voice-hybrid-v1'), audition = join(out, 'audition'), parts = join(out, 'level-matched')
const sha = (b) => createHash('sha256').update(b).digest('hex'), samples = JSON.parse(readFileSync(join(out, 'samples.json'), 'utf8'))
const sources = [
  { id: 'man-classic', file: join(root, 'dev/voice/classic-man-clean.mp3'), text: 'Man!', synthetic: false, sourceUrl: 'https://www.bilibili.com/video/BV17TD7BuEZF/', sourceRangeSeconds: [.08, 1.15] },
  { id: 'man-kimmel', file: join(root, 'dev/classic-quotes/hybrid-reference/kimmel-man-real.wav'), text: 'Man!', synthetic: false, expectedSha256: '325b0f959b000ef98f029e9f5a019ba9e433f647bb460354559e6850ab52da36', sourceUrl: 'https://www.youtube.com/watch?v=t8eoIKiDTw8', sourceRangeSeconds: [107.49, 108.12] },
  ...samples.samples.filter((s) => s.sha256).map((s) => ({ id: s.id, file: join(out, s.file), text: s.text, synthetic: true, expectedSha256: s.sha256, asrVerified: s.asrVerified, heard: s.heard, referenceSha256: samples.referenceSha256 })),
]
mkdirSync(audition, { recursive: true }); mkdirSync(parts, { recursive: true })
for (const s of sources) {
  s.sourceSha256 = sha(readFileSync(s.file)); if (s.expectedSha256 && s.expectedSha256 !== s.sourceSha256) throw new Error('SOURCE_SHA_MISMATCH')
  s.before = measureVoice(s.file); s.scoreDb = (s.before.activeRmsDb + s.before.activeFrameRmsP75Db) / 2
  if (!Number.isFinite(s.scoreDb) || !Number.isFinite(s.before.truePeakDb)) throw new Error('LEVEL_MEASUREMENT_FAILED')
}
// Use one conservative common target, avoiding limiter/compression entirely.
const targetScoreDb = Math.min(-19, ...sources.map((s) => s.scoreDb - s.before.truePeakDb - 2.2))
for (const s of sources) {
  s.staticGainDb = targetScoreDb - s.scoreDb
  const original = media(['-v', 'error', '-i', s.file, '-ar', '24000', '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout
  const gain = 10 ** (s.staticGainDb / 20), levelled = Buffer.alloc(original.length)
  for (let i = 0; i < original.length; i += 4) levelled.writeFloatLE(original.readFloatLE(i) * gain, i)
  s.decodedSamples = original.length / 4; s.matchedFile = join(parts, `${s.id}.wav`)
  const raw = join(parts, `${s.id}.f32`); writeFileSync(raw, levelled)
  media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', s.matchedFile])
  s.outputSha256 = sha(readFileSync(s.matchedFile)); s.buffer = levelled
}
const outputs = []
for (const [currencyId, man] of [['CNY-0.31', 'man-classic'], ['CNY-0.31', 'man-kimmel'], ['USD-1.27', 'man-kimmel'], ['USD-1.27', 'man-classic']]) {
  const body = sources.find((s) => s.id === currencyId), opener = sources.find((s) => s.id === man); if (!body) continue
  const pcm = Buffer.concat([Buffer.alloc(720 * 4), opener.buffer, body.buffer]), id = `${currencyId}-${man.replace('man-', '')}`, raw = join(audition, `${id}.f32`), file = join(audition, `${id}.wav`)
  writeFileSync(raw, pcm); media(['-v', 'error', '-y', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', file])
  const row = { id, file, sha256: sha(readFileSync(file)), text: `${opener.text} ${body.text}`, durationSeconds: pcm.length / 4 / 24000, asrVerified: body.asrVerified, heardBody: body.heard, subjectiveListeningVerified: false, syntheticBodyIncludesQuote: true, originalQuoteAppended: false, startSilenceSeconds: .03, interPartGapSeconds: 0, parts: [opener, body].map((s) => ({ id: s.id, sourceFile: s.file, sourceSha256: s.sourceSha256, matchedFile: s.matchedFile, outputSha256: s.outputSha256, text: s.text, synthetic: s.synthetic, referenceSha256: s.referenceSha256, sourceUrl: s.sourceUrl, sourceRangeSeconds: s.sourceRangeSeconds, staticGainDb: s.staticGainDb, decodedSamples: s.decodedSamples })) }
  outputs.push(row); console.log(JSON.stringify({ id, file, durationSeconds: row.durationSeconds, asrVerified: row.asrVerified, heardBody: row.heardBody }))
}
const report = { status: 'candidate-strict-asr-mismatches-not-fixed', apiCallsForLocalProcessing: 0, historicalTotalCalls: samples.cumulativeCalls, referenceSha256: samples.referenceSha256, referenceDurationSeconds: 12.19, referenceIsNoncontinuousSingleInterviewFourSegments: true, normalization: { method: 'one static gain per complete body or original MAN', activityScore: '(activeRmsDb+activeFrameRmsP75Db)/2; acoustic proxy not voice identity', targetScoreDb, predictedTruePeakCeilingDb: -2.2, limiter: false, compressor: false, wordEdits: false, crop: false, pitchOrSpeedChange: false }, sources: sources.map(({ buffer, ...s }) => s), outputs, assetsModified: false, noPromotion: true }
writeFileSync(join(out, 'auditions.json'), JSON.stringify(report, null, 2) + '\n')
writeFileSync(join(out, 'readable-text.txt'), outputs.map((r) => `${r.id}\n${r.text}\nCloud ASR body: ${r.heardBody}\nStrict ASR match: ${r.asrVerified}; voice similarity/listening not approved.\n`).join('\n'))
