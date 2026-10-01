const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
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
    // inbound logic
});

client.initialize();

app.get('/', (req, res) => {
    res.send('دكان اشتغل بنجاح');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});