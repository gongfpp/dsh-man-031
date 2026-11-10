"""Offline ASR limited to authorized hybrid-reference output scope."""
import sys, json, os, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dev'/'classic-quotes'/'hybrid-reference'; OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'dev'/'classic-man'/'asr-tools')); os.environ['HF_HUB_OFFLINE']='1'
from faster_whisper import WhisperModel
import numpy as np
model=WhisperModel('base.en',device='cpu',compute_type='int8',download_root=str(ROOT/'dev'/'classic-man'/'asr-models'),cpu_threads=6,local_files_only=True)
source=Path(sys.argv[1]); name=sys.argv[2]; offset=float(sys.argv[3]) if len(sys.argv)>3 else 0
raw=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(source),'-f','f32le','-ar','16000','-ac','1','-'],check=True,capture_output=True).stdout
segments,info=model.transcribe(np.frombuffer(raw,dtype=np.float32),language='en',word_timestamps=True,beam_size=5,condition_on_previous_text=False)
r={'source':str(source),'offsetToOriginalVideoSeconds':offset,'humanAuditioned':False,'evidence':'Cached base.en machine ASR, not proof of speaker identity','segments':[]}
for s in segments:
 row={'start':s.start,'end':s.end,'text':s.text,'words':[{'start':w.start,'end':w.end,'originalVideoStart':round(w.start+offset,3),'originalVideoEnd':round(w.end+offset,3),'word':w.word,'probability':w.probability} for w in s.words or []]};r['segments'].append(row);print(json.dumps(row),flush=True)
(OUT/(name+'.json')).write_text(json.dumps(r,indent=2),encoding='utf-8')
