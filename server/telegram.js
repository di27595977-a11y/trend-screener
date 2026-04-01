import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID  = () => process.env.TELEGRAM_CHAT_ID || '';

export function isTelegramConfigured() {
  return Boolean(BOT_TOKEN() && CHAT_ID());
}

export async function sendTelegram(message, { parseMode = 'HTML' } = {}) {
  const token = BOT_TOKEN();
  const chatId = CHAT_ID();

  if (!token || !chatId) {
    return { ok: false, error: 'Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
      }),
    });

    const data = await response.json();
    return { ok: data.ok, error: data.ok ? null : data.description };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ─── Signal Formatter ────────────────────────────────────────────────────────

export function formatRangeSignal(signal) {
  const side = signal.signalSide === 'long' ? '🟢 做多' : '🔴 做空';
  const levelType = signal.targetLevel.type === 'resistance' ? '壓力' : '支撐';
  const confirm4h = signal.has4hConfirm ? '✅' : '—';

  const lines = [
    `<b>${side} ${signal.symbol}</b>`,
    '',
    `📍 觸及${levelType}位: <code>${signal.targetLevel.price.toPrecision(6)}</code> (×${signal.targetLevel.touches})`,
    `💰 現價: <code>${signal.currentPrice.toPrecision(6)}</code>`,
    `📏 距離: ${signal.proximity.toFixed(3)}%`,
    '',
    `📊 評分: <b>${signal.score}</b>/100`,
    `📈 RSI(14): ${signal.rsi}`,
    `📉 BB寬: ${signal.bbWidth ?? '—'}%`,
    `📦 量比: ${signal.volumeRatio}x`,
    `🕓 4H確認: ${confirm4h}`,
  ];

  if (signal.nearestSupport && signal.nearestResistance) {
    const width = (
      ((signal.nearestResistance.price - signal.nearestSupport.price) / signal.currentPrice) *
      100
    ).toFixed(2);
    lines.push(`📐 區間寬度: ${width}%`);
    lines.push(
      `   支撐 <code>${signal.nearestSupport.price.toPrecision(6)}</code> ~ 壓力 <code>${signal.nearestResistance.price.toPrecision(6)}</code>`,
    );
  }

  lines.push('', `⏰ ${new Date(signal.detectedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);

  return lines.join('\n');
}

// ─── Batch Notify ────────────────────────────────────────────────────────────

export async function notifyRangeSignals(signals, rangeDetector, { logger = console, ignoreCooldown = false } = {}) {
  if (!isTelegramConfigured()) {
    logger.log('[Telegram] Not configured, skipping notifications.');
    return [];
  }

  const sent = [];

  for (const signal of signals) {
    if (!ignoreCooldown && rangeDetector.isOnCooldown(signal.symbol)) continue;

    const message = formatRangeSignal(signal);
    const result = await sendTelegram(message);

    if (result.ok) {
      rangeDetector.markNotified(signal.symbol);
      sent.push(signal.symbol);
      logger.log(`[Telegram] Sent range signal for ${signal.symbol} (${signal.signalSide})`);
    } else {
      logger.warn(`[Telegram] Failed to send for ${signal.symbol}: ${result.error}`);
    }

    // Rate limit: 1 message per second
    await new Promise((r) => setTimeout(r, 1000));
  }

  return sent;
}
