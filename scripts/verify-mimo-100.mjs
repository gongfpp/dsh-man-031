import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { utterance } from '../lib/amount.js'
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dev/mimo-100-cny')
const json = file => JSON.parse(readFileSync(join(out, file), 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const report = json('calls.json'), manifest = json('manifest.json')
assert.equal(report.calls.filter(x=>x.status==='received').length,100); assert.ok(report.calls.length>=100&&report.calls.length<=101); assert.equal(manifest.count, 100)
assert.equal(manifest.cloudAsrCalls, 0); assert.equal(manifest.batchApi, false)
assert.equal(manifest.automaticallyAddedToRuntime, false)
assert.equal(manifest.referenceSha256, '616c0da0c19a87c82f8531cc8ee2aea1da87c2eb24c9506b72dfed44d9f4c1a2')
assert.equal(new Set(manifest.items.map(x => x.id)).size, 100)
const runtimeSha=sha(readFileSync(join(root,'assets/voices/manifest.json')))
assert.ok(runtimeSha===report.runtimeManifestShaBefore||(report.runtimeUpdates??[]).some(x=>x.fromSha256===report.runtimeManifestShaBefore&&x.toSha256===runtimeSha))
for (let i = 0; i < 100; i++) {
  const item = manifest.items[i], call = report.calls.find(x=>x.status==='received'&&x.item.id===item.id), amount = (i + 1) / 100
  assert.equal(item.label, amount.toFixed(2)); assert.equal(item.amount, String(amount))
  assert.equal(item.text, utterance(amount, 'CNY')); assert.equal(item.currency, 'CNY')
  assert.equal(item.id, call.item.id); assert.equal(call.status, 'received'); assert.equal(call.httpStatus, 200)
  assert.equal(item.humanListeningVerified, false); assert.equal(item.currencyVerified, false)
  assert.equal(item.wholeUtterance, true); assert.equal(item.splice, false); assert.equal(item.speedPitchChange, false)
  assert.match(item.file, /^audition\/\d{3}-CNY-\d+\.\d{2}\.wav$/)
  const bytes = readFileSync(join(out, item.file))
  assert.equal(sha(bytes), item.sha256); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE')
  assert.equal(sha(readFileSync(join(out, call.rawFile))), call.sha256)
  assert.ok(Math.abs(item.durationSeconds - call.durationSeconds) <= 1 / 24000)
}
const html = readFileSync(join(out, 'index.html'), 'utf8')
assert.equal((html.match(/<audio /g) || []).length, 100)
assert.equal((html.match(/type="checkbox"/g) || []).length, 100)
const durations = manifest.items.map(x => x.durationSeconds), levels = manifest.items.map(x => x.activeRmsDb)
const result = { passed: true, files: 100, amounts: '0.01–1.00 CNY', httpTtsCalls: report.calls.length, cloudAsrCalls: 0, freeBatchApiUsed: false, runtimeManifestUnchanged: runtimeSha===report.runtimeManifestShaBefore, approvedRuntimeUpdates:report.runtimeUpdates??[], candidatesAddedToRuntime:false, contentsHumanReviewed: false, minimumDurationSeconds: Math.min(...durations), maximumDurationSeconds: Math.max(...durations), totalDurationSeconds: durations.reduce((a, b) => a + b, 0), activeRmsMinDb: Math.min(...levels), activeRmsMaxDb: Math.max(...levels), note: 'Structural/hash/mapping/whole-volume checks only; not a pronunciation or performance approval.' }
writeFileSync(join(out, 'verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
