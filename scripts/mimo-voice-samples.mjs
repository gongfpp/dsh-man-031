// Fixed-reference pilot only: maximum 3 TTS + 3 ASR requests, including failed calls.
// Plan: node scripts/mimo-voice-samples.mjs
// Execute: node scripts/mimo-voice-samples.mjs --run <reference.wav/mp3> <reference-source.json>
// source JSON: {speaker:'Kobe Bryant',url:'https://...',title:'...',transcript:'...',
//   startSeconds:0,endSeconds:12,identityReviewed:true,cleanSpeechReviewed:true}
// Keep original reference/source in dev/voice*/. Never use another plugin's voice pack.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadMiMoSecret } from './mimo-voice-secret.mjs'
import { amountSentence, amountText } from './amount-voice-text.mjs'
import { englishAmountSentence, normalizeEnglishASR } from './amount-voice-english.mjs'
// --chinese-round is the separately authorized second pilot: 2 TTS + 2 ASR.
// It never resets/overwrites the first round's six-request ledger.
const chineseRound = process.argv.includes('--chinese-round')
const englishRound = process.argv.includes('--english-round')
if (chineseRound && englishRound) throw new Error('CHOOSE_ONE_PILOT_ROUND')
const requestBudget = chineseRound || englishRound ? 4 : 6
const perKindBudget = chineseRound || englishRound ? 2 : 3
const out = fileURLToPath(new URL(englishRound ? '../dev/voice-pilot-en/' : chineseRound ? '../dev/voice-pilot-v2/' : '../dev/voice-pilot/', import.meta.url))
const samples = (englishRound ? [
  { id: 'CNY-0.31', amount: '0.31', currency: 'CNY' },
  { id: 'USD-1.27', amount: '1.27', currency: 'USD' },
] : chineseRound ? [
  { id: 'CNY-0.31', amount: '0.31', currency: 'CNY' },
  { id: 'USD-120.0001', amount: '120.0001', currency: 'USD' },
] : [
  { id: 'CNY-0', amount: '0', currency: 'CNY' },
  { id: 'CNY-0.31', amount: '0.31', currency: 'CNY' },
  { id: 'USD-120.0001', amount: '120.0001', currency: 'USD' },
]).map((s) => ({ ...s, text: englishRound ? englishAmountSentence(s.amount, s.currency) : chineseRound ? `${amountText(s.amount)}${s.currency === 'USD' ? '美元' : '元'}。` : amountSentence(s.amount, s.currency) }))
const instruction = englishRound
  ? 'Speak only the provided English sentence, with clear natural English numbers. Preserve the reference speaker\'s original low voice and calm conversational delivery. Do not change pitch, exaggerate, add words, sing, or speak Chinese.'
  : chineseRound
  ? '请只用普通话准确清晰地朗读给定的中文数字和金额单位，不要说英文，不要添加内容。保持参考说话人的低沉原始声线和稳定自然语气，不改变音高，不夸张。'
  : '保持参考音频说话人的原始声线、音高和自然讲话方式，稳定平静，不模仿其他人，不加旁白，不唱歌，不用夸张情绪。只朗读给定文字，英文开头接普通话金额。'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const norm = (text) => String(text).toLowerCase().replace(/\d+(?:\.\d+)?/g, (number) => { try { return amountText(number) } catch { return number } }).replace(/[^a-z零一二三四五六七八九十百千万亿点元美]/g, '')
