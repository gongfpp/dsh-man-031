// Expose already-generated candidates for explicit manual listening only.
// --english-round chooses the authorized English round, never prior failed Chinese samples.
// No API call and no automatic/verified publication. Does not ship the source reference.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { decimalAmount, amountSentence } from './amount-voice-text.mjs'
import { ENGLISH_CLIP_TEXT, englishAmountSentence } from './amount-voice-english.mjs'
const english = process.argv.includes('--english-round')
const pilot = fileURLToPath(new URL(english ? '../dev/voice-pilot-en/' : '../dev/voice-pilot/', import.meta.url))
const out = fileURLToPath(new URL('../assets/voices/', import.meta.url))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
try {
  const report = JSON.parse(readFileSync(join(pilot, 'samples.json'), 'utf8'))
  const ledger = JSON.parse(readFileSync(join(pilot, 'calls.json'), 'utf8'))
  const previous = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
  if (previous.status === 'verified') throw new Error('DO_NOT_REPLACE_VERIFIED_PACK_WITH_PILOTS')
  if (report.id !== (english ? 'kobe-mimo-en-v1' : 'kobe-mimo-v1') || !/^[a-f0-9]{64}$/.test(report.reference?.sha256 || '') || ledger.calls.length > (english ? 4 : 6)) throw new Error('INVALID_PILOT_PROVENANCE_OR_BUDGET')
  const amounts = {}
  const review = []
  for (const row of report.samples) {
    if (row.error || !row.sha256) continue
    const amount = decimalAmount(row.amount)
    const expected = english ? englishAmountSentence(amount, row.currency) : amountSentence(amount, row.currency)
    if (!['CNY', 'USD'].includes(row.currency) || row.text !== expected || row.file !== `${row.currency}-${amount}.mp3`) throw new Error('UNEXPECTED_PILOT_TEXT_OR_FILE')
    const source = resolve(pilot, row.file)
    const bytes = readFileSync(source)
    if (sha(bytes) !== row.sha256) throw new Error('PILOT_AUDIO_DIGEST_MISMATCH')
    const file = `amounts/${row.currency}-${amount}.mp3`
    mkdirSync(join(out, 'amounts'), { recursive: true })
    copyFileSync(source, join(out, file))
    amounts[`${row.currency}:${amount}`] = { file, text: row.text, sha256: row.sha256, asrVerified: row.asrTextMatch === true, heard: row.heard || '', listeningVerified: false }
    review.push(`${row.currency}:${amount}\t${file}\t${row.text}\tASR=${row.heard || ''}\tmatch=${row.asrTextMatch === true}`)
  }
  if (!Object.keys(amounts).length) throw new Error('NO_GENERATED_PILOT_AUDIO')
  const manifest = {
    schemaVersion: 1, id: report.id, ...(english ? { language: 'en', numberStyle: 'cardinal-US-no-and', currencyLabels: { CNY: '元', USD: '美元' } } : {}), status: 'candidate', synthetic: true,
    notice: 'AI-synthesized pilot, not a new recording or endorsement by Kobe Bryant. Manual listening only; speaker similarity and human listening are not yet approved.',
    defaultCurrency: 'CNY', currencies: ['CNY', 'USD'],
    attribution: { speaker: 'Kobe Bryant', publisher: report.attribution.publisher, url: report.attribution.url, title: report.attribution.title, startSeconds: report.attribution.startSeconds, endSeconds: report.attribution.endSeconds, rights: report.attribution.rights },
    reference: report.reference, clips: {}, amounts,
    plannedClips: english ? Object.fromEntries(Object.entries(ENGLISH_CLIP_TEXT).map(([key, text]) => [key, { file: `clips/${key}.mp3`, text }])) : previous.plannedClips || {},
    quality: { asrVerified: report.quality.asrVerified === true, listeningVerified: false, identitySimilarityVerified: false, crossLanguageVerified: false },
    generation: { ttsCalls: ledger.calls.filter((c) => c.kind === 'tts').length, asrCalls: ledger.calls.filter((c) => c.kind === 'asr').length, errors: ledger.calls.filter((c) => c.status === 'error').length, roundRequestLimit: english ? 4 : 6 },
    reviewReason: report.quality.asrVerified ? 'ASR_TEXT_MATCHED_AWAITING_USER_VOICE_REVIEW_NO_AUTOMATIC_PLAYBACK' : 'PILOT_ASR_TEXT_MISMATCH_REQUIRES_USER_LISTENING_NO_AUTOMATIC_PLAYBACK',
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(out, 'readable-text.txt'), 'CANDIDATE PILOTS ONLY — manual listening, not a complete token pack.\n' + review.join('\n') + '\n')
  console.log(JSON.stringify({ status: 'candidate', language: english ? 'en' : 'mixed', amounts: Object.keys(amounts), apiCalls: 0, listeningVerified: false, asrVerified: manifest.quality.asrVerified }))
} catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1 }
