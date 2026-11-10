"""Cut authorized Kimmel window; no synthesis, time/pitch change, denoise or gain."""
import json, hashlib, subprocess, wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dev'/'classic-quotes'/'hybrid-reference'
SOURCE=OUT/'kimmel-90-150.mp4'
def run(args): subprocess.run(args,check=True,capture_output=True)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def wavcut(name,start,end):
 p=OUT/(name+'.wav'); run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(SOURCE),'-ss',str(start),'-t',str(end-start),'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',str(p)])
 return p
# Clip boundaries are measured against fresh local ASR, NOT delayed public captions.
man=wavcut('kimmel-man-real',17.49,18.12)
run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(man),'-c:a','libmp3lame','-b:a','192k',str(OUT/'kimmel-man-real.mp3')])
context=wavcut('kimmel-man-what-context',17.42,18.72)
segments=[
 ('joke',17.49,25.80,'Man, what? Man, if I ever tried to say something to my wife when she was giving birth, man, she\'d Mamba mentality my ass upside my head.','Guest answer; audience/host laughter risk, especially near end. Not preferred clean clone reference.'),
 ('seasoned-vet',33.78,35.55,"She's like a seasoned vet too, man.",'Brief response; host question begins about local35.76, excluded.'),
 ('really-calm',36.25,37.65,"She's just really calm.",'Guest answer before host interjection about38.02, excluded.'),
 ('safe-driver',39.40,45.66,"Very calm, doesn't want to listen to any loud or fast music. She's just very safe and, like, cautious, careful.",'Guest response; no host turn transcribed inside. Room/crowd residuals not separated.'),
 ('proud',50.40,53.16,"She's just real cool, calm and collected, man.",'Complete first sentence only. Entire trailing proud-of-her sentence excluded because endpoint54.60 is too close to host turn; avoids residual clipped her and host risk.')]
rows=[]
for name,start,end,text,note in segments:
 p=wavcut('reference-segment-'+name,start,end)
 rows.append({'id':name,'path':str(p),'sourceRangeSeconds':[round(start+90,3),round(end+90,3)],'localRangeSeconds':[start,end],'durationSeconds':round(end-start,3),'sha256':sha(p),'transcriptForIdentification':text,'limitations':note})
def concat(name,indices):
 # All inputs same format: direct PCM concatenation, no crossfades or silence padding.
 p=OUT/(name+'.wav')
 with wave.open(str(p),'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000)
  for i in indices:
   with wave.open(rows[i]['path'],'rb') as r: w.writeframes(r.readframes(r.getnframes()))
 return {'path':str(p),'sha256':sha(p),'durationSeconds':round(sum(rows[i]['durationSeconds'] for i in indices),3),'segmentIds':[rows[i]['id'] for i in indices],'continuousOriginalSpeech':False,'repeatedAudio':False}
clean=concat('kimmel-reference-clean-candidate-12s',[1,2,3,4])
long=concat('kimmel-reference-expanded-review-only',[0,1,2,3,4])
# Visual role evidence: source channel/title identify interview participants;
# these stills document guest versus host framing, not automated identity verification.
for name,t in [('man-start',17.75),('seasoned-vet',34.4),('really-calm',36.9),('safe-driver',41.5),('proud',52.0)]:
 run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(SOURCE),'-frames:v','1',str(OUT/('role-'+name+'.jpg'))])
asr=json.loads((OUT/'kimmel-fresh-window-asr.json').read_text(encoding='utf-8'))
words=[w for s in asr['segments'] for w in s.get('words',[])]
contact_times=[]
for row in rows:
 a,b=row['localRangeSeconds']; row['actualASRText']=''.join(w['word'] for w in words if a<=w['start']<b).strip()
 row['contextASRText']=''.join(w['word'] for w in words if a-.6<=w['start']<b+.6).strip()
 cp=wavcut('context-'+row['id'],max(0,a-.6),b+.6)
 row['contextPath']=str(cp); row['contextSha256']=sha(cp); row['contextLocalRangeSeconds']=[round(a-.6,3),round(b+.6,3)]
 row['contactSheetLocalSeconds']=[round(a-.4,3),round((a+b)/2,3),round(b+.4,3)]
 contact_times.extend(row['contactSheetLocalSeconds'])
# Fifteen ordered frames; each row is before / midpoint / after one candidate.
frame_numbers=[round(t*29.97) for t in contact_times]
select='+'.join('eq(n\\,%d)'%n for n in frame_numbers)
run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(SOURCE),'-vf',f'select={select},scale=320:180,tile=3x5','-frames:v','1',str(OUT/'reference-roles-contact-sheet.jpg')])
meta={'source':{'url':'https://www.youtube.com/watch?v=t8eoIKiDTw8','channel':'Jimmy Kimmel Live','title':'Kobe Bryant on Shaq Drama & Raising Four Daughters','downloadedPath':str(SOURCE),'sha256':sha(SOURCE),'requestedSourceRangeSeconds':[90,150],'formats':'134 video + 140-6 en-US English (US) original audio, DASH','downloadProcessing':'yt-dlp --download-sections *90-150 --force-keyframes-at-cuts; ffmpeg reencoded H264/AAC. Not bit-exact original media. Source program audio, not synthesis.'},'timingEvidence':'Fresh local-window base.en word ASR + downloaded video. Original times = local times + requested start90s. Public captions have content-dependent delays and must NOT set crop boundaries. Word boundaries machine-estimated, not human audition.','humanAuditioned':False,'rightsVerified':False,'speakerEvidence':'Original English interview source channel/title, captions distinguish Jimmy and guest roles, local ASR turn text, visual stills document on-screen guest/host framing. No speaker embedding or biometric verification; no claim that stills alone prove active speaker.','processing':'Decode/resample to mono24kHz PCM16 for WAV; MAN MP3 encoding192kbps. No pitch/speed/gain changes, denoise, vocoder, generated extensions, or synthetic speech. Reference concatenations are explicit noncontinuous cuts; no duplicated audio or added padding.','man':{'path':str(OUT/'kimmel-man-real.mp3'),'wavPath':str(man),'sha256':sha(OUT/'kimmel-man-real.mp3'),'wavSha256':sha(man),'text':'Man','localRangeSeconds':[17.49,18.12],'sourceRangeSeconds':[107.49,108.12],'durationSeconds':0.63,'wordASRRangeSeconds':[107.56,108.04],'contextPath':str(context),'contextSha256':sha(context),'contextRangeSeconds':[107.42,108.72],'contextText':'Man, what?','limitations':'The 0.63s MAN is an unchanged natural word, NOT stretched to match the older1.07s MAN. Room/possible audience/host background remains.'},'segments':rows,'recommendedReference':clean,'expandedReference':long,'recommendation':'Use12.19s cleaner multisegment candidate or6.26s safe-driver standalone. Expanded20.50s is REVIEW ONLY, NOT approved for clone use due to laughter risk. Expanded includes joke and laughter risk: duration alone does not establish quality or similarity. No clean continuous20–30s passage exists in the authorized90–150s window.'}
(OUT/'hybrid-reference.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False),encoding='utf-8')
for p in [man,context,OUT/'kimmel-man-real.mp3',Path(clean['path']),Path(long['path'])]:
 run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(p),'-f','null','-'])
print(json.dumps({'man':meta['man'],'clean':clean,'expanded':long},ensure_ascii=False),flush=True)
