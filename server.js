/**
 * TradeBot — Bybit Server (FIXED v2)
 * Corrige el 404 sirviendo index.html desde la raíz del proyecto
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// ── Sirve archivos estáticos desde la raíz ───────────────
// ESTO CORRIGE EL 404 EN GET /
app.use(express.static(__dirname));

// ─── Config desde .env ───────────────────────────────────
const CONFIG = {
  API_KEY:    process.env.BYBIT_API_KEY    || '',
  API_SECRET: process.env.BYBIT_API_SECRET || '',
  TESTNET:    process.env.TESTNET !== 'false',
  PORT:       process.env.PORT || 3000,
};

console.log(`[CONFIG] Testnet: ${CONFIG.TESTNET}`);
console.log(`[CONFIG] API Key: ${CONFIG.API_KEY ? '✓ OK' : '⚠️ FALTA'}`);

// ─── Bybit Client ─────────────────────────────────────────
let client = null;

function getClient(apiKey, apiSecret, testnet) {
  try {
    const { RestClientV5 } = require('bybit-api');
    return new RestClientV5({ key: apiKey, secret: apiSecret, testnet });
  } catch(e) {
    console.error('Error iniciando cliente Bybit:', e.message);
    return null;
  }
}

if (CONFIG.API_KEY && CONFIG.API_SECRET) {
  client = getClient(CONFIG.API_KEY, CONFIG.API_SECRET, CONFIG.TESTNET);
}

// ─── Bot State ────────────────────────────────────────────
let botState = {
  running: false,
  config: null,
  currentPosition: null,
  stats: { wins: 0, losses: 0, pnl: 0, trades: [] },
  logs: [],
  scanTimer: null,
};

function log(type, msg) {
  const entry = { time: new Date().toLocaleTimeString('es-MX'), type, msg };
  botState.logs.unshift(entry);
  if (botState.logs.length > 100) botState.logs.pop();
  console.log(`[${entry.time}][${type.toUpperCase()}] ${msg}`);
}

// ─── RUTAS ────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), testnet: CONFIG.TESTNET, running: botState.running });
});

// Webhook para señales externas
app.post('/webhook', (req, res) => {
  log('info', `Webhook: ${JSON.stringify(req.body)}`);
  res.json({ ok: true, received: req.body });
});

// Test conexión
app.post('/api/connect', async (req, res) => {
  const { apiKey, apiSecret, testnet } = req.body;
  try {
    const c = getClient(apiKey, apiSecret, testnet);
    if (!c) return res.json({ ok: false, error: 'No se pudo crear cliente Bybit' });
    const result = await c.getWalletBalance({ accountType: 'UNIFIED' });
    if (result.retCode === 0) {
      const balance = result.result?.list?.[0]?.totalEquity || '0';
      client = c;
      log('ok', `✓ Conectado — Balance: ${parseFloat(balance).toFixed(2)} USDT`);
      res.json({ ok: true, balance: parseFloat(balance).toFixed(2) });
    } else {
      log('err', 'API error: ' + result.retMsg);
      res.json({ ok: false, error: result.retMsg });
    }
  } catch (e) {
    log('err', 'Conexión fallida: ' + e.message);
    res.json({ ok: false, error: e.message });
  }
});

// Iniciar bot
app.post('/api/start', (req, res) => {
  const cfg = req.body;
  if (!cfg.apiKey || !cfg.apiSecret) return res.json({ ok: false, error: 'Faltan API keys' });
  if (!cfg.pairs || cfg.pairs.length === 0) return res.json({ ok: false, error: 'Selecciona un par' });

  client = getClient(cfg.apiKey, cfg.apiSecret, cfg.testnet);
  botState.config = cfg;
  botState.running = true;
  botState.stats = { wins: 0, losses: 0, pnl: 0, trades: [] };

  log('ok', `Bot iniciado — ${cfg.testnet ? 'TESTNET' : '⚠️ REAL'}`);
  log('info', `Pares: ${cfg.pairs.join(', ')} | TP:${cfg.tp}% SL:${cfg.sl}% Lev:${cfg.leverage}x`);

  runScan();
  if (botState.scanTimer) clearInterval(botState.scanTimer);
  botState.scanTimer = setInterval(runScan, 2 * 60 * 1000);
  res.json({ ok: true });
});

// Detener bot
app.post('/api/stop', async (req, res) => {
  botState.running = false;
  if (botState.scanTimer) { clearInterval(botState.scanTimer); botState.scanTimer = null; }
  if (botState.currentPosition) {
    await closePosition(botState.currentPosition).catch(() => {});
    botState.currentPosition = null;
  }
  log('warn', '⏹ Bot detenido');
  res.json({ ok: true });
});

// Estado
app.get('/api/status', (req, res) => {
  res.json({
    running: botState.running,
    stats: botState.stats,
    logs: botState.logs.slice(0, 30),
    currentPosition: botState.currentPosition,
  });
});

// Indicadores
app.get('/api/indicators/:pair', async (req, res) => {
  if (!client) return res.json({ ok: false, error: 'Sin conexión API' });
  try {
    const data = await getIndicators(req.params.pair);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Ruta raíz explícita (fallback)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Trading Logic ────────────────────────────────────────

async function runScan() {
  if (!botState.running || !client) return;
  const cfg = botState.config;
  const pair = cfg.pairs[Math.floor(Math.random() * cfg.pairs.length)];
  log('info', `🔍 Analizando ${pair}...`);

  try {
    const { rsi, macd, ema, price } = await getIndicators(pair);
    log('info', `RSI:${rsi.toFixed(1)} MACD:${macd > 0 ? '▲' : '▼'} EMA:${ema.cross}`);

    let signal = null;
    if (rsi < 65 && macd > 0 && ema.cross === 'bullish') signal = 'Buy';
    else if (rsi > 35 && macd < 0 && ema.cross === 'bearish') signal = 'Sell';

    if (!signal) { log('muted', '⏳ Sin señal — 2 min'); return; }
    if (cfg.maxOneTrade && botState.currentPosition) { log('warn', 'Posición abierta — esperando'); return; }

    log('ok', `Señal ${signal === 'Buy' ? '▲ LONG' : '▼ SHORT'} ${pair} @ $${price}`);
    await executeTrade(signal, pair, price);
  } catch (e) {
    log('err', 'Error análisis: ' + e.message);
  }
}

async function getIndicators(pair) {
  const klines = await client.getKline({ category: 'linear', symbol: pair, interval: '15', limit: 60 });
  if (klines.retCode !== 0) throw new Error(klines.retMsg);
  const closes = klines.result.list.map(c => parseFloat(c[4])).reverse();
  const price = closes[closes.length - 1];
  const rsi = calcRSI(closes, 14);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const macd = calcMACD(closes);
  return { rsi, macd, price, ema: { ema20, ema50, cross: ema20 > ema50 ? 'bullish' : 'bearish' } };
}

async function executeTrade(side, symbol, price) {
  const cfg = botState.config;
  const qty = Math.max(0.001, Math.round((cfg.tradeSize * cfg.leverage / price) * 1000) / 1000);
  const tp = (price * (1 + (side === 'Buy' ? 1 : -1) * cfg.tp / 100)).toFixed(2);
  const sl = (price * (1 + (side === 'Buy' ? -1 : 1) * cfg.sl / 100)).toFixed(2);

  try {
    await client.setLeverage({ category: 'linear', symbol, buyLeverage: String(cfg.leverage), sellLeverage: String(cfg.leverage) });
    const order = await client.submitOrder({
      category: 'linear', symbol, side, orderType: 'Market', qty: String(qty),
      takeProfit: String(tp), stopLoss: String(sl),
      tpTriggerBy: 'LastPrice', slTriggerBy: 'LastPrice',
    });
    if (order.retCode !== 0) { log('err', `Orden error: ${order.retMsg}`); return; }
    botState.currentPosition = { orderId: order.result.orderId, symbol, side, entry: price, qty, tp, sl };
    log('ok', `✅ ${side} ${symbol} qty:${qty} TP:$${tp} SL:$${sl}`);
    monitorPosition(botState.currentPosition);
  } catch (e) {
    log('err', `Trade error: ${e.message}`);
  }
}

async function monitorPosition(pos) {
  const monitor = setInterval(async () => {
    if (!botState.running || !botState.currentPosition) { clearInterval(monitor); return; }
    try {
      const r = await client.getPositionInfo({ category: 'linear', symbol: pos.symbol });
      const p = r.result?.list?.find(x => x.symbol === pos.symbol);
      if (!p || parseFloat(p.size) === 0) {
        const pnl = parseFloat(p?.cumRealisedPnl || 0);
        botState.stats.pnl += pnl;
        if (pnl >= 0) { botState.stats.wins++; log('ok', `✅ TP — +${pnl.toFixed(3)} USDT`); }
        else { botState.stats.losses++; log('err', `❌ SL — ${pnl.toFixed(3)} USDT`); }
        botState.stats.trades.unshift({ side: pos.side, symbol: pos.symbol, pnl, time: new Date().toLocaleTimeString() });
        botState.currentPosition = null;
        clearInterval(monitor);
      }
    } catch (e) { /* silent */ }
  }, 15000);
}

