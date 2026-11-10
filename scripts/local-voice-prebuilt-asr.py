"""Existing cached offline ASR only; reports confined to this six-call comparison."""
import sys, os, json, hashlib, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-prebuilt-comparison'
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
paths = [OUT / x for x in (sys.argv[1:] or ['raw-A.mp3', 'raw-B.mp3', 'raw-C.mp3'])]
for source in paths:
    source = source.resolve()
    if not source.is_relative_to(OUT.resolve()): raise ValueError('COMPARISON_SCOPE_ONLY')
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], capture_output=True, check=True).stdout
    segments, info = model.transcribe(np.frombuffer(raw, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    rows = [{'start': s.start, 'end': s.end, 'text': s.text, 'words': [{'start': w.start, 'end': w.end, 'word': w.word, 'probability': w.probability} for w in s.words or []]} for s in segments]
    report = {'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'model': 'existing cached base.en, CPU int8', 'apiCalls': 0, 'offline': True, 'humanListeningVerified': False, 'wordTimesApproximate': True, 'heard': ' '.join(s['text'].strip() for s in rows), 'segments': rows}
    target = source.with_suffix('.local-asr.json')
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'file': source.name, 'report': str(target), 'heard': report['heard'], 'words': [w for s in rows for w in s['words']]}), flush=True)
