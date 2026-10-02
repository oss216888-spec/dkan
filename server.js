'use strict';
// سيرفر دكّان: بدون مكتبات خارجية (Node 18 أو أحدث). التشغيل: node server.js
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{}
const E=process.env,PORT=+E.PORT||3000;
const C={token:E.WA_TOKEN,phoneId:E.WA_PHONE_ID,verify:E.WA_VERIFY_TOKEN||'dukkan-verify',secret:E.WA_APP_SECRET,ver:E.WA_API_VERSION||'v21.0',
  platform:(E.WA_PLATFORM_PHONE||'967700000000').replace(/\D/g,''),tplStatus:E.WA_TPL_STATUS||'order_status',tplNew:E.WA_TPL_NEW_ORDER||'new_order'};
// الأوضاع: mock = تجريبي (الرسائل تُطبع في الشاشة) | web = واتساب بالباركود (رقم مربوط) | cloud = الـ API الرسمي من Meta
const MODE=/^web$/i.test(E.WA_MODE||'')?'web':(C.token&&C.phoneId?'cloud':'mock');
const MOCK=MODE==='mock';
const DBF=path.join(__dirname,'data.json');
let db={regs:{},orders:{},seen:{}};try{db=Object.assign(db,JSON.parse(fs.readFileSync(DBF,'utf8')));}catch{}
const save=()=>fs.writeFile(DBF,JSON.stringify(db),()=>{});
const D='٠١٢٣٤٥٦٧٨٩',west=s=>String(s||'').replace(/[٠-٩]/g,d=>D.indexOf(d));
// يقبل رقمًا يمنيًا (٧xxxxxxxx → 967) أو سعوديًا (٥xxxxxxxx → 966)، بأي صيغة: محلي، 05…، 00966…، +967…
const phone=p=>{p=west(p).replace(/\D/g,'').replace(/^00/,'').replace(/^0(?=[57]\d{8}$)/,'');if(/^7\d{8}$/.test(p))p='967'+p;else if(/^5\d{8}$/.test(p))p='966'+p;return p;};
const inWindow=p=>Date.now()-(db.seen[p]||0)<24*3600e3;

