// 内容脚本的共享运行时状态：单例 DOM 引用、最近一次提取结果与对话状态。
export const runtime = {
  host: null,
  ui: null,
  lastPageKey: '',
  lastData: null,
  extracting: false,
  threadPinned: true,
  chat: { messages: [], busy: false, port: null, greeted: false }
};
