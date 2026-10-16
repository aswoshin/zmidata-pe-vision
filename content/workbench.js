(() => {
  if(document.getElementById('pe-frame-review-host'))return;
  const origin='chrome-extension://'+chrome.runtime.id,nonce=crypto.randomUUID(),pending=new Map();
  const host=document.createElement('div');host.id='pe-frame-review-host';const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>:host{all:initial}button{position:fixed;right:22px;bottom:24px;z-index:2147483000;border:1px solid #ffffff44;border-radius:28px;background:#277c75;color:white;padding:13px 20px;font:600 14px system-ui;box-shadow:0 6px 28px #244b5330;cursor:pointer}button:hover{background:#226c66}button img{width:23px;height:23px;vertical-align:middle;margin-right:5px}iframe{position:fixed;right:22px;bottom:82px;width:min(400px,calc(100vw - 24px));height:min(720px,calc(100dvh - 104px));z-index:2147483001;border:1px solid #d7e7e9;border-radius:22px;background:#f0f6f6;box-shadow:0 16px 60px #244b5330;display:none}@media(max-width:460px){iframe{right:12px}button{right:12px}}</style><button type="button" aria-expanded="false"> <img src="${chrome.runtime.getURL('panel/brand.svg')}" alt="">卓觅识界</button><iframe title="卓觅识界"></iframe>`;
  const frame=shadow.querySelector('iframe');frame.src=chrome.runtime.getURL('panel/index.html')+'?host='+encodeURIComponent(location.origin)+'&nonce='+nonce;
  document.documentElement.append(host);shadow.querySelector('button').onclick=()=>{const open=getComputedStyle(frame).display==='none';frame.style.display=open?'block':'none';shadow.querySelector('button').setAttribute('aria-expanded',String(open));};
  const context=()=>{const u=new URL(location.href);return{origin:location.origin,projectId:u.searchParams.get('projectId'),taskId:u.searchParams.get('taskId'),subTaskId:u.searchParams.get('subTaskId')||u.searchParams.get('subtaskId'),missionType:u.searchParams.get('missionType')||'label'};};
  const key=c=>[c.origin,c.projectId,c.taskId,c.subTaskId,c.missionType].join('|');
  function check(expected){const c=context();if(!/^\d+$/.test(c.subTaskId||'')||!/^\d+$/.test(c.taskId||'')||!/^\d+$/.test(c.projectId||''))throw Error('当前不是有效的标注任务');if(expected&&key(c)!==key(expected))throw Error('任务已切换，请重新读取任务包');return c;}
  async function api(path,signal){const r=await fetch(path,{credentials:'include',redirect:'error',signal});if(!r.ok)throw Error(`平台 HTTP ${r.status}`);let j;try{j=await r.json();}catch{throw Error('平台没有返回任务数据，请确认登录');}if(Number(j.code)!==0||j.success===false)throw Error(String(j.message||'平台请求失败').slice(0,250));return j.data;}
  async function page(c,n,signal){const q=new URLSearchParams({page:String(n),pageSize:'10',filterPassedVote:'false',filter:JSON.stringify({questions:[],dataStatus:'ALL',questionsQueryConditions:'AND'})});const d=await api('/api/v1/label/center/subTask/'+c.subTaskId+'/data?'+q,signal);check(c);if(String(d.id)!==c.subTaskId||String(d.taskId)!==c.taskId||String(d.appId)!==c.projectId)throw Error('平台返回了不同任务的数据，已停止');return d;}
  async function readPack(expected,signal){const c=check(expected),first=await page(c,1,signal),size=Number(first.size);if(!Number.isInteger(size)||size<=0||size>500)throw Error('任务包数量异常或超过 500 条');const items=[...first.dataList];for(let n=2;items.length<size;n++){if(n>Math.ceil(size/10)+1)throw Error('分页不完整');const d=await page(c,n,signal);if(!d.dataList?.length)throw Error('任务包有缺页，不能启动整包分析');items.push(...d.dataList);}if(items.length!==size||new Set(items.map(x=>x.dataId)).size!==size)throw Error('任务包数量或数据 ID 不一致');return{context:c,key:key(c),name:first.taskName,size,status:first.status,committed:!!first.gmtCommit,template:first.templateConfig?.scheme||first.template?.scheme,items};}
  async function findItem(expected,id,index,signal){const c=check(expected);const p=await page(c,Math.floor(index/10)+1,signal);let item=p.dataList?.find(x=>x.dataId===id);if(!item)item=(await readPack(c,signal)).items.find(x=>x.dataId===id);if(!item)throw Error('题目已不在当前任务包');return{item,pack:p,c};}
  async function media(m,signal){const {item,c}=await findItem(m.context,m.dataId,m.index,signal);const path=item.data?.[m.videoField];if(typeof path!=='string')throw Error('缺少视频地址');const u=new URL(path,location.href);if(u.origin!==location.origin)throw Error('当前版本仅读取平台同源视频，请检查字段映射');const r=await fetch(u.href,{credentials:'include',redirect:'error',signal});if(!r.ok)throw Error(`视频读取 HTTP ${r.status}`);const limit=m.maxMB*1024*1024;if(Number(r.headers.get('content-length'))>limit)throw Error('视频超过设置的文件大小上限');const reader=r.body.getReader(),chunks=[];let total=0;try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw Error('视频超过设置的文件大小上限');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}check(c);const blob=new Blob(chunks,{type:r.headers.get('content-type')||'video/mp4'});return await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve({dataUrl:f.result});f.onerror=()=>reject(Error('视频编码失败'));f.readAsDataURL(blob);});}
  async function locate(m,signal){const c=check(m.context),wanted=Math.floor(m.index/10)+1;let card=Array.from(document.querySelectorAll('.labelRender-item')).find(x=>cardId(x)===String(m.dataId));if(!card){const li=document.querySelector(`.ant-v5-pagination-item[title="${wanted}"],.ant-pagination-item[title="${wanted}"]`);const button=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===String(wanted)&&x.closest('[class*=pagination]'));(li||button)?.click();for(let n=0;n<30;n++){if(signal?.aborted)throw Error('操作已停止');await new Promise(r=>setTimeout(r,150));check(c);card=Array.from(document.querySelectorAll('.labelRender-item')).find(x=>cardId(x)===String(m.dataId));if(card)break;}}if(!card)throw Error('未定位到题目；请切换到对应分页后重试');card.scrollIntoView({block:'center',behavior:'smooth'});const v=card.querySelector('video');if(v&&Number.isFinite(m.time)){v.currentTime=Math.max(0,Math.min(m.time,v.duration||m.time));v.pause();}return card;}
  const answers=new Map();let answerContext=null;
  function cardId(card){return card.dataset.id||Array.from(card.querySelectorAll('button[title]')).find(b=>b.textContent.trim()==='dataId: '+b.title)?.title||card.textContent.match(/dataId:\s*([a-zA-Z0-9_-]+)/)?.[1];}
  function clearAnswers(){answers.clear();answerContext=null;document.querySelectorAll('.pe-whale-answer').forEach(x=>x.remove());}
  function mountAnswers(){
    if(answerContext!==key(context())){if(answerContext)clearAnswers();return [];}
    const mounted=[];
    for(const card of document.querySelectorAll('.labelRender-item')){
      const id=cardId(card),answer=answers.get(id),existing=card.querySelector('.pe-whale-answer');
      if(existing&&(!answer||existing.dataset.dataId!==id))existing.remove();
      if(!answer)continue;
      const groups=Array.from(card.querySelectorAll('.labelRender-item-answer-wrap'));
      const anchor=groups.find(x=>/评分|打分/.test(x.querySelector('.labelRender-item-answer-title')?.textContent||x.textContent)&&x.querySelector('input[type=radio]'))||groups.at(-1);
      if(!anchor)continue;
      let box=card.querySelector('.pe-whale-answer');
      if(!box){box=document.createElement('div');box.className='pe-whale-answer';box.dataset.dataId=id;box.setAttribute('role','note');box.setAttribute('aria-label','卓觅识界识别结果');box.style.cssText='margin:12px 0;padding:12px 15px;border:1px solid #d7e7e9;border-left:3px solid #277c75;border-radius:10px;background:#f0f6f6;color:#244b53;font:500 14px/1.7 system-ui;overflow-wrap:anywhere;white-space:pre-wrap';}
      if(box.textContent!==answer)box.textContent=answer;
      if(anchor.nextElementSibling!==box)anchor.after(box);
      mounted.push(id);
    }
    return mounted;
  }
  function inject(m){check(m.context);if(!Array.isArray(m.results)||m.results.length>500)throw Error('识别结果无效');
    if(answerContext!==key(m.context)||m.replace)clearAnswers();answerContext=key(m.context);
    for(const r of m.results){if(typeof r.dataId!=='string'||!r.dataId||typeof r.answer!=='string'||r.answer.length>2000)throw Error('识别结果无效');answers.set(r.dataId,r.answer);}
    return {registered:answers.size,mounted:mountAnswers()};
  }
  let scheduled=false;new MutationObserver(records=>{
    if(records.every(r=>r.target.closest?.('.pe-whale-answer')||r.type==='childList'&&Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).every(n=>n.nodeType===1&&n.classList.contains('pe-whale-answer'))))return;
    if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;mountAnswers();},80);
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-id']});
  let last=key(context());setInterval(()=>{const now=key(context());if(now!==last){last=now;clearAnswers();for(const c of pending.values())c.abort();frame.contentWindow?.postMessage({pe:'contextChanged',nonce,context:context()},origin);}},1000);
  window.addEventListener('message',e=>{
    if(e.source!==frame.contentWindow||e.origin!==origin||e.data?.pe!=='request'||e.data.nonce!==nonce)return;
    const m=e.data;if(m.action==='cancel'){pending.get(m.target)?.abort();return;}
    const controller=new AbortController();pending.set(m.id,controller);const timeout=setTimeout(()=>controller.abort(),120000);
    (async()=>{switch(m.action){case'context':return context();case'pack':return readPack(m.context,controller.signal);case'media':return media(m,controller.signal);case'locate':await locate(m,controller.signal);return{located:true};case'inject':return inject(m);case'close':frame.style.display='none';shadow.querySelector('button').setAttribute('aria-expanded','false');return{closed:true};default:throw Error('不支持的工作台操作');}})().then(data=>frame.contentWindow?.postMessage({pe:'response',nonce,id:m.id,ok:true,data},origin)).catch(e=>frame.contentWindow?.postMessage({pe:'response',nonce,id:m.id,ok:false,error:e.message},origin)).finally(()=>{clearTimeout(timeout);pending.delete(m.id);});
  });
})();
