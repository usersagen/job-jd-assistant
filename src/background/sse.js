// 单轮 SSE 流式请求：把增量回传页面，并收集本轮正文与工具调用。
import { HEADER_TIMEOUT, TOTAL_TIMEOUT, linkAbort } from './ai.js';
import { TOOLS } from './tools.js';

export async function streamTurn({ baseUrl, apiKey, model, thinking, messages, useTools, omitThinking, signal, send }) {
  const payload = {
    model,
    messages,
    stream: true,
    temperature: 0.7
  };
  // 部分兼容端点不认 thinking 字段，降级重试时直接省略
  if (!omitThinking) payload.thinking = { type: thinking === false ? 'disabled' : 'enabled' };
  if (useTools) payload.tools = TOOLS;

  const link = linkAbort(signal);
  let timedOut = false;
  const headerTimer = setTimeout(() => { timedOut = true; link.abort(); }, HEADER_TIMEOUT);
  const totalTimer = setTimeout(() => { timedOut = true; link.abort(); }, TOTAL_TIMEOUT);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: link.signal
    });
    clearTimeout(headerTimer);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`请求失败（${response.status}）${detail.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const collected = new Map();

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (err) {
            continue;
          }
          const choice = json.choices && json.choices[0];
          if (!choice) continue;
          const delta = choice.delta || {};

          if (delta.reasoning_content) send({ type: 'reasoning', text: delta.reasoning_content });
          if (delta.content) {
            content += delta.content;
            send({ type: 'delta', text: delta.content });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const part of delta.tool_calls) {
              const index = part.index || 0;
              const current = collected.get(index) || { id: '', name: '', args: '' };
              if (part.id) current.id = part.id;
              if (part.function && part.function.name) current.name += part.function.name;
              if (part.function && part.function.arguments) current.args += part.function.arguments;
              collected.set(index, current);
            }
          }
        }
      }
    }

    const calls = Array.from(collected.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, item]) => ({
        id: item.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: item.name,
        args: item.args || '{}'
      }))
      .filter((item) => item.name);

    return { content, calls };
  } catch (err) {
    // 用户主动停止时不改写错误类型
    if (timedOut && !(signal && signal.aborted)) {
      const timeoutErr = new Error('请求超时，请检查网络或稍后重试。');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(headerTimer);
    clearTimeout(totalTimer);
    link.release();
  }
}
