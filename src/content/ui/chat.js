// AI 对话视图：流式渲染、停止、快捷追问与企业年报查询。
import { runtime } from '../state.js';
import { getContentSettings } from '../../shared/settings.js';
import { copyText } from '../../shared/clipboard.js';
import { formatMessage } from '../../shared/markdown.js';
import { PORT_AI_CHAT } from '../../shared/protocol.js';
import { readSession, writeSession, clearSession } from '../../shared/session.js';
import { extractWithRetry } from '../extract.js';
import { getAdapter } from '../sites/index.js';

// 当前正在流式输出的气泡，用于「停止」时结束计时
let activeBubble = null;
// 会话恢复的请求序号：切换岗位/新建对话后丢弃过期的异步结果
let restoreToken = 0;
// 打开历史会话时接管当前会话：后续消息继续写回该岗位的存储
let sessionOverride = '';
let sessionMeta = null;

// 当前页面的会话标识：优先用规范链接，取不到职位 ID 时退回页面签名
function pageSessionKey() {
  const site = getAdapter();
  const jobId = site.getJobId ? site.getJobId() : '';
  return jobId ? site.getCanonicalUrl(jobId) : site.pageKey();
}

// 实际读写的会话标识：打开历史会话后以该会话为准
export function sessionKey() {
  return sessionOverride || pageSessionKey();
}

function persistChat() {
  const key = sessionKey();
  if (!key) return;
  const data = runtime.lastData || {};
  const meta = sessionOverride && sessionMeta ? sessionMeta : data;
  writeSession(key, {
    title: meta.title || '',
    company: meta.company || '',
    url: meta.url || '',
    messages: runtime.chat.messages,
    updatedAt: Date.now()
  });
}

function renderMessages(messages) {
  runtime.ui.thread.textContent = '';
  messages.forEach((item) => {
    if (item.role === 'user') {
      appendChatMessage('user', item.content);
      return;
    }
    const bubble = appendChatMessage('assistant', item.content);
    bubble.finalize(item.content);
  });
  runtime.threadPinned = true;
}

// 清空内存中的对话（切岗位、新建对话共用）
export function resetChat() {
  restoreToken++;
  sessionOverride = '';
  sessionMeta = null;
  runtime.chat.messages = [];
  runtime.chat.greeted = false;
  runtime.ui.thread.textContent = '';
}

// 从会话存储恢复当前岗位的历史对话
export async function restoreChat() {
  if (!runtime.ui || runtime.chat.busy || runtime.chat.messages.length) return;
  const token = ++restoreToken;
  const key = sessionKey();
  const record = await readSession(key);
  if (token !== restoreToken || key !== sessionKey()) return;
  if (!record || !record.messages.length) return;
  runtime.chat.messages = record.messages.slice();
  renderMessages(record.messages);
  runtime.chat.greeted = true;
}

// 新建对话：清空当前页面的会话与存储，重新显示欢迎语
export function newChat() {
  stopChat();
  const key = pageSessionKey();
  resetChat();
  if (key) clearSession(key);
  switchView('chat');
}

// 打开历史会话（可能来自其他岗位），后续消息会继续写回该会话
export async function openHistorySession(key) {
  if (!runtime.ui || !key) return;
  stopChat();
  const record = await readSession(key);
  if (!record || !record.messages.length) return;
  restoreToken++;
  sessionOverride = key;
  sessionMeta = { title: record.title || '', company: record.company || '', url: record.url || '' };
  runtime.chat.messages = record.messages.slice();
  renderMessages(record.messages);
  runtime.chat.greeted = true;
  switchView('chat');
}

