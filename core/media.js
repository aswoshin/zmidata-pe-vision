import {digest} from './rules.js';
import {samplePercentages} from './recognition-config.js';
export async function dataURL(blob) {return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('媒体读取失败'));r.readAsDataURL(blob);});}
export function mp4AudioPresence(buffer) {
  const v=new DataView(buffer);let moov=false,video=false,audio=false;
  const word=p=>String.fromCharCode(...new Uint8Array(buffer,p,4));
  function walk(start,end,depth=0){if(depth>8)return;for(let p=start;p+8<=end;){let n=v.getUint32(p),header=8;const type=word(p+4);if(n===1){if(p+16>end)return;n=Number(v.getBigUint64(p+8));header=16;}if(n===0)n=end-p;if(n<header||p+n>end)return;
    if(type==='moov')moov=true;
    if(type==='hdlr'&&n>=header+12){const h=word(p+header+8);if(h==='soun')audio=true;if(h==='vide')video=true;}
    if(['moov','trak','mdia','minf','stbl'].includes(type))walk(p+header,p+n,depth+1);p+=n;
  }}
  try{walk(0,v.byteLength);}catch{return'unknown';}
  return moov&&video ? audio?'present':'absent':'unknown';
}
export function audioPresence(buffer) {
  const bytes=new Uint8Array(buffer);if(bytes.length<4||bytes[0]!==0x1a||bytes[1]!==0x45||bytes[2]!==0xdf||bytes[3]!==0xa3)return mp4AudioPresence(buffer);
  let tracks=false,video=false,audio=false;
  const vint=(p,id=false)=>{if(p>=bytes.length||bytes[p]===0)throw Error('invalid EBML');let n=1,mask=0x80;while(!(bytes[p]&mask)){n++;mask>>=1;}if(p+n>bytes.length||id&&n>4)throw Error('invalid EBML');let value=id?bytes[p]:bytes[p]&(mask-1),unknown=!id&&(bytes[p]&(mask-1))===mask-1;for(let i=1;i<n;i++){value=value*256+bytes[p+i];unknown=unknown&&bytes[p+i]===255;}return{length:n,value,unknown};};
  function walk(start,end,depth=0){if(depth>6)return;for(let p=start;p<end;){const id=vint(p,true),size=vint(p+id.length),body=p+id.length+size.length,finish=size.unknown?end:body+size.value;if(finish>end||finish<=p)throw Error('invalid EBML');if(id.value===0x1654ae6b)tracks=true;if(id.value===0x83&&size.value===1){if(bytes[body]===1)video=true;if(bytes[body]===2)audio=true;}if([0x18538067,0x1654ae6b,0xae].includes(id.value))walk(body,finish,depth+1);p=finish;}}
  try{walk(0,bytes.length);}catch{return'unknown';}return tracks&&video?audio?'present':'absent':'unknown';
}
function event(el,name,timeout=15000,signal) {
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('视频解码或定位超时')),timeout);const ok=()=>finish();const bad=()=>finish(Error('视频解码失败'));const stop=()=>finish(Error('分析已停止'));
    function finish(e){clearTimeout(timer);el.removeEventListener(name,ok);el.removeEventListener('error',bad);signal?.removeEventListener('abort',stop);e?reject(e):resolve();}
    el.addEventListener(name,ok,{once:true});el.addEventListener('error',bad,{once:true});signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  });
}
export async function prepareMedia(blob,c,signal,onProgress=()=>{}) {
  if(!blob.size || blob.size>c.maxMB*1024*1024)throw Error(`视频文件超过 ${c.maxMB} MB 或为空`);
  const buffer=await blob.arrayBuffer(),mediaHash=await digest(buffer);
  const mime=blob.type.startsWith('video/')?blob.type:'video/mp4';
  const typed=new Blob([buffer],{type:mime}),url=URL.createObjectURL(typed),v=document.createElement('video');
  v.muted=true;v.preload='auto';v.playsInline=true;v.style.cssText='position:fixed;left:-10000px;width:2px;height:2px';document.body.append(v);
  try {
    const loaded=event(v,'loadeddata',20000,signal);v.src=url;await loaded;
    const duration=v.duration;if(!Number.isFinite(duration)||duration<=0||duration>c.maxSeconds)throw Error(`视频时长异常或超过 ${c.maxSeconds} 秒`);
    const percentages=c.sampling==='percent'?samplePercentages(c.sampleStep):null;
    const count=percentages?percentages.length:Math.ceil(duration*c.fps)+1;if(!percentages&&count>c.maxFrames)throw Error(`全片需 ${count} 帧，超过 ${c.maxFrames} 帧上限；请调整采样密度或上限，未截断视频`);
    const canvas=document.createElement('canvas'),scale=Math.min(1,(percentages?(c.recognitionMode==='text'?1536:1024):768)/Math.max(v.videoWidth,v.videoHeight));canvas.width=Math.max(1,Math.round(v.videoWidth*scale));canvas.height=Math.max(1,Math.round(v.videoHeight*scale));const ctx=canvas.getContext('2d');
    const frames=[];let prev=-1;
    for(let i=0;i<count;i++){
      if(signal?.aborted)throw Error('分析已停止');
      const margin=Math.min(.015,duration/4),end=Math.max(margin,duration-Math.min(.025,duration/4));
      const t=Math.min(Math.max(margin,percentages?duration*percentages[i]/100:i/c.fps),end);if(Math.abs(t-prev)<.002)continue;
      if(Math.abs(v.currentTime-t)>.002){const seek=event(v,'seeked',10000,signal);v.currentTime=t;await seek;}
      if(v.readyState<2)await event(v,'loadeddata',10000,signal);
      ctx.drawImage(v,0,0,canvas.width,canvas.height);
      frames.push({time:t,...percentages?{percent:percentages[i]}:{},url:canvas.toDataURL('image/jpeg',.8)});prev=t;onProgress(i+1,count);
    }
    const visualComplete=!percentages&&frames.length>0&&frames[0].time<=.05&&frames.at(-1).time>=duration-.1;
    return {mediaHash,decoded:true,visualComplete,sampledOnly:!!percentages,duration,width:v.videoWidth,height:v.videoHeight,audioPresence:audioPresence(buffer),frames,videoDataUrl:percentages?null:await dataURL(typed),blob:typed};
  } finally {v.pause();v.removeAttribute('src');v.load();v.remove();URL.revokeObjectURL(url);}
}
export async function extractAudio(blob) {
  const a=new AudioContext();
  try{
    const decoded=await a.decodeAudioData(await blob.arrayBuffer()),rate=16000,n=Math.ceil(decoded.duration*rate),b=new ArrayBuffer(44+n*2),v=new DataView(b);
    const ascii=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};ascii(0,'RIFF');v.setUint32(4,36+n*2,true);ascii(8,'WAVE');ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,n*2,true);
    const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    for(let i=0;i<n;i++){const pos=Math.min(decoded.length-1,Math.floor(i*decoded.sampleRate/rate));const sample=channels.reduce((sum,c)=>sum+c[pos],0)/channels.length;v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true);}
    return dataURL(new Blob([b],{type:'audio/wav'}));
  } finally {await a.close();}
}
export function mediaSummary(m){return{mediaHash:m.mediaHash,decoded:m.decoded,visualComplete:m.visualComplete,duration:m.duration,width:m.width,height:m.height,audioPresence:m.audioPresence,sampledOnly:!!m.sampledOnly,sampledFrames:m.frames.length,framePercentages:m.frames.map(f=>f.percent??null),frameStart:m.frames[0]?.time,frameEnd:m.frames.at(-1)?.time};}
