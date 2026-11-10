// Read-only exact pack validation. Does not promote, generate, normalize, or rewrite evidence.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { media } from './voice-loudness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), assets = resolve(root, 'assets/voices'), dev = resolve(root, 'dev/voice-hybrid-v1')
const json = (p) => JSON.parse(readFileSync(p, 'utf8')), sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
export function verifyHybridVoicePack() {
  const m = json(resolve(assets, 'manifest.json')), publication = json(resolve(dev, 'pack/publication.json')), auditions = json(resolve(dev, 'auditions.json')), samples = json(resolve(dev, 'samples.json'))
  assert.equal(m.schemaVersion, 1); assert.equal(m.id, 'kobe-mimo-en-hybrid-v1'); assert.equal(m.exactOnly, true); assert.equal(m.status, 'verified')
  assert.equal(m.quality.asrVerified, false); assert.equal(m.quality.strictTextMatch, false); assert.equal(m.quality.identitySimilarityVerified, false); assert.equal(m.quality.boundaryHumanReviewed, false); assert.equal(m.quality.listeningVerified, true)
  assert.deepEqual(m.openers, ['man-classic', 'man-kimmel']); assert.deepEqual(Object.keys(m.clips), m.openers); assert.deepEqual(Object.keys(m.amounts), ['CNY:0.31', 'USD:1.27'])
  assert.deepEqual(m.phrases, [{ id: 'hybrid-jobs', prefix: 'whole-body', text: "That's about [amount and unit]. Job's not finished.", exactOnly: true }])
  assert.equal(sha(resolve(assets, 'manifest.json')), publication.manifestSha256); assert.equal(m.reference.sha256, samples.referenceSha256)
  assert.equal(m.reference.sha256, 'c8801e244195e79de49d6b070b64a4c925dcb26307111664f099a370d816c7f3')
  const accepted = ['CNY-0.31-classic', 'CNY-0.31-kimmel', 'USD-1.27-kimmel'], acceptance = m.humanCompositeAcceptance
  assert.equal(acceptance.basis.relayMessageRef, 'm01972'); assert.equal(acceptance.basis.reportedToolAnswerRef, 'm01801'); assert.equal(acceptance.noClaimAllFourCompositesListened, true)
  assert.equal(acceptance.composites.length, 4); assert.deepEqual(acceptance.composites.filter((c) => c.userApproved).map((c) => c.id), accepted)
  for (const c of acceptance.composites) { const a = auditions.outputs.find((s) => s.id === c.id); assert.equal(c.auditionSha256, a.sha256); assert.equal(sha(a.file), a.sha256); assert.equal(c.userApproved, accepted.includes(c.id)); for (const p of c.components) { const s = auditions.sources.find((s) => s.id === p.id); assert.equal(p.rawSourceSha256, s.sourceSha256); assert.equal(p.auditionStageSha256, s.outputSha256) } }
  const rows = [...Object.entries(m.clips), ...Object.entries(m.amounts)], files = new Set(), timing = []
  for (const [key, r] of rows) {
    assert.match(r.file, /^(clips|amounts)\/[A-Za-z0-9_-]+(?:\.[0-9]+)?\.mp3$/); assert.ok(!files.has(r.file)); files.add(r.file)
    const actual = resolve(assets, r.file), p = publication.assets.find((s) => s.file === r.file), src = auditions.sources.find((s) => s.id === p.id)
    assert.equal(sha(actual), r.sha256); assert.equal(r.sha256, p.sha256); assert.equal(sha(resolve(root, p.stageFile)), p.stageSha256); assert.equal(sha(resolve(root, p.sourceFile)), p.sourceSha256)
    assert.equal(r.volumeProcessing.auditionStageSha256, src.outputSha256); assert.equal(r.volumeProcessing.gainDb, src.staticGainDb); assert.equal(r.volumeProcessing.additionalGainOrLimiter, false); assert.equal(r.volumeProcessing.pitchOrSpeedChanged, false); assert.equal(r.volumeProcessing.croppedAfterAudition, false)
    if (key.startsWith('man-')) { assert.equal(r.synthetic, false); assert.ok(!('referenceSha256' in r)); assert.equal(r.sourceUrl, src.sourceUrl); assert.deepEqual(r.sourceRangeSeconds, src.sourceRangeSeconds) }
    else {
      assert.equal(r.synthetic, true); assert.equal(r.wholeBody, true); assert.equal(r.includesMan, false); assert.equal(r.includesSyntheticQuote, true); assert.equal(r.phraseId, 'hybrid-jobs'); assert.equal(r.referenceSha256, m.reference.sha256)
      assert.equal(r.asrVerified, false); assert.equal(r.strictTextMatch, false); assert.ok(!('currencyVerified' in r)); assert.equal(r.asrEvidence.cloud, src.heard)
      const local = json(resolve(dev, `body-${p.id}.local-asr.json`)); assert.equal(r.asrEvidence.local, local.heard); assert.equal(local.sourceSha256, p.sourceSha256)
    }
    const stage = media(['-v', 'error', '-i', resolve(root, p.stageFile), '-f', 'f32le', '-ac', '1', '-ar', '24000', 'pipe:1'], true).stdout, encoded = media(['-v', 'error', '-i', actual, '-f', 'f32le', '-ac', '1', '-ar', '24000', 'pipe:1'], true).stdout
    const stageN = stage.length / 4, n = encoded.length / 4; assert.equal(stageN, src.decodedSamples); assert.ok(Math.abs(n - stageN) <= 576, 'MP3 decoder tail cannot exceed one frame')
    let e1 = 0, e2 = 0, cross = 0, peak = 0
    for (let i = 0; i < Math.min(n, stageN); i++) { const a = stage.readFloatLE(i * 4), b = encoded.readFloatLE(i * 4); e1 += a * a; e2 += b * b; cross += a * b; peak = Math.max(peak, Math.abs(b)) }
    const correlation = cross / Math.sqrt(e1 * e2), rmsDeltaDb = 10 * Math.log10(e2 / e1)
    assert.ok(correlation > .98, 'encoded content/time alignment'); assert.ok(Math.abs(rmsDeltaDb) < .5, 'encoding must not add meaningful loudness'); assert.ok(peak < 1, 'decoded sample clipping')
    timing.push({ key, stageSamples: stageN, encodedSamples: n, sampleDifference: n - stageN, zeroLagCorrelation: correlation, encodingRmsDeltaDb: rmsDeltaDb })
  }
  assert.equal(files.size, 4)
  const baseline = resolve(root, publication.backupDirectory), old = json(resolve(baseline, 'manifest.json')); assert.equal(sha(resolve(baseline, 'manifest.json')), 'be08ee148edb840b8b734c8a019ed9edc1e07990c21ff3b725219629d09caa3d')
  for (const r of [...Object.values(old.clips), ...Object.values(old.amounts)]) assert.equal(sha(resolve(baseline, r.file)), r.sha256)
  // Execute the real client's pure planning functions, never a mocked implementation.
  const client = readFileSync(resolve(root, 'client.js'), 'utf8'), start = client.indexOf('  function formatAmount('), end = client.indexOf('  function previewAmount('); assert.ok(start >= 0 && end > start)
  const context = {}; vm.createContext(context); vm.runInContext(client.slice(start, end) + '\nglobalThis.plan = getAudioPlan', context)
  for (const [currency, amount] of [['CNY', .31], ['USD', 1.27]]) for (const opener of m.openers) assert.deepEqual(Array.from(context.plan(m, amount, currency, opener, 'hybrid-jobs')), [`/api/man-031/voices/${m.clips[opener].file}`, `/api/man-031/voices/${m.amounts[`${currency}:${amount}`].file}`])
  for (const [currency, amount] of [['CNY', 0], ['USD', 0], ['CNY', .01], ['CNY', .31004], ['USD', .31], ['CNY', 1.27], ['USD', 1.27004], ['CNY', 1e-8]]) assert.equal(context.plan(m, amount, currency), null)
  assert.throws(() => context.plan(m, .31, 'CNY', undefined, 'unknown-phrase'))
  const mismatched = structuredClone(m); mismatched.amounts['CNY:0.31'].phraseId = 'other'; assert.equal(context.plan(mismatched, .31, 'CNY'), null)
  assert.equal(m.costs.historicalTotal, 41); assert.equal(m.costs.thisPublicationApiCalls, 0)
  const result = { passed: true, exactOnly: true, listedAudio: files.size, acceptedComposites: accepted, unreviewedComposite: 'USD-1.27-classic', strictAsrVerified: false, clientExactHitAndNoFallbackChecks: true, historicalApiCalls: 41, publicationApiCalls: 0, readOnly: true, timing }
  console.log(JSON.stringify(result, null, 2)); return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyHybridVoicePack()
