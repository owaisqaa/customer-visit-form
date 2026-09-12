const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {File}=require('node:buffer');
const app=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
const delivery=app.slice(app.indexOf('let pendingPDF='),app.indexOf('async function createPDF('));
function setup(navigator={}){
 const elements=new Map(),urls=new Map();let next=0;
 function $(selector){if(!elements.has(selector)){const listeners={};elements.set(selector,{hidden:false,disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;listeners.close?.();},addEventListener(name,fn){listeners[name]=fn;},removeAttribute(key){delete this[key];}});}return elements.get(selector);}
 const context={$,navigator,File,Blob,URL:{createObjectURL(blob){const url=`blob:test/${++next}`;urls.set(url,blob);return url;},revokeObjectURL(){throw Error('An opened PDF URL must not be revoked while its document is alive.');}},setTimeout(){throw Error('No timed PDF URL expiry.');}};
 vm.createContext(context);vm.runInContext(delivery+';this.show=showPDFDownload;this.current=()=>pendingPDF;',context);
 return {context,$,urls,show:context.show};
}
const pdf=new Blob(['%PDF-1.7 test'],{type:'application/pdf'});
test('native share sends the generated file from a fresh tap without opening a blob URL',async()=>{
 let shared;const s=setup({canShare:()=>true,share(data){shared=data;return Promise.resolve();}});
 s.show(pdf,'زيارة.pdf');assert.equal(s.$('#pdfDelivery').open,true);assert.equal(s.$('#pdfShare').hidden,false);assert.equal(s.urls.size,0);
 const pending=s.$('#pdfShare').onclick();assert.equal(shared.files[0].name,'زيارة.pdf');assert.equal(shared.files[0].type,'application/pdf');await pending;
 assert.equal(s.urls.size,0);assert.equal(s.$('#pdfShare').disabled,false);assert(s.context.current());
});
test('canceling native sharing keeps the report ready and allows another attempt',async()=>{
 const s=setup({canShare:()=>true,share:()=>Promise.reject({name:'AbortError'})});s.show(pdf,'report.pdf');await s.$('#pdfShare').onclick();
 assert(s.context.current());assert.equal(s.$('#pdfShare').disabled,false);assert.equal(s.$('#pdfDelivery').open,true);assert.match(s.$('#pdfDeliveryStatus').textContent,/المحاولة مجدداً/);
});
test('sharing failure preserves the explicit download fallback',async()=>{
 const s=setup({canShare:()=>true,share:()=>Promise.reject({name:'NotAllowedError'})});s.show(pdf,'report.pdf');await s.$('#pdfShare').onclick();
 assert.match(s.$('#pdfDeliveryStatus').textContent,/تنزيل PDF/);const link=s.$('#pdfDownload');link.onclick({currentTarget:link});assert(s.urls.has(link.href));
});
test('download fallback opens separately and retains its URL after closing or preparing another PDF',()=>{
 const s=setup();s.show(pdf,'first.pdf');assert.equal(s.$('#pdfShare').hidden,true);assert.equal(s.urls.size,0);
 const link=s.$('#pdfDownload');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener');assert.equal(link.download,'first.pdf');
 link.onclick({currentTarget:link});const first=link.href;link.onclick({currentTarget:link});assert.equal(link.href,first);assert.equal(s.urls.size,1);
 s.$('#pdfBack').onclick();assert.equal(s.$('#pdfDelivery').open,false);assert.equal(s.context.current(),null);assert(s.urls.has(first));
 s.show(pdf,'second.pdf');link.onclick({currentTarget:link});assert.notEqual(link.href,first);assert(s.urls.has(first));assert.equal(s.urls.size,2);
});
test('failed capability detection still allows download and unused dialogs allocate no URLs',()=>{
 const s=setup({share(){},canShare(){throw Error('Unsupported');}});s.show(pdf,'report.pdf');assert.equal(s.$('#pdfShare').hidden,true);
 s.$('#pdfBack').onclick();assert.equal(s.urls.size,0);let prevented=false;s.$('#pdfDownload').onclick({preventDefault(){prevented=true;}});assert(prevented);
});
