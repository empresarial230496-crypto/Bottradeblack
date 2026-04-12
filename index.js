const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const PASSPHRASE = process.env.PASSPHRASE;

app.post('/webhook', async (req, res) => {
    const data = req.body;
    console.log('[INFO] Webhook recibido:', JSON.stringify(data));

    if (data.passphrase !== PASSPHRASE) {
        console.error('[ERROR] Clave incorrecta');
        return res.status(401).send('Error de clave');
    }

    const timestamp = Date.now().toString();
    const payload = JSON.stringify({
        category: "linear", 
        symbol: data.symbol || "BTCUSDT",
        side: data.action === 'buy' ? 'Buy' : 'Sell',
        orderType: "Market",
        qty: "0.001" 
    });

    const signature = crypto.createHmac('sha256', API_SECRET)
        .update(timestamp + API_KEY + "5000" + payload).digest('hex');

    try {
        const response = await axios.post('https://api.bybit.com/v5/order/create', payload, {
            headers: {
                'X-BAPI-API-KEY': API_KEY,
                'X-BAPI-SIGN-HEADER': signature,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': "5000",
                'Content-Type': 'application/json'
            }
        });
        console.log('[SUCCESS] Orden en Bybit:', JSON.stringify(response.data));
        res.status(200).send('Orden ejecutada');
    } catch (e) {
        console.error('[ERROR]', e.response ? e.response.data : e.message);
        res.status(500).send('Error');
    }
});

app.listen(process.env.PORT || 8080, () => console.log('⚡ Bot activo'));
