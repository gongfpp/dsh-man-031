import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { directory, plan } from './generate-doubao-offline.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const root = new URL('../', import.meta.url), assetRoot = new URL('assets/voices/', root)
const report = JSON.parse(await readFile(join(directory, 'render.json'), 'utf8'))
const asr = JSON.parse(await readFile(join(directory, 'bank-asr.json'), 'utf8'))
const numericWords = { '0':'zero','1':'one','2':'two','3':'three','4':'four','5':'five','6':'six','7':'seven','8':'eight','9':'nine' }
for(const item of plan.filter(item=>/^\d+$/.test(item.id))){
  const row=asr.samples.find(row=>row.id===item.id), text=row?.inferenceOnly.toLowerCase().replace(/[^a-z0-9]/g,'')
  if(text!==item.id && text!==numericWords[item.id])throw Error(`NUMERIC_ASR_MISMATCH ${item.id}`)
}
const preferredRoot = new URL('dev/doubao-man-refresh/', root)
const preferredReport = JSON.parse(await readFile(new URL('render.json', preferredRoot), 'utf8'))
const preferred = preferredReport.clips.find(row => row.id === 'prefix-clear')
if (!preferred || preferred.text !== "MAN! That's about.") throw Error('PREFERRED_PREFIX_MISSING')
for (const [file, expected] of [['A-CNY-0.31004.wav','e4dacc7831b7d667b784e01a11902ce508c3d64241baa3cf4022b83b068fcd0f'],['A-USD-1.27.wav','3d750d1aeff82f4dd4485bfcff811dc2e8c01b9f058009d0d19a6f497063f733']]) {
  if (hash(await readFile(new URL(`audition/${file}`, preferredRoot))) !== expected) throw Error('PREFERRED_AUDITION_CHANGED')
}
const preferredSource = new URL('clips/prefix-clear.wav', preferredRoot)
const preferredBytes = await readFile(preferredSource)
if (hash(preferredBytes) !== preferred.sha256) throw Error('PREFERRED_PREFIX_CHANGED')
const clips = {}
await mkdir(new URL('clips/', assetRoot), { recursive: true })
for(const item of plan){
  const row=item.id==='prefix'?preferred:report.clips.find(row=>row.id===item.id), source=item.id==='prefix'?preferredSource:join(directory,'clips',item.id+'.wav'),bytes=await readFile(source)
  if(hash(bytes)!==row?.sha256||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('STAGE_MISMATCH')
  await copyFile(source,new URL(`clips/${item.id}.wav`,assetRoot))
  clips[item.id]={file:`clips/${item.id}.wav`,text:item.text,sha256:row.sha256,duration:row.duration,asrVerified:/^\d+$/.test(item.id),humanListeningVerified:false,...(item.id==='prefix'?{humanPreference:'A selected over B in CNY 0.31004 and USD 1.27 composite auditions; not blanket approval of all amounts',source:'doubao-man-refresh/prefix-clear'}:{})}
}
const approved=await readFile(new URL('amounts/CNY-0.31.wav',assetRoot))
if(hash(approved)!=='616c0da0c19a87c82f8531cc8ee2aea1da87c2eb24c9506b72dfed44d9f4c1a2')throw Error('APPROVED_WAV_CHANGED')
const manifest={schemaVersion:1,id:'kobe-doubao-offline-v1',provider:'doubao',language:'en',status:'verified',exactOnly:false,openers:[],phrases:[{id:'doubao-jobs',prefix:'prefix'}],clips,amounts:{'CNY:0.31':{file:'amounts/CNY-0.31.wav',phraseId:'doubao-jobs',fullUtterance:true,sha256:hash(approved),humanListeningVerified:true,currencyHumanVerified:true,asrVerified:false}},verification:{numericContentChecked:true,source:'pre-generated with one fixed Doubao voice; local cached ASR; constant per-clip level adjustment',newCompositesHumanReviewed:false,runtimeGeneration:false},notes:'Local prefix + exact numeric tokens + currency/ending. The yuan/dollars clips include Job\'s not finished. No user API key or synthesis service is used at runtime.'}
await writeFile(new URL('manifest.json',assetRoot),JSON.stringify(manifest,null,2)+'\n')
await writeFile(new URL('readable-text.txt',assetRoot),plan.map(item=>`${item.id}: ${item.text}`).join('\n')+'\n')
let bytes=approved.length;for(const row of Object.values(clips))bytes+=(await stat(new URL(row.file,assetRoot))).size
console.log(JSON.stringify({clips:Object.keys(clips).length,approvedWholeUtterances:1,audioBytes:bytes,newApiCalls:0,numericChecks:'passed',runtimeGeneration:false}))
