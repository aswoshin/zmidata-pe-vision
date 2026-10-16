// These are text references from the supplied standard, not watched video exemplars.
export function validateObservation(observation,duration) {
  if(!observation||observation.videoExamined!==true||!Array.isArray(observation.segments)||!observation.segments.length)throw Error('缺少实际视频观察记录');
  const segments=[...observation.segments].sort((a,b)=>a.start-b.start);let end=0;
  for(const s of segments){if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>duration+.15||s.start>end+.6||typeof s.visual!=='string'||s.visual.trim().length<5)throw Error('视频观察记录缺页、越界或缺少画面事实');end=Math.max(end,s.end);}
  if(end<duration-.15)throw Error('观察记录没有覆盖全片');
  return observation;
}
export function calibrationReasons(rule,raw,media) {
  const reasons=[],scope=raw.scope;
  const evidence=list=>Array.isArray(list)&&list.length>0&&list.every(e=>Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.start>=0&&e.end>=e.start&&e.end<=media.duration+.15&&typeof e.description==='string'&&e.description.trim().length>=8);
  if(!scope||!['commercial_ad','noncommercial','uncertain'].includes(scope.type)||!evidence(scope.evidence)||typeof scope.reason!=='string'||scope.reason.trim().length<8)reasons.push('缺少基于成片的广告范围判断');
  else if(scope.type==='uncertain')reasons.push('是否属于商业广告尚不确定');
  else if(scope.type==='commercial_ad'&&(!Array.isArray(scope.signals)||!scope.signals.some(s=>['product_benefit','brand_identity','purchase_offer','service_promotion'].includes(s.type)&&evidence(s.evidence))))reasons.push('广告范围通过但缺少实际产品、品牌或服务传播证据');
  if(raw.gates?.usable_ad?.status==='pass'&&scope?.type==='noncommercial')reasons.push('非广告判断与商业门槛通过相矛盾');
  if(raw.gates?.usable_ad?.status==='pass'){const c=raw.communication;if(!c||c.subjectStatus!=='clear'||c.messageStatus!=='clear'||typeof c.subject!=='string'||!c.subject.trim()||typeof c.sellingMessage!=='string'||c.sellingMessage.trim().length<5||!evidence(c.evidence))reasons.push('未证明成片的宣传主体与商业信息清楚，不能放行到质量评分');}
  if(raw.gates?.usable_ad?.status==='pass'&&raw.gates?.technical?.status==='pass'){
    if(!evidence(raw.classificationEvidence))reasons.push('有效维度类型缺少成片证据');
    for(const id of rule.applicability[raw.category]||[]){const dimension=rule.dimensions.find(d=>d.id===id),outcome=raw.dimensions?.[id];if(rule.scoring.mode==='count'&&outcome&&Object.hasOwn(outcome,'score'))reasons.push(`维度“${dimension.name}”混用了数字子评分与达标计数，请重新判断优质达标`);
      for(const check of dimension.checks||[]){const c=outcome?.checks?.[check.id];if(!c||!['pass','fail','uncertain'].includes(c.status)||!evidence(c.evidence))reasons.push(`维度“${dimension.name}”缺少子项“${check.name}”的实际证据`);else if(c.status==='uncertain')reasons.push(`维度“${dimension.name}”子项不确定`);else if(outcome.status==='pass'&&c.status==='fail')reasons.push(`维度“${dimension.name}”通过与子项失败相矛盾`);}
      if(typeof outcome?.anchorComparison!=='string'||outcome.anchorComparison.trim().length<12)reasons.push(`维度“${dimension?.name||id}”未对照规则案例的质量边界`);
    }
  }
  return reasons;
}
