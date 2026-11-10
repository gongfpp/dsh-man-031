import { readFileSync, writeFileSync, mkdirSync, unlinkSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as v2 from './generate-doubao-phrases.mjs'
import * as v3 from './generate-doubao-phrases-v3.mjs'
const { directory, plan, phrases } = process.argv.includes('--v3') ? v3 : v2
import { measureVoice, media } from './voice-loudness.mjs'
const root=new URL('../',import.meta.url),bankRoot=new URL('assets/voices/',root),manifestPath=new URL('manifest.json',bankRoot),bank=JSON.parse(readFileSync(manifestPath,'utf8'))
const hash=b=>createHash('sha256').update(b).digest('hex'), report=[]
mkdirSync(join(directory,'clips'),{recursive:true})
for(const item of plan){
  const source=join(directory,item.id+'.mp3'),ledger=JSON.parse(readFileSync(join(directory,item.id+'.json'),'utf8'))
  if(ledger.status!=='received'||hash(readFileSync(source))!==ledger.sha256)throw Error('SOURCE_MISMATCH '+item.id)
  const before=measureVoice(source),pcm=media(['-v','error','-i',source,'-f','f32le','-ar','24000','-ac','1','pipe:1'],true).stdout,active=[]
  for(let at=0;at<pcm.length/4;at+=240){let sum=0,n=0;for(let i=at;i<Math.min(at+240,pcm.length/4);i++){sum+=pcm.readFloatLE(i*4)**2;n++}if(Math.sqrt(sum/n)>=10**(-50/20))active.push(at)}
  if(!active.length)throw Error('NO_ACTIVITY')
  const first=Math.max(0,active[0]-1200),end=Math.min(pcm.length/4,active.at(-1)+1440),stage=Buffer.from(pcm.subarray(first*4,end*4)),gainDb=Math.min(-24.8-before.activeRmsDb,-2.2-before.truePeakDb),gain=10**(gainDb/20)
  for(let i=0;i<stage.length;i+=4)stage.writeFloatLE(stage.readFloatLE(i)*gain,i)
  const file=join(directory,'clips',item.id+'.wav'),temp=file+'.f32';writeFileSync(temp,stage)
  try{media(['-v','error','-y','-f','f32le','-ar','24000','-ac','1','-i',temp,'-c:a','pcm_s16le',file])}finally{unlinkSync(temp)}
  const bytes=readFileSync(file),row={file:'clips/'+item.id+'.wav',text:item.text,sha256:hash(bytes),duration:stage.length/96000,asrVerified:false,humanListeningVerified:false}
  copyFileSync(file,new URL(row.file,bankRoot));bank.clips[item.id]=row
  report.push({id:item.id,...row,sourceSha256:ledger.sha256,rangeSeconds:[first/24000,end/24000],gainDb,after:measureVoice(file)})
}
bank.phrases=phrases;bank.units={CNY:'unit-yuan',USD:'unit-dollars',USD_SINGULAR:'unit-dollar'}
bank.notes=`${phrases.length} offline phrase templates, pre-generated fixed voice; local number + bare currency + optional ending. Three decimal half-up presentation; no runtime synthesis/key/provider.`
bank.verification.newCompositesHumanReviewed=false
writeFileSync(manifestPath,JSON.stringify(bank,null,2)+'\n')
writeFileSync(join(directory,'render.json'),JSON.stringify({developmentCalls:plan.length,cloudAsrCalls:0,processing:'Outer silence only with 50ms padding; single constant gain; no pitch/rate change; no fabricated per-clip human review.',clips:report},null,2)+'\n')
writeFileSync(new URL('readable-text.txt',bankRoot),Object.entries(bank.clips).map(([key,row])=>`${key}: ${row.text}`).join('\n')+'\n\n'+phrases.map(p=>`${p.id}: ${p.text}`).join('\n')+'\n')
console.log(JSON.stringify({phrases:phrases.length,newClips:report.length,totalClips:Object.keys(bank.clips).length,durations:report.map(r=>({id:r.id,seconds:r.duration})),newApiCalls:0}))
