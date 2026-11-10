import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
const root = new URL('../assets/voices/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
assert.equal(manifest.id,'kobe-doubao-offline-v1');assert.equal(manifest.provider,'doubao');assert.equal(manifest.runtime,undefined)
assert.equal(manifest.exactOnly,false);assert.equal(Object.keys(manifest.clips).length,55);assert.equal(manifest.phrases.length,10)
assert.equal(new Set(manifest.phrases.map(p=>p.id)).size,10)
for(const row of [...Object.values(manifest.clips),...Object.values(manifest.amounts)]){
  assert.match(row.file,/^(clips|amounts)\/[A-Za-z0-9][A-Za-z0-9-]*(?:\.\d+)?\.wav$/)
  const b=readFileSync(new URL(row.file,root));assert.equal(createHash('sha256').update(b).digest('hex'),row.sha256)
  assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE')
}
assert.equal(manifest.amounts['CNY:0.31'].sha256,'616c0da0c19a87c82f8531cc8ee2aea1da87c2eb24c9506b72dfed44d9f4c1a2')
let api
const window={test:v=>api=v,__ModuleLoader__:{load:({factory})=>factory(()=>({}))}}
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
vm.runInNewContext(client.replace("  return { name: 'man-031'","  window.test({ getAudioPlan, numberTokens, displayAmount, billingAmount }); return { name: 'man-031'"),{window,Date})
for(const [input,expected] of [[.000749,'0.001'],[.3105,'0.311'],[.31004,'0.310'],[1.2345,'1.235'],[9.9995,'10.000'],[.29,'0.290'],[0,'0.000'],[1e-12,'0.000']])assert.equal(api.billingAmount(input),expected)
for(const p of manifest.phrases)for(const currency of ['CNY','USD'])for(const amount of [0,.000749,.3105,1,1.27,21.003,101,1001,1000001,999999999999]){
  const files=Array.from(api.getAudioPlan(manifest,amount,currency,undefined,p.id))
  assert.ok(files[0].endsWith(manifest.clips[p.prefix].file));if(p.suffix)assert.ok(files.at(-1).endsWith(manifest.clips[p.suffix].file))
  assert.ok(!files.some(path=>path.includes('/amounts/')),'a different whole sentence must never replace a selected template')
}
assert.deepEqual(Array.from(api.numberTokens(.000749)),['0','dot','0','0','1'])
assert.deepEqual(Array.from(api.numberTokens(.3105)),['0','dot','3','1','1'])
assert.deepEqual(Array.from(api.numberTokens(9.9995)),['10'])
for(const path of ['../index.js','../client.js']){
 const text=readFileSync(new URL(path,import.meta.url),'utf8');for(const forbidden of ['openspeech.bytedance.com','voice/resolve','voice/configure','man031_voice_prepare','豆包连接'])assert.equal(text.includes(forbidden),false)
}
console.log('offline audio: passed (55 hashed clips, 10 templates x 2 currencies; decimal three-place half-up; approved whole WAV preserved; no runtime provider/key/tool)')