export function buildSystemPrompt(data, resume, customPrompt) {
  // 填了自定义提示词就替换默认的「回答要求」，岗位与简历上下文仍会自动附上
  const rules = (customPrompt || '').trim().slice(0, 2000)
    || '回答要求：中文；先给结论再给要点；结合岗位原文和简历的具体内容，不要泛泛而谈；信息不足时明确说明；默认控制在 400 字以内，用户要求详细时再展开。';
  const lines = [
    `你是一名资深求职顾问，帮助用户分析下面这个${getAdapter().name}岗位，并给出具体、可执行的建议。`,
    '',
    '【岗位信息】',
    `职位：${data.title || '未知'}`,
    `公司：${data.company || '未知'}${data.companyScale ? `（${data.companyScale}）` : ''}`,
    `薪资：${data.salary || '未知'}`,
    `城市：${data.city || '未知'}`,
    `经验要求：${data.experience || '未知'}`,
    `学历要求：${data.degree || '未知'}`,
    data.tags.length ? `标签：${data.tags.join(' / ')}` : '',
    data.address ? `地址：${data.address}` : '',
    '',
    '【职位描述】',
    (data.description || '（未获取到职位描述）').slice(0, 4000),
    '',
    '【求职者简历】',
    (resume || '').trim().slice(0, 4000) || '（用户未填写简历）',
    '',
    rules
  ];
  return lines.join('\n');
}

