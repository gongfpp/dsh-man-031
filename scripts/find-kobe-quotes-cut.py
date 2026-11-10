"""Reproducible local quote crops; no synthesis, denoising, pitch or tempo edits."""
from pathlib import Path
import subprocess, hashlib, json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dev'/'classic-quotes'
OUT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/'dev'/'voice'/'reference-source.mp4'
clips=[('what-can-i-say-mamba-out',155.95,158.84,'What can I say? Mamba out.'),('mamba-out',158.02,158.84,'Mamba out.')]
result=[]
for name,start,end,text in clips:
    path=OUT/(name+'.mp3')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(SOURCE),'-map','0:a:0','-af',f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,afade=t=out:st={end-start-0.008:.6f}:d=0.008','-vn','-c:a','libmp3lame','-b:a','192k',str(path)],check=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(path),'-f','null','-'],check=True)
    result.append({'file':str(path.relative_to(ROOT)),'text':text,'sourceURL':'https://www.youtube.com/watch?v=Eg0mxPXIpLY','publisher':'NBA on ESPN','sourceLocal':str(SOURCE.relative_to(ROOT)),'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'track':'0:a:0; original English AAC 44.1kHz stereo; prior download metadata format 234-11 en-US original','startSeconds':start,'endSeconds':end,'durationSeconds':round(end-start,3),'synthetic':False,'processing':'Contiguous crop, original 44.1kHz stereo, MP3 192 kb/s, last 8ms fade only; no pitch/tempo/gain/denoise edits','crowd':'Post-line cheering tail excluded. Arena/crowd/reverb overlapping the speech remains; not isolated clean speech.','humanAuditioned':False,'boundaryEvidence':'Existing ESPN auto captions plus cached local base.en ASR; approximate machine word boundaries. ASR correctly recognizes Mamba out, while existing auto captions say my bow.','rights':'Public accessibility does not establish redistribution/license permission; unverified.','sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(OUT/'farewell-clips.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
