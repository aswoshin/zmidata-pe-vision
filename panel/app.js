import {workbench,runtime,infer} from './rpc.js';
import {renderSettings} from './settings.js';
import {samplePercentages} from '../core/recognition-config.js';
import {recognizeItem,videoField,resultKey} from '../core/recognition.js';
import * as db from '../core/storage.js';
const $=id=>document.getElementById(id),state={pack:null,config:null,results:new Map(),keys:new Map(),running:false,loading:false,controller:null,epoch:0};
const notify=(text,error=false)=>{$('notice').textContent=text;$('notice').classList.toggle('error',error);};
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
function view(name){document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==name);document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===name));}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
function cancel(){state.epoch++;state.controller?.abort();}
function quickSettings(){if(!state.config)return;$('sample-step').value=state.config.sampleStep;$('enhance').checked=state.config.searchEnabled;$('sample-dots').replaceChildren(...samplePercentages(state.config.sampleStep).map(()=>node('i')));}
async function inject(results,replace=false,pack=state.pack){if(!pack)return;return workbench('inject',{context:pack.context,replace,results:results.filter(r=>r.status==='ready').map(r=>({dataId:String(r.dataId),answer:r.answer}))});}
function render(){
  const isText=state.config?.recognitionMode==='text';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.mode===(isText?'text':'ip')));b.disabled=state.running||state.loading;});
  $('mode-title').textContent=isText?'画面文字，写对了吗？':'视频里，是哪个 IP？';$('mode-caption').textContent=isText?'完整度 · 乱码检查 · 文字正确性':'动漫角色 · 品牌 IP · 作品归属';$('enhance-control').hidden=isText;$('text-mode-hint').hidden=!isText;$('start').firstChild.textContent=isText?'检查全部题 ':'识别全部题 ';
  const rows=[...state.results.values()],ready=rows.filter(r=>r.status==='ready').length,total=state.pack?.size||0,busy=state.running||state.loading;
  $('task-name').textContent=state.pack?.name||(state.loading?'正在读取题包…':'尚未读取题包');$('task-meta').textContent=state.pack?`${total} 题 · 分包 ${state.pack.context.subTaskId}`:'';
  $('model-line').textContent=state.config?`${state.config.provider==='vapi'?'V-API':'硅基流动'} · ${state.config.model}`:'';
  $('counts').textContent=`${ready} / ${total}`;$('progress').style.width=(total?ready/total*100:0)+'%';
  $('start').disabled=busy||!state.pack;$('start').hidden=state.running;$('stop').hidden=!state.running;$('load').disabled=busy;$('sample-step').disabled=busy;$('enhance').disabled=busy;
  $('retry').hidden=!rows.some(r=>['error','interrupted'].includes(r.status));$('retry').disabled=busy;
  const container=$('items');container.replaceChildren();
  for(const [index,item]of (state.pack?.items||[]).entries()){
    const id=String(item.dataId),r=state.results.get(id),card=node('article',undefined,'result');card.dataset.id=id;
    const head=node('div',undefined,'result-top');head.append(node('span',`第 ${index+1} 题`));
    const tools=node('div',undefined,'row'),badge=node('span',r?.status==='ready'?'已识别':r?.status==='analyzing'?'识别中':r?.status==='error'?'识别失败':r?.status==='interrupted'?'已停止':'待识别','badge '+(r?.status==='error'?'error':''));tools.append(badge);
    const locate=node('button','定位','text-button');locate.onclick=()=>workbench('locate',{context:state.pack.context,dataId:id,index}).catch(e=>notify(e.message,true));tools.append(locate);head.append(tools);card.append(head,node('p',r?.answer||r?.error||r?.progress||'等待识别',r?.status==='error'?'help error':'answer'));
    if(r?.status==='ready'){
      if(r.mode==='text'&&r.checks){const detail=node('details'),labels={completeness:'完整度',legibility:'乱码',correctness:'正确性'};detail.append(node('summary','文字片段与检查依据'));for(const [k,c]of Object.entries(r.checks))detail.append(node('p',`${labels[k]}：${c.evidence}`,'text-evidence'));for(const s of r.segments||[])detail.append(node('p','画面文字：'+s.text,'text-evidence'));for(const issue of r.issues||[]){const block=node('div',undefined,'text-evidence');block.append(node('p',issue.observed+(issue.suggestion?' → '+issue.suggestion:'')));const percent=r.media?.framePercentages?.[issue.frames[0]];if(Number.isFinite(percent)&&Number.isFinite(r.media?.duration)){const locateIssue=node('button',`定位 ${percent}% 画面`,'text-button');locateIssue.onclick=()=>workbench('locate',{context:state.pack.context,dataId:id,index,time:r.media.duration*percent/100}).catch(e=>notify(e.message,true));block.append(locateIssue);}detail.append(block);}card.append(detail);}
      const extra=node('div',undefined,'row spread');extra.append(node('span',r.enhancement?.status==='failed'?'增强失败 · 保留视觉结果':r.enhancement?.status==='returned'?(r.enhancement.grounded?'并行合并 · 有搜索依据':'并行合并 · 未提供搜索依据'):'视觉识别','help'));
      const again=node('button','重新识别','text-button');again.disabled=busy;again.onclick=()=>run([id],true);extra.append(again);card.append(extra);
      if(r.enhancement?.status==='failed'){const d=node('details');d.append(node('summary','增强详情'),node('p',r.enhancement.error));card.append(d);}
      const sources=(r.enhancement?.sources||[]).filter(s=>{try{return /^https?:$/.test(new URL(s.url).protocol);}catch{return false;}});
      if(sources.length){const d=node('details');d.append(node('summary','搜索来源'));for(const s of sources){const a=node('a',s.title||new URL(s.url).hostname);a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';d.append(a,node('br'));}card.append(d);}
    }
    container.append(card);
  }
  if(!total)container.append(node('div','打开标注题包后，点击刷新。','empty'));
}
async function loadPack(){
  if(state.running)return;cancel();const epoch=state.epoch;state.loading=true;render();
  try{
    const pack=await workbench('pack');if(epoch!==state.epoch)return;state.pack=pack;state.results.clear();state.keys.clear();await inject([],true,pack);
    const entries=await Promise.all(pack.items.map(async item=>{const key=await resultKey(pack,item,state.config),r=await db.get('results',key);return{item,key,r};}));if(epoch!==state.epoch)return;
    for(const {item,key,r}of entries){const id=String(item.dataId);state.keys.set(id,key);if(r)state.results.set(id,r.status==='analyzing'?{...r,status:'interrupted',progress:'上次识别已中断'}:r);}
    await inject([...state.results.values()],true,pack);if(epoch===state.epoch){const count=[...state.results.values()].filter(r=>r.status==='ready').length;$('run-state').textContent=count?`已恢复 ${count} / ${pack.size} 题`:'准备就绪';notify('识别结果会自动显示在每题评分下方。');}
  }catch(e){if(epoch===state.epoch){state.pack=null;state.results.clear();notify(e.message,true);}}
  finally{if(epoch===state.epoch){state.loading=false;render();}}
}
async function send(body,purpose,signal,config){for(let attempt=0;;attempt++){try{return await infer(body,purpose,signal,config);}catch(e){if(!e.retryable||attempt>=1||signal?.aborted)throw e;await new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(Error('识别已停止'));},timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},Math.max(1500,e.retryAfterMs||0));signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();});}}}
async function run(ids=null,force=false){
  if(state.running||state.loading||!state.pack)return;const pack=state.pack,config={...state.config},epoch=++state.epoch,controller=new AbortController();state.controller=controller;state.running=true;render();
  try{
    await runtime({type:'request.credentials',expectedConfig:config});
    const items=pack.items.map((x,index)=>({...x,dataId:String(x.dataId),index})).filter(x=>!ids||ids.includes(x.dataId));
    for(const item of items){
      if(controller.signal.aborted||epoch!==state.epoch)break;
      if(!force&&state.results.get(item.dataId)?.status==='ready')continue;
      const key=state.keys.get(item.dataId);let record={key,dataId:item.dataId,status:'analyzing',progress:'准备识别'};state.results.set(item.dataId,record);await db.put('results',record);render();
      try{
        if(force)await inject([...state.results.values()],true,pack);
        const field=videoField(item.data);if(!field)throw Error('未找到唯一视频字段');
        const result=await recognizeItem({config,signal:controller.signal,fetchMedia:async signal=>{const {dataUrl}=await workbench('media',{context:pack.context,dataId:item.dataId,index:item.index,videoField:field,maxMB:config.maxMB},signal);return(await fetch(dataUrl)).blob();},infer:(body,purpose,signal)=>send(body,purpose,signal,config),onProgress:progress=>{if(epoch!==state.epoch)return;record.progress=progress;$('run-state').textContent=`第 ${item.index+1} / ${pack.size} 题 · ${progress}`;}});
        if(epoch!==state.epoch||controller.signal.aborted)throw Error('识别已停止');record={...record,...result};
      }catch(e){record={...record,status:controller.signal.aborted?'interrupted':'error',error:e.message};}
      await db.put('results',record);
      if(epoch===state.epoch){state.results.set(item.dataId,record);render();if(record.status==='ready')try{await inject([record],false,pack);}catch(e){notify('识别已保存，页面显示失败：'+e.message,true);}}
    }
    if(epoch===state.epoch){const ready=[...state.results.values()].filter(r=>r.status==='ready').length;$('run-state').textContent=`已识别 ${ready} / ${pack.size} 题`;notify(ready===pack.size?'全部识别完成，翻页后也会自动显示结果。':'本轮结束，剩余题目可继续识别或重试。');}
  }catch(e){if(epoch===state.epoch)notify(e.message,true);}
  finally{if(state.controller===controller){state.running=false;state.controller=null;for(const [id,r]of state.results)if(r.status==='analyzing')state.results.set(id,{...r,status:'interrupted',progress:'已停止'});render();}}
}
async function saveQuick(patch={}){try{const c={...state.config,sampleStep:Number($('sample-step').value),searchEnabled:$('enhance').checked,...patch};await runtime({type:'config.save',config:c});}catch(e){quickSettings();notify(e.message,true);}}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>saveQuick({recognitionMode:b.dataset.mode}));
$('sample-step').onchange=()=>saveQuick();$('enhance').onchange=()=>saveQuick();$('load').onclick=loadPack;$('start').onclick=()=>run();$('retry').onclick=()=>run([...state.results].filter(([,r])=>['error','interrupted'].includes(r.status)).map(([id])=>id));$('stop').onclick=()=>{cancel();$('run-state').textContent='正在停止…';};$('close').onclick=()=>workbench('close').catch(()=>{});
window.addEventListener('pe-context-changed',()=>{cancel();state.loading=false;state.pack=null;state.results.clear();state.keys.clear();render();notify('题包已切换，点击刷新读取新题包。');});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes.recognitionConfig)return;const c=changes.recognitionConfig.newValue;if(JSON.stringify(c)===JSON.stringify(state.config))return;cancel();state.loading=false;state.config=c;quickSettings();state.results.clear();state.keys.clear();if(state.pack)inject([],true).catch(()=>{});render();const reload=()=>{if(state.running)setTimeout(reload,100);else loadPack();};reload();});
try{state.config=(await runtime({type:'config.get'})).config;quickSettings();await renderSettings($('settings-slot'),notify);render();await loadPack();}catch(e){notify(e.message,true);}
window.__PE_REVIEW__={snapshot:()=>({size:state.pack?.size,context:state.pack?.context,running:state.running,loading:state.loading,config:state.config,results:[...state.results.values()]})};
