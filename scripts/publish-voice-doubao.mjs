// Publish the exact user-approved WAV. No generation, recompression or word editing.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = new URL('../', import.meta.url)
const approvedSha = '616c0da0c19a87c82f8531cc8ee2aea1da87c2eb24c9506b72dfed44d9f4c1a2'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const input = new URL('dev/doubao-trial/audition/doubao-1.wav', root)
const bytes = await readFile(input)
assert.equal(hash(bytes), approvedSha, 'approved audition changed')
assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
assert.equal(bytes.toString('ascii', 8, 12), 'WAVE')
const file = 'amounts/CNY-0.31.wav'
const target = new URL(`assets/voices/${file}`, root)
await mkdir(new URL('assets/voices/amounts/', root), { recursive: true })
try { await writeFile(target, bytes, { flag: 'wx' }) }
catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(hash(await readFile(target)), approvedSha) }
const manifestUrl = new URL('assets/voices/manifest.json', root)
const previous = await readFile(manifestUrl)
if (JSON.parse(previous).id !== 'kobe-doubao-whole-v1') {
  await writeFile(new URL('dev/doubao-trial/previous-manifest.json', root), previous, { flag: 'wx' })
}
const manifest = {
  schemaVersion: 1, id: 'kobe-doubao-whole-v1', provider: 'doubao', language: 'en', status: 'verified',
  verifiedScope: 'User-approved exact CNY 0.31 full utterance; no blanket approval of other amounts.',
  exactOnly: true, synthetic: true,
  notice: 'Entire MAN and body are AI-generated. No original MAN is prepended.',
  defaultCurrency: 'CNY', currencies: ['CNY', 'USD'], currencyLabels: { CNY: '元', USD: '美元' },
  openers: [], clips: {}, phrases: [{ id: 'doubao-jobs', prefix: 'whole-utterance', exactOnly: true }],
  amounts: { 'CNY:0.31': {
    file, text: "MAN! That's about zero point three one 元. Job's not finished.",
    phraseId: 'doubao-jobs', fullUtterance: true, includesMan: true, synthetic: true,
    sha256: approvedSha, durationSeconds: 7.224, sampleRate: 24000,
    humanListeningVerified: true, currencyHumanVerified: true, asrVerified: false,
    referenceIsSynthesized: true,
    referenceSha256: '4abcb3f851e18b4b260c32f1da56935ec8b62117016d43f3997bb2f1254d134b',
    processing: { method: 'bit-identical copy of the approved whole-gain audition', gainDb: -3.983727222571506,
      cut: false, joined: false, speedChanged: false, pitchChanged: false, recompressed: false },
    acceptance: { date: '2026-11-09', sourceMessageRef: 'm02645', scope: 'This exact complete utterance, including MAN, unit and pace.' },
  } },
  quality: { listeningVerified: true, listeningScope: 'CNY:0.31 exact full utterance only', asrVerified: false },
}
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
await writeFile(new URL('assets/voices/readable-text.txt', root),
  "Doubao full-utterance exact-only pack.\nCNY:0.31: MAN! That's about zero point three one 元. Job's not finished.\nEntire utterance generated once; no static MAN, digit joins or near-amount substitution.\nUser approved this exact WAV on 2026-11-09. English ASR is not a Chinese-unit certification.\nOther exact amounts and USD are not included in this offline pack.\n")
console.log(JSON.stringify({ id: manifest.id, published: file, sha256: approvedSha, bytes: bytes.length, bitIdenticalToApprovedAudition: true, newApiCalls: 0 }))
