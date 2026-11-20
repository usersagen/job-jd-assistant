// BOSS 直聘：详情页与 /web/geek/jobs 列表页共用同一套适配器。
import { clean, pick, pickAll, findByAnchor } from '../../shared/dom.js';
import {
  parseMeta,
  parseCompanyInfo,
  pickMeta,
  readTitleFrom,
  readRecruiterCard,
  resolveSalary,
  readDescriptionFrom
} from './base.js';

// 页面改版时优先改这里：每个字段按顺序尝试，命中即返回
export const SELECTORS = {
  title: ['.job-banner .name h1', '.job-banner .name', '.job-primary .name h1', '.job-detail-header .job-detail-info .job-name', '.job-card-wrap.active .job-name', '.job-name'],
  salary: ['.job-banner .salary', '.job-primary .salary', '.job-detail-header .job-detail-info .job-salary', '.job-card-wrap.active .job-salary', '.salary'],
  company: ['.company-info .company-name', '.sider-company .company-name', '.job-banner .company-info a', '.company-name'],
  meta: ['.job-banner .info-primary p', '.job-primary .info-primary p', '.job-banner .job-info .text'],
  city: ['.job-banner .text-city', '.text-city'],
  experience: ['.job-banner .text-experiece', '.text-experiece'],
  degree: ['.job-banner .text-degree', '.text-degree'],
  tags: ['.job-keyword-list li', '.job-keyword-list span', '.job-label-list li'],
  description: ['.job-detail-body .desc-wrapper .desc', '.job-sec-text', '.job-detail-section .text', '.job-sec .text', '.job-detail .text', '.job-detail-body .desc'],
  address: ['.job-location .location-address', '.location-address', '.location-address-box', '.job-address-desc'],
  hr: ['.job-boss-info .name', '.job-boss-info .boss-name', '.boss-info .name'],
  hrExtra: ['.job-boss-info .gray', '.job-boss-info .boss-position'],
  companyInfo: ['.company-info p', '.company-tag-list li']
};

// 列表页（搜索列表 /web/geek/jobs、公司职位 /gongsi/job）：左侧职位卡片 + 右侧详情面板
function isListPage() {
  return location.pathname.startsWith('/web/geek/jobs')
    || location.pathname.startsWith('/gongsi/job');
}

// 单页应用里列表页的地址栏不随岗位变化，用「选中卡片 + 详情标题」做签名
function pageKey() {
  if (!isListPage()) return `detail|${location.href}`;
  const link = document.querySelector('.job-card-wrap.active .job-name[href]')
    || document.querySelector('.job-card-box.active .job-name[href]');
  const title = document.querySelector('.job-detail-header .job-detail-info .job-name');
  return `list|${link ? link.getAttribute('href') : ''}|${clean(title && title.textContent)}`;
}

// 列表页当前岗位的详情链接：详情面板的「查看更多信息」最准，其次选中的卡片
function readJobLink() {
  const link = document.querySelector('.job-detail-container .more-job-btn[href]')
    || document.querySelector('.job-detail-box .more-job-btn[href]')
    || document.querySelector('.job-card-wrap.active .job-name[href]')
    || document.querySelector('.job-card-box.active .job-name[href]');
  return link ? link.href : '';
}

// 列表页地址栏不会随岗位变化，职位 ID 只能从详情链接里取
function getJobId() {
  const match = location.pathname.match(/job_detail\/([^./?]+)\.html/)
    || readJobLink().match(/job_detail\/([^./?]+)\.html/)
    || [];
  return match[1] || '';
}

function getCanonicalUrl(jobId) {
  return jobId ? `https://www.zhipin.com/job_detail/${jobId}.html` : location.href.split('?')[0];
}

function readTitle() {
  return readTitleFrom(SELECTORS.title);
}

function readSalary(jobId, title, company) {
  return resolveSalary(SELECTORS, jobId, title, company);
}

// 列表页详情面板不显示公司字段，退回招聘者卡片的「公司 · 职位」
function parseAgentCompany() {
  const el = document.querySelector('.job-boss-info .boss-info-attr')
    || document.querySelector('.boss-info-attr');
  const text = clean(el && el.textContent);
  return text ? text.split('·')[0].trim() : '';
}

// 右侧公司卡片：优先按 class 取，class 失效再退回文本分类
function parseCompanyCard(card) {
  const info = { name: '', scale: '' };

  const links = Array.from(card.querySelectorAll('.company-info a'));
  // 卡片里 logo 链接和文字链接都可能带公司名，取最长的那份（避免拿到被截断的短文案）
  const candidates = [];
  links.forEach((a) => {
    const title = (a.getAttribute('title') || '').trim();
    const text = (a.textContent || '').trim();
    if (title) candidates.push(title);
    if (text) candidates.push(text);
  });
  if (candidates.length) {
    info.name = clean(candidates.reduce((longest, cur) => (cur.length > longest.length ? cur : longest)));
  }

  const scaleIcon = card.querySelector('.icon-scale');
  if (scaleIcon) info.scale = clean(scaleIcon.parentElement.textContent);

  if (!info.name || !info.scale) {
    const fallback = parseCompanyInfo(clean(card.innerText).split('\n'));
    info.name = info.name || fallback.name;
    info.scale = info.scale || fallback.scale;
  }

  return info;
}

// 工商信息区块：公司注册全称，比招聘卡片上的信息更完整
function readBusinessInfo() {
  const box = document.querySelector('.level-list-box') || document.querySelector('.level-list');
  const empty = { name: '' };
  if (!box) return empty;

  const item = box.querySelector('.company-name');
  if (!item) return empty;
  const clone = item.cloneNode(true);
  clone.querySelectorAll('span, em').forEach((node) => node.remove());
  return { name: clean(clone.textContent) };
}

// 公司名：BOSS 优先取工商信息，其次右侧「公司基本信息」卡片
function readCompany(deep) {
  const companyCard = document.querySelector('.sider-company');
  const info = companyCard
    ? parseCompanyCard(companyCard)
    : parseCompanyInfo(pickAll(SELECTORS.companyInfo));
  const business = readBusinessInfo();

  let name = business.name || info.name;
  if (!name) name = pick(SELECTORS.company);
  // 列表页详情面板没有公司字段：先用招聘者卡片的「公司 · 职位」，再用选中卡片的公司名
  if (!name) name = parseAgentCompany();
  if (!name) name = pick(['.job-card-wrap.active .boss-name']);
  if (deep && !name) name = findByAnchor(['公司介绍', '公司信息'], 2);

  return { name, scale: info.scale || '' };
}

// 列表页头部把「城市 / 经验 / 学历」放在 tag-list 的 li 里，逐项拼起来再分类
function readMeta() {
  const headerTags = pickAll(['.job-detail-header .tag-list li']);
  const parsed = parseMeta(pick(SELECTORS.meta) || headerTags.join(' | '));
  return { ...pickMeta(SELECTORS, parsed), extras: [] };
}

function readTags() {
  return pickAll(SELECTORS.tags);
}

function readHr() {
  return readRecruiterCard();
}

function readAddress() {
  return pick(SELECTORS.address);
}

function descriptionElement() {
  return SELECTORS.description.map((sel) => document.querySelector(sel)).find(Boolean) || null;
}

function readDescription(deep) {
  return readDescriptionFrom(descriptionElement, deep, true);
}

export default {
  id: 'boss',
  name: 'BOSS 直聘',
  selectors: SELECTORS,
  isListPage,
  pageKey,
  getJobId,
  getCanonicalUrl,
  readTitle,
  readSalary,
  readCompany,
  readMeta,
  readTags,
  readHr,
  readAddress,
  readDescription
};
