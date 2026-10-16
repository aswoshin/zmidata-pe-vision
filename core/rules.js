import {calibrationReasons} from './calibration.js';
const STATE = new Set(['pass', 'fail', 'uncertain', 'not_applicable']);
const ID = /^[a-z][a-z0-9_]{0,47}$/;
export const clone = value => JSON.parse(JSON.stringify(value));
export function validateRulePack(p) {
  if (!p || p.schemaVersion !== 1) throw Error('规则 schemaVersion 必须为 1');
  if (!ID.test(p.id) || typeof p.name!=='string' || !p.name.trim() || p.name.length>120 || typeof p.version!=='string' || !p.version.trim() || p.version.length>80) throw Error('规则需要合法 id、名称和版本');
  if (typeof p.source?.text!=='string' || !p.source.text.trim() || p.source.text.length > 80000) throw Error('必须保留规则原文，长度不超过 80000 字');
  if (!Array.isArray(p.dimensions) || !p.dimensions.length || p.dimensions.length > 12) throw Error('维度数量必须为 1–12');
  const ids = p.dimensions.map(d => d.id);
  if (new Set(ids).size !== ids.length || p.dimensions.some(d => !ID.test(d.id) || typeof d.name!=='string' || !d.name || typeof d.criteria!=='string' || !d.criteria)) throw Error('维度 id 不可重复，名称和达标标准不能为空');
  if (!Array.isArray(p.gates) || p.gates.some(g => !ID.test(g.id) || !g.criteria || !Number.isInteger(g.failScore) || g.failScore < 1 || g.failScore > 5) || new Set(p.gates.map(g => g.id)).size !== p.gates.length) throw Error('技术门槛配置不合法');
  if (!p.applicability || !Object.keys(p.applicability).length) throw Error('缺少有效维度适用配置');
  for (const [category, dims] of Object.entries(p.applicability)) {
    if (!ID.test(category) || !Array.isArray(dims) || !dims.length || new Set(dims).size !== dims.length || dims.some(id => !ids.includes(id))) throw Error('有效维度配置不合法');
  }
  if (!['count', 'weighted'].includes(p.scoring?.mode)) throw Error('评分模式支持 count 或 weighted');
  if (p.scoring.mode === 'count') {
    for (const n of new Set(Object.values(p.applicability).map(x => x.length))) {
      const row = p.scoring.table?.[n];
      for (let k = 0; k <= n; k++) if (!Number.isInteger(row?.[k]) || row[k] < 1 || row[k] > 5) throw Error(`评分表缺少 ${n} 个有效维度、${k} 个达标的分数`);
    }
  } else {
    if (p.dimensions.some(d => !Number.isFinite(d.weight) || d.weight <= 0)) throw Error('加权模式要求每个维度设置正权重');
    const t = p.scoring.thresholds;
    if (!Array.isArray(t) || !t.length || t.some(x => !Number.isFinite(x.min) || x.min < 1 || x.min > 5 || !Number.isInteger(x.score) || x.score < 1 || x.score > 5) || !t.some(x => x.min === 1)) throw Error('加权评分阈值必须覆盖 1–5');
  }
  if (!['none', 'when_present', 'required'].includes(p.media?.audioPolicy)) throw Error('audioPolicy 不合法');
  if (typeof p.platform?.videoField!=='string' || !p.platform.videoField || typeof p.platform?.scoreTitle!=='string' || !p.platform.scoreTitle || !Array.isArray(p.platform.promptFields) || p.platform.promptFields.some(x=>typeof x!=='string'||!x)) throw Error('缺少平台视频、提示词及评分字段映射');
  if(p.evaluation){if(p.evaluation.mode!=='observed_then_calibrated'||p.evaluation.ignoreGenerationPrompt!==true||typeof p.evaluation.allowBulkApply!=='boolean'||!p.gates.some(g=>g.id==='usable_ad'&&g.failScore===1))throw Error('案例校准配置无效');for(const d of p.dimensions){if(!Array.isArray(d.checks)||!d.checks.length||d.checks.some(c=>!ID.test(c.id)||!c.name||!c.criteria)||new Set(d.checks.map(c=>c.id)).size!==d.checks.length)throw Error('校准维度需要完整且不重复的子项');}}
  if (p.taskIds && (!Array.isArray(p.taskIds) || p.taskIds.some(x => !/^\d+$/.test(String(x))))) throw Error('taskIds 必须为任务 ID 列表');
  return clone(p);
}
export function parseModelJSON(value) {
  if (typeof value !== 'string' || value.length > 150000) throw Error('模型没有返回有效文本');
  const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch { throw Error('模型输出不是有效 JSON，请重试或人工复核'); }
}
function evidenceOK(list, duration) {
  return Array.isArray(list) && list.length > 0 && list.length <= 24 && list.every(e => Number.isFinite(e.start) && Number.isFinite(e.end) && e.start >= 0 && e.end >= e.start && e.end <= duration + .15 && typeof e.description === 'string' && e.description.trim().length > 0 && e.description.length <= 2000);
}
export function assess(p, raw, media, audio = null) {
  validateRulePack(p);
  const reasons = [];
  if (!media?.decoded || !Number.isFinite(media.duration) || media.duration <= 0 || !media.visualComplete) return {status:'incomplete', score:null, provisionalScore:null, reasons:['视频未完整解码或采样未覆盖全片']};
  if (!raw || typeof raw !== 'object') return {status:'needs_review', score:null, provisionalScore:null, reasons:['缺少模型判断']};
  if(p.evaluation?.mode==='observed_then_calibrated'){const issues=calibrationReasons(p,raw,media);if(issues.length)return{status:'needs_review',score:null,provisionalScore:null,reasons:issues};if(raw.scope.type==='noncommercial')raw={...raw,gates:{...raw.gates,usable_ad:{status:'fail',evidence:raw.scope.evidence}}};}
  const needsAudio = p.media.audioPolicy === 'required' || (p.media.audioPolicy === 'when_present' && media.audioPresence !== 'absent');
  const audioValid = audio?.reviewed === true && ['pass','fail'].includes(audio.status) && evidenceOK(audio.evidence,media.duration);
  for (const gate of p.gates) {
    const g = raw.gates?.[gate.id];
    if (!g || !['pass','fail','uncertain'].includes(g.status) || !evidenceOK(g.evidence, media.duration)) return {status:'needs_review', score:null, provisionalScore:null, reasons:[`门槛“${gate.name}”缺少有效判断或时间证据`]};
    if (g.status === 'uncertain') return {status:'needs_review', score:null, provisionalScore:null, reasons:[`门槛“${gate.name}”不确定`]};
    if (g.status === 'fail') return {status:(needsAudio&&!audioValid)||raw.needsReview===true?'needs_review':'ready', score:(needsAudio&&!audioValid)||raw.needsReview===true?null:gate.failScore, provisionalScore:gate.failScore, reasons:[`未通过“${gate.name}”`,...needsAudio&&!audioValid?['声音尚未有效复核']:[],...raw.needsReview===true?['模型标记需要人工复核']:[]], effectiveDimensions:[], passCount:0};
  }
  const effective = p.applicability[raw.category];
  if (!effective) return {status:'needs_review',score:null,provisionalScore:null,reasons:['视频类型无法匹配专项有效维度']};
  if (!Array.isArray(raw.effectiveDimensions) || raw.effectiveDimensions.length !== effective.length || new Set(raw.effectiveDimensions).size !== effective.length || effective.some(x => !raw.effectiveDimensions.includes(x))) reasons.push('模型有效维度与规则不一致');
  const dims = clone(raw.dimensions || {});
  if (needsAudio) {
    if (!audio?.reviewed || !['pass','fail'].includes(audio.status) || !evidenceOK(audio.evidence,media.duration)) reasons.push('声音或音画配合尚未有效复核');
    else if (audio.status === 'fail') {
      for (const id of effective.filter(id => p.dimensions.find(d => d.id === id)?.audioSensitive)) {
        if (dims[id]?.status === 'pass') dims[id] = {...dims[id],status:'fail',...p.scoring.mode==='weighted'?{score:Math.min(dims[id].score||3,3)}:{},evidence:[...dims[id].evidence,...audio.evidence]};
      }
    }
  }
  for (const id of effective) {
    const d = dims[id];
    if (!d || !STATE.has(d.status) || !evidenceOK(d.evidence,media.duration)) reasons.push(`维度“${id}”缺少有效判断或时间证据`);
    else if (['uncertain','not_applicable'].includes(d.status)) reasons.push(`有效维度“${id}”未完成判断`);
    if (p.scoring.mode === 'weighted' && (!Number.isInteger(d?.score) || d.score < 1 || d.score > 5)) reasons.push(`维度“${id}”缺少 1–5 分子评分`);
  }
  let score = null, passCount = effective.filter(id => dims[id]?.status === 'pass').length;
  const completeDimensions = effective.every(id => ['pass','fail'].includes(dims[id]?.status) && evidenceOK(dims[id].evidence,media.duration));
  if (completeDimensions && p.scoring.mode === 'count') score = p.scoring.table[effective.length][passCount];
  else if (completeDimensions && p.scoring.mode === 'weighted' && effective.every(id => Number.isInteger(dims[id]?.score))) {
    const total = effective.reduce((n,id) => n + p.dimensions.find(d => d.id === id).weight,0);
    const avg = effective.reduce((n,id) => n + dims[id].score*p.dimensions.find(d => d.id === id).weight,0)/total;
    score = [...p.scoring.thresholds].sort((a,b)=>b.min-a.min).find(t=>avg>=t.min)?.score ?? null;
  }
  if (raw.needsReview === true) reasons.push('模型标记需要人工复核');
  return {status:reasons.length || score === null ? 'needs_review':'ready',score:reasons.length?null:score,provisionalScore:score,reasons,effectiveDimensions:effective,passCount,dimensions:dims};
}
export function compareScore(result, original, mode) {
  if (mode !== 'check') return null;
  if (result.score === null) return 'unresolved';
  if (!Number.isInteger(original)) return 'missing_original';
  return result.score === original ? 'agree':'disagree';
}
export async function digest(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === 'string' ? value : stable(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), x=>x.toString(16).padStart(2,'0')).join('');
}
function stable(x) { if (Array.isArray(x)) return '['+x.map(stable).join(',')+']'; if (x && typeof x === 'object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}'; return JSON.stringify(x); }
export function cacheIdentity(ruleHash, mediaHash, config, mode, contextPromptHash = '') {
  return {ruleHash,mediaHash,contextPromptHash,endpoint:config.endpoint,protocol:config.protocol,model:config.model,audioModel:config.audioModel||'',fps:config.fps,maxFrames:config.maxFrames,mediaMode:config.mediaMode,audioEnabled:config.audioEnabled,promptVersion:3,mode};
}
