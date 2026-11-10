// Development only. No credentials, cloud calls or generation code ships with the plugin.
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const directory = fileURLToPath(new URL('../dev/doubao-offline-pilot/', import.meta.url))
export const plan = [
  { id: 'prefix', text: "MAN! That's about.", instruction: '用参考的同一男声。MAN低沉、洪亮有力地感叹，短暂停顿，然后沉稳地说That\'s about。只读目标文本，不添加其他词或音乐。' },
  { id: '0', text: 'Zero.' }, { id: 'dot', text: 'Point.' },
  { id: '3', text: 'Three.' }, { id: '1', text: 'One.' },
  { id: 'yuan', text: "元。Job's not finished.", instruction: '用参考的同一低沉男声，沉稳自然、清楚地读目标文本。元按中文yuán读，之后自然地说英文。只读目标文本，不添加其他词或音乐。' },
  ...[[2,'Two'],[4,'Four'],[5,'Five'],[6,'Six'],[7,'Seven'],[8,'Eight'],[9,'Nine'],[10,'Ten'],[11,'Eleven'],[12,'Twelve'],[13,'Thirteen'],[14,'Fourteen'],[15,'Fifteen'],[16,'Sixteen'],[17,'Seventeen'],[18,'Eighteen'],[19,'Nineteen'],[20,'Twenty'],[30,'Thirty'],[40,'Forty'],[50,'Fifty'],[60,'Sixty'],[70,'Seventy'],[80,'Eighty'],[90,'Ninety'],['hundred','Hundred'],['thousand','Thousand'],['million','Million'],['billion','Billion']].map(([id,word])=>({id:String(id),text:word+'.'})),
  { id:'dollars', text:"Dollars. Job's not finished." },
  { id:'singular-dollar', text:"Dollar. Job's not finished." },
]
const defaultInstruction = '用参考的同一低沉男声，沉稳、清楚地读这个英语数字词，正常偏慢的语速，音量一致。只读目标文本一次，不要解释、报数、其他词或音乐。'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function generateItem(id, key, options = {}) {
  const destination = options.directory ?? directory
  const item = (options.plan ?? plan).find(row => row.id === id)
  if (!item || !/^[A-Za-z0-9-]+$/.test(id) || typeof key !== 'string' || !key) throw Error('INVALID_DEVELOPMENT_INPUT')
  await mkdir(destination, { recursive: true })
  const ledger = { id, text: item.text, instruction: item.instruction ?? defaultInstruction, speaker: 'S_HhJVZcKf2', model: 'seed-tts-2.0-expressive', status: 'reserved', time: new Date().toISOString(), requestId: randomUUID() }
  const ledgerPath = join(destination, `${id}.json`)
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' })
  const payload = JSON.stringify({ user: { uid: 'dsh-man-031-offline-build' }, req_params: { text: item.text, speaker: ledger.speaker, model: ledger.model, audio_params: { format: 'mp3', sample_rate: 24000 }, additions: JSON.stringify({ context_texts: [ledger.instruction] }) } })
  try {
    const response = await new Promise((resolve, reject) => {
      const request = https.request('https://openspeech.bytedance.com/api/v3/tts/unidirectional', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key, 'X-Api-Resource-Id': 'seed-icl-2.0', 'X-Api-Request-Id': ledger.requestId } }, incoming => {
        const parts = []; let size = 0
        incoming.on('data', bytes => { size += bytes.length; if (size > 4 * 1024 * 1024) request.destroy(Error('RESPONSE_TOO_LARGE')); else parts.push(bytes) })
        incoming.on('error', reject)
        incoming.on('end', () => resolve({ status: incoming.statusCode, bytes: Buffer.concat(parts) }))
      })
      request.setTimeout(45000, () => request.destroy(Error('PROVIDER_TIMEOUT')))
      request.on('error', reject); request.end(payload)
    })
    ledger.http = response.status
    if (response.status !== 200) throw Error('PROVIDER_HTTP_ERROR')
    const records = response.bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    if (records.at(-1)?.code !== 20000000 || records.some(row => ![0, 20000000].includes(row.code))) throw Error('PROVIDER_BUSINESS_ERROR')
    const audio = Buffer.concat(records.filter(row => row.code === 0 && typeof row.data === 'string').map(row => Buffer.from(row.data, 'base64')))
    if (!audio.length || audio.length > 1024 * 1024) throw Error('INVALID_AUDIO_SIZE')
    await writeFile(join(destination, `${id}.mp3`), audio, { flag: 'wx' })
    Object.assign(ledger, { status: 'received', bytes: audio.length, sha256: hash(audio), finalCode: 20000000 })
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
    return { id, status: ledger.status, bytes: audio.length }
  } catch (error) {
    ledger.status = 'failed'; ledger.error = ['PROVIDER_HTTP_ERROR', 'PROVIDER_BUSINESS_ERROR', 'PROVIDER_TIMEOUT', 'RESPONSE_TOO_LARGE', 'INVALID_AUDIO_SIZE'].includes(error.message) ? error.message : 'NETWORK_OR_RESPONSE_ERROR'
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
    throw Error(`${id}: ${ledger.error}; no automatic retry`)
  }
}