async function wa(body){
  if(MODE==='web')return webSend(body);
  if(MOCK){console.log('\n[واتساب تجريبي → '+body.to+'] '+(body.text?body.text.body:'قالب '+body.template.name+' '+JSON.stringify(body.template.components[0].parameters.map(x=>x.text))));return{mock:true};}
  try{
    const r=await fetch(`https://graph.facebook.com/${C.ver}/${C.phoneId}/messages`,{method:'POST',headers:{Authorization:'Bearer '+C.token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',...body})});
    const j=await r.json();if(!r.ok)console.error('خطأ واتساب:',JSON.stringify(j));return j;
  }catch(e){console.error('خطأ شبكة:',e.message);}
}
// ---------- واتساب بالباركود (whatsapp-web.js) ----------
let web=null,webReady=false,lastQR=null,webErr='';
// طابور إرسال: رسالة كل ١٫٥ ثانية على الأقل، لتقليل خطر حظر الرقم
let webQ=Promise.resolve();
const webSend=body=>{const p=webQ.then(()=>webSendNow(body));webQ=p.catch(()=>{}).then(()=>new Promise(r=>setTimeout(r,1500)));return p;};
async function webSendNow(body){
  const text=body.text&&body.text.body;
  if(!text)return{error:'unsupported'};
  if(!webReady){console.error('واتساب غير جاهز بعد (امسح الباركود أو انتظر الاتصال)');return{error:'not_ready'};}
  try{
    const id=await web.getNumberId(String(body.to));
    if(!id)return{error:'not_on_whatsapp'};
    await web.sendMessage(id._serialized,text,{sendSeen:false});
    return{ok:true};
  }catch(e){console.error('خطأ إرسال واتساب:',e.message);return{error:e.message};}
}
function startWeb(){
  let lib,qrt;
  try{lib=require('whatsapp-web.js');}catch{webErr='مكتبة whatsapp-web.js غير مثبتة (فشل تثبيتها أثناء البناء)';console.error('\n'+webErr+'. نفّذ: npm install whatsapp-web.js qrcode-terminal\n');return;}
  try{qrt=require('qrcode-terminal');}catch{}
  const boot=()=>web.initialize().catch(e=>{webErr='تعذّر تشغيل واتساب: '+String(e.message).slice(0,300);console.error(webErr);});
  const opts={
    authStrategy:new lib.LocalAuth({dataPath:E.WA_SESSION_DIR||path.join(os.homedir(),'dukkan-session')}),
    puppeteer:{headless:true,executablePath:E.PUPPETEER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--mute-audio']}
  };
  // اختياري: تثبيت نسخة واتساب ويب إذا علق الربط عند التحميل. مثال: WA_WEB_VERSION=2.3000.1017054665-alpha
  if(E.WA_WEB_VERSION)opts.webVersionCache={type:'remote',remotePath:'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/'+E.WA_WEB_VERSION+'.html'};
  web=new lib.Client(opts);
  web.on('qr',q=>{
    lastQR=q;webReady=false;
    // لا نطبع نص الباركود في السجل (أي شخص يرى السجل يستطيع ربط رقمك). افتحه من صفحة /qr
    console.log('\nظهر باركود جديد. افتح /qr?key=مفتاحك في المتصفح وامسحه من واتساب: الأجهزة المرتبطة > ربط جهاز\n');
    if(qrt&&!E.RENDER)qrt.generate(q,{small:true}); // الطباعة في الشاشة فقط عند التشغيل على جهازك
  });
  web.on('authenticated',()=>console.log('تم مسح الباركود (authenticated)، جاري تحميل المحادثات…'));
  web.on('loading_screen',(pct,msg)=>console.log('تحميل واتساب:',pct+'%',msg||''));
  web.on('change_state',st=>console.log('حالة واتساب:',st));
  web.on('auth_failure',m=>{webErr='فشل الربط: '+m;console.error(webErr);});
  web.on('ready',()=>{webReady=true;lastQR=null;webErr='';console.log('واتساب جاهز ✅ ويرسل رموز التحقق والإشعارات.');});
  web.on('disconnected',r=>{webReady=false;console.error('انقطع واتساب:',r,'— إعادة المحاولة بعد ٥ ثوانٍ');setTimeout(()=>web.destroy().catch(()=>{}).finally(boot),5000);});
  web.on('message',async m=>{
    try{
      const from=String(m.from||'');
      if(m.fromMe||m.isStatus||from.endsWith('@g.us'))return;
      let num=from.split('@')[0];
      if(from.endsWith('@lid')){ // معرّف داخلي لواتساب: نحوله لرقم الجوال الحقيقي
        try{const r=await web.getContactLidAndPhone([from]);if(r&&r[0]&&r[0].pn)num=String(r[0].pn).split('@')[0];}catch{}
        if(num===from.split('@')[0]){try{const c=await m.getContact();if(c&&c.number)num=c.number;}catch{}}
      }
      inbound(num,m.body||'');
    }catch(e){console.error(e.message);}
  });
  boot();
}

const sendText=(to,t)=>wa({to,type:'text',text:{body:t}});
const sendTpl=(to,name,ps)=>wa({to,type:'template',template:{name,language:{code:'ar'},components:[{type:'body',parameters:ps.map(t=>({type:'text',text:String(t)}))}]}});
// داخل نافذة ٢٤ ساعة من آخر رسالة للعميل: رسالة عادية (مجانية). خارجها: قالب معتمد (مدفوع).
// حدود لحماية رقمك من الحظر ومن إساءة الاستخدام (قابلة للتعديل من البيئة)
const caps={};
const allow=(k,max,win)=>{const n=Date.now(),a=(caps[k]||[]).filter(t=>n-t<win);if(a.length>=max){caps[k]=a;return false;}a.push(n);caps[k]=a;return true;};
const notify=(to,msg,tpl,ps)=>{
  if(!allow('n:'+to,+E.NOTIFY_PER_NUMBER_HOUR||20,36e5)||!allow('n:*',+E.NOTIFY_GLOBAL_HOUR||300,36e5)){console.warn('تجاوز حد الإرسال، تم تجاهل رسالة إلى',to);return;}
  return(MODE==='web'||inWindow(to))?sendText(to,msg):sendTpl(to,tpl,ps);
};

const STATUS={new:'وصل طلبك للمتجر',review:'بانتظار اعتماد الحوالة',prep:'تم تأكيد طلبك وجارٍ تجهيزه',ship:'تم شحن طلبك',done:'تم تسليم طلبك'};
function inbound(from,txt){
  db.seen[from]=Date.now();txt=west(txt);
  for(const r of Object.values(db.regs)){
    if(r.mode!=='code'&&!r.ok&&r.exp>Date.now()&&phone(r.phone)===from&&txt.includes(r.code)){r.ok=true;sendText(from,'تم تأكيد رقمك في دكّان ✅ ارجع للموقع وكمّل إنشاء متجرك.');}
  }
  const m=txt.match(/طلب\s*#?\s*(\d+)/);
  if(m){const o=Object.values(db.orders).find(x=>x.buyer===from&&String(x.id)===m[1]);if(o)sendText(from,`طلبك #${o.id} من ${o.storeName}: ${STATUS[o.status]||o.status}.`);}
  save();
}
const QR_HTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ربط واتساب</title><body style="font-family:sans-serif;text-align:center;padding:24px;direction:rtl"><h2>ربط واتساب بدكّان</h2><p id="s">جاري التحميل…</p><div id="q" style="display:inline-block;padding:16px;background:#fff"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>var key=new URLSearchParams(location.search).get("key"),last="";async function tick(){try{var d=await(await fetch("/qr/data?key="+encodeURIComponent(key))).json(),s=document.getElementById("s"),q=document.getElementById("q");if(d.mode!=="web"){s.textContent="الوضع الحالي ("+d.mode+") لا يعرض باركود. أضف WA_MODE=web في Environment واحفظ.";q.innerHTML="";}else if(d.err){s.textContent="تعذّر التشغيل: "+d.err;q.innerHTML="";}else if(d.ready){s.textContent="واتساب جاهز ✅";q.innerHTML="";last="";}else if(d.qr){s.textContent="امسح الباركود من واتساب: الأجهزة المرتبطة > ربط جهاز";if(d.qr!==last){last=d.qr;q.innerHTML="";new QRCode(q,{text:d.qr,width:300,height:300});}}else{s.textContent="الوضع: باركود. جاري تشغيل المتصفح الداخلي… (قد يأخذ دقيقة عند أول تشغيل)";}}catch(e){}}tick();setInterval(tick,3000);</script></body>';
const qrKeyOk=k=>{const a=Buffer.from(String(k||'')),b=Buffer.from(String(E.WA_QR_KEY||''));return b.length>=8&&a.length===b.length&&crypto.timingSafeEqual(a,b);};
const key=(s,i)=>s+':'+i;
const routes={
  'GET /api/config':()=>({mock:MOCK,mode:MODE,platformPhone:C.platform}),
  'POST /api/register/start':async(b,q,ctx)=>{
    if(!allow('c:'+ctx.ip,10,600e3)||!allow('c:*',+E.CODE_GLOBAL_10MIN||30,600e3))return[429,{error:'طلبات كثيرة، جرّب بعد قليل.'}];
    const p=phone(b.phone);if(!/^(9677|9665)\d{8}$/.test(p))return[400,{error:'رقم غير صحيح، اكتب رقمًا يمنيًا أو سعوديًا'}];
    const now=Date.now();
    if(Object.values(db.regs).filter(r=>r.phone===p&&now-(r.t||0)<10*60e3).length>=3)return[429,{error:'طلبت رموزًا كثيرة، انتظر ١٠ دقائق ثم جرّب مرة ثانية.'}];
    const id=crypto.randomBytes(8).toString('hex'),code=String(crypto.randomInt(100000,1000000));
    if(MODE==='cloud'){ // الـ API الرسمي: لا نستطيع بدء المحادثة بلا قالب، فالعميل هو من يرسل الرمز
      db.regs[id]={phone:p,code,exp:now+10*60e3,ok:false,t:now};save();
      return{id,mode:'reverse',code,link:`https://wa.me/${C.platform}?text=${encodeURIComponent('رمز التسجيل في دكّان: '+code)}`};
    }
    // تجريبي / باركود: نرسل الرمز لرقمه ويكتبه في الصفحة
    const sent=await sendText(p,`رمز التحقق في دكّان: ${code}\nصالح لمدة ١٠ دقائق. لا تشاركه مع أحد.`);
    if(sent&&sent.error==='not_on_whatsapp')return[400,{error:'هذا الرقم غير مسجّل على واتساب.'}];
    if(sent&&sent.error)return[503,{error:'تعذّر إرسال الرمز الآن، جرّب بعد قليل.'}];
    db.regs[id]={phone:p,code,exp:now+10*60e3,ok:false,tries:0,t:now,mode:'code'};save();
    return{id,mode:'code',mock:MOCK};
  },
  'POST /api/register/verify':b=>{
    const r=db.regs[String(b.id)];
    if(!r||r.mode!=='code'||r.exp<Date.now())return[410,{error:'انتهت صلاحية الرمز، اطلب رمزًا جديدًا.'}];
    if(r.ok)return{ok:true};
    if((r.tries||0)>=5)return[429,{error:'محاولات كثيرة، اطلب رمزًا جديدًا.'}];
    const c=west(b.code).replace(/\D/g,'');r.tries=(r.tries||0)+1;
    if(c.length===r.code.length&&crypto.timingSafeEqual(Buffer.from(c),Buffer.from(r.code))){r.ok=true;save();return{ok:true};}
    save();return[400,{error:`الرمز غير صحيح${r.tries<5?' (تبقّى '+(5-r.tries)+' محاولات)':''}.`}];
  },
  'GET /api/register/status':(b,q)=>{const r=db.regs[q.get('id')];return{ok:!!(r&&r.ok&&r.exp>Date.now())};},
  'POST /api/dev/simulate':b=>{ // للوضع التجريبي فقط: يحاكي وصول رسالة العميل
    if(!MOCK)return[403,{error:'للوضع التجريبي فقط'}];const r=db.regs[b.id];if(!r)return[404,{error:'غير موجود'}];
    inbound(phone(r.phone),'رمز التسجيل في دكّان: '+r.code);return{ok:true};
  },
  'POST /api/orders':b=>{
    const o={store:String(b.store),id:b.id,storeName:String(b.storeName||''),buyer:phone(b.buyerPhone),merchant:phone(b.merchantPhone),total:b.total,summary:String(b.summary||''),city:b.city,pay:b.pay,status:b.status||'new',tName:String(b.transferName||'').slice(0,60),tRef:String(b.transferRef||'').slice(0,40)};
    db.orders[key(o.store,o.id)]=o;save();
    const tr=(o.tName||o.tRef)?`\nاسم المحوِّل: ${o.tName}\nرقم الحوالة: ${o.tRef}`:'';
    if(o.merchant)notify(o.merchant,`طلب جديد #${o.id} في ${o.storeName}\n${o.summary}\nالمدينة: ${o.city}\nالدفع: ${o.pay}${tr}\nالإجمالي: ${o.total}`,C.tplNew,[o.id,o.storeName,o.summary+(tr?' | حوالة '+o.tRef+' باسم '+o.tName:''),o.total,o.city]);
    if(o.buyer){const st=STATUS[o.status]||STATUS.new;notify(o.buyer,`تم استلام طلبك #${o.id} من ${o.storeName}\nالإجمالي: ${o.total}\nالحالة: ${st}\nسنرسل لك هنا أي تحديث على طلبك.`,C.tplStatus,[o.id,o.storeName,st]);}
    return{ok:true};
  },
  'POST /api/orders/status':b=>{
    if(!STATUS[b.status])return[400,{error:'حالة غير صحيحة'}];
    const k2=key(String(b.store),b.id);let o=db.orders[k2];
    if(!o){ // السيرفر نسي الطلب (إعادة تشغيل/قرص مؤقت): نعيد بناءه مما أرسله الموقع
      if(!b.buyerPhone)return[404,{error:'طلب غير معروف'}];
      o=db.orders[k2]={store:String(b.store),id:b.id,storeName:String(b.storeName||''),buyer:phone(b.buyerPhone),status:b.status};
    }
    o.status=b.status;save();const st=STATUS[o.status];
    if(st&&o.buyer)notify(o.buyer,`طلبك #${o.id} من ${o.storeName}: ${st}.`,C.tplStatus,[o.id,o.storeName,st]);
    return{ok:true};
  }
};
const body=req=>new Promise(r=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e6)req.destroy();});req.on('end',()=>r(d));});
const clientIp=req=>String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'';
const hits={};setInterval(()=>{for(const k in hits)delete hits[k];},60e3);
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),k=req.method+' '+u.pathname;
  const out=(c,o,t='application/json; charset=utf-8')=>{res.writeHead(c,{'Content-Type':t});res.end(Buffer.isBuffer(o)||typeof o==='string'?o:JSON.stringify(o));};
  try{
    if(k==='GET /'||k==='GET /index.html'){const f=['index.html','dukkan-demo.html'].map(n=>path.join(__dirname,n)).find(fs.existsSync);return f?out(200,fs.readFileSync(f),'text/html; charset=utf-8'):out(404,'ملف الموقع (index.html) غير موجود في المشروع','text/plain; charset=utf-8');}
    if(k==='GET /qr'||k==='GET /qr/data'){ // صفحة الباركود: محمية بمفتاح WA_QR_KEY لأن أي شخص يمسح الباركود يربط رقمك
      const local=/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress||'')&&!req.headers['x-forwarded-for'];
      if(!local&&!qrKeyOk(u.searchParams.get('key')))return out(403,'ممنوع. اضبط WA_QR_KEY (٨ أحرف فأكثر) وافتح /qr?key=…','text/plain; charset=utf-8');
      return k==='GET /qr'?out(200,QR_HTML,'text/html; charset=utf-8'):out(200,{mode:MODE,ready:webReady,qr:lastQR,err:webErr});
    }
    const ip=clientIp(req);hits[ip]=(hits[ip]||0)+1;if(hits[ip]>120)return out(429,{error:'طلبات كثيرة'});
    if(u.pathname==='/webhook'){
      if(req.method==='GET')return u.searchParams.get('hub.verify_token')===C.verify?out(200,u.searchParams.get('hub.challenge')||'','text/plain'):out(403,'forbidden','text/plain');
      const raw=await body(req);
      if(C.secret){const sig='sha256='+crypto.createHmac('sha256',C.secret).update(raw).digest('hex'),got=String(req.headers['x-hub-signature-256']||'');
        if(got.length!==sig.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(sig)))return out(401,'bad signature','text/plain');}
      out(200,'ok','text/plain');
      for(const e of JSON.parse(raw||'{}').entry||[])for(const c of e.changes||[])for(const m of (c.value&&c.value.messages)||[])inbound(m.from,(m.text&&m.text.body)||'');
      return;
    }
    const h=routes[k];if(!h)return out(404,{error:'غير موجود'});
    const raw=req.method==='POST'?await body(req):'',r=await h(raw?JSON.parse(raw):{},u.searchParams,{ip});
    Array.isArray(r)?out(r[0],r[1]):out(200,r);
  }catch(e){console.error(e);out(500,{error:'خطأ في السيرفر'});}
}).listen(PORT,'0.0.0.0',()=>{
  console.log(`دكّان يشتغل على http://localhost:${PORT}  ${{mock:'(وضع تجريبي: الرسائل تُطبع هنا ولا تُرسل)',web:'(واتساب بالباركود)',cloud:'(واتساب الرسمي Cloud API)'}[MODE]}`);
  if(MODE==='web')startWeb();
});
setInterval(()=>{
  let ch=false;
  for(const k in db.regs)if(db.regs[k].exp<Date.now()-36e5){delete db.regs[k];ch=true;}
  for(const k in db.seen)if(Date.now()-db.seen[k]>30*864e5){delete db.seen[k];ch=true;}
  for(const k in caps){caps[k]=caps[k].filter(t=>Date.now()-t<36e5);if(!caps[k].length)delete caps[k];}
  if(ch)save();
},10*60e3).unref();
