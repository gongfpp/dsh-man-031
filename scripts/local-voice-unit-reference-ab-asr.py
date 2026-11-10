"""One cached offline base.en pass per new raw. Unit recognition is explicitly not quality approval."""
import os, sys, json, subprocess, hashlib, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'voice-unit-reference-ab'
sys.path.insert(0, str(ROOT / 'dev' / 'classic-man' / 'asr-tools'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel
import numpy as np
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'dev' / 'classic-man' / 'asr-models'), cpu_threads=6, local_files_only=True)
plan = json.loads((OUT / 'samples.json').read_text(encoding='utf8'))
results = []
for s in plan['samples']:
    if not s.get('sha256') or s.get('error'):
        continue
    source = OUT / s['file']
    if hashlib.sha256(source.read_bytes()).hexdigest() != s['sha256']:
        raise ValueError('RAW_HASH_MISMATCH')
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], capture_output=True, check=True).stdout
    segments, info = model.transcribe(np.frombuffer(raw, dtype=np.float32), language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    rows = [{'start': r.start, 'end': r.end, 'text': r.text, 'words': [{'start': w.start, 'end': w.end, 'word': w.word, 'probability': w.probability} for w in r.words or []]} for r in segments]
    heard = ' '.join(r['text'].strip() for r in rows)
    formatted = re.sub(r'(\d)\s*\.\s*(\d+)', r'\1.\2', heard.lower())
    number_present = bool(re.search(r'zero\s+point\s+three\s+one|(?<![\d.])0\.31(?!\d)', formatted))
    ending_present = bool(re.search(r"jobs?['’]?s?\s+not\s+finished", formatted))
    row = {'id': s['id'], 'referenceId': s['referenceId'], 'unitText': s['unitText'], 'rawSha256': s['sha256'], 'heard': heard, 'segments': rows, 'number031PresentInLocalAsr': number_present, 'endingJobsNotFinishedPresentInLocalAsr': ending_present, 'currencyVerified': False, 'humanListeningVerified': False, 'qualityPassed': False, 'unitWarning': 'base.en is English only; Chinese 元 and romanized yuan cannot be approved by automatic recognition. Never treat un/young as verified units.', 'wordTimesApproximate': True}
    results.append(row)
    (OUT / (s['id'] + '.local-asr.json')).write_text(json.dumps(row, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({k: row[k] for k in ['id', 'unitText', 'heard', 'number031PresentInLocalAsr', 'endingJobsNotFinishedPresentInLocalAsr', 'currencyVerified', 'qualityPassed']}, ensure_ascii=False), flush=True)
(OUT / 'local-asr-summary.json').write_text(json.dumps({'model': 'existing cached base.en CPU int8', 'cloudAsrCalls': 0, 'onePassPerRawOnly': True, 'qualityPassed': False, 'priorBatchUserRejected': True, 'samples': results}, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
