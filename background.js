import {validateConfig,route} from './core/recognition-config.js';
chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const trusted=sender=>sender.id===chrome.runtime.id&&sender.url?.startsWith(chrome.runtime.getURL('panel/'));
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(!trusted(sender))return false;
  (async()=>{
    const local=await chrome.storage.local.get('recognitionConfig'),c=validateConfig(local.recognitionConfig),keys=(await chrome.storage.session.get('apiKeys')).apiKeys||{};
    if(m.type==='config.get')return{config:c,hasKeys:{vapi:!!keys['https://api.gpt.ge'],siliconflow:!!keys['https://api.siliconflow.cn']}};
    if(m.type==='config.save'){
      const next=validateConfig(m.config);
      for(const [provider,origin]of Object.entries({vapi:'https://api.gpt.ge',siliconflow:'https://api.siliconflow.cn'}))if(m.apiKeys?.[provider]!==undefined){const value=String(m.apiKeys[provider]).trim();if(value)keys[origin]=value;else delete keys[origin];}
      await chrome.storage.session.set({apiKeys:keys});await chrome.storage.local.set({recognitionConfig:next});return{saved:true};
    }
    const purpose=m.purpose||'visual',r=route(c,purpose),key=keys[new URL(r.endpoint).origin]||'';
    if(!key)throw Error(`请在设置中填写 ${r.provider==='vapi'?'V-API':'硅基流动'} API Key`);
    if(m.type==='models'){const response=await fetch(r.endpoint.replace(/\/v1$/,'')+'/v1/models',{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('模型列表 HTTP '+response.status);const j=await response.json();return{models:(j.data||[]).map(x=>x.id).filter(x=>typeof x==='string')};}
    if(m.type==='request.credentials'){
      if(!m.expectedConfig||JSON.stringify(validateConfig(m.expectedConfig))!==JSON.stringify(c))throw Error('设置已变化，请重新开始识别');
      return{config:c,route:r,key};
    }
    throw Error('不支持的操作');
  })().then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:{message:e.message}}));return true;
});
