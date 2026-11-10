// Development-only candidate generation. Ordinary MiMo TTS, NOT the paid Batch API.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { amountWords, utterance } from '../lib/amount.js'
import { measureVoice, media } from './voice-loudness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'dev/mimo-100-cny')
const endpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
const model = 'mimo-v2.5-tts-voiceclone'
const referenceFile = join(root, 'assets/voices/amounts/CNY-0.31.wav')
const referenceSha = '616c0da0c19a87c82f8531cc8ee2aea1da87c2eb24c9506b72dfed44d9f4c1a2'
const instruction = 'Match the supplied reference speaker and performance. Begin MAN with a powerful, deep, resonant shout; then keep the same voice and speak the amount slowly, clearly and confidently. Read only the supplied target text. Read 元 as the Chinese currency syllable yuán. Keep natural short sentence pauses. Do not add words, music or sound effects.'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const plan = Array.from({ length: 100 }, (_, i) => {
  const cents = i + 1, amount = cents / 100, label = amount.toFixed(2)
  const id = `${String(cents).padStart(3, '0')}-CNY-${label}`
  return { id, amount: String(amount), label, currency: 'CNY', text: utterance(amount, 'CNY'), assistantContent: `(raising voice and shouting) MAN! (calm, slow, unhurried) That's about ${amountWords(amount)} 元. Job's not finished.`, file: `audition/${id}.wav` }
})
if (plan.length !== 100 || new Set(plan.map(x => x.id)).size !== 100 || plan[0].amount !== '0.01' || plan[99].amount !== '1') throw Error('INVALID_PLAN')
const reference = readFileSync(referenceFile)
if (sha(reference) !== referenceSha) throw Error('APPROVED_REFERENCE_CHANGED')
const runtimeFile = join(root, 'assets/voices/manifest.json')
function save(report) {
  const file = join(out, 'calls.json'), temp = join(out, 'calls.json.tmp')
  if (dirname(resolve(file)) !== resolve(out) || dirname(resolve(temp)) !== resolve(out)) throw Error('INVALID_LEDGER_PATH')
  writeFileSync(temp, JSON.stringify(report, null, 2) + '\n')
  renameSync(temp, file)
}
function render(report) {
  mkdirSync(join(out, 'audition'), { recursive: true })
  for (const row of report.calls.filter(x => x.status === 'received')) {
    if (row.output && existsSync(join(out, row.output.file))) {
      if (sha(readFileSync(join(out, row.output.file))) !== row.output.sha256) throw Error('EXISTING_OUTPUT_CHANGED')
      continue
    }
    const raw = join(out, row.rawFile), file = join(out, row.item.file)
    if (sha(readFileSync(raw)) !== row.sha256) throw Error('RAW_HASH_MISMATCH')
    const before = measureVoice(raw)
    if (!Number.isFinite(before.activeRmsDb) || !Number.isFinite(before.truePeakDb)) throw Error('INVALID_LEVEL_MEASUREMENT')
    const gainDb = Math.min(-24.8 - before.activeRmsDb, -2.2 - before.truePeakDb)
    media(['-v', 'error', '-y', '-i', raw, '-af', `volume=${gainDb}dB`, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', file])
    const after = measureVoice(file)
    if (Math.abs(before.decodedDurationSeconds - after.decodedDurationSeconds) > 1 / 24000) throw Error('DURATION_CHANGED')
    row.output = { file: row.item.file, sha256: sha(readFileSync(file)), durationSeconds: after.decodedDurationSeconds, gainDb, activeRmsDb: after.activeRmsDb, truePeakDb: after.truePeakDb, humanListeningVerified: false, currencyVerified: false, wholeUtterance: true, splice: false, speedPitchChange: false }
    save(report)
  }
}
function gallery(report) {
  const items = report.calls.filter(x => x.status === 'received' && x.output).map(row => ({ ...row.item, ...row.output })).sort((a,b)=>a.id.localeCompare(b.id))
  const manifest = { provider: 'mimo', model, count: items.length, requestedCount: 100, referenceIsSynthesized: true, referenceSha256: referenceSha, cloudAsrCalls: 0, batchApi: false, automaticallyAddedToRuntime: false, runtimeManifestUnchanged: sha(readFileSync(runtimeFile)) === report.runtimeManifestShaBefore, approvedRuntimeUpdates:report.runtimeUpdates??[], items }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const rows = items.map(x => `<li data-label="${x.label}"><label><input type="checkbox" value="${x.id}"> <strong>${x.label} 元</strong> <span>#${x.id.slice(0, 3)} · ${x.durationSeconds.toFixed(2)}秒</span></label><audio controls preload="none" src="${x.file}"></audio></li>`).join('\n')
  writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小米100条候选试听</title><style>body{font:16px system-ui;max-width:800px;margin:32px auto;padding:0 20px;background:#f6f7fb;color:#18202c}header{position:sticky;top:0;background:#f6f7fb;padding:12px 0}h1{font-size:24px}button,input{font:inherit;padding:8px}ul{list-style:none;padding:0}li{background:white;border:1px solid #dce1ea;border-radius:10px;padding:16px;margin:12px 0}label{display:flex;gap:8px;align-items:center;margin-bottom:10px}label span{margin-left:auto;color:#657185;font-size:13px}audio{width:100%;height:38px}input[type=checkbox]{width:20px;height:20px}</style><header><h1>小米100条候选试听</h1><p>0.01–1.00元，每个金额一条完整句。仅供挑选，尚未加入豆包包。</p><input id="filter" placeholder="搜索金额，如0.31"><button id="export">下载已选清单（0）</button></header><ul>${rows}</ul><script>const items=${JSON.stringify(items)};const checks=[...document.querySelectorAll('input[type=checkbox]')];const button=document.querySelector('#export');function update(){button.textContent='下载已选清单（'+checks.filter(x=>x.checked).length+'）'}checks.forEach(x=>x.onchange=update);document.querySelector('#filter').oninput=e=>document.querySelectorAll('li').forEach(x=>x.hidden=!x.dataset.label.includes(e.target.value.trim()));document.addEventListener('play',e=>document.querySelectorAll('audio').forEach(x=>{if(x!==e.target)x.pause()}),true);button.onclick=()=>{const ids=new Set(checks.filter(x=>x.checked).map(x=>x.value));const selected=items.filter(x=>ids.has(x.id));const a=document.createElement('a');const u=URL.createObjectURL(new Blob([JSON.stringify({provider:'mimo',selected},null,2)],{type:'application/json'}));a.href=u;a.download='selected-mimo-100.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};</script></html>`)
  writeFileSync(join(out, 'README.txt'), `解压后双击 index.html，逐条试听并勾选，再点“下载已选清单”。\n共${items.length}/100条，0.01–1.00元各一条。\n声线参考：用户已确认的豆包AI成品；输出均由小米MiMo重新完整生成。\n只做整句音量调整，未拼贴、变速或改调。未进行云端ASR，不保证每条读音和表现正确，供人工挑选。\n这些候选没有自动混进已安装的豆包离线包。\n`)
  console.log(JSON.stringify({ delivered: items.length, requested: 100, calls: report.calls.length, gallery: join(out, 'index.html'), runtimeManifestUnchanged: manifest.runtimeManifestUnchanged }))
}
async function readBounded(response) {
  const reader = response.body.getReader(), chunks = []; let length = 0
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 8 * 1024 * 1024) throw Error('RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(value)) } } finally { await reader.cancel().catch(() => {}) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function main() {
  if (!process.argv.includes('--run') && !process.argv.includes('--resume') && !process.argv.includes('--render')) { console.log(JSON.stringify({ dryRun: true, count: plan.length, first: plan[0].text, last: plan[99].text, referenceSha256: referenceSha, cloudAsr: 0, batchApi: false })); return }
  mkdirSync(out, { recursive: true }); mkdirSync(join(out, 'raw'), { recursive: true })
  const lock = join(out, 'generation.lock'); writeFileSync(lock, String(process.pid), { flag: 'wx' })
  try {
    const ledger = join(out, 'calls.json')
    let report
    if (process.argv.includes('--render') || process.argv.includes('--resume')) report = JSON.parse(readFileSync(ledger, 'utf8'))
    else { if (existsSync(ledger)) throw Error('EXISTING_LEDGER_NO_REPEAT'); report = { referenceSha256: referenceSha, referenceIsSynthesized: true, model, instruction, runtimeManifestShaBefore: sha(readFileSync(runtimeFile)), hardTtsCap: 100, cloudAsrCap: 0, retries: 0, calls: [] }; save(report) }
    if (report.referenceSha256 !== referenceSha || report.model !== model || report.instruction !== instruction) throw Error('LEDGER_INPUT_CHANGED')
    const currentRuntime=JSON.parse(readFileSync(runtimeFile,'utf8')),currentRuntimeSha=sha(readFileSync(runtimeFile))
    if(currentRuntimeSha!==report.runtimeManifestShaBefore){
      const baselineFile=join(out,'runtime-manifest-before-prefix-A.json'),baseline=JSON.parse(readFileSync(baselineFile,'utf8'))
      const withoutPrefix=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='prefix'))
      if(sha(readFileSync(baselineFile))!==report.runtimeManifestShaBefore||currentRuntime.clips?.prefix?.sha256!=='9a7a7e5fed21b636cf2c3a15f4aa7bf512f1e8246fcba94f3313d69e9aca1098'||JSON.stringify(withoutPrefix(currentRuntime.clips))!==JSON.stringify(withoutPrefix(baseline.clips))||JSON.stringify(currentRuntime.amounts)!==JSON.stringify(baseline.amounts))throw Error('UNEXPECTED_RUNTIME_CHANGE')
      report.runtimeUpdates=[{fromSha256:report.runtimeManifestShaBefore,toSha256:currentRuntimeSha,reason:'User selected A MAN prefix for Doubao offline 0.5.1; all numeric/unit/whole-amount entries unchanged. No MiMo candidate added.'}];save(report)
    }
    if (!process.argv.includes('--render')) {
      if (report.calls.some(x => !['received','error'].includes(x.status))) throw Error('UNKNOWN_ATTEMPT_NO_REPEAT')
      const acknowledged = process.argv.find(x=>x.startsWith('--replace-failed='))?.slice('--replace-failed='.length)
      const failed = report.calls.filter(x=>x.status==='error')
      if (failed.length) {
        if (failed.length!==1 || failed[0].item.id!==acknowledged || acknowledged!=='008-CNY-0.08' || failed[0].error!=='REQUEST_OR_RESPONSE_FAILED' || existsSync(join(out,failed[0].rawFile))) throw Error('FAILED_ATTEMPT_REQUIRES_EXPLICIT_REVIEW')
        report.originalHardTtsCap ??= report.hardTtsCap
        report.hardTtsCap=101
        report.reviewedReplacement={id:acknowledged,reason:'Earlier HTTP 200 body failed; no local audio exists. Preserve failed attempt and explicitly replace once to obtain 100 usable files.',at:new Date().toISOString()}
        save(report)
      }
      const secret = loadMiMoSecret('tts')
      if (!secret.found || secret.base !== 'https://api.xiaomimimo.com/v1') throw Error('OFFICIAL_SECRET_REQUIRED')
      for (const item of plan) {
        if (existsSync(join(out, 'STOP'))) break
        if (report.calls.some(x => x.item.id === item.id && x.status==='received')) continue
        const previous=report.calls.filter(x=>x.item.id===item.id)
        if (previous.length && item.id!==acknowledged) throw Error('UNREVIEWED_REPEAT')
        if (report.calls.length >= report.hardTtsCap) throw Error('REQUEST_CAP_REACHED')
        const row = { item, status: 'started', at: new Date().toISOString(), attempt:previous.length+1, rawFile: `raw/${item.id}${previous.length?'-replacement':''}.wav` }
        report.calls.push(row); save(report)
        try {
          const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: item.assistantContent }], audio: { format: 'wav', voice: `data:audio/wav;base64,${reference.toString('base64')}` }, stream: false }), signal: AbortSignal.timeout(180000) })
          row.httpStatus = response.status
          if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP_${response.status}`) }
          row.phase='response-body'; save(report)
          const data = await readBounded(response), encoded = data.choices?.[0]?.message?.audio?.data
          row.phase='audio-validation'; row.finishReason=data.choices?.[0]?.finish_reason??null; save(report)
          if (typeof encoded !== 'string' || !encoded.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('AUDIO_MISSING_OR_INVALID')
          const bytes = Buffer.from(encoded, 'base64')
          if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('NOT_WAV')
          writeFileSync(join(out, row.rawFile), bytes, { flag: 'wx' })
          const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(out, row.rawFile)], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
          if (probe.status !== 0) throw Error('LOCAL_PROBE_FAILED')
          const duration = Number(JSON.parse(probe.stdout).format?.duration)
          if (!(duration > 0 && duration <= 120)) throw Error('INVALID_DURATION')
          Object.assign(row, { status: 'received', sha256: sha(bytes), bytes: bytes.length, durationSeconds: duration, finishReason: data.choices?.[0]?.finish_reason ?? null, humanListeningVerified: false })
          save(report); console.log(JSON.stringify({ received: report.calls.filter(x => x.status === 'received').length, id: item.id, durationSeconds: duration }))
        } catch (e) { row.status = 'error'; row.errorType=['TimeoutError','AbortError','TypeError','SyntaxError','Error'].includes(e.name)?e.name:'Error'; row.failedAt=new Date().toISOString(); row.error = /^HTTP_\d+$/.test(e.message) || ['AUDIO_MISSING_OR_INVALID', 'NOT_WAV', 'INVALID_DURATION', 'LOCAL_PROBE_FAILED', 'RESPONSE_TOO_LARGE'].includes(e.message) ? e.message : 'REQUEST_OR_RESPONSE_FAILED'; save(report); throw Error(row.error) }
      }
    }
    render(report); gallery(report)
  } finally { if (dirname(resolve(lock)) !== resolve(out)) throw Error('INVALID_LOCK_PATH'); unlinkSync(lock) }
}
main().catch(e => { console.error(JSON.stringify({ error: /^(?:HTTP_\d+|[A-Z_]+)$/.test(e.message) ? e.message : 'LOCAL_FAILURE', noAutomaticRetry: true })); process.exitCode = 1 })
