const $ = (id) => document.getElementById(id);
const FIELDS = ['deepseekApiKey', 'qccApiKey', 'deepseekBaseUrl', 'allowCustomBaseUrl', 'deepseekModel', 'deepseekThinking', 'customPrompt', 'resumeText'];

chrome.storage.local.get(FIELDS, (items = {}) => {
  $('key').value = items.deepseekApiKey || '';
  $('qcc').value = items.qccApiKey || '';
  $('base').value = items.deepseekBaseUrl || 'https://api.deepseek.com/v1';
  $('allowCustom').checked = items.allowCustomBaseUrl === true;
  $('model').value = items.deepseekModel || 'deepseek-flash';
  $('thinking').checked = items.deepseekThinking !== false;
  $('prompt').value = items.customPrompt || '';
  $('resume').value = items.resumeText || '';
});

$('save').addEventListener('click', () => {
  chrome.storage.local.set(
    {
      deepseekApiKey: $('key').value.trim(),
      qccApiKey: $('qcc').value.trim(),
      deepseekBaseUrl: $('base').value.trim(),
      allowCustomBaseUrl: $('allowCustom').checked,
      deepseekModel: $('model').value.trim(),
      deepseekThinking: $('thinking').checked,
      customPrompt: $('prompt').value.trim(),
      resumeText: $('resume').value
    },
    () => {
      const status = $('status');
      status.textContent = '已保存';
      setTimeout(() => { status.textContent = ''; }, 1600);
    }
  );
});
