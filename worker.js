'use strict';
// عامل واتساب لدكّان: يقرأ طابور الرسائل من Supabase ويرسلها عبر واتساب. يشتغل على حاسبك.
// لا يستقبل اتصالات من الإنترنت: يتصل بـSupabase وبواتساب فقط.
const fs=require('fs'),os=require('os'),path=require('path');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{}
const E=process.env;
const BASE=(E.SUPABASE_URL||'').replace(/\/$/,''),KEY=E.SUPABASE_SERVICE_KEY||'';
const MODE=/^mock$/i.test(E.WORKER_MODE||'')?'mock':'web';
if(!BASE||!KEY){console.error('\nاملأ SUPABASE_URL و SUPABASE_SERVICE_KEY في ملف .env (انسخه من .env.example)\n');process.exit(1);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rest(p,opt={}){
  const r=await fetch(BASE+'/rest/v1/'+p,{...opt,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(opt.headers||{})}});
  const t=await r.text();let j=null;try{j=t?JSON.parse(t):null;}catch{}
  if(!r.ok)throw new Error(r.status+' '+t.slice(0,200));return j;
}
const patch=(id,b)=>rest(`outbox?id=eq.${id}`,{method:'PATCH',body:JSON.stringify(b)});

// ---------- واتساب ----------
let client=null,ready=MODE==='mock';
async function send(to,text){
  if(MODE==='mock'){console.log(`\n[واتساب تجريبي → ${to}]\n${text}`);return;}
  if(!ready)throw new Error('not_ready');
  const id=await client.getNumberId(String(to));
  if(!id){const e=new Error('not_on_whatsapp');e.perm=true;throw e;}
  await client.sendMessage(id._serialized,text,{sendSeen:false});
}
function startWeb(){
  let lib,qrt;
  try{lib=require('whatsapp-web.js');}catch{console.error('\nنفّذ أولًا:  npm install\n');process.exit(1);}
  try{qrt=require('qrcode-terminal');}catch{}
  const boot=()=>client.initialize().catch(e=>console.error('تعذّر تشغيل واتساب:',e.message));
  client=new lib.Client({
    authStrategy:new lib.LocalAuth({dataPath:E.WA_SESSION_DIR||path.join(os.homedir(),'dukkan-session')}),
    puppeteer:{headless:true,executablePath:E.PUPPETEER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']}
  });
  client.on('qr',q=>{console.log('QR_CODE_READY:',q);console.log('\nامسح الباركود من واتساب جوال المنصة: الأجهزة المرتبطة > ربط جهاز\n');if(qrt)qrt.generate(q,{small:true});});
  client.on('authenticated',()=>console.log('تم الربط، جاري التشغيل…'));
  client.on('auth_failure',m=>console.error('فشل الربط:',m));
  client.on('ready',()=>{ready=true;console.log('واتساب جاهز ✅ العامل يرسل الآن رسائل الطابور.');});
  client.on('disconnected',r=>{ready=false;console.error('انقطع واتساب:',r,'— إعادة المحاولة بعد ٥ ثوانٍ');setTimeout(()=>client.destroy().catch(()=>{}).finally(boot),5000);});
  // العميل يرسل «طلب #123» فيرد عليه العامل بحالة الطلب
  client.on('message',async m=>{
    try{
      const from=String(m.from||'');
      if(m.fromMe||m.isStatus||from.endsWith('@g.us'))return;
      let num=from.split('@')[0];
      if(from.endsWith('@lid')){const c=await m.getContact();if(c&&c.number)num=c.number;}
      const x=String(m.body||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/طلب\s*#?\s*(\d+)/);
      if(!x)return;
      const t=await rest('rpc/buyer_order_status',{method:'POST',body:JSON.stringify({p_phone:num,p_no:+x[1]})});
      if(t)await send(num,t);
    }catch(e){console.error(e.message);}
  });
  boot();
}

// ---------- الطابور ----------
let busy=false;
async function tick(){
  if(busy||!ready)return;busy=true;
  try{
    const rows=await rest('outbox?status=eq.pending&tries=lt.5&order=id.asc&limit=10');
    for(const r of rows||[]){
      const c=await rest(`outbox?id=eq.${r.id}&status=eq.pending`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'sending'})});
      if(!c||!c.length)continue; // أخذه عامل آخر
      try{await send(r.to_phone,r.body);await patch(r.id,{status:'sent',sent_at:new Date().toISOString(),error:null});}
      catch(e){
        const t=(r.tries||0)+1;
        await patch(r.id,{status:(e.perm||t>=5)?'failed':'pending',tries:t,error:String(e.message).slice(0,200)});
        console.error(`تعذّر إرسال الرسالة ${r.id} إلى ${r.to_phone}: ${e.message}`);
      }
      await sleep(1500); // فاصل بين الرسائل لتقليل خطر الحظر
    }
  }catch(e){console.error('خطأ في قراءة الطابور:',e.message);}
  finally{busy=false;}
}
(async()=>{
  console.log(`عامل دكّان يشتغل (${MODE==='mock'?'وضع تجريبي: الرسائل تُطبع ولا تُرسل':'واتساب بالباركود'})`);
  try{await rest('outbox?status=eq.sending',{method:'PATCH',body:JSON.stringify({status:'pending'})});}catch(e){console.error('تعذّر الاتصال بـSupabase:',e.message);}
  if(MODE==='web')startWeb();
  setInterval(tick,3000);
  setInterval(()=>rest(`outbox?status=in.(sent,failed)&created_at=lt.${new Date(Date.now()-7*864e5).toISOString()}`,{method:'DELETE'}).catch(()=>{}),6*3600e3).unref();
})();
