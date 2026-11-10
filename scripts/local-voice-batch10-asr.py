"""Existing cached offline ASR only; all new reports stay under dev/voice-batch10."""
import sys, os, json, hashlib, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-batch10'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
for value in (sys.argv[1:] or [str(OUT / 'raw-batch10.wav')]):
    source = Path(value).resolve()
    if not source.is_relative_to(OUT.resolve()):
        raise ValueError('BATCH_DEV_AUDIO_ONLY')
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], capture_output=True, check=True).stdout
    segments, info = model.transcribe(np.frombuffer(raw, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    rows = [{'start': s.start, 'end': s.end, 'text': s.text, 'words': [{'start': w.start, 'end': w.end, 'word': w.word, 'probability': w.probability} for w in s.words or []]} for s in segments]
    words = [w for row in rows for w in row['words']]
    tokens = [re.sub(r"[^a-z0-9.]", '', w['word'].lower()).strip('.') for w in words]
    endings = [i for i, t in enumerate(tokens) if t in ('finished', 'finish') and i >= 2 and tokens[i-1] == 'not' and tokens[i-2] in ('job', 'jobs')]
    parts, start = [], 0
    for i in endings:
        part = words[start:i+1]
        parts.append({'index': len(parts), 'start': part[0]['start'] if part else None, 'end': part[-1]['end'] if part else None, 'text': ' '.join(w['word'].strip() for w in part), 'words': part, 'endingExactFinished': tokens[i] == 'finished'})
        start = i + 1
    report = {'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'durationSeconds': len(raw) / 4 / 16000, 'model': 'existing cached base.en CPU int8', 'cloudAsrCalls': 0, 'offline': True, 'wordTimesApproximate': True, 'humanListeningVerified': False, 'currencyVerified': False, 'heard': ' '.join(r['text'].strip() for r in rows), 'segments': rows, 'completionAnchorCount': len(endings), 'paragraphCandidates': parts, 'unassignedTrailingWords': words[start:], 'note': 'Ending counts are candidates, not proof of ten exact amounts; require numeric order, prefix and actual silence boundary cross-check.'}
    target = OUT / (source.stem + '.local-asr.json')
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print(json.dumps({'source': source.name, 'report': str(target), 'durationSeconds': report['durationSeconds'], 'completionAnchorCount': len(endings), 'paragraphCandidates': [{k: p[k] for k in ('index', 'start', 'end', 'text', 'endingExactFinished')} for p in parts], 'unassignedTrailingWords': words[start:]}, ensure_ascii=False), flush=True)
