'use strict';
// Read-only adapter for the existing Fantasy Apps Script. No write modes.
window.LabAPI=(()=>{
 const endpoint='https://script.google.com/a/macros/zennioptical.com/s/AKfycbzKMV9Vy3fq2UQlT8Z5Ll67gsEieLE1EhrFQ13hnENcNzp2FOX-2lBv402tSvivKeriOg/exec';
 const cache=new Map(), pending=new Map(); let seq=0, running=0, heavyRunning=0, cooldownUntil=0;
 const queue=[]; let wake=null;
 function drain(){clearTimeout(wake);wake=null;if(Date.now()<cooldownUntil){wake=setTimeout(drain,cooldownUntil-Date.now());return;}while(running<2){const i=queue.findIndex(q=>!q.heavy||heavyRunning===0);if(i<0)return;const q=queue.splice(i,1)[0];running++;if(q.heavy)heavyRunning++;Promise.resolve().then(q.fn).then(q.resolve,q.reject).finally(()=>{running--;if(q.heavy)heavyRunning--;drain();});}}
 function schedule(fn,mode){return new Promise((resolve,reject)=>{queue.push({fn,resolve,reject,heavy:['roster','performance'].includes(mode)});drain();});}
 const finalData=(mode,d)=>mode==='matchups'&&d?.matchups?.length&&d.matchups.every(m=>m.status==='FINAL')||mode==='performance'&&d?.complete===true&&d?.matchups?.length&&d.matchups.every(m=>m.status==='FINAL');
 const prefix="ZENNI_LAB_2026_V111_";
 function read(key){try{return JSON.parse(localStorage.getItem(prefix+key));}catch{return null;}}
 function save(key,value){try{localStorage.setItem(prefix+key,JSON.stringify(value));}catch{}}
 function request(mode,params={},force=false){
  if(!['league','matchups','roster','performance'].includes(mode))return Promise.reject(Error('Unsupported mode'));
  const key=mode+JSON.stringify(params), old=cache.get(key)||read(key); const ttl=finalData(mode,old?.data)?86400000:120000; if(!force&&old&&Date.now()-old.time<ttl)return Promise.resolve(old.data); if(pending.has(key))return pending.get(key);
  const attempt=()=>new Promise((resolve,reject)=>{
   const cb='fantasyLab_'+Date.now()+'_'+(++seq), script=document.createElement('script'); let done=false;
   const finish=(err,data)=>{if(done)return;done=true;clearTimeout(timer);script.remove();window[cb]=()=>{};setTimeout(()=>delete window[cb],60000);if(err)reject(err);else resolve(data);};
   const timer=setTimeout(()=>finish(Error(mode+' request timed out')),mode==='roster'||mode==='performance'?90000:60000);
   window[cb]=data=>{if(!data||data.ok!==true)return finish(Error(data?.error||'Invalid API response')); if(Number(data.season??data.league?.season)!==2026||Number(data.leagueId??data.league?.id)!==1310132533)return finish(Error('Unexpected league or season')); finish(null,data);};
   script.onerror=()=>finish(Error('API unavailable. Check Google account access or network.'));script.src=endpoint+'?'+new URLSearchParams({mode,...params,callback:cb,_:Date.now()});document.head.append(script);
  });
  const promise=schedule(async()=>{try{return await attempt();}catch(e){if(e.message.includes('timed out'))cooldownUntil=Date.now()+10000;throw e;}},mode).then(data=>{const item={data,time:Date.now()};cache.set(key,item);if(finalData(mode,data))save(key,item);return data;}).finally(()=>pending.delete(key));pending.set(key,promise);return promise;
 }
 return {request, peek(mode,params={}){const key=mode+JSON.stringify(params);const item=cache.get(key)||read(key);return item&&finalData(mode,item.data)?item.data:null;}};
})();