async function closePosition(pos) {
  try {
    await client.submitOrder({
      category: 'linear', symbol: pos.symbol,
      side: pos.side === 'Buy' ? 'Sell' : 'Buy',
      orderType: 'Market', qty: String(pos.qty), reduceOnly: true,
    });
    log('warn', `Posición ${pos.symbol} cerrada`);
  } catch (e) { log('err', `Error cierre: ${e.message}`); }
}

// ─── Math ─────────────────────────────────────────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = (gains / period) / (losses / period || 0.001);
  return 100 - (100 / (1 + rs));
}
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}
function calcMACD(closes) { return calcEMA(closes, 12) - calcEMA(closes, 26); }

// ─── Start ────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`\n⚡ TradeBot corriendo en puerto ${CONFIG.PORT}\n`);
});

module.exports = app;
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// El bot lee tus llaves desde las variables de Railway que ya configuraste
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const WEBHOOK_PASSPHRASE = process.env.PASSPHRASE; 
const BYBIT_URL = 'https://api.bybit.com'; // Cambiar a api-testnet.bybit.com si usas testnet

function createSignature(params, secret) {
    return crypto.createHmac('sha256', secret).update(params).digest('hex');
}

app.post('/webhook', async (req, res) => {
    const data = req.body;
    console.log('[INFO] Webhook recibido:', JSON.stringify(data));

    // VALIDACIÓN DE SEGURIDAD
    if (data.passphrase !== WEBHOOK_PASSPHRASE) {
        console.error('[ERROR] Passphrase incorrecta');
        return res.status(401).send('No autorizado');
    }

    // PREPARACIÓN DE LA ORDEN PARA BYBIT (V5)
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const payload = JSON.stringify({
        category: "linear", // Para futuros/perpetuos. Cambiar a "spot" si es cuenta spot.
        symbol: data.symbol || "BTCUSDT",
        side: data.action === 'buy' ? 'Buy' : 'Sell',
        orderType: "Market",
        qty: data.quantity.toString()
    });

    const paramStr = timestamp + API_KEY + recvWindow + payload;
    const signature = createSignature(paramStr, API_SECRET);

    // ENVÍO DE LA ORDEN A BYBIT
    try {
        const response = await axios.post(`${BYBIT_URL}/v5/order/create`, payload, {
            headers: {
                'X-BAPI-API-KEY': API_KEY,
                'X-BAPI-SIGN-HEADER': signature,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': recvWindow,
                'Content-Type': 'application/json'
            }
        });

        // ESTO ES LO QUE BUSCAS: La respuesta de Bybit en tus logs
        console.log('[SUCCESS] Respuesta de Bybit:', JSON.stringify(response.data));
        res.status(200).json(response.data);
    } catch (error) {
        console.error('[ERROR] Fallo en Bybit:', error.response ? error.response.data : error.message);
        res.status(500).send('Error en la ejecución');
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`⚡ TradeBot activo en puerto ${PORT}`));
