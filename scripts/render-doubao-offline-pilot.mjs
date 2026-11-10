import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { directory, plan } from './generate-doubao-offline.mjs'
import { measureVoice, media } from './voice-loudness.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const target = -23.855086777926918, stages = new Map(), report = []
mkdirSync(join(directory, 'clips'), { recursive: true }); mkdirSync(join(directory, 'audition'), { recursive: true })
function wav(pcm, path) { const raw = path + '.f32'; writeFileSync(raw, pcm); try { media(['-v','error','-y','-f','f32le','-ar','24000','-ac','1','-i',raw,'-c:a','pcm_s16le',path]) } finally { unlinkSync(raw) } }
for (const item of plan) {
  const ledger = JSON.parse(readFileSync(join(directory, item.id + '.json'), 'utf8'))
  const source = join(directory, item.id + '.mp3')
  if (ledger.status !== 'received' || hash(readFileSync(source)) !== ledger.sha256) throw Error('SOURCE_NOT_VERIFIED')
  const before = measureVoice(source), pcm = media(['-v','error','-i',source,'-f','f32le','-ar','24000','-ac','1','pipe:1'],true).stdout
  const frames = []
  for (let at=0; at<pcm.length/4; at+=240) { let sum=0,count=0; for(let i=at;i<Math.min(at+240,pcm.length/4);i++){sum+=pcm.readFloatLE(i*4)**2;count++} if(Math.sqrt(sum/count)>=10**(-50/20))frames.push(at) }
  if(!frames.length)throw Error('NO_ACTIVITY')
  const first=Math.max(0,frames[0]-1200),end=Math.min(pcm.length/4,frames.at(-1)+240+1200)
  const stage=Buffer.from(pcm.subarray(first*4,end*4)),score=before.activeRmsDb,gainDb=Math.min(-24.8-score,-2.2-before.truePeakDb),gain=10**(gainDb/20)
  if(!Number.isFinite(gain))throw Error('INVALID_GAIN')
  for(let i=0;i<stage.length;i+=4)stage.writeFloatLE(stage.readFloatLE(i)*gain,i)
  const output=join(directory,'clips',item.id+'.wav');wav(stage,output);stages.set(item.id,stage)
  report.push({id:item.id,text:item.text,sourceSha256:ledger.sha256,rangeSeconds:[first/24000,end/24000],gainDb,duration:stage.length/4/24000,file:output,sha256:hash(readFileSync(output)),before,after:measureVoice(output),wordEdits:false,speedOrPitchChange:false,humanListeningVerified:false})
}
const auditions=[]
for(const [currency,amount,keys] of [['CNY','0.13',['0','dot','1','3']],['CNY','1.03',['1','dot','0','3']],['CNY','0.31',['0','dot','3','1']],['CNY','0.31004',['0','dot','3','1','0','0','4']],['USD','1.27',['1','dot','2','7']],['USD','1',['1']]]){
  const order=['prefix',...keys,currency==='CNY'?'yuan':amount==='1'?'singular-dollar':'dollars'],pcm=Buffer.concat([Buffer.alloc(720*4),...order.map(key=>stages.get(key))]),output=join(directory,'audition',`${currency}-${amount}.wav`);wav(pcm,output)
  auditions.push({amount,order,file:output,duration:pcm.length/4/24000,sha256:hash(readFileSync(output)),humanListeningVerified:false})
}
writeFileSync(join(directory,'render.json'),JSON.stringify({purpose:'development-only offline concatenation pilot',apiCallsForRendering:0,trim:'only outer low-energy silence, 50ms pad',clips:report,auditions},null,2)+'\n')
console.log(JSON.stringify({auditions,activeRmsDb:report.map(row=>({id:row.id,db:row.after.activeRmsDb}))}))
