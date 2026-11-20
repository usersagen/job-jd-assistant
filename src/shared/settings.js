// 存储读取：内容脚本与 background 各自只取需要的字段。
export function getContentSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['deepseekApiKey', 'resumeText', 'customPrompt', 'qccApiKey'], (items) => resolve(items || {}));
  });
}

export function getBackgroundSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        'deepseekApiKey',
        'deepseekBaseUrl',
        'deepseekModel',
        'deepseekThinking',
        'allowCustomBaseUrl',
        'qccApiKey'
      ],
      (items) => resolve(items || {})
    );
  });
}
