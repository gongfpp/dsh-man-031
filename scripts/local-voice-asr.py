"""Existing cached Whisper only. No downloads or paid/API requests."""
import sys, json, subprocess, os, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-bridge-edit'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
source = Path(sys.argv[1]).resolve()
name = sys.argv[2]
if not name.replace('-', '').isalnum(): raise ValueError('SAFE_REPORT_NAME_REQUIRED')
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], check=True, capture_output=True).stdout
segments, info = model.transcribe(np.frombuffer(raw, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
result = {'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'model': 'existing cached base.en', 'offline': True, 'localFilesOnly': True, 'apiCalls': 0, 'sourceOffsetSeconds': 0, 'evidence': 'Local ASR, not human audition or speaker identity verification; word timestamps approximate', 'segments': []}
for s in segments:
    result['segments'].append({'start': round(s.start, 6), 'end': round(s.end, 6), 'text': s.text, 'words': [{'start': round(w.start, 6), 'end': round(w.end, 6), 'word': w.word, 'probability': w.probability} for w in s.words or []]})
result['heard'] = ' '.join(x['text'].strip() for x in result['segments'])
report = OUT / (name + '.json')
report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'report': str(report), 'apiCalls': 0, 'heard': result['heard'], 'segments': result['segments']}), flush=True)