export function appendChatMessage(role, text, isError) {
  const el = document.createElement('div');
  el.className = `msg ${role === 'user' ? 'user' : 'bot'}${isError ? ' err' : ''}`;
  runtime.ui.thread.appendChild(el);

  const scrollIfPinned = () => {
    if (runtime.threadPinned) runtime.ui.thread.scrollTop = runtime.ui.thread.scrollHeight;
  };

  if (role === 'user') {
    el.textContent = text;
    scrollIfPinned();
    return { set() {}, setThinking() {}, setNote() {}, finalize() {} };
  }

  const note = document.createElement('div');
  note.className = 'tool-note';
  note.hidden = true;

  // 思考过程：点标题可折叠，默认在回答开始后自动收起
  const think = document.createElement('div');
  think.className = 'think';
  think.hidden = true;
  const thinkTitle = document.createElement('div');
  thinkTitle.className = 'tt';
  const thinkArrow = document.createElement('span');
  thinkArrow.className = 'arr';
  thinkArrow.textContent = '▾';
  const thinkLabel = document.createElement('span');
  thinkLabel.textContent = '思考过程';
  thinkTitle.append(thinkArrow, thinkLabel);
  const thinkBody = document.createElement('div');
  thinkBody.className = 'tb';
  think.append(thinkTitle, thinkBody);
  let thinkTouched = false;
  thinkTitle.addEventListener('click', () => {
    thinkTouched = true;
    const collapsed = think.classList.toggle('collapsed');
    thinkArrow.textContent = collapsed ? '▸' : '▾';
  });

  const answer = document.createElement('div');
  answer.className = 'answer';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.hidden = true;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制 Markdown';
  copyBtn.hidden = true;
  const timeEl = document.createElement('span');
  timeEl.className = 'elapsed';
  meta.append(copyBtn, timeEl);

  el.append(note, think, answer, meta);

  let answerText = String(text || '');
  let thinkText = '';
  let frame = 0;
  let answerDirty = false;
  let thinkDirty = false;
  let startedAt = 0;
  let ticker = 0;
  let copyTimer = 0;

  copyBtn.addEventListener('click', async () => {
    if (!answerText.trim()) return;
    const ok = await copyText(answerText);
    copyBtn.textContent = ok ? '已复制' : '复制失败';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyBtn.textContent = '复制 Markdown'; }, 1200);
  });

  const tick = () => {
    if (!startedAt) return;
    timeEl.textContent = `用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  };
  const stopTimer = () => {
    if (ticker) {
      clearInterval(ticker);
      ticker = 0;
    }
    if (startedAt) {
      tick();
      startedAt = 0;
    }
  };

  // 流式期间用纯文本 + 每帧合并一次写入，避免每个 token 全量重建 Markdown
  const render = () => {
    frame = 0;
    if (answerDirty) {
      answerDirty = false;
      answer.textContent = answerText;
    }
    if (thinkDirty) {
      thinkDirty = false;
      thinkBody.textContent = thinkText.length > 2000 ? `…${thinkText.slice(-2000)}` : thinkText;
    }
    scrollIfPinned();
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  answer.innerHTML = formatMessage(answerText);
  scrollIfPinned();

  return {
    set(value, error) {
      el.classList.toggle('err', Boolean(error));
      answerText = String(value == null ? '' : value);
      answerDirty = true;
      schedule();
    },
    // 思考模式下的 reasoning_content，单独用浅色小块展示
    setThinking(value) {
      think.hidden = !value;
      if (!value) return;
      thinkText = String(value);
      thinkDirty = true;
      schedule();
    },
    // 工具调用状态提示
    setNote(value) {
      note.hidden = !value;
      note.textContent = value || '';
      scrollIfPinned();
    },
    // 回答开始输出时自动收起思考过程（用户手动展开/收起过则不干预）
    collapseThinking() {
      if (thinkTouched || think.hidden) return;
      think.classList.add('collapsed');
      thinkArrow.textContent = '▸';
    },
    // 计时：从发出请求到大模型返回结束
    startTimer() {
      meta.hidden = false;
      startedAt = Date.now();
      tick();
      ticker = setInterval(tick, 100);
    },
    stopTimer,
    // 流式结束后一次性渲染 Markdown
    finalize(value, error) {
      el.classList.toggle('err', Boolean(error));
      if (value !== undefined) answerText = String(value == null ? '' : value);
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      answerDirty = false;
      answer.innerHTML = formatMessage(answerText);
      stopTimer();
      meta.hidden = !(timeEl.textContent || answerText.trim());
      copyBtn.hidden = !answerText.trim();
      scrollIfPinned();
    }
  };
}

export function buildChatView() {
  const view = document.createElement('div');
  view.className = 'view view-chat';
  view.hidden = true;

  const thread = document.createElement('div');
  thread.className = 'thread';
  // 用户手动向上翻时不再强制滚到底部
  thread.addEventListener('scroll', () => {
    runtime.threadPinned = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
  }, { passive: true });

  const input = document.createElement('textarea');
  input.placeholder = '就这个岗位提问，Enter 发送，Shift+Enter 换行';

  const quick = document.createElement('div');
  quick.className = 'quick';
  ['评估我的岗位匹配度', '写一段打招呼话术', '这份 JD 有哪些风险信号'].forEach((prompt) => {
    const chip = document.createElement('button');
    chip.className = 'qchip';
    chip.type = 'button';
    chip.textContent = prompt;
    // 点快捷问题直接发送，无需再点「发送」
    chip.addEventListener('click', () => {
      sendChat(prompt);
    });
    quick.appendChild(chip);
  });

  const composer = document.createElement('div');
  composer.className = 'composer';
  const send = document.createElement('button');
  send.className = 'send';
  send.type = 'button';
  send.textContent = '发送';
  composer.append(input, send);

  view.append(thread, quick, composer);
  return { view, thread, input, send };
}

export function stopChat() {
  if (activeBubble) {
    activeBubble.stopTimer();
    activeBubble = null;
  }
  if (runtime.chat.port) {
    try { runtime.chat.port.disconnect(); } catch (e) { /* 已断开 */ }
    runtime.chat.port = null;
  }
  runtime.chat.busy = false;
  runtime.ui.send.textContent = '发送';
}

export function switchView(name) {
  const isChat = name === 'chat';
  runtime.ui.viewJob.hidden = name !== 'job';
  runtime.ui.viewChat.hidden = !isChat;
  if (runtime.ui.viewHistory) runtime.ui.viewHistory.hidden = name !== 'history';
  runtime.ui.jd.title = name === 'job' ? '返回 AI 对话' : '查看岗位信息';
  runtime.ui.jd.classList.toggle('active', name === 'job');
  // 进入岗位信息 / 历史会话后把按钮图标替换为「返回对话」
  const icons = runtime.ui.icons;
  if (icons) {
    runtime.ui.jd.innerHTML = name === 'job' ? icons.back : icons.notes;
    if (runtime.ui.history) {
      runtime.ui.history.classList.toggle('active', name === 'history');
      runtime.ui.history.innerHTML = name === 'history' ? icons.back : icons.history;
    }
  }
  if (isChat && !runtime.chat.greeted) {
    runtime.chat.greeted = true;
    appendChatMessage('assistant', '我会结合当前岗位和你填写的简历回答。可以直接提问，或点下面的快捷问题。');
  }
  if (isChat) runtime.ui.input.focus();
}

export async function sendChat(textArg) {
  if (runtime.chat.busy) return;
  const text = String(textArg !== undefined ? textArg : runtime.ui.input.value).trim();
  if (!text) return;

  const settings = await getContentSettings();
  if (!settings.deepseekApiKey) {
    appendChatMessage('assistant', '还没有配置 DeepSeek API Key。点右上角 ⚙ 打开设置页填写后再试。', true);
    return;
  }

  if (textArg === undefined) runtime.ui.input.value = '';
  appendChatMessage('user', text);
  runtime.chat.messages.push({ role: 'user', content: text });
  persistChat();

  runtime.chat.busy = true;
  runtime.ui.send.textContent = '停止';
  const bubble = appendChatMessage('assistant', '');
  activeBubble = bubble;

  if (!runtime.lastData) {
    bubble.set('正在读取当前岗位信息…');
    try {
      runtime.lastData = await extractWithRetry();
    } catch (err) {
      bubble.set('读取岗位信息失败，请刷新页面后重试。', true);
      stopChat();
      return;
    }
    if (!runtime.chat.busy) return;
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(runtime.lastData, settings.resumeText, settings.customPrompt) },
    ...runtime.chat.messages.slice(-10)
  ];

  try {
    runtime.chat.port = chrome.runtime.connect({ name: PORT_AI_CHAT });
  } catch (err) {
    bubble.set('扩展已更新，请刷新页面后重试。', true);
    stopChat();
    return;
  }

  bubble.set('正在思考…');
  const port = runtime.chat.port;
  let answer = '';
  let reasoning = '';
  let errored = '';

  port.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'reasoning') {
      reasoning += message.text;
      if (!answer) bubble.set('');
      bubble.setThinking(reasoning);
    } else if (message.type === 'tool') {
      if (message.status === 'running') bubble.setNote('正在查询企业年报…');
      else bubble.setNote(message.error ? '企业年报查询失败' : '已获取企业年报数据');
    } else if (message.type === 'delta') {
      answer += message.text;
      bubble.collapseThinking();
      bubble.set(answer);
    } else if (message.type === 'notice') {
      bubble.setNote(message.message || '');
    } else if (message.type === 'error') {
      errored = message.message || '请求失败';
      bubble.set(answer ? `${answer}\n\n[请求中断：${errored}]` : errored, !answer);
      bubble.stopTimer();
      stopChat();
    } else if (message.type === 'done') {
      if (!answer.trim()) {
        bubble.finalize(errored || '（没有返回内容）', true);
      } else {
        bubble.finalize(answer);
        if (!errored) {
          runtime.chat.messages.push({ role: 'assistant', content: answer });
          persistChat();
        }
      }
      stopChat();
    }
  });

  port.onDisconnect.addListener(() => {
    if (runtime.chat.busy) {
      if (!answer.trim()) bubble.set('连接已断开，请重试。', true);
      bubble.stopTimer();
      stopChat();
    }
  });

  bubble.startTimer();
  try {
    port.postMessage({ type: 'chat', messages });
  } catch (err) {
    bubble.set('连接已断开，请重试。', true);
    bubble.stopTimer();
    stopChat();
  }
}

// 点「查」按钮才查询企业年报（需已配置 DeepSeek 与企查查 Key）
export async function queryCompany() {
  if (runtime.chat.busy) return;
  switchView('chat');

  const settings = await getContentSettings();
  if (!settings.deepseekApiKey) {
    appendChatMessage('assistant', '还没有配置 DeepSeek API Key。点右上角 ⚙ 打开设置页填写后再试。', true);
    return;
  }
  if (!settings.qccApiKey) {
    appendChatMessage('assistant', '还没有配置企查查 API Key。点右上角 ⚙ 打开设置页填写后再试。', true);
    return;
  }

  if (!runtime.lastData) runtime.lastData = await extractWithRetry();
  const company = ((runtime.lastData && runtime.lastData.company) || '').trim();
  if (!company) {
    appendChatMessage('assistant', '还没有提取到公司名称，先点右下角的「AI 岗位助手」重新提取再试。', true);
    return;
  }

  sendChat(`请调用企业年报工具查询「${company}」最近三年的工商年报，提取每年的从业人数；
若从业人数为“企业选择不公示”或为空，则改用社保参保人数作为替代，并注明口径。
只返回近三年的年度和人数，不需要趋势分析和额外判断。`);
}
