"""Local cached ASR only; evidence, not human listening or speaker verification."""
import sys, json, subprocess, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'classic-quotes'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE']='1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT/'dev'/'classic-man'/'asr-models'), cpu_threads=6, local_files_only=True)
source = Path(sys.argv[1]); start=float(sys.argv[2]); duration=float(sys.argv[3]); name=sys.argv[4]
raw=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(start),'-i',str(source),'-t',str(duration),'-f','f32le','-ar','16000','-ac','1','-'],check=True,capture_output=True).stdout
segments, info=model.transcribe(np.frombuffer(raw,dtype=np.float32),language='en',beam_size=5,word_timestamps=True,condition_on_previous_text=False)
result={'source':str(source),'sourceOffset':start,'evidence':'Local base.en ASR; not human audition; timestamps approximate','segments':[]}
for s in segments:
    row={'start':round(start+s.start,3),'end':round(start+s.end,3),'text':s.text,'words':[{'start':round(start+w.start,3),'end':round(start+w.end,3),'word':w.word,'probability':w.probability} for w in s.words or []]}
    result['segments'].append(row); print(json.dumps(row),flush=True)
(OUT/(name+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
