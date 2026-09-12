'use strict';
const $=s=>document.querySelector(s);
const sections=[
 {title:'الخط اليومي',hint:'الصالحية',fields:[['area','المنطقة','text'],['date','تاريخ الزيارة','date'],['route','خط السير','text']]},
 {title:'تصنيف الزبون',fields:[['customer','اسم الزبون','text'],['district','الحي','text'],['gps','موقع الزبون (GPS)','gps'],['photo','صورة المحل','photo'],['classification','تصنيف الزبون','grade'],['locationRating','تقييم الموقع','grade']]},
 {title:'توفر المواد الدعائية',hint:'حدّد "نعم" أو "لا" لكل أداة عرض',fields:[...['آرمة','براد','بوستر','دانجلر','شيلف ستريب','ستاند راني','ستاند دولسي','ستاند بيكر'].map((x,i)=>['display'+i,x,'yesno']),['displayNotes','ملاحظات على أدوات العرض','textarea']]},
 {title:'المنتجات',hint:'قيّم من 0 (الأضعف) إلى 5 (الأفضل)',fields:[['knows','الزبون يعرف جيداً أصناف الشركة','rating'],['offered','المندوبون عرضوا جميع الأصناف على الزبون','rating'],['placement','تقييم مكان منتجاتنا في رفوف وبرادات الزبون','rating'],...['بربيكان','راني','بايسن','دولسي','فيمتو','دارك بلو','جرين','بيكر','رأس الحصان','سيزر','المراعي'].map((x,i)=>['product'+i,x,'rating']),['productNotes','ملاحظات الزبون على المنتجات','textarea']]},
 {title:'العلاقة بين الزبون والمندوبين',hint:'قيّم من 0 (الأضعف) إلى 5 (الأفضل)',fields:[['intro','يقدم المندوب نفسه كمندوب شركة ليدرز','rating'],['repRating','تقييم الزبون للمندوبين','rating'],['invoices','تقييم التزام المندوبين بالفواتير الورقية','rating'],['offers','تقييم الزبون للعروض الدورية المقدمة من الشركة','rating'],['relationshipNotes','ملاحظات إضافية عن علاقة المندوب بالزبون','textarea',false]]}
];
const fields=sections.flatMap(s=>s.fields);let saving=false,photo='',activeId=null,records=[],db=null,dirty=false,photoBusy=false,revision=0,timer,saveChain=Promise.resolve();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fieldHTML(f){const [id,label,type]=f;const wide=['textarea','gps','photo'].includes(type)||['knows','offered','placement','intro','repRating','invoices','offers'].includes(id);let html='';
 if(['grade','yesno','rating'].includes(type)){const options=type==='grade'?['A','B','C','D']:type==='yesno'?['نعم','لا']:['0','1','2','3','4','5'];html=`<fieldset><legend>${label}</legend><div class="choices">${options.map(v=>`<label class="choice"><input type="radio" name="${id}" value="${v}"><span>${v}</span></label>`).join('')}</div></fieldset>`;}
 else{html=`<label class="label" for="${id}">${label}</label>`;if(type==='textarea')html+=`<textarea id="${id}" name="${id}" rows="3" placeholder="اكتب الملاحظات، أو «لا يوجد»"></textarea>`;
 else if(type==='gps')html+='<p class="hint">الصق رابط الموقع من Google Maps، أو استخدم موقعك الحالي.</p><div class="location"><input id="gps" name="gps" type="url" dir="ltr" placeholder="https://maps.google.com/..."><button type="button" class="outline" id="locate">استخدام موقعي</button></div>';
 else if(type==='photo')html+='<div class="photoBox"><input id="photo" type="file" accept="image/*"><p class="hint">اختر صورة للمحل أو التقط صورة من هاتفك.</p><img id="photoPreview" alt="صورة المحل" hidden><button type="button" id="removePhoto" class="outline" hidden>إزالة الصورة</button></div>';
 else html+=`<input id="${id}" name="${id}" type="${type}">`;}
 return `<div class="field ${wide?'wide':''}" data-field="${id}">${html}</div>`;}
