"""Crop two phrases from sourced 2009 press-conference repost; no synthesis."""
from pathlib import Path
import subprocess,json,hashlib
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'dev'/'classic-quotes'
source=OUT/'jobs-source.webm'
clips=[('jobs-not-finished',7.92,8.88,"Job's not finished."),('job-finished-i-dont-think-so',9.46,12.54,"Job finished? I don't think so.")]
results=[]
for name,start,end,text in clips:
    path=OUT/(name+'.mp3'); length=end-start
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-map','0:a:0','-af',f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,afade=t=out:st={length-0.008:.6f}:d=0.008','-vn','-c:a','libmp3lame','-b:a','192k',str(path)],check=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(path),'-f','null','-'],check=True)
    result={'file':str(path.relative_to(ROOT)),'text':text,'sourceURL':'https://www.youtube.com/watch?v=fY7l2pcxdHM','sourceTitle':'Kobe Bryant Exclaims the jobs not finished - Post-game Sound from Game 2 of the 2009 NBA Finals','uploader':'Basketball Action','uploadDate':'2022-06-08','event':'2009 NBA Finals Game 2 post-game press conference; Lakers led Orlando 2-0','provenanceLimitation':'Public repost, not verified NBA/ESPN/Lakers channel or original master. Event and speaker attribution from video metadata plus public same-event longer interview search results. Do not label this download official.','eventCrossReference':'https://www.youtube.com/watch?v=qeO3DbH-Ies','eventCrossReferenceLabel':'Jalen Rose - JalenTV verified channel: Kobe Bryant Game 2 Presser - Lakers vs Magic NBA Finals 2009; discovered through public YouTube search, not downloaded or human-reviewed','sourceLocal':str(source.relative_to(ROOT)),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'track':'251; en; Opus 48kHz stereo, sole English speech stream, no auto-dub indication in metadata','startSeconds':start,'endSeconds':end,'durationSeconds':round(length,3),'synthetic':False,'processing':'Contiguous source crop preserving internal pauses; MP3 192kbps stereo 48kHz; final 8ms fade only; no pitch, speed, gain or denoise changes','boundaryEvidence':'Downloaded English auto captions + local cached base.en ASR in jobs-asr.json. First finished ends approx8.76; second phrase approx9.58–12.44. Crops have short trailing padding; no reporter line after12.54.','humanAuditioned':False,'crowd':'Press-room background/room sound may remain. No post-line applause extension, no claim of isolated studio speech.','rights':'No redistribution/license permission established. Public access is not a license.','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    results.append(result)
(OUT/'jobs-clips.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
