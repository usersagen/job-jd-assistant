// background 入口：工具栏点击、消息转发与 AI 长连接编排。
import { MSG, PORT_AI_CHAT } from '../shared/protocol.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  getSettings,
  validateBaseUrl
} from './ai.js';
import { runTool } from './tools.js';
import { streamTurn } from './sse.js';
import { readSession, writeSession, clearSession, listSessions } from './session.js';

const MAX_TOOL_ROUNDS = 2;

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: MSG.EXTRACT }, () => {
    // 当前页没有内容脚本（不在职位详情页）时会报错，忽略即可
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === MSG.OPEN_OPTIONS) {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (message.type !== MSG.SESSION) return;

  if (message.op === 'list') {
    Promise.resolve(listSessions())
      .then((list) => sendResponse(list || []))
      .catch(() => sendResponse([]));
    return true;
  }

  const key = String(message.key || '');
  if (!key) {
    sendResponse(null);
    return;
  }
  let task;
  if (message.op === 'set') task = writeSession(key, message.record || {});
  else if (message.op === 'clear') task = clearSession(key);
  else task = readSession(key);
  Promise.resolve(task)
    .then((result) => sendResponse(result || null))
    .catch(() => sendResponse(null));
  return true;
});

// 内容脚本通过长连接发起对话：在 background 里请求可绕过页面 CORS，并把 SSE 增量转回页面
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_AI_CHAT) return;

  let controller = null;
  const send = (payload) => {
    try {
      port.postMessage(payload);
    } catch (err) {
      // 页面已断开，忽略
    }
  };
  const abort = () => {
    if (controller) {
      controller.abort();
      controller = null;
    }
  };

  port.onDisconnect.addListener(abort);

  port.onMessage.addListener(async (message) => {
    if (!message) return;
    if (message.type === 'abort') {
      abort();
      return;
    }
    if (message.type !== 'chat') return;

    abort();
    controller = new AbortController();
    const signal = controller.signal;

    try {
      const settings = await getSettings();
      if (!settings.deepseekApiKey) {
        send({ type: 'error', message: '未配置 DeepSeek API Key，请打开扩展设置页填写。' });
        return;
      }

      const baseCheck = validateBaseUrl(
        settings.deepseekBaseUrl || DEFAULT_BASE_URL,
        settings.allowCustomBaseUrl === true
      );
      if (baseCheck.error) {
        send({ type: 'error', message: baseCheck.error });
        return;
      }
      const baseUrl = baseCheck.url;
      const model = (settings.deepseekModel || DEFAULT_MODEL).trim().replace(/^deepseek:/, '');
      let thinking = settings.deepseekThinking !== false;
      let useTools = Boolean(settings.qccApiKey);

      const convo = message.messages.slice();
      const requestTurn = (omitThinking = false) => streamTurn({
        baseUrl,
        apiKey: settings.deepseekApiKey,
        model,
        thinking,
        messages: convo,
        useTools,
        omitThinking,
        signal,
        send
      });

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let turn = null;
        try {
          turn = await requestTurn();
        } catch (err) {
          const detail = String((err && err.message) || err);
          // 兼容端点可能不认 thinking / tools 参数，400 时去掉后重试一次
          if (round === 0 && /请求失败（400）/.test(detail) && (thinking || useTools)) {
            thinking = false;
            useTools = false;
            send({ type: 'notice', message: '当前端点不支持思考/工具参数，已自动降级重试' });
            turn = await requestTurn(true);
          } else {
            throw err;
          }
        }
        if (!turn.calls.length) break;

        convo.push({
          role: 'assistant',
          content: turn.content || null,
          tool_calls: turn.calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args }
          }))
        });

        for (const call of turn.calls) {
          send({ type: 'tool', name: call.name, status: 'running' });
          let output = null;
          try {
            output = await runTool(call, settings);
          } catch (err) {
            output = { error: String((err && err.message) || err) };
          }
          send({ type: 'tool', name: call.name, status: 'done', error: Boolean(output && output.error) });
          convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }

      send({ type: 'done' });
    } catch (err) {
      if (err && err.name === 'AbortError') send({ type: 'done' });
      else send({ type: 'error', message: String((err && err.message) || err) });
    } finally {
      controller = null;
    }
  });
});
