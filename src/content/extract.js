// 岗位信息提取：流程与站点无关，具体字段取值交给站点适配器。
import { sleep, pick } from '../shared/dom.js';
import { getAdapter } from './sites/index.js';
import { readHrFallback } from './sites/base.js';

export function extract(deep = false) {
  const site = getAdapter();
  const description = site.readDescription(deep);

  const companyInfo = site.readCompany(deep);
  let company = companyInfo.name || pick(site.selectors.company);

  const meta = site.readMeta();
  const tags = site.readTags(meta.extras);
  let hr = site.readHr();
  if (!hr) hr = readHrFallback(site.selectors);

  const jobId = site.getJobId();
  const title = site.readTitle();
  const salary = site.readSalary(jobId, title, company);

  return {
    jobId,
    title,
    salary,
    company,
    companyScale: companyInfo.scale || '',
    city: meta.city,
    experience: meta.experience,
    degree: meta.degree,
    tags,
    hr,
    address: companyInfo.address || site.readAddress(),
    description,
    url: site.getCanonicalUrl(jobId),
    extractedAt: new Date().toLocaleString('zh-CN')
  };
}

export async function extractWithRetry() {
  let data = extract();
  let usedDeep = false;
  // 职位描述常为懒加载，重试几次；最耗时的文本锚点兜底只在最后一次重试启用
  for (let i = 0; i < 5 && (!data.title || !data.description); i++) {
    await sleep(400);
    const deep = i === 4;
    data = extract(deep);
    usedDeep = usedDeep || deep;
  }
  // 公司名等次要字段缺失时，补一次带锚点兜底的提取
  if (!usedDeep && !data.company) data = extract(true);
  return data;
}
