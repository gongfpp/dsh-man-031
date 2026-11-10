"""Local ASR evidence only; not proof of speaker identity or unprocessed audio."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / 'dev' / 'classic-man'
sys.path.insert(0, str(ROOT / 'asr-tools'))
from faster_whisper import WhisperModel
model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root=str(ROOT / 'asr-models'), cpu_threads=6)
for arg in sys.argv[1:]:
    source = ROOT / arg
    import subprocess
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ar', '16000', '-ac', '1', '-'], check=True, capture_output=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    segments, info = model.transcribe(audio, language='en', beam_size=5, word_timestamps=True, condition_on_previous_text=False)
    result = {'source': source.name, 'language': info.language, 'segments': []}
    for s in segments:
        row = {'start': s.start, 'end': s.end, 'text': s.text, 'words': [{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in (s.words or [])]}
        result['segments'].append(row)
        print(json.dumps(row, ensure_ascii=True), flush=True)
    (ROOT / (source.stem + '.asr.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