async function main() {
  if (process.argv[2] !== '--run') {
    console.log(JSON.stringify({ dryRun: true, samples, maximumRequests: requestBudget, ttsMaximum: perKindBudget, asrMaximum: perKindBudget, retries: 0, publication: 'manual review only' }, null, 2))
    return
  }
  const [, , , refArg, sourceArg] = process.argv
  if (!refArg || !sourceArg) throw new Error('REFERENCE_AND_SOURCE_REQUIRED')
  const reference = readFileSync(resolve(refArg))
  if (!/\.(mp3|wav)$/i.test(refArg) || reference.length > 10 * 1024 * 1024 || !reference.length) throw new Error('INVALID_REFERENCE_AUDIO')
  const source = JSON.parse(readFileSync(resolve(sourceArg), 'utf8'))
  if (source.speaker !== 'Kobe Bryant' || !/^https:\/\//.test(source.url || '') || !source.title || !source.transcript || source.identityReviewed !== true || (source.cleanSpeechReviewed !== true && source.pilotOnlyUnlistened !== true) || !(source.endSeconds > source.startSeconds && source.startSeconds >= 0)) throw new Error('REVIEWED_AUTHENTIC_REFERENCE_REQUIRED')
  const secrets = { tts: loadMiMoSecret('tts'), asr: loadMiMoSecret('asr') }
  if (!secrets.tts.found || !secrets.asr.found) throw new Error('MIMO_SECRET_NOT_FOUND')
  mkdirSync(out, { recursive: true })
  const ledgerFile = join(out, 'calls.json')
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : { budget: requestBudget, round: englishRound ? 'en' : chineseRound ? 2 : 1, calls: [] }
  if (ledger.budget !== requestBudget || !Array.isArray(ledger.calls)) throw new Error('INVALID_CALL_LEDGER')
  const referenceSha256 = sha(reference)
  const voice = `data:${/\.wav$/i.test(refArg) ? 'audio/wav' : 'audio/mpeg'};base64,${reference.toString('base64')}`
  const reportFile = join(out, 'samples.json')
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {
    schemaVersion: 1, id: englishRound ? 'kobe-mimo-en-v1' : 'kobe-mimo-v1', language: englishRound ? 'en' : 'mixed', status: 'candidate', synthetic: true,
    attribution: { ...source, notice: 'AI-synthesized voice; not a new recording or endorsement by Kobe Bryant. Public availability does not establish redistribution rights.' },
    reference: { sha256: referenceSha256 }, instruction, samples: [],
    quality: { asrVerified: false, listeningVerified: false, identitySimilarityVerified: false, crossLanguageVerified: false },
  }
  if (report.reference.sha256 !== referenceSha256 || report.instruction !== instruction) throw new Error('FIXED_REFERENCE_OR_STYLE_CHANGED')
  const commit = () => { save(ledgerFile, ledger); save(reportFile, report) }
  async function call(kind, id, body) {
    if (ledger.calls.length >= requestBudget || ledger.calls.filter((c) => c.kind === kind).length >= perKindBudget) throw new Error('PILOT_BUDGET_EXHAUSTED_NO_AUTOMATIC_RETRY')
    const entry = { index: ledger.calls.length + 1, kind, id, at: new Date().toISOString(), status: 'started', phase: 'fetch', referenceSha256 }
    ledger.calls.push(entry); commit() // A timeout/crash may still be billed. Reserve before fetch.
    try {
      const secret = secrets[kind]
      const response = await fetch(`${secret.base}/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${secret.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
      })
      entry.httpStatus = response.status
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      entry.phase = 'response-body'; commit()
      const parsed = await response.json()
      entry.phase = 'complete'; entry.status = 'received'; commit()
      return parsed
    } catch (error) {
      entry.status = 'error'
      entry.error = /^HTTP_\d+$/.test(error.message) ? error.message : error.name === 'SyntaxError' ? 'RESPONSE_JSON_PARSE_FAILED' : ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_OR_RESPONSE_TIMEOUT' : entry.phase === 'response-body' ? 'RESPONSE_BODY_READ_FAILED' : 'NETWORK_FETCH_FAILED'
      entry.errorName = ['SyntaxError', 'TypeError', 'TimeoutError', 'AbortError', 'Error'].includes(error.name) ? error.name : 'OtherError'
      const code = error.cause?.code || error.code
      if (['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) entry.transportCode = code
      commit(); throw new Error(entry.error)
    }
  }
  for (const sample of samples) {
    if (report.samples.some((s) => s.id === sample.id)) continue // No hidden retry of failed samples.
    const row = { ...sample, file: `${sample.id}.mp3`, listeningVerified: false }
    report.samples.push(row); commit()
    try {
      const parsed = await call('tts', sample.id, { model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: sample.text }], audio: { format: 'mp3', voice }, stream: false })
      const data = parsed?.choices?.[0]?.message?.audio?.data
      if (typeof data !== 'string' || !data) throw new Error('TTS_AUDIO_MISSING')
      const bytes = Buffer.from(data, 'base64')
      if (!bytes.length) throw new Error('TTS_AUDIO_EMPTY')
      writeFileSync(join(out, row.file), bytes)
      row.sha256 = sha(bytes); row.bytes = bytes.length
      await new Promise((r) => setTimeout(r, 4000))
      const asr = await call('asr', sample.id, { model: 'mimo-v2.5-asr', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${bytes.toString('base64')}` } }] }] })
      row.heard = asr?.choices?.[0]?.message?.content || ''
      row.asrTextMatch = englishRound ? normalizeEnglishASR(row.heard) === normalizeEnglishASR(sample.text) : norm(row.heard) === norm(sample.text)
    } catch (error) {
      row.error = /^(?:HTTP_\d+|TTS_AUDIO_MISSING|TTS_AUDIO_EMPTY|PILOT_BUDGET_EXHAUSTED_NO_AUTOMATIC_RETRY)$/.test(error.message) ? error.message : 'PILOT_CALL_FAILED'
      commit(); break // Stop on first error; never multiply billable failed calls.
    }
    commit()
    if (sample !== samples.at(-1)) await new Promise((r) => setTimeout(r, 4000))
  }
  report.quality.asrVerified = report.samples.length === samples.length && report.samples.every((s) => s.asrTextMatch === true)
  commit()
  console.log(JSON.stringify({ output: out, ttsCalls: ledger.calls.filter((c) => c.kind === 'tts').length, asrCalls: ledger.calls.filter((c) => c.kind === 'asr').length, errors: ledger.calls.filter((c) => c.status === 'error').length, asrVerified: report.quality.asrVerified, listeningVerified: false, status: 'candidate' }))
}
main().catch((error) => {
  const safe = /^(?:MIMO_SECRET_NOT_FOUND|REFERENCE_AND_SOURCE_REQUIRED|INVALID_REFERENCE_AUDIO|REVIEWED_AUTHENTIC_REFERENCE_REQUIRED|INVALID_CALL_LEDGER|FIXED_REFERENCE_OR_STYLE_CHANGED|PILOT_BUDGET_EXHAUSTED_NO_AUTOMATIC_RETRY)$/.test(error.message) ? error.message : 'PILOT_SETUP_FAILED'
  console.error(JSON.stringify({ error: safe, callsNotAutomaticallyRetried: true })); process.exitCode = 1
})
