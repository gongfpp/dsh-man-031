// Read-only candidate evidence audit. No activation operation exists.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { englishVoiceGroupPlan } from './plan-amount-voice-english.mjs'
import { normalizeEnglishASR, englishAmountTokens } from './amount-voice-english.mjs'
import { validateOriginalQuote, validateOriginalOpener, validatePhraseDeclarations } from './normalize-voice-pack.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), assets = join(root, 'assets/voices')
const sha = (b) => createHash('sha256').update(b).digest('hex'), json = (p) => JSON.parse(readFileSync(p, 'utf8')), check = (ok, e) => { if (!ok) throw new Error(e) }
function gapsFor(audio, minimum) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audio, '-af', `silencedetect=n=-38dB:d=${minimum}`, '-f', 'null', '-'], { encoding: 'utf8', timeout: 120000, windowsHide: true })
  check(!r.error && r.status === 0, 'SILENCE_RECHECK_FAILED')
  const gaps = []; let start
  for (const m of r.stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) { if (m[1] === 'start') start = Number(m[2]); else { if (start !== undefined) gaps.push({ start, end: Number(m[2]) }); start = undefined } }
  return gaps
}
export function auditKobeQuotePack(draftReview = false) {
  const manifestPath = join(assets, 'manifest.json'), bytes = readFileSync(manifestPath), manifest = JSON.parse(bytes)
  check(manifest.status === 'candidate' && Object.keys(manifest.clips).length === 44, 'EXACT_44_CLIP_CANDIDATE_REQUIRED')
  validatePhraseDeclarations(manifest.phrases, manifest.clips, manifest.originalQuotes)
  for (const [key, c] of Object.entries(manifest.clips)) {
    check(/^clips\/[a-zA-Z0-9_.-]+\.mp3$/.test(c.file) && sha(readFileSync(join(assets, c.file))) === c.sha256, 'CLIP_PATH_OR_DIGEST_CHANGED')
    if (c.synthetic === false) {
      if (manifest.originalQuotes.includes(key)) validateOriginalQuote(c, key, manifest)
      else validateOriginalOpener(c, key, manifest.openers)
    } else check(c.referenceSha256 === englishVoiceGroupPlan.referenceSha256, 'MIXED_SYNTH_REFERENCE')
  }
  const base = json(join(root, 'dev/voice-pilot-en-b-phrases/base-manifest.json'))
  for (const [key, row] of Object.entries(base.clips)) check(JSON.stringify(row) === JSON.stringify(manifest.clips[key]), 'OLD_40_METADATA_MUTATED')
  for (const key of ['man-firm', 'man-extended']) check(readFileSync(join(assets, manifest.clips[key].file)).equals(readFileSync(join(root, `dev/voice-pilot-man/${key}.mp3`))), 'APPROVED_MAN_BYTES_CHANGED')
  check(sha(readFileSync(join(root, 'dev/classic-man/retirement-opening-context.mp3'))) === manifest.clips['man-classic'].sourceSha256, 'CLASSIC_CONTEXT_CHANGED')
  const groupDir = join(root, 'dev/voice-pilot-en-b-groups'), report = json(join(groupDir, 'samples.json')), ledger = json(join(groupDir, 'calls.json')), cuts = json(join(groupDir, 'candidate-cut-plan.json'))
  check(JSON.stringify(report.plan) === JSON.stringify(englishVoiceGroupPlan) && ledger.calls.length === 8 && ledger.calls.every((c) => c.status === 'received' && c.phase === 'complete' && c.referenceSha256 === englishVoiceGroupPlan.referenceSha256), 'NUMERIC_GROUP_LEDGER_OR_PLAN_CHANGED')
  const numericGroups = report.samples.map((sample, i) => {
    const group = englishVoiceGroupPlan.groups[i], audio = join(groupDir, sample.file)
    check(sha(readFileSync(audio)) === sample.sha256 && normalizeEnglishASR(sample.heard) === normalizeEnglishASR(group.text), 'NUMERIC_GROUP_AUDIO_OR_ASR_CHANGED')
    const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8', windowsHide: true }).stdout.trim())
    const saved = cuts.segmentation.groups[i].observedInternalSilences, observed = gapsFor(audio, 0.35).filter((g) => g.start > 0.02 && g.end < duration - 0.02)
    check(Number.isFinite(duration) && saved.length === [9, 9, 7, 8][i] && JSON.stringify(observed) === JSON.stringify(saved), 'NUMERIC_GROUP_GAPS_CHANGED')
    for (const key of group.keys) check(manifest.clips[key].boundaryReviewed === false && manifest.clips[key].boundaryReviewMethod === 'silencedetect-count+group-asr' && cuts.clips[key].boundaryReviewed === false, 'NUMERIC_MACHINE_REVIEW_MUST_REMAIN_FALSE')
    return { id: group.id, sha256: sample.sha256, groupAsrMatch: true, orderedInternalGaps: saved.length, tokenCount: group.keys.length }
  })
  const bridge = manifest.clips['bridge-thats-about'], rawDir = join(root, 'dev/voice-pilot-en-b-bridge'), raw = json(join(rawDir, 'samples.json')), rawLedger = json(join(rawDir, 'calls.json')), processed = json(join(root, 'dev/voice-bridge-edit/processed-bridge.source.json')), local = json(join(root, 'dev/voice-bridge-edit/bridge-processed-local-asr.json'))
  check(raw.validationError === 'ASR_SEQUENCE_MISMATCH' && raw.quality.asrVerified === false && rawLedger.calls.length === 2 && sha(readFileSync(join(rawDir, raw.file))) === raw.sha256 && raw.sha256 === bridge.rawSha256 && bridge.rawAsrVerified === false && bridge.asrVerified === true && bridge.boundaryReviewed === false && processed.sha256 === bridge.sha256 && local.sourceSha256 === bridge.sha256 && normalizeEnglishASR(local.heard) === normalizeEnglishASR("That's about"), 'BRIDGE_RAW_FAILURE_OR_PROCESSED_ASR_CHANGED')
  check(JSON.stringify(bridge.processing.keepRangeSeconds) === JSON.stringify([0, 1.1]) && gapsFor(join(rawDir, raw.file), 0.12).some((g) => JSON.stringify(g) === JSON.stringify(bridge.processing.observedSilence)), 'BRIDGE_CLEAR_GAP_EVIDENCE_CHANGED')
  const sources = json(join(assets, 'sources/original-quotes.json'))
  const quotes = manifest.originalQuotes.map((key) => {
    const c = manifest.clips[key], source = sources.find((s) => s.key === key)
    check(source && source.sha256 === c.sha256 && sha(readFileSync(resolve(root, source.sourceLocal))) === c.sourceSha256 && readFileSync(resolve(root, source.file)).equals(readFileSync(join(assets, c.file))), 'ORIGINAL_QUOTE_SOURCE_OR_BYTES_CHANGED')
    check(c.boundaryReviewed === false && c.listeningVerified === false && c.referenceSha256 === undefined, 'ORIGINAL_QUOTE_CANNOT_BORROW_CLONE_OR_HUMAN_REVIEW')
    return { key, text: c.text, original: true, sourceURL: c.sourceURL, sourceSha256: c.sourceSha256, range: c.sourceRangeSeconds, exactLocalAsrMatch: c.asrVerified, heard: c.localAsrHeard, mismatch: c.localAsrMismatch }
  })
  const previewDir = join(root, 'dev/voice-quote-audition'), previews = json(join(previewDir, 'manifest.json'))
  check(previews.sourceManifestSha256 === sha(bytes) && previews.previews.length === 9 && new Set(previews.previews.map((p) => `${p.opener}:${p.phraseId}`)).size === 9, 'EXACT_CURRENT_NINE_COMPOSITES_REQUIRED')
  const composites = previews.previews.map((p) => {
    const phrase = manifest.phrases.find((x) => x.id === p.phraseId), keys = [p.opener, phrase?.prefix, ...englishAmountTokens('0.31'), 'yuan', phrase?.suffix], path = join(previewDir, p.file)
    check(manifest.openers.includes(p.opener) && p.currency === 'CNY' && p.amount === '0.31' && JSON.stringify(p.speechplan.map((s) => s.key)) === JSON.stringify(keys) && sha(readFileSync(path)) === p.sha256 && p.speechplan.every((s) => s.fileSha256 === manifest.clips[s.key].sha256), 'COMPOSITE_SCHEDULE_OR_SHA_CHANGED')
    return { id: p.id, path, sha256: p.sha256, text: p.readableText, approved: false, userReply: null, userMessageRef: null, voiceUsabilityAcceptedWithinComposite: false }
  })
  const reviewDir = join(root, 'dev/voice-promotion'), reviewFile = join(reviewDir, 'kobe-quotes-review.json')
  if (draftReview && !existsSync(reviewFile)) {
    mkdirSync(reviewDir, { recursive: true })
    writeFileSync(reviewFile, JSON.stringify({ schemaVersion: 1, status: 'pending', manifestPath, manifestSha256: sha(bytes), approvedForAutomaticPlayback: false, scope: 'These exact nine CNY 0.31 MAN + processed bridge + original quote composites only. No per-clip boundary or forensic identity review is implied. Older composite approvals cannot be reused.', composites, explicitLimitations: ['Question quote original/context captions say finished, but local clip ASR omits -ed; mismatch must stay recorded', 'No redistribution rights established', 'Human boundaryReviewed flags remain false'] }, null, 2) + '\n')
  }
  const review = existsSync(reviewFile) ? json(reviewFile) : null
  const matches = !!review && review.manifestSha256 === sha(bytes) && review.status === 'approved' && review.approvedForAutomaticPlayback === true && review.composites?.length === 9 && review.composites.every((a, i) => a.id === composites[i].id && a.sha256 === composites[i].sha256 && resolve(a.path) === composites[i].path && a.approved === true && a.voiceUsabilityAcceptedWithinComposite === true && typeof a.userReply === 'string' && a.userReply.trim() && typeof a.userMessageRef === 'string' && a.userMessageRef.trim())
  return { dryRun: true, calls: 0, assetsModified: false, canExecutePromotion: false, evidencePassed: true, clipHashesVerified: 44, numericGroups, bridge: { rawFailurePreserved: true, processing: 'remove-extra-trailing-word', newFileLocalAsrVerified: true, noAdditionalApiCalls: true }, originalQuotes: quotes, composites: composites.length, reviewFile, reviewApprovedAndMatching: matches, blockers: ['Read-only audit cannot activate playback', ...(matches ? [] : ['New quote composites have no exact matching user listening approval']), 'Job-question exact local ASR mismatch remains explicit; contextual text evidence is not human listening', 'Public sources have no verified redistribution license'], proposedQualityScopeOnly: { listeningScope: 'composite examples', userApprovedCompositeIds: matches ? composites.map((c) => c.id) : [], boundaryHumanReviewed: false, identitySimilarityExplicitlyVerified: false } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.some((x) => ['--apply', '--force', '--verified'].includes(x))) throw new Error('DRY_RUN_ONLY_NO_PROMOTION_IMPLEMENTED')
  console.log(JSON.stringify(auditKobeQuotePack(process.argv.includes('--draft-review')), null, 2))
}
