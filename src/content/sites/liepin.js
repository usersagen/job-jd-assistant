// 猎聘：城市 / 经验 / 学历与「学生可投」「招N人」等标签混在 job-properties 里。
import { clean, pick, pickAll } from '../../shared/dom.js';
import {
  pickMeta,
  readTitleFrom,
  resolveSalary,
  readDescriptionFrom
} from './base.js';

// 页面改版时优先改这里：每个字段按顺序尝试，命中即返回
export const SELECTORS = {
  title: ['.job-apply-content .name-box > span.name', '.job-apply-content .name-box .job-title'],
  salary: ['.job-apply-content .name-box .salary', '.name-box .salary'],
  company: ['.company-info-container .company-card .name'],
  meta: ['.job-properties'],
  city: [],
  experience: [],
  degree: [],
  tags: [],
  description: ['.job-intro-container dd[data-selector="job-intro-content"]', '.job-intro-container .paragraph dd'],
  address: [],
  hr: [],
  hrExtra: [],
  companyInfo: ['.company-info-container .label-box']
};

function readLiepinMeta() {
  const meta = { city: '', experience: '', degree: '' };
  const extras = [];

  pickAll(['.job-properties > span']).forEach((raw) => {
    const text = clean(raw);
    if (!text) return;
    if (!meta.experience && /(经验|应届|在校)/.test(text)) meta.experience = text;
    else if (!meta.degree && /(学历|本科|大专|硕士|博士|中专|高中)/.test(text)) meta.degree = text;
    else if (!meta.city && /(市|区|县|-)/.test(text)) meta.city = text;
    else extras.push(text);
  });

  return { meta, extras };
}

// 公司信息：公司名、人数规模、职位地址
function readLiepinCompany() {
  const info = { name: pick(SELECTORS.company), scale: '', address: '' };

  document.querySelectorAll('.company-info-container .label-box').forEach((box) => {
    const label = clean((box.querySelector('.label') || {}).textContent);
    const value = clean((box.querySelector('.text') || {}).textContent);
    if (!value) return;
    if (/规模|人数/.test(label)) info.scale = value;
    else if (/地址/.test(label)) info.address = value;
  });

  return info;
}

// 招聘者：姓名 · 职位 · 在线状态
function readLiepinHr() {
  const card = document.querySelector('.recruiter-container');
  if (!card) return '';
  const name = clean((card.querySelector('.content .name-box .name') || {}).textContent);
  const position = clean((card.querySelector('.title-box > span') || {}).textContent);
  const active = clean((card.querySelector('.online') || {}).textContent);
  return [name, position, active].filter(Boolean).join(' · ');
}

function isListPage() {
  return false;
}

function pageKey() {
  return `detail|${location.href}`;
}

function getJobId() {
  return (location.pathname.match(/\/(?:job|lptjob)\/(\d+)(?:\.shtml)?/) || [])[1] || '';
}

function getCanonicalUrl(jobId) {
  if (!jobId) return location.href.split('?')[0];
  return location.pathname.startsWith('/lptjob/')
    ? `https://www.liepin.com/lptjob/${jobId}`
    : `https://www.liepin.com/job/${jobId}.shtml`;
}

function readTitle() {
  return readTitleFrom(SELECTORS.title);
}

function readSalary(jobId, title, company) {
  return resolveSalary(SELECTORS, jobId, title, company);
}

function readCompany() {
  return readLiepinCompany();
}

function readMeta() {
  const { meta, extras } = readLiepinMeta();
  return { ...pickMeta(SELECTORS, meta), extras };
}

function readTags(extraTags = []) {
  return Array.from(new Set([...pickAll(SELECTORS.tags), ...extraTags]));
}

function readHr() {
  return readLiepinHr();
}

function readAddress() {
  return '';
}

function descriptionElement() {
  return SELECTORS.description.map((sel) => document.querySelector(sel)).find(Boolean) || null;
}

function readDescription(deep) {
  return readDescriptionFrom(descriptionElement, deep);
}

export default {
  id: 'liepin',
  name: '猎聘',
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
