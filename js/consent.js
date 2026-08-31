const CONSENT_KEY='suvera:privacy-consent:v1',CONSENT_VERSION=1,banner=document.getElementById('consentBanner');
let consent=null;
function normalize(value){
  if(!value||typeof value!=='object'||Number(value.version)!==CONSENT_VERSION)return null;
  return{version:1,necessary:true,preferences:value.preferences===true,analytics:value.analytics===true,marketing:false,updatedAt:typeof value.updatedAt==='string'?value.updatedAt:new Date().toISOString()};
}
function read(){
  try{
    const raw=localStorage.getItem(CONSENT_KEY);
    if(raw==='essential'||raw==='analytics')return normalize({version:1,preferences:raw==='analytics',analytics:raw==='analytics'});
    return normalize(JSON.parse(raw||'null'));
  }catch(_){return null;}
}
function apply(value,persist=false){
  consent=normalize(value);
  document.documentElement.dataset.consent=consent?'saved':'unset';
  if(banner)banner.hidden=Boolean(consent);
  if(persist&&consent)try{localStorage.setItem(CONSENT_KEY,JSON.stringify(consent));}catch(_){}
  window.dispatchEvent(new CustomEvent('suvera:consent',{detail:consent||{necessary:true,preferences:false,analytics:false,marketing:false}}));
}
function save(values){apply(normalize({version:1,...values,updatedAt:new Date().toISOString()}),true);}
async function open(trigger){const module=await import('./consent-preferences.js');module.openConsentPreferences(trigger,consent);}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-consent-action]');if(!button)return;
  const action=button.dataset.consentAction;
  if(action==='accept-all')save({preferences:true,analytics:true});
  if(action==='necessary-only')save({preferences:false,analytics:false});
  if(action==='manage'||action==='open-settings')void open(button);
});
window.SuveraConsent=Object.freeze({KEY:CONSENT_KEY,VERSION:1,current:()=>consent&&{...consent},allows:category=>category==='necessary'||Boolean(consent?.[category]),save,open});
apply(read());
