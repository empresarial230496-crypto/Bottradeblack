require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const API_KEY    = process.env.API_KEY    || process.env.BIBYT_API_KEY    || '';
const API_SECRET = process.env.API_SECRET || process.env.BIBYT_API_SECRET || '';
const PASSPHRASE = process.env.PASSPHRASE || '';
const TESTNET    = process.env.TESTNET !== 'false';
const PORT       = process.env.PORT || 8080;

const BASE_URL = TESTNET
  ? 'https://api-testnet.bybit.com'
  : 'https://api.bybit.com';

console.log(`[CONFIG] Testnet: ${false}`);
console.log(`[CONFIG] API Key: ${ps0SaqEpyqnmHeoI8X ? '✓ OK' : '⚠️  FALTA'}`);
console.log(`[CONFIG] Base URL: ${BASE_URL}`);

function bybitHeaders(payload) {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const signStr    = timestamp + API_KEY + recvWindow + payload;
  const signature  = crypto
    .createHmac('sha256', API_SECRET)
    .update(signStr)
    .digest('hex');
  return {
    'Content-Type':       'application/json',
    'X-BAPI-API-KEY':     API_KEY,
    'X-BAPI-TIMESTAMP':   timestamp,
    'X-BAPI-RECV-WINDOW': recvWindow,
    'X-BAPI-SIGN':        signature,
  };
}

async function placeOrder(orderParams) {
  const payload  = JSON.stringify(orderParams);
  const response = await axios.post(
    `${BASE_URL}/v5/order/create`,
    payload,
    { headers: bybitHeaders(payload) }
  );
  return response.data;
}

async function getBalanceData() {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const queryStr   = 'accountType=UNIFIED';
  const signStr    = timestamp + API_KEY + recvWindow + queryStr;
  const signature  = crypto
    .createHmac('sha256', API_SECRET)
    .update(signStr)
    .digest('hex');
  const response = await axios.get(
    `${BASE_URL}/v5/account/wallet-balance?${queryStr}`,
    { headers: {
        'X-BAPI-API-KEY':     API_KEY,
        'X-BAPI-TIMESTAMP':   timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN':        signature,
    }}
  );
  return response.data;
}

