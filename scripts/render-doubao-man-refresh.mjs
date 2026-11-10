import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { directory, plan } from './generate-doubao-man-refresh.mjs'
import { measureVoice, media } from './voice-loudness.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)), manifestPath=join(root,'assets/voices/manifest.json'), hash=bytes=>createHash('sha256').update(bytes).digest('hex'), originalManifestHash=hash(readFileSync(manifestPath)), bank=JSON.parse(readFileSync(manifestPath,'utf8')), parts=new Map(), clips=[], auditions=[]
mkdirSync(join(directory,'clips'),{recursive:true});mkdirSync(join(directory,'audition'),{recursive:true})
function wav(pcm,path){const raw=path+'.f32';writeFileSync(raw,pcm);try{media(['-v','error','-y','-f','f32le','-ar','24000','-ac','1','-i',raw,'-c:a','pcm_s16le',path])}finally{unlinkSync(raw)}}
for(const item of plan){
  const ledger=JSON.parse(readFileSync(join(directory,item.id+'.json'),'utf8')),source=join(directory,item.id+'.mp3')
  if(ledger.status!=='received'||hash(readFileSync(source))!==ledger.sha256)throw Error('SOURCE_HASH_MISMATCH')
  const before=measureVoice(source),pcm=media(['-v','error','-i',source,'-f','f32le','-ar','24000','-ac','1','pipe:1'],true).stdout,frames=[]
  for(let at=0;at<pcm.length/4;at+=240){let sum=0,count=0;for(let i=at;i<Math.min(at+240,pcm.length/4);i++){sum+=pcm.readFloatLE(i*4)**2;count++}if(Math.sqrt(sum/count)>=10**(-50/20))frames.push(at)}
  if(!frames.length)throw Error('NO_ACTIVITY')
  const first=Math.max(0,frames[0]-1200),end=Math.min(pcm.length/4,frames.at(-1)+1440),stage=Buffer.from(pcm.subarray(first*4,end*4)),gainDb=Math.min(-24.8-before.activeRmsDb,-2.2-before.truePeakDb),gain=10**(gainDb/20)
  for(let i=0;i<stage.length;i+=4)stage.writeFloatLE(stage.readFloatLE(i)*gain,i)
  const file=join(directory,'clips',item.id+'.wav');wav(stage,file);parts.set(item.id,stage)
  clips.push({id:item.id,text:item.text,sourceSha256:ledger.sha256,sha256:hash(readFileSync(file)),file,rangeSeconds:[first/24000,end/24000],duration:stage.length/96000,gainDb,after:measureVoice(file),humanListeningVerified:false})
}
function original(key){const item=bank.clips[key];if(!item||!/^clips\/[a-z0-9-]+\.wav$/.test(item.file))throw Error('INVALID_BANK_KEY');const path=join(root,'assets/voices',item.file);if(hash(readFileSync(path))!==item.sha256)throw Error('BANK_HASH_MISMATCH');return media(['-v','error','-i',path,'-f','f32le','-ar','24000','-ac','1','pipe:1'],true).stdout}
for(const [variant,prefix,newEnding]of[['A','prefix-clear',false],['B','prefix-flavor',true]])for(const [currency,amount,numbers,tail]of[['CNY','0.31004',['0','dot','3','1','0','0','4'],'yuan'],['USD','1.27',['1','dot','2','7'],'dollars']]){
  const ending=newEnding?parts.get(tail+'-flavor'):original(tail),pcm=Buffer.concat([Buffer.alloc(720*4),parts.get(prefix),...numbers.map(original),ending]),file=join(directory,'audition',`${variant}-${currency}-${amount}.wav`);wav(pcm,file)
  auditions.push({variant,currency,amount,file,sha256:hash(readFileSync(file)),duration:pcm.length/96000,numericTokens:numbers,prefix,ending:newEnding?tail+'-flavor':tail,humanListeningVerified:false})
}
if(hash(readFileSync(manifestPath))!==originalManifestHash)throw Error('RUNTIME_MANIFEST_CHANGED')
const result={developmentTtsCalls:4,cloudAsrCalls:0,runtimeManifestUnchanged:true,runtimeManifestSha256:originalManifestHash,processing:'Only outer quiet silence trimmed with 50ms pad and one constant gain per new clip; original number WAVs unchanged; no speed/pitch change, no crossfade.',clips,auditions}
writeFileSync(join(directory,'render.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({clips:clips.map(x=>({id:x.id,duration:x.duration,activeRmsDb:x.after.activeRmsDb})),auditions}))
