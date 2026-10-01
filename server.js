const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');// سيرفر دكّان: بدون مكتبات خارجية (Node 18 أو أحدث). التشغيل: node server.js
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{}
const E=process.env,PORT=+E.PORT||3000;
const C={token:E.WA_TOKEN,phoneId:E.WA_PHONE_ID,verify:E.WA_VERIFY_TOKEN||'dukkan-verify',secret:E.WA_APP_SECRET,ver:E.WA_API_VERSION||'v21.0',
  platform:(E.WA_PLATFORM_PHONE||'967700000000').replace(/\D/g,''),tplStatus:E.WA_TPL_STATUS||'order_status',tplNew:E.WA_TPL_NEW_ORDER||'new_order'};
// الأوضاع: mock = تجريبي (الرسائل تُطبع في الشاشة) | web = واتساب بالباركود (رقم مربوط) | cloud = الـ API الرسمي من Meta

const MODE = 'web';
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
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process'
        ]
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('=== امسحي هذا الباركود عبر الواتساب للربط ===');
});

client.on('ready', () => {
    console.log('=== تم ربط الواتساب بنجاح! السيرفر جاهز ===');
});
client.on('message', async (msg) => {
    if (msg.fromMe || msg.isStatus || !msg.from.endsWith('@c.us')) return;
    inbound(msg.from, msg.body);
});
client.initialize();
// دالة إرسال الرسائل عبر واتساب المربوط بالباركود
async function webSend(body) {
    try {
        const chatId = body.to.includes('@c.us') ? body.to : `${body.to.replace(/\D/g, '')}@c.us`;
        const text = body.text || body.text?.body || body.message || '';
        await client.sendMessage(chatId, text);
        console.log(`تم إرسال الرسالة بنجاح إلى: ${chatId}`);
        return { status: 'success' };
    } catch (error) {
        console.error('خطأ في إرسال الرسالة عبر الواتساب:', error);
        return { error: error.message };
    }
}


const sendText=(to,t)=>wa({to,type:'text',text:{body:t}});
const sendTpl=(to,name,ps)=>wa({to,type:'template',template:{name,language:{code:'ar'},components:[{type:'body',parameters:ps.map(t=>({type:'text',text:String(t)}))}]}});
// داخل نافذة ٢٤ ساعة من آخر رسالة للعميل: رسالة عادية (مجانية). خارجها: قالب معتمد (مدفوع).
const notify=(to,msg,tpl,ps)=>(MODE==='web'||inWindow(to))?sendText(to,msg):sendTpl(to,tpl,ps);

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
const key=(s,i)=>s+':'+i;
const routes={
  'GET /api/config':()=>({mock:MOCK,mode:MODE,platformPhone:C.platform}),
  'POST /api/register/start':async b=>{
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
    const o=db.orders[key(String(b.store),b.id)];if(!o)return[404,{error:'طلب غير معروف'}];
    o.status=b.status;save();const st=STATUS[o.status];
    if(st&&o.buyer)notify(o.buyer,`طلبك #${o.id} من ${o.storeName}: ${st}.`,C.tplStatus,[o.id,o.storeName,st]);
    return{ok:true};
  }
};
const body=req=>new Promise(r=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e6)req.destroy();});req.on('end',()=>r(d));});
const hits={};setInterval(()=>{for(const k in hits)delete hits[k];},60e3);
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),k=req.method+' '+u.pathname;
  const out=(c,o,t='application/json; charset=utf-8')=>{res.writeHead(c,{'Content-Type':t});res.end(Buffer.isBuffer(o)||typeof o==='string'?o:JSON.stringify(o));};
  try{
    if(k==='GET /'||k==='GET /index.html')return out(200,fs.readFileSync(path.join(__dirname,'index.html.html')),'text/html; charset=utf-8');
    const ip=req.socket.remoteAddress;hits[ip]=(hits[ip]||0)+1;if(hits[ip]>120)return out(429,{error:'طلبات كثيرة'});
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
    const raw=req.method==='POST'?await body(req):'',r=await h(raw?JSON.parse(raw):{},u.searchParams);
    Array.isArray(r)?out(r[0],r[1]):out(200,r);
  }catch(e){console.error(e);out(500,{error:'خطأ في السيرفر'});}
}).listen(PORT,()=>{
  console.log(`دكّان يشتغل على http://localhost:${PORT}  ${{mock:'(وضع تجريبي: الرسائل تُطبع هنا ولا تُرسل)',web:'(واتساب بالباركود)',cloud:'(واتساب الرسمي Cloud API)'}[MODE]}`);
});
setInterval(()=>{let ch=false;for(const k in db.regs)if(db.regs[k].exp<Date.now()-36e5){delete db.regs[k];ch=true;}if(ch)save();},10*60e3).unref();
