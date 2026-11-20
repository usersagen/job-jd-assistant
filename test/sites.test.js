import test from 'node:test';
import assert from 'node:assert/strict';
import boss from '../src/content/sites/boss.js';
import zhilian from '../src/content/sites/zhilian.js';
import xmrc from '../src/content/sites/xmrc.js';
import liepin from '../src/content/sites/liepin.js';
import { detectAdapter } from '../src/content/sites/index.js';
import { stubDom, stubLocation } from './support.mjs';

test('detectAdapter：按域名选择站点，未知域名回退 BOSS', () => {
  assert.equal(detectAdapter('xiaoyuan.zhaopin.com').id, 'zhilian');
  assert.equal(detectAdapter('www.xmrc.com.cn').id, 'xmrc');
  assert.equal(detectAdapter('www.liepin.com').id, 'liepin');
  assert.equal(detectAdapter('www.zhipin.com').id, 'boss');
  // 后缀边界：不能把 evilzhaopin.com 当成智联
  assert.equal(detectAdapter('evilzhaopin.com').id, 'boss');
});

test('BOSS：详情页职位 ID 与规范链接', () => {
  stubLocation('https://www.zhipin.com/job_detail/abc123.html?ka=search');
  stubDom();
  assert.equal(boss.getJobId(), 'abc123');
  assert.equal(boss.getCanonicalUrl('abc123'), 'https://www.zhipin.com/job_detail/abc123.html');
  assert.equal(boss.pageKey(), `detail|${globalThis.location.href}`);
});

test('BOSS：列表页从详情链接取职位 ID，并用选中卡片做页面签名', () => {
  stubLocation('https://www.zhipin.com/web/geek/jobs');
  stubDom({
    elements: {
      '.job-detail-container .more-job-btn[href]': {
        href: 'https://www.zhipin.com/job_detail/xyz789.html'
      },
      '.job-card-wrap.active .job-name[href]': {
        getAttribute: () => '/job_detail/xyz789.html'
      },
      '.job-detail-header .job-detail-info .job-name': {
        textContent: '前端工程师'
      }
    }
  });
  assert.equal(boss.getJobId(), 'xyz789');
  assert.equal(boss.pageKey(), 'list|/job_detail/xyz789.html|前端工程师');
});

test('BOSS：公司职位页（/gongsi/job/）按选中卡片取职位 ID', () => {
  stubLocation('https://www.zhipin.com/gongsi/job/cd4176549347c39c1nZ62ty_E1U~.html');
  stubDom({
    elements: {
      '.job-detail-box .more-job-btn[href]': {
        href: 'https://www.zhipin.com/job_detail/2864f95f7fa1fc530nxy0ti6FFBZ.html'
      },
      '.job-card-box.active .job-name[href]': {
        getAttribute: () => '/job_detail/2864f95f7fa1fc530nxy0ti6FFBZ.html'
      },
      '.job-detail-header .job-detail-info .job-name': {
        textContent: 'AI产品经理（J11050）'
      }
    }
  });
  assert.equal(boss.isListPage(), true);
  assert.equal(boss.getJobId(), '2864f95f7fa1fc530nxy0ti6FFBZ');
  assert.equal(boss.pageKey(), 'list|/job_detail/2864f95f7fa1fc530nxy0ti6FFBZ.html|AI产品经理（J11050）');
});

test('BOSS：无职位 ID 时规范链接去掉查询串', () => {
  stubLocation('https://www.zhipin.com/web/geek/jobs?query=1');
  assert.equal(boss.getCanonicalUrl(''), 'https://www.zhipin.com/web/geek/jobs');
});

test('智联：职位 ID、规范链接与页面签名', () => {
  stubLocation('https://xiaoyuan.zhaopin.com/job/CC123456?ref=search');
  stubDom();
  assert.equal(zhilian.getJobId(), 'CC123456');
  assert.equal(zhilian.getCanonicalUrl('CC123456'), 'https://xiaoyuan.zhaopin.com/job/CC123456');
  assert.equal(zhilian.pageKey(), `zhilian|${globalThis.location.href}|`);
});

