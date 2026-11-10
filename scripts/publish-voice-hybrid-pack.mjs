// Finite local pack publication from the exact already-auditioned components; no network.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url)), dev = join(root, 'dev/voice-hybrid-v1'), pack = join(dev, 'pack'), stage = join(pack, 'stage'), assets = join(root, 'assets/voices')
const digest = (b) => createHash('sha256').update(b).digest('hex'), sha = (f) => digest(readFileSync(f)), json = (f) => JSON.parse(readFileSync(f, 'utf8')), rel = (f) => relative(root, f).replaceAll('\\', '/')
const auditions = json(join(dev, 'auditions.json')), samples = json(join(dev, 'samples.json')), refSha = 'c8801e244195e79de49d6b070b64a4c925dcb26307111664f099a370d816c7f3'
assert.equal(auditions.referenceSha256, refSha); assert.equal(samples.referenceSha256, refSha)
const acceptedIds = ['CNY-0.31-classic', 'CNY-0.31-kimmel', 'USD-1.27-kimmel']
const composites = auditions.outputs.map((a) => { assert.equal(sha(a.file), a.sha256); return { id: a.id, auditionSha256: a.sha256, durationSeconds: a.durationSeconds, userApproved: acceptedIds.includes(a.id), scope: acceptedIds.includes(a.id) ? 'actual presented composite' : 'not separately presented or listened', components: a.parts.map((p) => ({ id: p.id, rawSourceSha256: p.sourceSha256, auditionStageSha256: p.outputSha256 })) } })
assert.equal(composites.length, 4); assert.equal(composites.filter((x) => x.userApproved).length, 3)
const acceptance = { basis: { kind: 'lead-relayed-human-listening-acceptance', relayMessageRef: 'm01972', reportedToolAnswerRef: 'm01801', reportedUserReply: '两种币种听着都可以，继续整合' }, scope: 'three presented exact composites; not ASR, identity, licensing, arbitrary amounts, or unpresented USD/classic composite', composites, amounts: ['CNY:0.31', 'USD:1.27'], noClaimAllFourCompositesListened: true }
const sources = auditions.sources
assert.deepEqual(sources.map((s) => s.id), ['man-classic', 'man-kimmel', 'CNY-0.31', 'USD-1.27'])
const files = sources.map((s) => ({ ...s, assetFile: `${s.synthetic ? 'amounts' : 'clips'}/${s.id}.mp3` }))
for (const s of files) { assert.equal(sha(s.file), s.sourceSha256); assert.equal(sha(s.matchedFile), s.outputSha256); assert.ok(Number.isFinite(s.staticGainDb)); if (s.synthetic) assert.equal(s.referenceSha256, refSha) }
if (!process.argv.includes('--run')) { console.log(JSON.stringify({ dryRun: true, assets: files.map((s) => s.assetFile), exactAmounts: acceptance.amounts, acceptedComposites: acceptedIds, apiCalls: 0, cumulativeCalls: 41 }, null, 2)); process.exit(0) }
assert.ok(process.argv.includes('--lead-approval=m01972'), 'explicit integration approval required')
assert.ok(!existsSync(join(pack, 'publication.json')), 'already published; do not overwrite or repeat silently')
mkdirSync(stage, { recursive: true })
const clips = {}, amounts = {}, provenance = []
for (const s of files) {
  const output = join(stage, s.assetFile); mkdirSync(dirname(output), { recursive: true })
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', s.matchedFile, '-map_metadata', '-1', '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', output], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
  assert.equal(run.status, 0, 'local MP3 encoding failed')
  const row = { file: s.assetFile, text: s.text, sha256: sha(output), synthetic: s.synthetic, durationSeconds: s.decodedSamples / 24000, sourceDecodedSamples: s.decodedSamples, volumeProcessing: { method: 'auditioned whole-component static gain; encode only after approved stage', gainDb: s.staticGainDb, rawSourceSha256: s.sourceSha256, auditionStageSha256: s.outputSha256, outputSha256: sha(output), auditionStageFile: rel(s.matchedFile), pitchOrSpeedChanged: false, croppedAfterAudition: false, additionalGainOrLimiter: false }, humanAcceptanceScope: 'presented composite examples, not per-word acoustic certification' }
  if (s.synthetic) {
    const local = json(join(dev, `body-${s.id}.local-asr.json`)); assert.equal(local.sourceSha256, s.sourceSha256)
    row.referenceSha256 = refSha; row.phraseId = 'hybrid-jobs'; row.includesSyntheticQuote = true; row.includesMan = false; row.wholeBody = true; row.asrVerified = false; row.strictTextMatch = false
    row.asrEvidence = { cloud: s.heard, local: local.heard, localModel: local.model, strictTextMatch: false, rawResultPreserved: true, note: s.id.startsWith('USD') ? 'Extra And does not alter numeric amount/unit semantics; possible local-only next is unconfirmed.' : 'Cloud un / local UN unit pronunciation accepted for use by user listening, not independently currency-verified.' }
    amounts[s.id.replace('-', ':')] = row
  } else {
    row.sourceUrl = s.sourceUrl; row.sourceRangeSeconds = s.sourceRangeSeconds; row.referenceType = 'original-recording-excerpt-not-cloned-reference'; row.rightsConfirmed = false; clips[s.id] = row
  }
  provenance.push({ id: s.id, file: s.assetFile, sha256: row.sha256, sourceFile: rel(s.file), sourceSha256: s.sourceSha256, stageFile: rel(s.matchedFile), stageSha256: s.outputSha256, gainDb: s.staticGainDb })
}
const manifest = { schemaVersion: 1, id: 'kobe-mimo-en-hybrid-v1', language: 'en', status: 'verified', verifiedScope: 'human-approved limited exact composite examples, with strict ASR mismatches retained', exactOnly: true, synthetic: true, notice: 'Two original MAN excerpts plus AI-synthesized complete bodies. Not a new authentic Kobe recording or endorsement. Public availability is not a redistribution license.', defaultCurrency: 'CNY', currencies: ['CNY', 'USD'], currencyLabels: { CNY: '元', USD: '美元' }, openers: ['man-classic', 'man-kimmel'], phrases: [{ id: 'hybrid-jobs', prefix: 'whole-body', text: "That's about [amount and unit]. Job's not finished.", exactOnly: true }], clips, amounts, reference: { sha256: refSha, durationSeconds: 12.19, oneFileFourNoncontinuousInterviewPassages: true, sourceUrl: 'https://www.youtube.com/watch?v=t8eoIKiDTw8', sourceSha256: samples.sourceSha256 }, quality: { asrVerified: false, strictTextMatch: false, listeningVerified: true, listeningScope: 'three named exact composite previews only', identitySimilarityVerified: false, boundaryHumanReviewed: false, rightsConfirmed: false, userApprovedComposite: true }, humanCompositeAcceptance: acceptance, costs: { thisPublicationApiCalls: 0, historicalTotal: 41, tts: 21, asr: 20 } }
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const readable = ['Hybrid exact-only pack: CNY 0.31 / USD 1.27 only. No fragments or zero fallback.', 'Original MAN pool: man-classic / man-kimmel (same static gains as presented auditions).', ...Object.entries(amounts).map(([k, v]) => `${k}: ${v.text}\nCloud ASR: ${v.asrEvidence.cloud}\nLocal ASR: ${v.asrEvidence.local}\nstrictTextMatch:false; user composite acceptance is not an ASR pass.`), 'Presented and accepted: CNY/classic, CNY/Kimmel, USD/Kimmel. USD/classic was not separately listened.', 'Status verified means limited human composite acceptance, not identity, legal rights, currency ASR certification, or all amounts.'].join('\n\n') + '\n'
writeFileSync(join(stage, 'readable-text.txt'), readable)
// Preserve every file in the prior declared pack before replacing any overlapping path.
const old = json(join(assets, 'manifest.json')), baseline = join(pack, 'previous-runtime-baseline'); mkdirSync(baseline, { recursive: true })
copyFileSync(join(assets, 'manifest.json'), join(baseline, 'manifest.json'))
for (const row of [...Object.values(old.clips), ...Object.values(old.amounts)]) { assert.match(row.file, /^(clips|amounts)\/[A-Za-z0-9_.-]+\.mp3$/); const to = join(baseline, row.file); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(assets, row.file), to); if (row.sha256) assert.equal(sha(to), row.sha256) }
for (const f of ['sources/original-quotes.json', 'sources/processed-bridge.json', 'sources/classic-man.json', 'readable-text.txt']) if (existsSync(join(assets, f))) { mkdirSync(dirname(join(baseline, f)), { recursive: true }); copyFileSync(join(assets, f), join(baseline, f)) }
for (const s of files) { const to = join(assets, s.assetFile); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(stage, s.assetFile), to) }
copyFileSync(join(stage, 'readable-text.txt'), join(assets, 'readable-text.txt')); copyFileSync(join(stage, 'manifest.json'), join(assets, 'manifest.json'))
const result = { manifestFile: 'assets/voices/manifest.json', manifestSha256: sha(join(assets, 'manifest.json')), baselineManifestSha256: sha(join(baseline, 'manifest.json')), backupDirectory: rel(baseline), assets: provenance, acceptance, apiCalls: 0, cumulativeCalls: 41 }
writeFileSync(join(pack, 'publication.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2))
