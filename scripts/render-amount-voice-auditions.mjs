// Pure offline render matching client order, with 30ms start and zero inter-clip gaps.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { decimalAmount } from './amount-voice-text.mjs'
import { englishAmountTokens } from './amount-voice-english.mjs'
import { validateOriginalOpener, validateOriginalQuote, validatePhraseDeclarations } from './normalize-voice-pack.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const voiceArg = process.argv.find((x) => x.startsWith('--voices-dir='))?.slice('--voices-dir='.length)
if (voiceArg && !/^dev\/voice[^/]*\/variant$/.test(voiceArg)) throw new Error('VARIANT_MUST_BE_SCOPED_DEV_VOICE_DIRECTORY')
const voices = join(root, voiceArg || 'assets/voices')
const manifestPath = join(voices, 'manifest.json'), manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes)
const quoteMode = !!manifest.originalQuotes
const out = join(root, voiceArg ? `${voiceArg.replace(/\/variant$/, '')}/audition` : quoteMode ? 'dev/voice-quote-audition' : manifest.phrases ? 'dev/voice-phrase-audition' : 'dev/voice-pack-audition')
if (manifest.phrases) validatePhraseDeclarations(manifest.phrases, manifest.clips, manifest.originalQuotes)
const hash = (b) => createHash('sha256').update(b).digest('hex')
if (manifest.status !== 'candidate' || manifest.language !== 'en' || manifest.clips.prefix.text !== "It's been" || Object.keys(manifest.amounts).length || manifest.reference.sha256 !== '20742b25564e131ef5ed8207f72dfbf6bcb284a573dfb7ed89b9f149db178b79' || JSON.stringify(manifest.openers) !== JSON.stringify(['man-firm', 'man-extended', 'man-classic'])) throw new Error('NEW_FIXED_REFERENCE_CANDIDATE_PACK_REQUIRED')
const decoded = new Map()
function decode(key) {
  if (decoded.has(key)) return decoded.get(key)
  const clip = manifest.clips[key]
  if (!clip) throw new Error(`MISSING_CLIP:${key}`)
  if (clip.synthetic === false) {
    if (manifest.originalQuotes?.includes(key)) validateOriginalQuote(clip, key, manifest)
    else validateOriginalOpener(clip, key, manifest.openers)
  } else if (clip.referenceSha256 !== manifest.reference.sha256) throw new Error(`MIXED_SYNTHESIZED_CLIP:${key}`)
  const path = resolve(voices, clip.file)
  if (hash(readFileSync(path)) !== clip.sha256) throw new Error(`CLIP_HASH_MISMATCH:${key}`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
  if (r.error || r.status !== 0 || !r.stdout?.length || r.stdout.length % 2) throw new Error(`CLIP_DECODE_FAILED:${key}`)
  const value = { pcm: r.stdout, path, durationSeconds: r.stdout.length / 2 / 24000 }; decoded.set(key, value); return value
}
function wav(pcm) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
const cases = quoteMode ? ['man-classic', 'man-firm', 'man-extended'].flatMap((opener) => manifest.phrases.map((p) => ({ id: `CNY-0.31-${opener.replace('man-', '')}-${p.id}`, amount: '0.31', currency: 'CNY', opener, phraseId: p.id }))) : manifest.phrases ? manifest.phrases.map((p) => ({ id: `CNY-0.31-classic-${p.id}`, amount: '0.31', currency: 'CNY', opener: 'man-classic', phraseId: p.id })) : [
  { id: 'CNY-0.31-classic', amount: '0.31', currency: 'CNY', opener: 'man-classic' }, { id: 'USD-1.27-firm', amount: '1.27', currency: 'USD', opener: 'man-firm' }, { id: 'CNY-0-extended', amount: '0', currency: 'CNY', opener: 'man-extended' },
]
mkdirSync(out, { recursive: true })
const report = { schemaVersion: 1, status: 'candidate', synthetic: true, calls: 0, sourceManifest: manifestPath, sourceManifestSha256: hash(manifestBytes), referenceSha256: manifest.reference.sha256, schedule: { initialDelaySeconds: 0.03, interClipGapSeconds: 0, overlapSeconds: 0, playbackRate: 1, gain: 1, uiTailIncluded: false, decode: 'ffmpeg MP3 -> 24000Hz mono PCM16; no post-decode trimming, normalization or effects', caveat: 'Same clip order/gap as client WebAudio; browser MP3 decoder padding can differ slightly. Original speech-overlapping crowd/room noise remains. New composites need listening; prior legacy-composite acceptance does not approve the new bridge/quotes. Job-question ASR mismatch (-ed) is retained in manifest.' }, humanListeningVerified: false, identitySimilarityVerified: false, previews: [] }
for (const c of cases) {
  const unit = c.currency === 'CNY' ? 'yuan' : decimalAmount(c.amount) === '1' ? 'singular-dollar' : 'dollar', phrase = manifest.phrases?.find((p) => p.id === c.phraseId)
  const keys = [c.opener, phrase?.prefix || 'prefix', ...englishAmountTokens(c.amount), unit, ...(phrase?.suffix ? [phrase.suffix] : [])], chunks = [Buffer.alloc(24000 * 2 * 0.03)]
  let when = 0.03
  const speechplan = keys.map((key, index) => {
    const d = decode(key); chunks.push(d.pcm); const clip = manifest.clips[key]
    const item = { index, key, text: clip.text, file: clip.file, sourcePath: d.path, synthetic: clip.synthetic !== false, referenceSha256: clip.referenceSha256, fileSha256: clip.sha256, originalSourceURL: clip.sourceURL, originalSourceSha256: clip.sourceSha256, originalSourceRangeSeconds: clip.sourceRangeSeconds, decodedDurationSeconds: d.durationSeconds, startSeconds: when }
    when += d.durationSeconds; return item
  })
  const file = `${c.id}.wav`, bytes = wav(Buffer.concat(chunks)); writeFileSync(join(out, file), bytes)
  report.previews.push({ ...c, file, durationSeconds: when, readableText: speechplan.map((s) => s.text).join(' '), sha256: hash(bytes), speechplan })
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')
writeFileSync(join(out, 'speechplan.json'), JSON.stringify(report.previews.map(({ id, speechplan }) => ({ id, speechplan })), null, 2) + '\n')
writeFileSync(join(out, 'readable-text.txt'), report.previews.map((p) => `${p.id}\t${p.file}\t${p.durationSeconds.toFixed(3)}s\t${p.readableText}`).join('\n') + '\n\nCandidate only. New bridge/quote composites not user approved. Local quote ASR evidence/mismatch preserved. Human identity review remains pending. No API calls in this render.\n')
console.log(JSON.stringify({ output: out, calls: 0, previews: report.previews.map(({ id, file, durationSeconds, readableText }) => ({ id, file, durationSeconds, readableText })) }, null, 2))
