// Finite local integration only. No service calls; original quote bytes preserved.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { kobeQuotePhrasePlan } from './plan-amount-voice-quotes.mjs'
import { phraseVoicePlan } from './plan-amount-voice-phrases.mjs'
import { validateOriginalQuote, validatePhraseDeclarations } from './normalize-voice-pack.mjs'
import { normalizeEnglishASR } from './amount-voice-english.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'assets/voices'), dev = join(root, 'dev/voice-quote-integration')
const json = (p) => JSON.parse(readFileSync(p, 'utf8')), sha = (b) => createHash('sha256').update(b).digest('hex'), check = (ok, e) => { if (!ok) throw new Error(e) }
const base = json(join(root, 'dev/voice-pilot-en-b-phrases/base-manifest.json')), beforeBytes = readFileSync(join(out, 'manifest.json')), before = JSON.parse(beforeBytes)
check(base.status === 'candidate' && Object.keys(base.clips).length === 40 && base.reference.sha256 === '20742b25564e131ef5ed8207f72dfbf6bcb284a573dfb7ed89b9f149db178b79', 'EXACT_40_CLIP_BASE_REQUIRED')
for (const [key, row] of Object.entries(base.clips)) check(JSON.stringify(before.clips[key]) === JSON.stringify(row) && sha(readFileSync(join(out, row.file))) === row.sha256, 'BASE_METADATA_OR_AUDIO_CHANGED')
const bridgeDir = join(root, 'dev/voice-bridge-edit'), bridge = json(join(bridgeDir, 'processed-bridge.source.json')), localBridge = json(join(bridgeDir, 'bridge-processed-local-asr.json')), bridgeBytes = readFileSync(join(bridgeDir, 'bridge-thats-about-processed.mp3'))
const raw = json(join(root, 'dev/voice-pilot-en-b-bridge/samples.json')), ledger = json(join(root, 'dev/voice-pilot-en-b-bridge/calls.json'))
check(bridge.asrVerified === true && bridge.referenceSha256 === base.reference.sha256 && sha(bridgeBytes) === bridge.sha256 && localBridge.sourceSha256 === bridge.sha256 && normalizeEnglishASR(localBridge.heard) === normalizeEnglishASR("That's about") && raw.validationError === 'ASR_SEQUENCE_MISMATCH' && raw.quality.asrVerified === false && raw.sha256 === bridge.rawSha256 && ledger.calls.length === 2 && bridge.processing.operation === 'remove-extra-trailing-word', 'PROCESSED_BRIDGE_EVIDENCE_REQUIRED')
const jobs = json(join(root, 'dev/classic-quotes/jobs-clips.json')), farewell = json(join(root, 'dev/classic-quotes/farewell-clips.json'))
const selections = [
  ['quote-jobs-not-finished', jobs[0], 'jobs-final-asr.json'],
  ['quote-mamba-out', farewell[0], 'farewell-final-asr.json'],
  ['quote-job-finished', jobs[1], 'question-final-asr.json'],
]
const manifest = { ...base, status: 'candidate', notice: 'Mixed AI-synthesized English amounts/bridge and explicitly declared original-source MAN/quote excerpts. Not a new authentic Kobe recording or endorsement. Public availability is not a redistribution license.', ...kobeQuotePhrasePlan, legacyPrefixKey: 'prefix', quality: { ...base.quality, asrVerified: false, numberGroupsAsrVerified: true, processedBridgeAsrVerified: true, listeningVerified: false, identitySimilarityVerified: false, crossLanguageVerified: false, asrScope: '37-number-token group ASR; independently ASR-verified processed bridge; individual original quotes retain own local ASR/mismatch evidence; no new composites approved', blockers: ['New bridge-plus-quote composites require user listening', 'Original job-question local ASR omits -ed; source context/captions support finished', 'No redistribution/license permission established'] }, clips: { ...base.clips }, amounts: {} }
const bridgeDuration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(bridgeDir, 'bridge-thats-about-processed.mp3')], { encoding: 'utf8', windowsHide: true }).stdout.trim())
const { sourceFile, rawFile, ...bridgeSafe } = bridge
manifest.clips['bridge-thats-about'] = { ...bridgeSafe, file: 'clips/bridge-thats-about.mp3', duration: bridgeDuration, sourceEvidence: 'sources/processed-bridge.json', normalization: 'processed-source-bytes-preserved', gainDb: 0 }
const originalRows = [], quoteFiles = []
for (const [key, source, asrFile] of selections) {
  check(source?.synthetic === false && source.humanAuditioned === false && /no pitch/i.test(source.processing) && /(?:speed|tempo)/i.test(source.processing), 'REAL_UNALTERED_QUOTE_METADATA_REQUIRED')
  const path = resolve(root, source.file), bytes = readFileSync(path), asrBytes = readFileSync(join(root, 'dev/classic-quotes', asrFile)), asr = JSON.parse(asrBytes)
  check(sha(bytes) === source.sha256 && sha(readFileSync(resolve(root, source.sourceLocal))) === source.sourceSha256 && resolve(asr.source) === path, 'ORIGINAL_QUOTE_OR_ASR_SOURCE_DIGEST_MISMATCH')
  const heard = asr.segments.map((s) => s.text.trim()).join(' '), match = normalizeEnglishASR(heard) === normalizeEnglishASR(source.text)
  const row = { file: `clips/${key}.mp3`, text: source.text, synthetic: false, sha256: source.sha256, duration: source.durationSeconds, sourceURL: source.sourceURL, sourceSha256: source.sourceSha256, sourceRangeSeconds: [source.startSeconds, source.endSeconds], referenceType: 'original-recording-excerpt-not-cloned-reference', publisher: source.publisher || source.uploader, sourceEvidence: 'sources/original-quotes.json', sourceProvenanceLimitation: source.provenanceLimitation || source.crowd, processing: { description: source.processing, pitchModified: false, speedModified: false, gainNormalizationApplied: false, finalFadeSeconds: 0.008 }, normalization: 'original-source-clip-bytes-preserved', boundaryReviewed: false, boundaryReviewMethod: 'source-captions+existing-cached-local-asr', asrVerified: match, asrScope: 'this exact original excerpt, existing cached offline base.en', localAsrHeard: heard, localAsrReportSha256: sha(asrBytes), localAsrMismatch: match ? null : 'Local ASR heard finish, while original context/captions support finished; not silently treated as an exact text pass.', listeningVerified: false, rights: source.rights }
  validateOriginalQuote(row, key, manifest)
  manifest.clips[key] = row; quoteFiles.push({ key, bytes, file: row.file }); originalRows.push({ key, ...source, localAsrReport: asrFile, localAsrReportSha256: sha(asrBytes), localAsrHeard: heard, exactAsrMatch: match })
}
validatePhraseDeclarations(manifest.phrases, manifest.clips, manifest.originalQuotes)
check(Object.keys(manifest.clips).length === 44 && phraseVoicePlan.items.every(({ key }) => !manifest.clips[key]), 'EXACT_44_CLIP_QUOTE_CANDIDATE_REQUIRED')
if (!process.argv.includes('--run')) console.log(JSON.stringify({ dryRun: true, calls: 0, clips: 44, status: manifest.status, openers: manifest.openers, phrases: manifest.phrases, originalQuotes: manifest.originalQuotes, quoteEvidence: originalRows.map(({ key, text, exactAsrMatch }) => ({ key, text, exactAsrMatch })), old40Unchanged: true, standardPhrasesDevelopmentOnly: true }, null, 2))
else {
  mkdirSync(dev, { recursive: true }); mkdirSync(join(out, 'sources'), { recursive: true })
  writeFileSync(join(dev, 'before-integration-manifest.json'), beforeBytes)
  writeFileSync(join(out, 'clips/bridge-thats-about.mp3'), bridgeBytes)
  for (const f of quoteFiles) writeFileSync(join(out, f.file), f.bytes)
  writeFileSync(join(out, 'sources/processed-bridge.json'), JSON.stringify({ ...bridgeSafe, localAsr: localBridge, rawFailureUnchanged: true, rawLedgerRequests: ledger.calls.length, apiCallsForPostProcessing: 0 }, null, 2) + '\n')
  writeFileSync(join(out, 'sources/original-quotes.json'), JSON.stringify(originalRows, null, 2) + '\n')
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(out, 'readable-text.txt'), Object.entries(manifest.clips).map(([key, row]) => `${key}\t${row.file}\t${row.synthetic ? 'synthetic' : 'original excerpt'}\t${row.text}`).join('\n') + '\n\nCandidate only. Failed raw bridge remains failed; processed bridge has separate local ASR. Question quote local ASR omits -ed. New composites not user approved. 31 paid requests total; no API calls during integration.\n')
  writeFileSync(join(dev, 'integration.json'), JSON.stringify({ calls: 0, priorManifestSha256: sha(beforeBytes), currentManifestSha256: sha(readFileSync(join(out, 'manifest.json'))), clips: 44, preservedBaseClips: 40, excludedStandardPhraseTags: phraseVoicePlan.items.map((x) => x.key), quoteSources: originalRows, originalBytesPreserved: true, status: 'candidate', paidRequestsCumulative: { total: 31, tts: 16, asr: 15, responseErrors: 1, bridgeRawValidationErrors: 1 } }, null, 2) + '\n')
  console.log(JSON.stringify({ calls: 0, clips: 44, candidate: true, old40Unchanged: true, assets: out, noAutomaticPlaybackApproval: true }, null, 2))
}