const botState = {
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

app.get('/', (_, res) =>
  res.sendFile(path.join(__dirname, 'index.html'))
);

app.get('/health', (_, res) =>
  res.json({ ok: true, uptime: process.uptime(), testnet: TESTNET, running: botState.running })
);

app.get('/api/status', (_, res) =>
  res.json({
    running: botState.running,
    stats: botState.stats,
    logs: botState.logs.slice(0, 30),
    currentPosition: botState.currentPosition,
  })
);

app.post('/api/connect', async (req, res) => {
  try {
    const result = await getBalanceData();
    if (result.retCode === 0) {
      const balance = result.result?.list?.[0]?.totalEquity || '0';
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

// ── Webhook desde TradingView ─────────────────────────────
app.post('/webhook', async (req, res) => {
  const data = req.body;
  log('info', `Webhook recibido: ${JSON.stringify(data)}`);

  if (PASSPHRASE && data.passphrase !== PASSPHRASE) {
    log('err', 'Passphrase incorrecta');
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  if (!API_KEY || !API_SECRET) {
    log('err', 'API Key falta');
    return res.status(500).json({ ok: false, error: 'API Key no configurada' });
  }

  log('info', `Intentando orden: ${data.action} ${data.symbol} qty:${data.quantity}`);

  try {
    const orderPayload = {
      category:  'linear',
      symbol:    data.symbol || 'BTCUSDT',
      side:      data.action === 'buy' ? 'Buy' : 'Sell',
      orderType: 'Market',
      qty:       String(data.quantity || '0.001'),
    };
    log('info', `Payload: ${JSON.stringify(orderPayload)}`);

    const result = await placeOrder(orderPayload);
    log('info', `Respuesta Bybit: ${JSON.stringify(result)}`);

    if (result.retCode === 0) {
      log('ok', `✅ Orden ejecutada — ID: ${result.result?.orderId}`);
      res.json({ ok: true, orderId: result.result?.orderId });
    } else {
      log('err', `Bybit rechazó: ${result.retMsg} (code: ${result.retCode})`);
      res.json({ ok: false, error: result.retMsg, code: result.retCode });
    }
  } catch (e) {
    const errDetail = JSON.stringify({
      msg: e.message,
      status: e.response?.status,
      bybit: e.response?.data,
    });
    log('err', `EXCEPCION: ${errDetail}`);
    res.status(500).json({ ok: false, error: errDetail });
  }
});

app.post('/api/start', (req, res) => {
  const cfg = req.body;
  if (!API_KEY || !API_SECRET)
    return res.json({ ok: false, error: 'Faltan API keys en Railway Variables' });
  if (!cfg.pairs?.length)
    return res.json({ ok: false, error: 'Selecciona al menos un par' });

  botState.config  = cfg;
  botState.running = true;
  botState.stats   = { wins: 0, losses: 0, pnl: 0, trades: [] };

  log('ok', `Bot iniciado — ${TESTNET ? 'TESTNET' : '⚠️  REAL'}`);
  log('info', `Pares: ${cfg.pairs.join(', ')} | TP:${cfg.tp}% SL:${cfg.sl}% Lev:${cfg.leverage}x`);

  runScan();
  if (botState.scanTimer) clearInterval(botState.scanTimer);
  botState.scanTimer = setInterval(runScan, 2 * 60 * 1000);
  res.json({ ok: true });
});

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

async function runScan() {
  if (!botState.running) return;
  const cfg  = botState.config;
  const pair = cfg.pairs[Math.floor(Math.random() * cfg.pairs.length)];
  log('info', `🔍 Analizando ${pair}...`);

  try {
    const { rsi, macd, ema, price } = await getIndicators(pair);
    log('info', `RSI:${rsi.toFixed(1)} MACD:${macd > 0 ? '▲' : '▼'} EMA:${ema.cross}`);

    let signal = null;
    if      (rsi < 65 && macd > 0 && ema.cross === 'bullish') signal = 'Buy';
    else if (rsi > 35 && macd < 0 && ema.cross === 'bearish') signal = 'Sell';

    if (!signal) { log('muted', '⏳ Sin señal — 2 min'); return; }
    if (cfg.maxOneTrade && botState.currentPosition) {
      log('warn', 'Posición abierta — esperando cierre'); return;
    }

    log('ok', `Señal ${signal === 'Buy' ? '▲ LONG' : '▼ SHORT'} ${pair} @ $${price}`);
    await executeTrade(signal, pair, price);
  } catch (e) {
    log('err', 'Error análisis: ' + e.message);
  }
}

async function getIndicators(pair) {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const queryStr   = `category=linear&symbol=${pair}&interval=15&limit=60`;
  const signStr    = timestamp + API_KEY + recvWindow + queryStr;
  const signature  = crypto
    .createHmac('sha256', API_SECRET)
    .update(signStr)
    .digest('hex');

  const r = await axios.get(`${BASE_URL}/v5/market/kline?${queryStr}`, {
    headers: {
      'X-BAPI-API-KEY':     API_KEY,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN':        signature,
    }
  });

  if (r.data.retCode !== 0) throw new Error(r.data.retMsg);
  const closes = r.data.result.list.map(c => parseFloat(c[4])).reverse();
  const price  = closes[closes.length - 1];
  const rsi    = calcRSI(closes, 14);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const macd   = calcMACD(closes);
  return { rsi, macd, price, ema: { ema20, ema50, cross: ema20 > ema50 ? 'bullish' : 'bearish' } };
}

async function executeTrade(side, symbol, price) {
  const cfg = botState.config;
  const qty = Math.max(0.001, Math.round((cfg.tradeSize * cfg.leverage / price) * 1000) / 1000);
  const tp  = (price * (1 + (side === 'Buy' ?  1 : -1) * cfg.tp / 100)).toFixed(2);
  const sl  = (price * (1 + (side === 'Buy' ? -1 :  1) * cfg.sl / 100)).toFixed(2);

  try {
    await placeOrder({
      category: 'linear', symbol,
      buyLeverage: String(cfg.leverage),
      sellLeverage: String(cfg.leverage),
    });
  } catch (_) {}

  const result = await placeOrder({
    category: 'linear', symbol, side,
    orderType:   'Market',
    qty:         String(qty),
    takeProfit:  String(tp),
    stopLoss:    String(sl),
    tpTriggerBy: 'LastPrice',
    slTriggerBy: 'LastPrice',
  });

  if (result.retCode !== 0) {
    log('err', `Orden rechazada: ${result.retMsg}`);
    return;
  }

  botState.currentPosition = {
    orderId: result.result.orderId,
    symbol, side, entry: price, qty, tp, sl,
  };
  log('ok', `✅ ${side} ${symbol} qty:${qty} TP:$${tp} SL:$${sl}`);
  monitorPosition(botState.currentPosition);
}

async function monitorPosition(pos) {
  const monitor = setInterval(async () => {
    if (!botState.running || !botState.currentPosition) {
      clearInterval(monitor); return;
    }
    try {
      const timestamp  = Date.now().toString();
      const recvWindow = '5000';
      const queryStr   = `category=linear&symbol=${pos.symbol}`;
      const signStr    = timestamp + API_KEY + recvWindow + queryStr;
      const signature  = crypto
        .createHmac('sha256', API_SECRET)
        .update(signStr)
        .digest('hex');

      const r = await axios.get(`${BASE_URL}/v5/position/list?${queryStr}`, {
        headers: {
          'X-BAPI-API-KEY':     API_KEY,
          'X-BAPI-TIMESTAMP':   timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'X-BAPI-SIGN':        signature,
        }
      });

      const p = r.data.result?.list?.find(x => x.symbol === pos.symbol);
      if (!p || parseFloat(p.size) === 0) {
        const pnl = parseFloat(p?.cumRealisedPnl || 0);
        botState.stats.pnl += pnl;
        pnl >= 0 ? botState.stats.wins++ : botState.stats.losses++;
        log(pnl >= 0 ? 'ok' : 'err',
          `${pnl >= 0 ? '✅ TP' : '❌ SL'} — ${pnl.toFixed(3)} USDT`);
        botState.stats.trades.unshift({
          side: pos.side, symbol: pos.symbol,
          pnl, time: new Date().toLocaleTimeString(),
        });
        botState.currentPosition = null;
        clearInterval(monitor);
      }
    } catch (_) {}
  }, 15000);
}

async function closePosition(pos) {
  try {
    await placeOrder({
      category:  'linear',
      symbol:    pos.symbol,
      side:      pos.side === 'Buy' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty:       String(pos.qty),
      reduceOnly: true,
    });
    log('warn', `Posición ${pos.symbol} cerrada`);
  } catch (e) {
    log('err', `Error cierre: ${e.message}`);
  }
}

app.get('/api/indicators/:pair', async (req, res) => {
  try {
    const data = await getIndicators(req.params.pair);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

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
  for (let i = 1; i < closes.length; i++)
    ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes) {
  return calcEMA(closes, 12) - calcEMA(closes, 26);
}

app.listen(PORT, () =>
  console.log(`\n⚡ TradeBot corriendo en puerto ${PORT} — ${TESTNET ? 'TESTNET' : 'REAL'}\n`)
);

module.exports = app;