test('智联：元信息按标签分类，全职/招聘人数进入标签', () => {
  stubDom({
    lists: {
      '.job-banner__desc .job-banner__desc-text': ['上海', '3-5年', '本科', '全职', '招2人']
    }
  });
  const meta = zhilian.readMeta();
  assert.deepEqual(meta, {
    city: '上海',
    experience: '3-5年',
    degree: '本科',
    extras: ['全职', '招2人']
  });
  assert.deepEqual(zhilian.readTags(meta.extras), ['全职', '招2人']);
});

test('智联：新版详情页（/jobdetail/）职位 ID、规范链接与元信息', () => {
  stubLocation('https://www.zhaopin.com/jobdetail/CCL1488629520J40904366905.htm?refcode=4021');
  stubDom({
    lists: {
      '.summary-planes__info li': ['厦门 思明区', '经验不限', '本科']
    }
  });
  assert.equal(zhilian.getJobId(), 'CCL1488629520J40904366905');
  assert.equal(
    zhilian.getCanonicalUrl('CCL1488629520J40904366905'),
    'https://www.zhaopin.com/jobdetail/CCL1488629520J40904366905.htm'
  );
  assert.deepEqual(zhilian.readMeta(), {
    city: '厦门 思明区',
    experience: '经验不限',
    degree: '本科',
    extras: []
  });
});

test('智联：新版公司卡片直接读取公司名与规模', () => {
  stubDom({
    text: { '.company-summary__name-link': '厦门合恩医药有限公司' },
    lists: {
      '.company-summary__item .company-summary__text': ['不需要融资', '100-299人', '医药批发/零售']
    }
  });
  assert.deepEqual(zhilian.readCompany(), { name: '厦门合恩医药有限公司', scale: '100-299人' });
});

test('智联：从公司信息行里提取规模', () => {
  stubDom({
    text: { '.company-info__name': '某某科技有限公司' },
    lists: { '.company-info__property p': ['规模：100-499人', '性质：民营'] }
  });
  assert.deepEqual(zhilian.readCompany(), { name: '某某科技有限公司', scale: '100-499人' });
});

test('厦门人才网：从查询参数取职位 ID，地址即规范链接', () => {
  stubLocation('https://www.xmrc.com.cn/Recruit/RecruitInfo/abc?id=987&from=list');
  assert.equal(xmrc.getJobId(), '987');
  assert.equal(xmrc.getCanonicalUrl('987'), globalThis.location.href);
});

test('厦门人才网：城市片段拼接，其余进入标签', () => {
  stubDom({
    lists: {
      '.job-info__top__time.text-block-group > span': ['｜上海市', '｜3-5年', '｜本科', '｜招聘2人']
    }
  });
  const meta = xmrc.readMeta();
  assert.deepEqual(meta, {
    city: '上海市',
    experience: '3-5年',
    degree: '本科',
    extras: ['招聘2人']
  });
  assert.deepEqual(xmrc.readTags(meta.extras), ['招聘2人']);
});

test('猎聘：/job/ 与 /lptjob/ 两种职位链接都支持', () => {
  stubLocation('https://www.liepin.com/job/123456.shtml');
  assert.equal(liepin.getJobId(), '123456');
  assert.equal(liepin.getCanonicalUrl('123456'), 'https://www.liepin.com/job/123456.shtml');

  stubLocation('https://www.liepin.com/lptjob/789');
  assert.equal(liepin.getJobId(), '789');
  assert.equal(liepin.getCanonicalUrl('789'), 'https://www.liepin.com/lptjob/789');
});

test('猎聘：无职位 ID 时规范链接去掉查询串', () => {
  stubLocation('https://www.liepin.com/job/list?x=1');
  stubDom();
  assert.equal(liepin.getJobId(), '');
  assert.equal(liepin.getCanonicalUrl(''), 'https://www.liepin.com/job/list');
  assert.equal(liepin.pageKey(), `detail|${globalThis.location.href}`);
});

test('猎聘：元信息按标签分类，其余进入标签', () => {
  stubDom({
    lists: {
      '.job-properties > span': ['上海市', '3-5年经验', '本科', '学生可投']
    }
  });
  const meta = liepin.readMeta();
  assert.deepEqual(meta, {
    city: '上海市',
    experience: '3-5年经验',
    degree: '本科',
    extras: ['学生可投']
  });
  assert.deepEqual(liepin.readTags(meta.extras), ['学生可投']);
});
