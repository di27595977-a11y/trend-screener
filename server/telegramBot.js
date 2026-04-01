import { sendTelegram, isTelegramConfigured, formatRangeSignal } from './telegram.js';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID || '';
const POLL_INTERVAL = 3000;

let lastUpdateId = 0;
let pollTimer = null;

// ─── Telegram API helpers ────────────────────────────────────────────────────

async function callTelegram(method, body = {}) {
  const token = BOT_TOKEN();
  if (!token) return null;

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return response.json();
}

async function getUpdates() {
  return callTelegram('getUpdates', {
    offset: lastUpdateId + 1,
    timeout: 2,
    allowed_updates: ['message', 'callback_query'],
  });
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  return callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function sendMessageWithButtons(chatId, text, buttons) {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function editMessageText(chatId, messageId, text, buttons) {
  return callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
  });
}

// ─── Main Menu ───────────────────────────────────────────────────────────────

const MAIN_BUTTONS = [
  [
    { text: '📊 1H 區間訊號', callback_data: 'range_1h' },
    { text: '📊 4H 區間訊號', callback_data: 'range_4h' },
  ],
  [
    { text: '🔄 重新掃描 1H', callback_data: 'scan_1h' },
    { text: '🔄 重新掃描 4H', callback_data: 'scan_4h' },
  ],
];

function formatSignalList(signals, timeframe) {
  if (!signals.length) {
    return `📭 <b>${timeframe.toUpperCase()} 區間偵測</b>\n\n目前沒有觸及壓力/支撐的幣種。`;
  }

  const header = `📊 <b>${timeframe.toUpperCase()} 區間訊號</b> — ${signals.length} 個\n`;
  const lines = signals.slice(0, 8).map((s) => {
    const side = s.signalSide === 'long' ? '🟢' : '🔴';
    const dir = s.signalSide === 'long' ? '做多' : '做空';
    const confirm = s.has4hConfirm ? ' ✦' : '';
    return `${side} <b>${s.symbol}</b> ${dir} ${s.score}分${confirm}\n   ${s.targetLevel.type === 'resistance' ? '壓力' : '支撐'} <code>${s.targetLevel.price.toPrecision(6)}</code> ×${s.targetLevel.touches} · RSI ${s.rsi}`;
  });

  const footer = signals.length > 8 ? `\n\n...還有 ${signals.length - 8} 個` : '';
  const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

  return `${header}\n${lines.join('\n\n')}${footer}\n\n⏰ ${ts}`;
}

// ─── Command / Callback Handlers ─────────────────────────────────────────────

export function startTelegramBot(rangeDetector, { logger = console } = {}) {
  if (!isTelegramConfigured()) {
    logger.log('[TG Bot] Not configured, skipping.');
    return;
  }

  logger.log('[TG Bot] Starting polling...');

  // Send menu on startup
  sendMessageWithButtons(
    CHAT_ID(),
    '🤖 <b>Trend Screener 區間偵測</b>\n\n按下方按鈕查詢目前的 S/R 訊號：',
    MAIN_BUTTONS,
  ).then(() => logger.log('[TG Bot] Menu sent.'));

  async function handleUpdate(update) {
    try {
      // Handle /range command
      if (update.message?.text) {
        const text = update.message.text.trim();
        const chatId = update.message.chat.id;

        if (text === '/range' || text === '/range@' + (await getBotUsername())) {
          const signals = rangeDetector.getSignals();
          await sendMessageWithButtons(chatId, formatSignalList(signals, '1h'), MAIN_BUTTONS);
        }

        if (text === '/start' || text === '/menu') {
          await sendMessageWithButtons(chatId, '🤖 <b>Trend Screener 區間偵測</b>\n\n按下方按鈕查詢：', MAIN_BUTTONS);
        }
      }

      // Handle button callbacks
      if (update.callback_query) {
        const cb = update.callback_query;
        const data = cb.data;
        const chatId = cb.message?.chat?.id;
        const msgId = cb.message?.message_id;

        if (data === 'range_1h' || data === 'range_4h') {
          const tf = data === 'range_4h' ? '4h' : '1h';
          await answerCallbackQuery(cb.id, `查詢 ${tf.toUpperCase()} 訊號...`);
          const signals = rangeDetector.getSignals();
          const text = formatSignalList(signals, tf);

          if (msgId) {
            await editMessageText(chatId, msgId, text, MAIN_BUTTONS);
          } else {
            await sendMessageWithButtons(chatId, text, MAIN_BUTTONS);
          }
        }

        if (data === 'scan_1h' || data === 'scan_4h') {
          const tf = data === 'scan_4h' ? '4h' : '1h';
          await answerCallbackQuery(cb.id, `掃描 ${tf.toUpperCase()} 中...`);

          if (msgId) {
            await editMessageText(chatId, msgId, `🔄 正在掃描 ${tf.toUpperCase()}...`, null);
          }

          const signals = await rangeDetector.scan(tf);
          const text = formatSignalList(signals, tf);

          if (msgId) {
            await editMessageText(chatId, msgId, text, MAIN_BUTTONS);
          } else {
            await sendMessageWithButtons(chatId, text, MAIN_BUTTONS);
          }
        }

        if (data?.startsWith('detail_')) {
          const symbol = data.replace('detail_', '');
          const signals = rangeDetector.getSignals();
          const signal = signals.find((s) => s.symbol === symbol);

          await answerCallbackQuery(cb.id);

          if (signal) {
            const detail = formatRangeSignal(signal);
            await sendTelegram(detail);
          }
        }
      }
    } catch (err) {
      logger.warn('[TG Bot] Error handling update:', err.message);
    }
  }

  let botUsername = null;
  async function getBotUsername() {
    if (botUsername) return botUsername;
    const result = await callTelegram('getMe');
    botUsername = result?.result?.username || '';
    return botUsername;
  }

  async function poll() {
    try {
      const result = await getUpdates();
      if (result?.ok && result.result?.length) {
        for (const update of result.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);
          await handleUpdate(update);
        }
      }
    } catch (err) {
      logger.warn('[TG Bot] Poll error:', err.message);
    }
  }

  pollTimer = setInterval(poll, POLL_INTERVAL);
  poll(); // First poll immediately

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
