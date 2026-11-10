// Offline assembly only. No credentials, service calls, system TTS, pitch changes, or sibling-plugin imports.
// node scripts/normalize-voice-pack.mjs <reviewed-plan.json> <output-directory>
// Plan: {reference:{sha256},attribution:{speaker:'Kobe Bryant',url,title,notice},
// quality:{asrVerified,listeningVerified,identitySimilarityVerified,crossLanguageVerified},
// clips:{prefix:{source:'group.mp3',start:0,end:1.2,text:"Man! It's been",referenceSha256:'...',boundaryReviewed:true,asrVerified:true},...},
// amounts:{'CNY:0.31':{source:'...',start:0,end:3,text:'...',referenceSha256:'...',boundaryReviewed:true,asrVerified:true}}}
// Sources are relative to the plan; they must all be synthesized from the same authenticated reference.
// Pass --verified only AFTER the complete pack has been heard and the quality fields reviewed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { CLIP_TEXT, decimalAmount, amountSentence } from './amount-voice-text.mjs'
import { ENGLISH_CLIP_TEXT, englishAmountSentence } from './amount-voice-english.mjs'
import { phraseVoicePlan } from './plan-amount-voice-phrases.mjs'
import { kobeQuotePhrasePlan } from './plan-amount-voice-quotes.mjs'
const PHRASE_TEXT = Object.fromEntries(phraseVoicePlan.items.map(({ key, text }) => [key, text]))
export function validatePhraseDeclarations(phrases, clips, originalQuotes = []) {
  const standard = JSON.stringify(phrases) === JSON.stringify(phraseVoicePlan.phrases) && !originalQuotes.length && phraseVoicePlan.items.every(({ key, text }) => clips?.[key]?.text === text)
  const kobe = JSON.stringify(phrases) === JSON.stringify(kobeQuotePhrasePlan.phrases) && JSON.stringify(originalQuotes) === JSON.stringify(kobeQuotePhrasePlan.originalQuotes) && clips?.['bridge-thats-about']?.text === "That's about" && originalQuotes.every((key) => clips?.[key]?.synthetic === false)
  if (!standard && !kobe) throw new Error('EXACT_PHRASE_DECLARATIONS_AND_CLIPS_REQUIRED')
  return true
}
export function validateOriginalQuote(row, key, plan, verified = false) {
  const range = row.sourceRangeSeconds
  if (!kobeQuotePhrasePlan.originalQuotes.includes(key) || !plan.originalQuotes?.includes(key) || !plan.phrases?.some((p) => p.suffix === key) || row.synthetic !== false || row.referenceSha256 !== undefined || row.referenceType !== 'original-recording-excerpt-not-cloned-reference' || !/^https:\/\//.test(row.sourceURL || '') || !/^[a-f0-9]{64}$/.test(row.sourceSha256 || '') || !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] < 0 || range[1] <= range[0] || range[1] - range[0] > 30 || row.processing?.pitchModified !== false || row.processing?.speedModified !== false || typeof row.text !== 'string' || !row.text.trim()) throw new Error('DECLARED_ORIGINAL_QUOTE_PROVENANCE_REQUIRED')
  if (verified && row.listeningVerified !== true) throw new Error('ORIGINAL_QUOTE_USER_REVIEW_REQUIRED')
  return true
}
const OPENER_TEXT = Object.freeze({ 'man-firm': 'Man!', 'man-extended': 'Maaaan!', 'man-classic': 'Man!' })
export function validateOriginalOpener(row, key, openers = [], verified = false) {
  const range = row.sourceRangeSeconds
  if (key !== 'man-classic' || !openers.includes(key) || row.synthetic !== false || row.referenceSha256 !== undefined || row.referenceType !== 'original-recording-excerpt-not-cloned-reference' || !/^https:\/\//.test(row.sourceURL || '') || !/^[a-f0-9]{64}$/.test(row.sourceSha256 || '') || !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] < 0 || range[1] <= range[0] || range[1] - range[0] > 30 || row.processing?.pitchModified !== false || row.processing?.speedModified !== false) throw new Error('DECLARED_ORIGINAL_OPENER_PROVENANCE_REQUIRED')
  if (verified && (row.listeningVerified !== true || row.userApprovedTrim !== true)) throw new Error('ORIGINAL_OPENER_USER_REVIEW_REQUIRED')
  return true
}
const clipText = (plan) => plan.language === 'en' ? { ...ENGLISH_CLIP_TEXT, ...(plan.originalQuotes?.length ? { 'bridge-thats-about': "That's about", ...Object.fromEntries(plan.originalQuotes.map((key) => [key, plan.clips?.[key]?.text])) } : plan.phrases ? PHRASE_TEXT : {}), ...Object.fromEntries((plan.openers || []).map((key) => [key, OPENER_TEXT[key]])) } : CLIP_TEXT
const requiredQuality = (plan) => plan.language === 'en' ? ['asrVerified', 'listeningVerified', 'identitySimilarityVerified'] : qualityKeys
const repo = fileURLToPath(new URL('..', import.meta.url))
const isWithin = (root, path) => { const rel = relative(root, path); return !rel.startsWith('..') && !isAbsolute(rel) }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const qualityKeys = ['asrVerified', 'listeningVerified', 'identitySimilarityVerified', 'crossLanguageVerified']
function media(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 })
  if (result.error || result.status !== 0) throw new Error(`MEDIA_COMMAND_FAILED:${command}`)
  return result
}
export function validatePlan(plan, verified = false) {
  if (!/^[a-f0-9]{64}$/.test(plan.reference?.sha256 || '')) throw new Error('REFERENCE_SHA256_REQUIRED')
  if (plan.attribution?.speaker !== 'Kobe Bryant' || !/^https:\/\//.test(plan.attribution?.url || '') || !plan.attribution?.title) throw new Error('AUTHENTIC_REFERENCE_ATTRIBUTION_REQUIRED')
  if (plan.openers !== undefined && (plan.language !== 'en' || !Array.isArray(plan.openers) || !plan.openers.length || new Set(plan.openers).size !== plan.openers.length || !plan.openers.every((key) => Object.hasOwn(OPENER_TEXT, key)))) throw new Error('INVALID_DECLARED_OPENERS')
  if (plan.phrases !== undefined) {
    if (plan.language !== 'en') throw new Error('ENGLISH_PHRASES_REQUIRED')
    validatePhraseDeclarations(plan.phrases, plan.clips, plan.originalQuotes)
  }
  const items = []
  for (const [key, row] of Object.entries(plan.clips || {})) {
    if (!Object.hasOwn(clipText(plan), key) || row.text !== clipText(plan)[key]) throw new Error('UNEXPECTED_CLIP_TEXT')
    items.push({ key, row, file: `clips/${key}.mp3`, kind: 'clips' })
  }
  for (const [key, row] of Object.entries(plan.amounts || {})) {
    const match = /^(CNY|USD):(.+)$/.exec(key)
    if (!match || decimalAmount(match[2]) !== match[2] || row.text !== (plan.language === 'en' ? englishAmountSentence(match[2], match[1]) : amountSentence(match[2], match[1]))) throw new Error('UNEXPECTED_AMOUNT_TEXT')
    items.push({ key, row, file: `amounts/${match[1]}-${match[2]}.mp3`, kind: 'amounts' })
  }
  if (!items.length) throw new Error('NO_REVIEWED_SEGMENTS')
  for (const { key, kind, row } of items) {
    if (!row.source || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end <= row.start || row.end - row.start > 30) throw new Error('INVALID_SEGMENT_BOUNDARIES')
    if (row.synthetic === false) {
      if (kind !== 'clips') throw new Error('ONLY_DECLARED_OPENERS_OR_QUOTE_SUFFIXES_MAY_BE_ORIGINAL')
      if (plan.originalQuotes?.includes(key)) validateOriginalQuote(row, key, plan, verified)
      else validateOriginalOpener(row, key, plan.openers, verified)
      if (row.preserveOriginal !== true) throw new Error('ORIGINAL_OPENER_MUST_PRESERVE_PROCESSED_SOURCE_BYTES')
      continue
    }
    if (key === 'man-classic') throw new Error('CLASSIC_OPENER_MUST_DECLARE_ORIGINAL_SOURCE')
    if (row.referenceSha256 !== plan.reference.sha256) throw new Error('MIXED_REFERENCES_FORBIDDEN')
    const automaticCandidateBoundary = !verified && row.boundaryReviewed === false && row.boundaryReviewMethod === 'silencedetect-count+group-asr' && row.asrVerified === true
    if (row.boundaryReviewed !== true && !automaticCandidateBoundary) throw new Error('MANUAL_BOUNDARY_REVIEW_REQUIRED')
    if (verified && row.asrVerified !== true) throw new Error('SEGMENT_ASR_REVIEW_REQUIRED')
  }
  if (plan.openers && !plan.openers.every((key) => plan.clips?.[key])) throw new Error('DECLARED_OPENER_CLIP_MISSING')
  if (verified && (!requiredQuality(plan).every((key) => plan.quality?.[key] === true) || !Object.keys(clipText(plan)).every((key) => plan.clips?.[key]))) throw new Error('COMPLETE_PACK_QUALITY_REVIEW_REQUIRED')
  return items
}
export function buildPack(planFile, output, verified = false) {
  const planPath = resolve(planFile)
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const items = validatePlan(plan, verified)
  const out = resolve(output)
  const dev = resolve(repo, 'dev')
  const relDev = relative(dev, out)
  if (!isWithin(resolve(repo, 'assets/voices'), out) && !(isWithin(dev, out) && /^voice[^\\/]*(?:[\\/]|$)/.test(relDev))) throw new Error('OUTPUT_MUST_BE_SCOPED_VOICE_DIRECTORY')
  const stage = resolve(repo, 'dev/voice-build', `${Date.now()}-${process.pid}`)
  mkdirSync(stage, { recursive: true })
  const manifest = {
    schemaVersion: 1, id: plan.language === 'en' ? 'kobe-mimo-en-v1' : 'kobe-mimo-v1', ...(plan.language === 'en' ? { language: 'en', numberStyle: 'cardinal-US-no-and', currencyLabels: { CNY: '元', USD: '美元' } } : {}), status: verified ? 'verified' : 'candidate', synthetic: true,
    notice: 'Contains AI-synthesized clips and any explicitly declared original-source openers. Not a new authentic Kobe recording or endorsement; clip.synthetic distinguishes sources.',
    defaultCurrency: 'CNY', currencies: ['CNY', 'USD'], attribution: plan.attribution,
    reference: { sha256: plan.reference.sha256 },
    ...(plan.phrases ? { phrases: plan.phrases, legacyPrefixKey: 'prefix' } : {}),
    ...(plan.originalQuotes ? { originalQuotes: plan.originalQuotes } : {}),
    quality: Object.fromEntries(qualityKeys.map((key) => [key, plan.quality?.[key] === true])),
    ...(plan.openers ? { openers: [...plan.openers], originalOpeners: plan.openers.filter((key) => plan.clips[key]?.synthetic === false) } : {}),
    clips: {}, amounts: {}, normalization: { method: 'static-gain', targetMeanDb: -20, maximumPeakDb: -1, sampleRate: 24000, channels: 1, pitchModified: false, openers: 'preserve-original-bytes' },
  }
  for (const [index, { key, row, file, kind }] of items.entries()) {
    const source = resolve(dirname(planPath), row.source)
    if (!existsSync(source)) throw new Error('SEGMENT_SOURCE_MISSING')
    if (row.preserveOriginal === true) {
      if ((!plan.openers?.includes(key) && !plan.originalQuotes?.includes(key)) || row.start !== 0 || !/\.mp3$/i.test(source)) throw new Error('ONLY_APPROVED_OPENERS_MAY_BYPASS_NORMALIZATION')
      const duration = Number(media('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source]).stdout.trim())
      if (!Number.isFinite(duration) || Math.abs(duration - row.end) > 0.02) throw new Error('OPENER_MUST_COPY_COMPLETE_ORIGINAL')
      const target = resolve(out, file)
      mkdirSync(dirname(target), { recursive: true })
      const bytes = readFileSync(source)
      writeFileSync(target, bytes)
      manifest[kind][key] = { ...(row.synthetic === false ? { ...row, source: undefined, start: undefined, end: undefined, preserveOriginal: undefined } : {}), file, text: row.text, synthetic: row.synthetic !== false, sha256: digest(bytes), duration, gainDb: 0, referenceSha256: row.referenceSha256, boundaryReviewed: row.boundaryReviewed === true, asrVerified: row.asrVerified === true, listeningVerified: row.listeningVerified === true, normalization: 'original-bytes-preserved' }
      continue
    }
    const wav = join(stage, `${index}.wav`)
    media('ffmpeg', ['-y', '-v', 'error', '-i', source, '-af', `atrim=start=${row.start}:end=${row.end},asetpts=PTS-STARTPTS`, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    const levels = media('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']).stderr
    const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(levels)
    const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(levels)
    if (!mean || !peak) throw new Error('SEGMENT_VOLUME_UNMEASURABLE')
    const gain = Math.min(15, -20 - Number(mean[1]), -1 - Number(peak[1]))
    const target = resolve(out, file)
    mkdirSync(dirname(target), { recursive: true })
    media('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-af', `volume=${gain.toFixed(3)}dB`, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', target])
    const duration = Number(media('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target]).stdout.trim())
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('INVALID_OUTPUT_DURATION')
    manifest[kind][key] = { file, text: row.text, synthetic: true, sha256: digest(readFileSync(target)), duration: Number(duration.toFixed(3)), gainDb: Number(gain.toFixed(3)), referenceSha256: row.referenceSha256, boundaryReviewed: row.boundaryReviewed === true, boundaryReviewMethod: row.boundaryReviewMethod || 'human', asrVerified: row.asrVerified === true, asrScope: row.asrScope || 'clip' }
  }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(out, 'readable-text.txt'), [...Object.entries(manifest.clips), ...Object.entries(manifest.amounts)].map(([key, clip]) => `${key}\t${clip.file}\t${clip.text}`).join('\n') + '\n')
  return { output: out, status: manifest.status, clips: Object.keys(manifest.clips).length, amounts: Object.keys(manifest.amounts).length, calls: 0 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || !process.argv[3]) throw new Error('USAGE:node scripts/normalize-voice-pack.mjs plan.json output-directory [--verified]')
    console.log(JSON.stringify(buildPack(process.argv[2], process.argv[3], process.argv.includes('--verified'))))
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1 }
}
