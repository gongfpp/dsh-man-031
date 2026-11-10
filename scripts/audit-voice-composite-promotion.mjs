// Evidence-only promotion preparation. NEVER writes assets or enables playback.
// --draft-review creates a pending review file in dev; default audits it read-only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { englishVoiceGroupPlan } from './plan-amount-voice-english.mjs'
import { phraseVoicePlan } from './plan-amount-voice-phrases.mjs'
import { normalizeEnglishASR, englishAmountTokens } from './amount-voice-english.mjs'
import { validateOriginalOpener, validatePhraseDeclarations } from './normalize-voice-pack.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), assets = join(root, 'assets/voices')
const reviewDir = join(root, 'dev/voice-promotion'), reviewFile = join(reviewDir, 'standard-phrases-review.json')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const requireIt = (ok, error) => { if (!ok) throw new Error(error) }
if (process.argv.some((x) => ['--apply', '--force', '--verified'].includes(x))) throw new Error('DRY_RUN_ONLY_NO_PROMOTION_IMPLEMENTED')
const manifestPath = join(assets, 'manifest.json'), bytes = readFileSync(manifestPath), manifest = JSON.parse(bytes)
if (manifest.originalQuotes) {
  const { auditKobeQuotePack } = await import('./audit-voice-kobe-quotes.mjs')
  console.log(JSON.stringify(auditKobeQuotePack(process.argv.includes('--draft-review')), null, 2))
  process.exit(0)
}
requireIt(manifest.status === 'candidate' && Object.keys(manifest.clips).length === 45, 'EXACT_45_CLIP_CANDIDATE_REQUIRED_REAUDIT_AFTER_ANY_NEW_CLIP')
validatePhraseDeclarations(manifest.phrases, manifest.clips)
for (const [key, c] of Object.entries(manifest.clips)) {
  requireIt(/^clips\/[a-zA-Z0-9_.-]+\.mp3$/.test(c.file), 'UNSAFE_CLIP_PATH')
  requireIt(sha(readFileSync(join(assets, c.file))) === c.sha256, `CLIP_DIGEST_MISMATCH:${key}`)
  if (c.synthetic === false) validateOriginalOpener(c, key, manifest.openers)
  else requireIt(c.referenceSha256 === englishVoiceGroupPlan.referenceSha256, `MIXED_REFERENCE:${key}`)
}
function auditGroup(dirName, plan, count, cutsFile, expectedGaps) {
  const dir = join(root, 'dev', dirName), report = json(join(dir, 'samples.json')), ledger = json(join(dir, 'calls.json')), cuts = json(join(dir, cutsFile))
  requireIt(JSON.stringify(report.plan) === JSON.stringify(plan) && ledger.calls.length === count && ledger.calls.every((c) => c.status === 'received' && c.phase === 'complete' && c.referenceSha256 === plan.referenceSha256), 'GROUP_PLAN_OR_LEDGER_CHANGED')
  const groups = report.samples || [report]
  const evidences = []
  for (const [i, g] of groups.entries()) {
    const expectedText = plan.groups ? plan.groups[i].text : plan.text
    requireIt(normalizeEnglishASR(g.heard) === normalizeEnglishASR(expectedText), 'GROUP_ASR_SEQUENCE_CHANGED')
    const audio = join(dir, g.file)
    requireIt(sha(readFileSync(audio)) === g.sha256, 'GROUP_AUDIO_DIGEST_CHANGED')
    const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8', timeout: 120000, windowsHide: true }).stdout?.trim())
    requireIt(Number.isFinite(duration) && duration > 0, 'GROUP_PROBE_FAILED')
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audio, '-af', 'silencedetect=n=-38dB:d=0.35', '-f', 'null', '-'], { encoding: 'utf8', timeout: 120000, windowsHide: true })
    requireIt(!r.error && r.status === 0, 'GROUP_SILENCE_AUDIT_FAILED')
    const gaps = []; let from
    for (const m of r.stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
      if (m[1] === 'start') from = Number(m[2])
      else { requireIt(from !== undefined, 'UNPAIRED_SILENCE'); const to = Number(m[2]); if (from > 0.02 && to < duration - 0.02) gaps.push({ start: from, end: to }); from = undefined }
    }
    requireIt(gaps.length === expectedGaps[i], 'GROUP_SILENCE_COUNT_CHANGED')
    const savedGaps = cuts.segmentation.groups ? cuts.segmentation.groups[i].observedInternalSilences : cuts.segmentation.observedInternalSilences
    requireIt(JSON.stringify(gaps) === JSON.stringify(savedGaps), 'RECORDED_CUT_EVIDENCE_CHANGED')
    const keys = plan.groups ? plan.groups[i].keys : plan.items.map((x) => x.key)
    for (const key of keys) requireIt(cuts.clips[key].boundaryReviewed === false && cuts.clips[key].referenceSha256 === plan.referenceSha256 && manifest.clips[key].boundaryReviewed === false && manifest.clips[key].boundaryReviewMethod === 'silencedetect-count+group-asr', 'MACHINE_BOUNDARY_PROVENANCE_MUST_REMAIN_FALSE')
    evidences.push({ id: g.id || plan.id, groupSha256: g.sha256, asrSequenceMatch: true, observedInternalSilences: gaps.length, machineCutCount: keys.length })
  }
  return evidences
}
const groupEvidence = [...auditGroup('voice-pilot-en-b-groups', englishVoiceGroupPlan, 8, 'candidate-cut-plan.json', [9, 9, 7, 8]), ...auditGroup('voice-pilot-en-b-phrases', phraseVoicePlan, 2, 'candidate-cut-plan.json', [4])]
const base = json(join(root, 'dev/voice-pilot-en-b-phrases/base-manifest.json'))
for (const [key, c] of Object.entries(base.clips)) requireIt(JSON.stringify(manifest.clips[key]) === JSON.stringify(c), 'OLD_40_METADATA_MUTATED')
for (const key of ['man-firm', 'man-extended']) requireIt(readFileSync(join(assets, manifest.clips[key].file)).equals(readFileSync(join(root, `dev/voice-pilot-man/${key}.mp3`))), 'ACCEPTED_MAN_BYTES_CHANGED')
const classic = manifest.clips['man-classic']
requireIt(sha(readFileSync(join(root, 'dev/classic-man/retirement-opening-context.mp3'))) === classic.sourceSha256, 'CLASSIC_CONTEXT_DIGEST_CHANGED')
const previewDir = join(root, 'dev/voice-phrase-audition'), previewManifest = json(join(previewDir, 'manifest.json'))
requireIt(previewManifest.sourceManifestSha256 === sha(bytes) && previewManifest.previews.length === 4, 'EXACT_CURRENT_FOUR_COMPOSITES_REQUIRED')
const composites = previewManifest.previews.map((p, i) => {
  const phrase = phraseVoicePlan.phrases[i], expectedKeys = ['man-classic', phrase.prefix, ...englishAmountTokens('0.31'), 'yuan', ...(phrase.suffix ? [phrase.suffix] : [])]
  requireIt(p.amount === '0.31' && p.currency === 'CNY' && p.phraseId === phrase.id && JSON.stringify(p.speechplan.map((s) => s.key)) === JSON.stringify(expectedKeys), 'COMPOSITE_PLAN_CHANGED')
  const path = join(previewDir, p.file)
  requireIt(sha(readFileSync(path)) === p.sha256 && p.speechplan.every((s) => s.fileSha256 === manifest.clips[s.key].sha256), 'COMPOSITE_DIGEST_CHANGED')
  return { id: p.id, path, sha256: p.sha256, text: p.readableText, approved: false, userReply: null, userMessageRef: null, voiceUsabilityAcceptedWithinComposite: false }
})
if (process.argv.includes('--draft-review') && !existsSync(reviewFile)) {
  mkdirSync(reviewDir, { recursive: true })
  writeFileSync(reviewFile, JSON.stringify({ schemaVersion: 1, status: 'pending', manifestPath, manifestSha256: sha(bytes), scope: 'These exact four standard-phrase CNY 0.31 composite examples only. Not individual token or forensic speaker identity review. Not authorization for other future quotes/bridge packs.', approvedForAutomaticPlayback: false, composites, excludedFromApproval: ['all future bridge/quote additions', 'individual clip boundary human review', 'speaker identity authentication'], note: 'Do not copy prior legacy composite approval into these new entries. User has pivoted toward classic quotes; these standard examples are comparison-only.' }, null, 2) + '\n')
}
const review = existsSync(reviewFile) ? json(reviewFile) : null
const approvalMatches = !!review && review.manifestSha256 === sha(bytes) && review.manifestPath === manifestPath && review.status === 'approved' && review.approvedForAutomaticPlayback === true && review.composites?.length === 4 && review.composites.every((a, i) => a.id === composites[i].id && resolve(a.path) === composites[i].path && a.sha256 === composites[i].sha256 && a.approved === true && typeof a.userReply === 'string' && a.userReply.trim() && typeof a.userMessageRef === 'string' && a.userMessageRef.trim() && a.voiceUsabilityAcceptedWithinComposite === true)
console.log(JSON.stringify({ dryRun: true, calls: 0, assetsModified: false, canExecutePromotion: false, evidencePassed: true, clipHashesVerified: 45, groupEvidence, reviewFile, reviewApprovedAndMatching: approvalMatches, blockers: approvalMatches ? ['Read-only tool: a separately reviewed activation path is required; any future quote/bridge changes require a new audit and new matching approval.'] : ['Four NEW standard phrase composites are unapproved; legacy classic+.31 approval does not cover them. User pivoted to classic quote work.'], proposedQualityScopeOnly: { listeningScope: 'composite examples', userApprovedCompositeIds: approvalMatches ? composites.map((x) => x.id) : [], boundaryHumanReviewed: false, identitySimilarityExplicitlyVerified: false }, warning: 'No boundaryReviewed flags or identity verification claims are changed. No --force or --apply operation exists.' }, null, 2))
