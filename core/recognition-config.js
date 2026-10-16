export const DEFAULTS = Object.freeze({schemaVersion:2,recognitionMode:'ip',provider:'vapi',model:'gemini-3.8-flash',sampleStep:10,searchEnabled:false,searchModel:'gemini-3.8-flash-search',maxMB:80,maxSeconds:600,timeoutMs:180000});
export const PRESETS = {vapi:{model:'gemini-3.8-flash'},siliconflow:{model:'Qwen/Qwen3.5-397B-A17B'}};
export function validateConfig(value={}) {
  // Old scoring settings are not recognition settings. Keep keys in their existing session vault.
  const c={...DEFAULTS};
  if(value.schemaVersion===2)for(const k of Object.keys(c))if(value[k]!==undefined)c[k]=value[k];
  if(!['ip','text'].includes(c.recognitionMode))throw Error('请选择 IP 识别或文字检查');
  if(!['vapi','siliconflow'].includes(c.provider))throw Error('仅支持 V-API 或硅基流动');
  for(const k of ['model','searchModel'])if(typeof c[k]!=='string'||!c[k].trim()||c[k].length>180)throw Error('模型 ID 无效');else c[k]=c[k].trim();
  if(/(?:-search|online|web-search)/i.test(c.model))throw Error('视觉模型请使用非联网版本；联网通过增强识别开关启用');
  if(!/^gemini-[\w.-]+-search$/.test(c.searchModel))throw Error('增强模型需使用 V-API 的 Gemini -search 版本');
  if(![5,10,20,25].includes(Number(c.sampleStep)))throw Error('抽帧间隔需为 5%、10%、20% 或 25%');c.sampleStep=Number(c.sampleStep);
  if(typeof c.searchEnabled!=='boolean')throw Error('增强识别开关无效');
  for(const [k,min,max] of [['maxMB',1,200],['maxSeconds',1,1800],['timeoutMs',1000,240000]]){c[k]=Number(c[k]);if(!Number.isFinite(c[k])||c[k]<min||c[k]>max)throw Error(k+' 超出范围');}
  return c;
}
export function route(config,purpose='visual') {
  const c=validateConfig(config);if(!['visual','search'].includes(purpose))throw Error('未知识别模式');
  if(purpose==='search'&&c.recognitionMode==='text')throw Error('文字检查仅使用视觉模型');
  if(purpose==='search'&&!c.searchEnabled)throw Error('尚未开启增强识别');
  const provider=purpose==='search'?'vapi':c.provider;
  return {provider,endpoint:provider==='vapi'?'https://api.gpt.ge':'https://api.siliconflow.cn/v1',protocol:provider==='vapi'?'gemini':'siliconflow',model:purpose==='search'?c.searchModel:c.model};
}
export function samplePercentages(step=10){if(![5,10,20,25].includes(step))throw Error('抽帧间隔无效');return Array.from({length:100/step+1},(_,i)=>i*step);}
