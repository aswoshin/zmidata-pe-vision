import {renderSettings} from './settings.js';
const notify=(text,error=false)=>{const el=document.getElementById('notice');el.textContent=text;el.classList.toggle('error',error);};
renderSettings(document.getElementById('settings-slot'),notify).catch(e=>notify(e.message,true));