$('#fields').innerHTML=sections.map((s,i)=>`<section class="card" id="section${i}"><div class="cardHead"><span class="number">${i+1}</span><div><h2>${s.title}</h2>${s.hint?`<p>${s.hint}</p>`:''}</div></div><div class="cardBody">${s.fields.map(fieldHTML).join('')}</div></section>`).join('');
$('#sectionLinks').innerHTML=sections.map((s,i)=>`<a href="#section${i}"><span>${i+1}</span>${s.title}</a>`).join('');
function notify(message,error=false){$('#notice').textContent=message;$('#notice').classList.toggle('failure',error);}
function data(){const d=Object.fromEntries(new FormData($('#visitForm')));d.photo=photo;return d;}
function updateProgress(){const d=data(),n=fields.filter(f=>String(d[f[0]]??'').trim()).length;$('#progress').max=fields.length;$('#progress').value=n;$('#progressText').textContent=`${n} من ${fields.length} حقلاً معبّأً`;}
function showPhoto(){const el=$('#photoPreview');el.hidden=!photo;if(photo)el.src=photo;else el.removeAttribute('src');$('#removePhoto').hidden=!photo;}
function applyData(d={}){$('#visitForm').reset();for(const f of fields){const id=f[0];if(id==='photo')continue;const el=$('#visitForm').elements.namedItem(id);if(el)el.value=d[id]??'';}photo=d.photo||'';showPhoto();updateProgress();document.querySelectorAll('.error').forEach(x=>x.classList.remove('error'));}
function confirmed(title,description){return new Promise(resolve=>{const modal=$('#confirm');$('#confirmTitle').textContent=title;$('#confirmText').textContent=description;modal.returnValue='';modal.onclose=()=>resolve(modal.returnValue==='yes');$('#confirmYes').onclick=()=>modal.close('yes');$('#confirmNo').onclick=()=>modal.close('no');modal.showModal();});}
function tx(store,mode,action){return new Promise((resolve,reject)=>{if(!db)return reject(new Error('storage'));const t=db.transaction(store,mode);const r=action(t.objectStore(store));t.oncomplete=()=>resolve(r?.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
function writeDraft(){const snapshot={id:'current',data:data(),activeId,dirty};saveChain=saveChain.catch(()=>{}).then(()=>tx('draft','readwrite',s=>s.put(snapshot)));saveChain.then(()=>{$('#draftState').textContent='تم حفظ المسودة تلقائياً';},()=>{$('#draftState').textContent='تعذّر حفظ المسودة';notify('تعذّر الحفظ في هذا المتصفح. احتفظ بنسخة PDF قبل إغلاق الصفحة.',true);});return saveChain;}
function changed(){dirty=true;updateProgress();$('#draftState').textContent='جارٍ حفظ المسودة…';clearTimeout(timer);timer=setTimeout(writeDraft,400);}
$('#visitForm').addEventListener('input',e=>{if(e.target.type==='file')return;e.target.closest('.field')?.classList.remove('error');changed();});
async function newReport(){if(dirty&&!await confirmed('مسح النموذج؟','ستُمسح المسودة الحالية. التقارير المحفوظة في السجل ستبقى كما هي.'))return;revision++;clearTimeout(timer);activeId=null;dirty=false;applyData();$('#editorTitle').textContent='زيارة جديدة';showView('form');await writeDraft().catch(()=>{});$('#draftState').textContent='مسودة جديدة';notify('النموذج جاهز لتقرير جديد.');window.scrollTo({top:0,behavior:'smooth'});}
$('#new').onclick=newReport;$('#clear').onclick=newReport;
function showView(view){$('#editor').hidden=view!=='form';$('#history').hidden=view!=='history';$('#formTab').classList.toggle('active',view==='form');$('#historyTab').classList.toggle('active',view==='history');$('#formTab').toggleAttribute('aria-current',view==='form');$('#historyTab').toggleAttribute('aria-current',view==='history');if(view==='history')renderHistory();}
$('#formTab').onclick=()=>showView('form');$('#historyTab').onclick=()=>showView('history');
function validate(){if(photoBusy){notify('انتظر حتى يكتمل تجهيز الصورة.',true);return false;}return true;}
async function saveReport(){if(saving||!validate())return null;saving=true;clearTimeout(timer);const id=activeId||crypto.randomUUID(),previous=records.find(r=>r.id===id);const record={id,data:data(),created:previous?.created||new Date().toISOString(),updated:new Date().toISOString()};try{await tx('reports','readwrite',s=>s.put(record));activeId=id;dirty=false;records=records.filter(r=>r.id!==id);records.unshift(record);$('#count').textContent=records.length;$('#editorTitle').textContent='تعديل تقرير محفوظ';await writeDraft();notify('تم حفظ التقرير. يمكنك فتحه وتعديله من التقارير المحفوظة.');return record;}catch{notify('تعذّر حفظ التقرير. قد تكون مساحة المتصفح ممتلئة أو التخزين غير متاح. يمكنك تنزيل PDF للاحتفاظ بإجاباتك.',true);return record;}finally{saving=false;}}
$('#visitForm').onsubmit=async e=>{e.preventDefault();$('#save').disabled=true;try{await saveReport();}finally{$('#save').disabled=false;}};
function renderHistory(){$('#count').textContent=records.length;$('#historyList').innerHTML=records.length?records.slice().sort((a,b)=>b.updated.localeCompare(a.updated)).map(r=>`<article class="historyItem"><div><h3>${esc(r.data.customer?.trim()||'تقرير بدون اسم')}</h3><p>${esc(r.data.date||'بدون تاريخ')} · ${esc(r.data.area||'بدون منطقة')} · ${esc(r.data.route||'بدون خط سير')}</p><p>آخر حفظ: ${esc(new Date(r.updated).toLocaleString('ar'))}</p></div><div class="actions"><button class="primary" data-open="${esc(r.id)}">فتح وتعديل</button><button class="outline" data-pdf="${esc(r.id)}">تنزيل PDF</button><button class="outline delete" data-delete="${esc(r.id)}">حذف</button></div></article>`).join(''):'<div class="empty"><h3>لا توجد تقارير محفوظة بعد</h3><p>املأ التقرير واضغط «حفظ التقرير» ليظهر هنا.</p></div>';}
$('#historyList').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const r=records.find(r=>r.id===(b.dataset.open||b.dataset.pdf||b.dataset.delete));if(!r)return;if(b.dataset.open){if(dirty&&!await confirmed('فتح تقرير محفوظ؟','سيحل التقرير المحدد محل المسودة الحالية غير المحفوظة في السجل.'))return;clearTimeout(timer);revision++;activeId=r.id;dirty=false;applyData(r.data);$('#editorTitle').textContent='تعديل تقرير محفوظ';showView('form');await writeDraft().catch(()=>{});notify('التقرير مفتوح للتعديل. اضغط حفظ لتحديث النسخة الموجودة.');window.scrollTo({top:0,behavior:'smooth'});}else if(b.dataset.pdf){await exportPDF(r,b);}else if(await confirmed('حذف التقرير؟','سيُحذف هذا التقرير من سجل هذا المتصفح. لا يمكن التراجع عن الحذف.')){try{await tx('reports','readwrite',s=>s.delete(r.id));records=records.filter(x=>x.id!==r.id);if(activeId===r.id){activeId=null;dirty=true;await writeDraft();}renderHistory();notify('تم حذف التقرير.');}catch{notify('تعذّر حذف التقرير.',true);}}};
$('#photo').onchange=async e=>{const file=e.target.files[0];if(!file)return;const rev=revision;photoBusy=true;try{if(file.size>25*1024*1024)throw Error('size');const url=URL.createObjectURL(file);try{const img=await loadImage(url);const c=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(img.width,img.height));c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);if(rev!==revision)return;photo=c.toDataURL('image/jpeg',.85);showPhoto();$('[data-field="photo"]').classList.remove('error');changed();}finally{URL.revokeObjectURL(url);}}catch{notify('تعذّر قراءة الصورة. اختر صورة JPG أو PNG أو WebP بحجم أقل من 25 MB.',true);e.target.value='';}finally{photoBusy=false;}};
$('#removePhoto').onclick=()=>{photo='';$('#photo').value='';showPhoto();changed();};
$('#locate').onclick=()=>{if(!navigator.geolocation){notify('تحديد الموقع غير متاح. الصق رابط Google Maps يدوياً.',true);return;}const rev=revision;$('#locate').disabled=true;navigator.geolocation.getCurrentPosition(pos=>{if(rev===revision){$('#gps').value=`https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;changed();notify('تم إدخال الموقع الحالي.');}$('#locate').disabled=false;},()=>{notify('تعذّر تحديد الموقع. اسمح بالوصول إلى الموقع أو الصق رابط Google Maps يدوياً.',true);$('#locate').disabled=false;},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});};
function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});}
// Keep the form tab alive: PDF generation must never navigate it to a blob URL.
// The second tap supplies fresh user activation for iOS's native file share sheet.
let pendingPDF=null,pdfExportBusy=false;
function showPDFDownload(blob,name){
 const file=typeof File==='function'?new File([blob],name,{type:'application/pdf'}):null;
 pendingPDF={blob,file,name,url:null};
 let canShare=false;try{canShare=Boolean(file&&navigator.share&&navigator.canShare?.({files:[file]}));}catch{}
 $('#pdfFileName').textContent=name;
 $('#pdfShare').hidden=!canShare;$('#pdfShare').disabled=false;
 $('#pdfDeliveryHint').textContent=canShare?'على iPhone: اضغط «حفظ أو مشاركة PDF»، ثم اختر «حفظ في الملفات». سيبقى النموذج مفتوحاً.':'اضغط «تنزيل PDF». إذا فُتح التقرير في تبويب منفصل، يمكنك إغلاقه للعودة إلى هذه الصفحة.';
 $('#pdfDeliveryStatus').textContent='';
 const link=$('#pdfDownload');link.href='#';link.download=name;link.target='_blank';link.rel='noopener';
 if(!$('#pdfDelivery').open)$('#pdfDelivery').showModal();
}
$('#pdfShare').onclick=async()=>{
 const selected=pendingPDF;if(!selected?.file)return;
 const button=$('#pdfShare');button.disabled=true;$('#pdfDeliveryStatus').textContent='';
 try{
  // Call share before any await: Safari requires an active user gesture.
  await navigator.share({files:[selected.file]});
  if(pendingPDF===selected)$('#pdfDeliveryStatus').textContent='يمكنك الرجوع إلى الصفحة أو حفظ نسخة أخرى.';
 }catch(error){
  if(pendingPDF===selected)$('#pdfDeliveryStatus').textContent=error?.name==='AbortError'?'أُغلقت نافذة المشاركة. يمكنك المحاولة مجدداً.':'تعذّرت المشاركة. استخدم «تنزيل PDF» أدناه، ثم احفظ الملف من عارض PDF.';
 }finally{button.disabled=false;}
};
$('#pdfDownload').onclick=event=>{
 const selected=pendingPDF;if(!selected){event.preventDefault();return;}
 if(!selected.url)selected.url=URL.createObjectURL(selected.blob);
 // Safari may keep reading this URL in another tab. Do not revoke it on a
 // timer, dialog close, or pagehide (which may place this page in the BFCache).
 // The browser releases it when this document is finally destroyed.
 event.currentTarget.href=selected.url;
 $('#pdfDeliveryStatus').textContent='إذا فُتح التقرير في تبويب آخر، أغلق ذلك التبويب للعودة إلى النموذج.';
};
$('#pdfBack').onclick=()=>$('#pdfDelivery').close();
$('#pdfDelivery').addEventListener('close',()=>{pendingPDF=null;$('#pdfDownload').removeAttribute('href');});
async function createPDF(record){
 await Promise.all([document.fonts.load('24px "Cairo"'),document.fonts.load('bold 24px "Cairo"')]);await document.fonts.ready;
 const {PDFDocument}=PDFLib,pdf=await PDFDocument.create();pdf.setTitle('Customer visit report');pdf.setProducer('IQ Distribution - Customer visits');
 const logo=await loadImage('logo.png'),shop=record.data.photo?await loadImage(record.data.photo):null;
 const W=1240,H=1754,M=72,TOP=190,BOTTOM=1630,CW=W-2*M;
 const measure=document.createElement('canvas').getContext('2d');
 const font=(size,bold=false)=>`${bold?'bold ':''}${size}px "Cairo",Tahoma,Arial,sans-serif`;
 const answer=f=>{const value=record.data[f[0]];return value===undefined||value===null||String(value).trim()===''?'—':String(value)+(f[2]==='rating'?' / 5':'');};
 function wrap(value,size,width,bold=false){measure.font=font(size,bold);const out=[];
  for(const paragraph of String(value).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){
   if(measure.measureText((line?line+' ':'')+word).width>width&&line){out.push(line);line='';}
   if(measure.measureText(word).width>width){for(const ch of word){if(line&&measure.measureText(line+ch).width>width){out.push(line);line='';}line+=ch;}}
   else line+=(line?' ':'')+word;
  }out.push(line||' ');}return out;
 }
 function layout(sectionNumbers,scale){const ops=[];let y=0;const gap=24*scale,half=(CW-gap)/2;
  const text=(value,x,yy,size,color='#233d50',bold=false,align='right')=>ops.push({kind:'text',value,x,y:yy,size,color,bold,align});
  function lines(value,x,yy,width,size,color,bold=false){for(const line of wrap(value,size,width,bold)){text(line,x,yy+size*.95,size,color,bold);yy+=size*1.5;}return yy;}
  function field(f,x,yy,width){const [id,label,type]=f,pad=10*scale;
   if(['grade','yesno','rating'].includes(type)){const labelSize=22*scale,valSize=23*scale,valueWidth=100*scale;
    const wrapped=wrap(label,labelSize,width-valueWidth-pad);const h=Math.max(wrapped.length*labelSize*1.5,valSize*1.5)+14*scale;
    let ly=yy;for(const line of wrapped){text(line,x+width,ly+labelSize,labelSize);ly+=labelSize*1.5;}
    text(answer(f),x+pad,yy+valSize,valSize,'#146993',true,'left');ops.push({kind:'rect',x,y:yy+h-5*scale,w:width,h:1,color:'#e2eaf0'});return yy+h;
   }
   let next=lines(label,x+width,yy,width,22*scale,'#537186',true)+3*scale;
   next=lines(answer(f),x+width,next,width,id==='gps'?21*scale:24*scale,'#203b4e');return next+16*scale;
  }
  function full(f){y=field(f,M,y,CW);}
  function pair(a,b){const right=field(a,M+half+gap,y,half),left=b?field(b,M,y,half):y;y=Math.max(right,left);}
  function photo(){y=lines('صورة المحل',M+CW,y,CW,22*scale,'#537186',true)+8*scale;
   if(!shop){y=lines('لم تُرفق صورة',M+CW,y,CW,23*scale,'#203b4e')+15*scale;return;}
   const maxH=210*scale,maxW=CW,imageScale=Math.min(maxW/shop.width,maxH/shop.height),w=shop.width*imageScale,h=shop.height*imageScale;
   ops.push({kind:'image',image:shop,x:M+CW-w,y,w,h});y+=h+20*scale;
  }
  for(const si of sectionNumbers){const section=sections[si];const headSize=26*scale,headLines=wrap(`${si+1}. ${section.title}`,headSize,CW-32*scale,true);const headHeight=Math.max(49*scale,headLines.length*headSize*1.5+12*scale);
   ops.push({kind:'rect',x:M,y,w:CW,h:headHeight,color:'#eaf3f9'});let headY=y+7*scale;
   for(const line of headLines){text(line,M+CW-16*scale,headY+headSize,headSize,'#146993',true);headY+=headSize*1.5;}
   y+=headHeight+15*scale;
   const fs=section.fields;
   if(si===0){pair(fs[0],fs[1]);full(fs[2]);}
   if(si===1){pair(fs[0],fs[1]);full(fs[2]);photo();pair(fs[4],fs[5]);}
   if(si===2){for(let i=0;i<8;i+=2)pair(fs[i],fs[i+1]);full(fs[8]);}
   if(si===3){for(let i=0;i<3;i++)full(fs[i]);for(let i=3;i<14;i+=2)pair(fs[i],i+1<14?fs[i+1]:null);full(fs[14]);}
   if(si===4){for(const f of fs)full(f);}
   y+=18*scale;
  }
  return {ops,height:y,scale};
 }
 function fit(indices){const available=BOTTOM-TOP;let result=layout(indices,1);if(result.height<=available)return result;
  let hi=1,lo=.5;while(layout(indices,lo).height>available)lo/=2;
  for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(layout(indices,mid).height<=available)lo=mid;else hi=mid;}
  return layout(indices,lo);
 }
 const pages=[fit([0,1,2]),fit([3,4])];
 for(let i=0;i<pages.length;i++){const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
  function paintText(value,x,y,size,color='#233d50',bold=false,align='right'){ctx.font=font(size,bold);ctx.fillStyle=color;ctx.textAlign=align;ctx.direction=align==='right'?'rtl':'ltr';ctx.fillText(value,x,y);}
  ctx.fillStyle='white';ctx.fillRect(0,0,W,H);ctx.fillStyle='#1679ac';ctx.fillRect(0,0,W,12);ctx.drawImage(logo,W-M-96,38,96,96);
  paintText('نموذج زيارة وتقييم الزبون',W-M-120,78,32,'#203e54',true);
  paintText(i===0?'بيانات الزيارة والمواد الدعائية':'تقييم المنتجات والعلاقة مع المندوبين',W-M-120,118,22,'#627b8c');
  ctx.fillStyle='#dce6ec';ctx.fillRect(M,153,CW,2);
  for(const op of pages[i].ops){if(op.kind==='text')paintText(op.value,op.x,TOP+op.y,op.size,op.color,op.bold,op.align);
   else if(op.kind==='rect'){ctx.fillStyle=op.color;ctx.fillRect(op.x,TOP+op.y,op.w,op.h);}
   else ctx.drawImage(op.image,op.x,TOP+op.y,op.w,op.h);
  }
  ctx.fillStyle='#dce6ec';ctx.fillRect(M,H-88,CW,1);
  paintText('IQ DISTRIBUTION · SYRIA',M,H-48,17,'#688091',false,'left');paintText(`الصفحة ${i+1} من 2`,W-M,H-48,19,'#688091');
  const image=await pdf.embedJpg(canvas.toDataURL('image/jpeg',.96));pdf.addPage([595.28,841.89]).drawImage(image,{x:0,y:0,width:595.28,height:841.89});
 }
 return new Blob([await pdf.save()],{type:'application/pdf'});
}
async function exportPDF(record,button){
 if(pdfExportBusy){notify('يجري تجهيز تقرير PDF. انتظر حتى ينتهي.');return;}
 pdfExportBusy=true;const old=button?.textContent;
 if(button){button.disabled=true;button.textContent='جارٍ تجهيز PDF…';}
 try{
  const blob=await createPDF(record);
  const name=`زيارة-${record.data.customer||'زبون'}-${record.data.date||'تقرير'}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');
  showPDFDownload(blob,`${name}.pdf`);
  notify(db?'تقرير PDF جاهز. اختر طريقة حفظه من النافذة.':'تقرير PDF جاهز. التخزين غير متاح؛ احفظ نسخة من الملف قبل مغادرة الصفحة.',!db);
 }catch(error){notify('تعذّر إنشاء PDF. إجاباتك ما زالت في النموذج؛ حاول مجدداً.',true);}
 finally{pdfExportBusy=false;if(button){button.disabled=false;button.textContent=old;}}
}
$('#pdf').onclick=async()=>{const b=$('#pdf');b.disabled=true;try{const record=await saveReport();if(record)await exportPDF(record,b);}finally{b.disabled=false;}};
async function init(){try{db=await new Promise((resolve,reject)=>{const request=indexedDB.open('iq-customer-visits-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('reports',{keyPath:'id'});request.result.createObjectStore('draft',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('blocked'));});const saved=await tx('reports','readonly',s=>s.getAll());records=saved||[];const draft=await tx('draft','readonly',s=>s.get('current'));if(draft){applyData(draft.data);activeId=draft.activeId;dirty=draft.dirty;$('#draftState').textContent='تم استرجاع المسودة';if(activeId)$('#editorTitle').textContent='تعديل تقرير محفوظ';}renderHistory();}catch{notify('التخزين غير متاح في هذا المتصفح. يمكنك تعبئة النموذج وتنزيل PDF، لكن لن تُحفظ المسودة أو التقارير.',true);}updateProgress();}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty){clearTimeout(timer);writeDraft().catch(()=>{});}});
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'read_visit_form',description:'Read the current customer visit form answers without saving or changing them. All fields are optional.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('Expected an empty object');const d=data();return {answers:{...d,photo:d.photo?'attached':''},allFieldsOptional:true};}})).catch(()=>{});}catch{}}
init();
