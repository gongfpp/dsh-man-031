import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { estimate, usageTotals, createPriceStore } from '../lib/public-pricing.js'
import { reduce, initialState, apply } from '../index.js'
const table = JSON.parse(await readFile(new URL('../assets/provider-pricing.json', import.meta.url), 'utf8'))
const row = { key:'step:1', provider:'openai', model:'gpt-6.1-sol', time:Date.parse('2026-11-11T03:00:00Z'), input:1000, output:100, cacheRead:500, cacheWrite:100, reasoning:50 }
assert.equal(usageTotals([row]).total,1700,'reasoning is not counted twice')
assert.equal(usageTotals([],false).available,false)
assert.equal(usageTotals([row],true).available,false)
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`)
close(estimate([row],false,table,'USD').amount,.0033)
close(estimate([row],false,table,'CNY').amount,.0033*table.fx.CNY)
const long={...row,input:272001};close(estimate([long],false,table,'USD').amount,(272001*4+100*15+500*.2+100*5)/1e6)
const short={...row,input:271400};close(estimate([short],false,table,'USD').amount,(271400*2+100*10+500*.1+100*2.5)/1e6)
assert.equal(estimate([{...row,model:'not-a-model'}],false,table,'USD').status,'unknown')
assert.equal(estimate([{...row,model:'gpt-5.5-pro'}],false,table,'USD').status,'unknown','unpriced flag wins over numeric rates')
assert.equal(estimate([row],true,table,'USD').amount,null)
assert.equal(estimate([{...row,provider:'codex'}],false,table,'USD').amount,.0033,'API equivalent is an estimate, never actual plan billing')
assert.equal(estimate([{...row,model:'gpt-5.5'}],false,table,'USD').status,'unknown','unknown cache-write price is not zero')
close(estimate([{...row,provider:'xiaomi',model:'mimo-v2.6-flash',cacheWrite:0}],false,table,'CNY').amount,(1000+100*2+500*.02)/1e6)
const ds={...row,provider:'deepseek',model:'deepseek-v4-flash',cacheWrite:0};assert.equal(estimate([ds],false,table,'CNY').status,'estimated')
assert.notEqual(estimate([ds],false,table,'USD').amount,estimate([{...ds,time:Date.parse('2026-11-11T05:00:00Z')}],false,table,'USD').amount,'request-time peak/off-peak pricing')
close(estimate([row,{...row,model:'gpt-4.1-mini',cacheWrite:0}],false,table,'USD').amount,.0033+.00061)
const ev=(type,seq,data)=>({type,seq,time:row.time+seq,data})
let state=initialState({},0)
state=reduce(state,ev('request/header',0,{header:{config:{provider:'openai',model:'gpt-6.1-sol'}}}))
state=reduce(state,ev('turn/start',1,{turn:1}))
const usage={inputTokens:1000,outputTokens:100,cacheReadTokens:500,cacheWriteTokens:100,reasoningTokens:50}
state=reduce(state,ev('assistant/message',2,{turn:1,step:1,usage}))
state=reduce(state,ev('assistant/message',3,{turn:1,step:1,usage}))
assert.equal(state.samples.length,1,'step replay/replacement does not double count')
state=reduce(state,ev('assistant/message',4,{turn:1,step:2,message:{source:{provider:'openai',model:'gpt-4.1-mini'}},usage:{...usage,cacheWriteTokens:0}}))
state=reduce(state,ev('turn/end',5,{turn:1,reason:{kind:'completed'}}))
assert.equal(state.recent[0].samples.length,2);assert.equal(state.latest.samples,undefined,'wire view contains only boundaries')
assert.equal(usageTotals(state.recent[0].samples).total,3300)
const routes=new Map(),effects=[];let meterCalls=0,meter={getTurnCost:async()=>{meterCalls++;throw Error('offline')}}
const session={}
await apply({sessions:{get:()=>session},sessionProjections:{register:async d=>{d.stateSchema.parse(state);return{stateOf:()=>state}}},get:()=>meter,connection:{fetch:{register:r=>{routes.set(r.path,r);return()=>{}}}},effect:f=>effects.push(f())})
const request=async(mode='',currency='USD')=>(await routes.get('/api/man-031/cost').fetch(new Request(`https://local/api/man-031/cost?sessionId=s&endSeq=5&currency=${currency}${mode}`))).json()
let result=await request('&mode=tokens');assert.equal(meterCalls,0);assert.equal(result.source,'native-usage');assert.equal(result.usage.total,3300)
result=await request();assert.equal(result.source,'public-pricing');assert.equal(result.status,'estimated');assert.equal(meterCalls,1)
meter=undefined;result=await request();assert.equal(result.source,'public-pricing');assert.equal(result.usage.available,true)
meter={getTurnCost:async()=>({found:true,apiCost:0,calls:[{apiCost:0,plan:true}]})};result=await request('','CNY');assert.equal(result.source,'cost-meter');assert.equal(result.status,'plan');assert.equal(result.amount,0)
await Promise.all(effects.map(f=>f()))
let fetches=0
const store=createPriceStore({fetchImpl:async()=>{fetches++;throw Error('offline')}});await store.init()
assert.equal(store.quote([row],false,'USD').amount,.0033);assert.equal(store.quote([row],false,'USD').amount,.0033)
await store.dispose();assert.equal(fetches,2,'one bounded price + FX background attempt, never per-turn networking')
console.log('public pricing: passed (native projection, per-request models/long context/cache/peak/FX, duplicate/unknown safeguards, token bypass, meter-first/fallback and offline snapshot)')
