import {mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import JSZip from 'jszip';
const root=fileURLToPath(new URL('.',import.meta.url));
const production=['background.js','core','panel','content','icons','vendor','README.md','LICENSE.txt','NOTICE.txt','安装与使用.txt','manifest.json'];
const out=join(root,'out'), extension=join(out,'extension'), zip=new JSZip();
mkdirSync(out,{recursive:true});rmSync(extension,{recursive:true,force:true});mkdirSync(extension);
function add(path,rel){for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name),name=rel+'/'+entry.name;if(entry.isDirectory())add(file,name);else zip.file(name,readFileSync(file));}}
for(const name of production){const path=join(root,name);cpSync(path,join(extension,name),{recursive:true});if(name.includes('.'))zip.file(name,readFileSync(path));else add(path,name);}
const {version}=JSON.parse(readFileSync(join(root,'manifest.json')));
const output=join(out,`卓觅识界-PE视觉助手-v${version}.zip`);
writeFileSync(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));console.log(output);console.log('Unpacked extension: '+extension);
