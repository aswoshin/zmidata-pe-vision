import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,validateConfig,route,samplePercentages} from '../core/recognition-config.js';
import {buildRecognitionRequest,normalizeRecognition,resultKey,videoField,mergeRecognition,inferRecognition} from '../core/recognition.js';
const media={frames:[{percent:0,url:'data:image/jpeg;base64,AAAA'},{percent:100,url:'data:image/jpeg;base64,AAAA'}]};
const outcome={entities:[{name:'埃菲尔铁塔',kind:'landmark',certainty:'confirmed',confidence:92,features:['轮廓','四个基座'],frames:[0,1],evidence:'塔身轮廓和四个基座'}],uncertain:false};
test('默认视觉识别，不携带联网工具、视频原文件、分数或提示词',()=>{assert.equal(DEFAULTS.searchEnabled,false);const c=validateConfig(),b=buildRecognitionRequest(c,media),text=JSON.stringify(b);assert.equal(b.contents[0].parts.filter(p=>p.inlineData).length,2);assert.ok(!b.tools);assert.ok(!text.includes('video_url'));assert.ok(!text.includes('originalScore'));assert.equal(route(c).endpoint,'https://api.gpt.ge');assert.throws(()=>route(c,'search'));});
test('旧评分设置不污染识别，端点只能选择两家服务，搜索单独路由',()=>{assert.deepEqual(validateConfig({endpoint:'http://evil',model:'old'}),DEFAULTS);assert.throws(()=>validateConfig({...DEFAULTS,provider:'local'}));assert.throws(()=>validateConfig({...DEFAULTS,model:'gemini-3.8-flash-search'}));const c=validateConfig({...DEFAULTS,provider:'siliconflow',model:'Qwen/Qwen3.5-397B-A17B',searchEnabled:true});assert.equal(route(c).endpoint,'https://api.siliconflow.cn/v1');assert.equal(route(c,'search').endpoint,'https://api.gpt.ge');assert.equal(buildRecognitionRequest(c,media).messages[1].content.filter(x=>x.type==='image_url').length,2);assert.ok(buildRecognitionRequest(c,media,{purpose:'search',baseline:outcome}).contents);});
test('百分比取样包含首尾，与视频秒数无关',()=>{assert.deepEqual(samplePercentages(20),[0,20,40,60,80,100]);assert.equal(samplePercentages(5).length,21);assert.equal(samplePercentages(10).length,11);assert.throws(()=>samplePercentages(0));assert.throws(()=>samplePercentages(7));});
test('结果只列名称、去重、过滤不确定项和真人类别，保留有效帧证据',()=>{const r=normalizeRecognition({...outcome,entities:[...outcome.entities,...outcome.entities,{name:'不确定角色',kind:'character',certainty:'uncertain'},{name:'person',kind:'person',certainty:'confirmed'}]},2);assert.equal(r.answer,'埃菲尔铁塔 · 置信度 92%');assert.equal(r.entities.length,1);assert.equal(r.uncertain,true);assert.equal(normalizeRecognition({entities:[],uncertain:true},2).answer,'暂无法确认具体 IP');assert.throws(()=>normalizeRecognition({entities:[{...outcome.entities[0],frames:[2]}],uncertain:false},2));assert.throws(()=>normalizeRecognition({entities:[{...outcome.entities[0],name:'<script>x</script>'}],uncertain:false},2));assert.throws(()=>normalizeRecognition('{broken',2));});
test('兼容新旧视频字段，无法唯一确定时停止',()=>{assert.equal(videoField({media_path:'x',sd2_5_video_path:'y'}),'media_path');assert.equal(videoField({sd2_5_video_path:'x'}),'sd2_5_video_path');assert.equal(videoField({one:'x.mp4',two:'y.mp4'}),null);});
test('本机结果隔离题包、视频、模型、抽帧和搜索开关',async()=>{const pack={key:'pack1',context:{origin:'https://www.skyvendorise.com'}},item={dataId:'1',data:{media_path:'/x.mp4?Expires=1'}};const a=await resultKey(pack,item,DEFAULTS);assert.equal(a,await resultKey(pack,{...item,data:{media_path:'/x.mp4?Expires=2'}},DEFAULTS));assert.notEqual(a,await resultKey({...pack,key:'pack2'},item,DEFAULTS));for(const patch of [{sampleStep:5},{searchEnabled:true},{model:'another'}])assert.notEqual(a,await resultKey(pack,item,{...DEFAULTS,...patch}));});
test('只保留IP：物品过滤，真人姓名转人工确认，低置信度不硬猜',()=>{
  const entity={...outcome.entities[0],kind:'character',name:'江户川柯南',franchise:'名侦探柯南'};
  const r=normalizeRecognition({entities:[{...entity,kind:'object',name:'汽车'},{...entity,kind:'person',name:'某真人'},{...entity,confidence:55}],uncertain:false},2);
  assert.equal(r.entities.length,0);assert.equal(r.humanReview,true);assert.equal(r.answer,'真人身份需人工确认');
  assert.equal(normalizeRecognition({entities:[{...entity,frames:[0]}],uncertain:false},2).entities[0].confidence,85);
});
test('两路一致取较低置信度，冲突降级，不把搜索独有IP注入页面',()=>{
 const visual=normalizeRecognition(outcome,2),same=normalizeRecognition({...outcome,entities:[{...outcome.entities[0],confidence:88}]},2);
 assert.equal(mergeRecognition(visual,same,{grounded:true}).entities[0].confidence,88);
 const conflict=normalizeRecognition({...outcome,entities:[{...outcome.entities[0],name:'东京塔'}]},2);
 assert.equal(mergeRecognition(visual,conflict).entities[0].confidence,72);
 assert.equal(mergeRecognition(normalizeRecognition({entities:[],uncertain:true},2),same).entities.length,0);
});
test('联网和视觉真实并行启动，最终统一输出；搜索失败保留视觉置信度',async()=>{
 const started=[];let release;const barrier=new Promise(r=>release=r);
 const infer=async(body,purpose)=>{started.push(purpose);if(started.length===2)release();await barrier;return{text:JSON.stringify(outcome),model:'mock',grounded:purpose==='search'};};
 const result=await inferRecognition({...DEFAULTS,searchEnabled:true},media,infer);
 assert.deepEqual(started,['visual','search']);assert.equal(result.entities[0].confidence,92);assert.equal(result.enhancement.parallel,true);
 const fallback=await inferRecognition({...DEFAULTS,searchEnabled:true},media,async(body,purpose)=>{if(purpose==='search')throw Error('search down');return{text:JSON.stringify(outcome),model:'mock'};});
 assert.equal(fallback.enhancement.status,'failed');assert.equal(fallback.entities[0].confidence,92);
});
