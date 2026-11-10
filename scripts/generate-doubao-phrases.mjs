// Development-only generation. These requests and credentials never ship in the plugin.
import { fileURLToPath } from 'node:url'
import { generateItem } from './generate-doubao-offline.mjs'
export const directory = fileURLToPath(new URL('../dev/doubao-phrases-v2/', import.meta.url))
const instruction = '用参考的同一低沉男声，带自信和一点调侃，清楚、沉稳、自然地说目标文本。MAN要读清mæn、洪亮有力，之后自然放松；元读中文yuán。不要像收银员，不要添加词、音乐、音效。只读一次。'
export const plan = [
  ['about','About.'], ['man-about','MAN! About.'], ['came-about','That came to about.'],
  ['wanted-round',"MAN! You wanted another round. That's about."], ['another-round','Another round. About.'],
  ['pass-bill','MAN! I said pass the ball. Not the bill. About.'], ['what-say','What can I say? About.'],
  ['line-next',"One round down. What's next?"], ['line-work','All right. Back to work.'],
  ['line-count',"Let's make that count."], ['line-jobs',"Job's not finished."], ['line-locked','Stay locked in.'],
  ['line-breath','Take a breath. Then take the next shot.'], ['line-going','We keep going.'],
  ['line-out',"This round's over. Mamba out."], ['unit-yuan','元。'], ['unit-dollars','Dollars.'], ['unit-dollar','Dollar.'],
].map(([id,text]) => ({id,text,instruction}))
export const phrases = [
  ['round-next','一轮结束，下一轮？','One round down', 'prefix','line-next',"MAN! That's about {amount} {unit}. One round down. What's next?"],
  ['back-work','继续干活','Back to work','about','line-work','About {amount} {unit}. All right. Back to work.'],
  ['make-count','让这笔钱花得值','Make that count','man-about','line-count',"MAN! About {amount} {unit}. Let's make that count."],
  ['jobs','活儿还没结束',"Job's not finished",'came-about','line-jobs',"That came to about {amount} {unit}. Job's not finished."],
  ['wanted','你说再来一轮？','Another round?','wanted-round',null,"MAN! You wanted another round. That's about {amount} {unit}."],
  ['locked','保持专注','Stay locked in','another-round','line-locked','Another round. About {amount} {unit}. Stay locked in.'],
  ['pass','传球，不是传账单','Pass the ball, not the bill','pass-bill',null,'MAN! I said pass the ball. Not the bill. About {amount} {unit}.'],
  ['breath','喘口气，再投下一球','Take the next shot','about','line-breath','About {amount} {unit}. Take a breath. Then take the next shot.'],
  ['going','还能说什么？继续吧','We keep going','what-say','line-going','What can I say? About {amount} {unit}. We keep going.'],
  ['out','这轮结束，曼巴退场','Mamba out','man-about','line-out',"MAN! About {amount} {unit}. This round's over. Mamba out."],
].map(([id,labelZh,labelEn,prefix,suffix,text],i)=>({id,labelZh:`${i+1}. ${labelZh}`,labelEn:`${i+1}. ${labelEn}`,prefix,...(suffix?{suffix}:{}),text}))
export const generatePhraseItem = (id,key) => generateItem(id,key,{directory,plan})
