# ⚡ TradeBot — Bybit Auto

Bot de trading automático que sigue tendencias usando **EMA + RSI + MACD**.
Opera en Bybit cada 2 minutos buscando Largos y Cortos.

---

## ⚠️ ADVERTENCIA DE RIESGO

> El trading con apalancamiento puede resultar en la pérdida total del capital.
> Empieza SIEMPRE con Testnet. Nunca inviertas más de lo que puedas perder.

---

## 🚀 Deploy en Railway (desde tu celular)

### Paso 1 — Prepara el código
1. Crea una cuenta en **GitHub** (github.com) desde tu celular
2. Crea un repositorio nuevo llamado `tradebot`
3. Sube estos archivos: `server.js`, `package.json`, `index.html`

### Paso 2 — Deploy en Railway
1. Abre **railway.app** en tu celular
2. Crea cuenta gratis con GitHub
3. Toca "New Project" → "Deploy from GitHub Repo"
4. Selecciona tu repo `tradebot`
5. Railway detecta automáticamente que es Node.js

### Paso 3 — Variables de entorno
En Railway, ve a tu proyecto → "Variables" y agrega:
```
BYBIT_API_KEY     = tu_api_key
BYBIT_API_SECRET  = tu_api_secret
TESTNET           = true
```

### Paso 4 — Genera un dominio
En Railway → "Settings" → "Generate Domain"
Obtendrás una URL como: `https://tradebot-xxx.railway.app`

¡Abre esa URL desde tu celular y controla el bot!

---

## 🔑 Cómo obtener API Keys de Bybit Testnet

1. Ve a **testnet.bybit.com** → Crear cuenta
2. Perfil → "API" → "Crear nueva API Key"
3. Permisos necesarios: ✅ Trading ✅ Wallet (lectura)
4. Guarda la Key y Secret

---

## 📊 Estrategia

El bot analiza cada 2 minutos con velas de 15 minutos:

| Condición | Señal |
|-----------|-------|
| RSI < 65 + MACD ▲ + EMA20 > EMA50 | **LONG ▲** |
| RSI > 35 + MACD ▼ + EMA20 < EMA50 | **SHORT ▼** |
| Cualquier otra combinación | Sin señal |

---

## 📁 Estructura
```
tradebot/
├── server.js       ← Backend Node.js (lógica del bot)
├── index.html      ← Dashboard móvil (mueve a /public/index.html)
├── package.json    ← Dependencias
└── .env.example    ← Template de variables (renombra a .env)
```

**Nota:** Mueve `index.html` a una carpeta `public/` dentro del proyecto.

---

## 🛠️ Correr local (si tienes PC)

```bash
npm install
cp .env.example .env
# edita .env con tus API keys
npm start
```

Abre: http://localhost:3000
