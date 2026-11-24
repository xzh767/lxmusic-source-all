/*!
 * @name 👖裤佬SVIP音源(二改整合版)
 * @description 基于安妮独家音源v4 + 星海音乐源v3.2.12 重构，替代原不稳定版本
 * @description 官网 https://Jsnzkpg.github.io
 * @version v3.0.0 | 2026-08-19
 * @author 裤佬 | 安妮 | 星海
 */

const { EVENT_NAMES, request, on, send, env, version } = globalThis.lx;

// ==================== 配置区 ====================
// 若需使用星海ChKSz接口，填入apikey（留空则跳过）
const CHKSZ_APIKEY = '';

// 酷我代理解密配置
const KW_DECRYPT_PROXY = {
  url: '',
  allowEncryptedLossless: false,
  urlParamName: 'url',
  ekeyParamName: 'ekey'
};

// ==================== 常量定义 ====================
const PLATFORMS = ['wy', 'tx', 'kw', 'kg', 'mg'];
const PLATFORM_NAMES = {
  wy: '网易云音乐', tx: 'QQ音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐'
};

// 各平台支持的音质
const MUSIC_QUALITIES = {
  wy: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'jyeffect', 'sky', 'jymaster'],
  tx: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
  kw: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
  kg: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
  mg: ['128k', '320k', 'flac', 'flac24bit']
};

// 音质降级顺序
const QUALITY_ORDER = ['jymaster', 'sky', 'jyeffect', 'master', 'hires', 'flac24bit', 'atmos', 'flac', '320k', '192k', '128k'];

// ==================== API 端点 ====================
const API = {
  // 安妮 - 酷狗代理
  kgAnnie: 'https://api.music.lerd.dpdns.org/kg',
  // 安妮 - QQ vkeys
  txVkeys: 'https://api.vkeys.cn/v2/music/tencent/geturl',
  // 安妮 - 酷我
  kwMobi: 'http://nmobi.kuwo.cn/mobi.s',
  // 安妮 - 网易
  wyWeb: 'https://c.wwwweb.top/music/url',
  // 星海 - 后端主接口
  xhBackend: 'https://yy.zddyr.top/lx/api/',
  // 星海 - 后端备用
  xhBackendFallback: 'https://zrcdy.dpdns.org/lx/api/',
  // 星海 - GD Studio
  gdStudio: 'https://music-api.gdstudio.xyz/api.php',
  // 星海 - ChKSz
  chkszWy: 'https://api.chksz.com/api/163_music',
  chkszTx: 'https://api.chksz.com/api/qq_music',
  // 裤佬 - QSVIP搜索
  qsVip: 'https://api.qs.vip/music/',
  qsVipFallback: 'https://api.qs.la/music/'
};

// ==================== 质量映射 ====================
const QUALITY_MAP = {
  kg: { '128k': '128k', '320k': '320k', 'flac': 'flac', 'flac24bit': 'flac24bit', 'hires': 'flac24bit' },
  tx: { '128k': '6', '192k': '7', '320k': '8', 'flac': '10', 'flac24bit': '11', 'hires': '11', 'atmos': '13', 'master': '14' },
  kw: { '128k': '128kmp3', '320k': '320kmp3', 'flac': '2000kflac', 'flac24bit': '4000kflac', 'hires': '4000kflac' },
  wy: { '128k': '128k', '192k': '128k', '320k': '320k', 'flac': 'flac', 'flac24bit': 'flac24bit', 'hires': 'hires', 'jyeffect': 'hires', 'sky': 'atmos', 'jymaster': 'master' },
  mg: { '128k': '128k', '320k': '320k', 'flac': 'flac', 'flac24bit': 'flac24bit' }
};

const GD_BR_MAP = { '128k': '128', '192k': '192', '320k': '320', 'flac': '740', 'flac24bit': '999', 'hires': '999' };
const CHKSZ_WY_LEVEL = { '128k': 'standard', '192k': 'exhigh', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'hires', 'hires': 'hires', 'jyeffect': 'jyeffect', 'sky': 'sky', 'jymaster': 'jymaster' };
const CHKSZ_TX_SIZE = { '128k': '128k', '192k': '320k', '320k': '320k', 'flac': 'flac', 'flac24bit': 'hires', 'hires': 'hires', 'atmos': 'master', 'master': 'master' };

// ==================== 工具函数 ====================
const httpFetch = (url, options = {}) => new Promise((resolve, reject) => {
  request(url, { timeout: 5000, ...options }, (err, resp) => {
    if (err) return reject(err);
    let body = resp.body;
    if (typeof body === 'string') {
      const t = body.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { body = JSON.parse(t); } catch (e) {}
      }
    }
    resolve({ statusCode: resp.statusCode, headers: resp.headers || {}, body });
  });
});

function mapQuality(quality, avail) {
  if (avail.includes(quality)) return quality;
  for (const q of QUALITY_ORDER) {
    if (avail.includes(q)) return q;
  }
  return avail[0] || '128k';
}

function getSongId(info) {
  return info?.hash || info?.songmid || info?.id || info?.rid || '';
}

// ==================== 缓存 ====================
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6小时
const MAX_CACHE_SIZE = 500;

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
  if (cache.size > MAX_CACHE_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

// ==================== 各平台URL解析器 ====================

/* ---- 酷狗（安妮代理） ---- */
async function resolveKgAnnie(info, quality) {
  const hash = info.SQFileHash || info.HQFileHash || info.FileHash || info.hash || info.songmid;
  if (!hash) throw new Error('缺少酷狗歌曲hash');
  const type = QUALITY_MAP.kg[quality] || '128k';
  const resp = await httpFetch(API.kgAnnie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, musicInfo: { source: 'kg', hash } })
  });
  if (resp.body?.code === 200 && resp.body?.data?.url) return resp.body.data.url;
  throw new Error(resp.body?.message || `酷狗安妮获取失败(code:${resp.body?.code})`);
}

/* ---- QQ（安妮vkeys） ---- */
async function resolveTxVkeys(info, quality) {
  const mid = info.songmid;
  if (!mid) throw new Error('缺少QQ songmid');
  const qc = QUALITY_MAP.tx[quality] || '6';
  const resp = await httpFetch(`${API.txVkeys}?mid=${mid}&quality=${qc}`);
  if (resp.body?.code === 200 && resp.body?.data?.url) return resp.body.data.url;
  throw new Error(resp.body?.message || `QQ vkeys获取失败(code:${resp.body?.code})`);
}

/* ---- 酷我（安妮mobi） ---- */
async function resolveKwMobi(info, quality) {
  const rid = info.rid || info.hash || info.songmid || info.id;
  if (!rid) throw new Error('缺少酷我歌曲ID');
  const br = QUALITY_MAP.kw[quality];
  if (!br) throw new Error('不支持的酷我音质');
  const params = {
    f: 'web', user: '0',
    source: 'kwplayerhd_ar_4.3.0.8_tianbao_T1A_qirui.apk',
    type: 'convert_url_with_sign', rid, br
  };
  const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const resp = await httpFetch(`${API.kwMobi}?${qs}`);
  if (resp.body?.code === 200 && resp.body?.data?.url) return resp.body.data.url;
  throw new Error(resp.body?.msg || `酷我mobi获取失败(code:${resp.body?.code})`);
}

/* ---- 网易（安妮c.wwwweb.top） ---- */
async function resolveWyWeb(info, quality) {
  const id = info.songmid || info.id || info.hash;
  if (!id) throw new Error('缺少网易歌曲ID');
  const level = QUALITY_MAP.wy[quality] || 'flac';
  const resp = await httpFetch(API.wyWeb, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { source: 'wy', musicId: id, quality: level }
  });
  const b = resp.body;
  if (b?.code === 200 && b?.url) return b.url;
  throw new Error(b?.message || `网易web获取失败(code:${b?.code})`);
}

/* ---- 星海后端接口（多平台通用） ---- */
async function resolveXhBackend(platform, info, quality, baseUrl) {
  const sourceMap = { wy: 'netease', tx: 'qq', kw: 'kw', kg: 'kg', mg: 'migu' };
  const source = sourceMap[platform] || platform;
  const params = { source, quality: quality || '' };
  params.songmid = info.songmid || info.id || '';
  params.name = info.name || '';
  params.singer = info.singer || '';
  params.albumName = info.albumName || info.album || '';
  params.interval = info.interval || '';

  if (platform === 'kg') {
    const types = info._types || {};
    params.mainHash = info.hash || '';
    if (types[quality]?.hash) params.hash = types[quality].hash;
    params.albumId = info.albumId || '';
  }

  const qs = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const url = `${baseUrl}?${qs}`;
  const resp = await httpFetch(url);
  const data = resp.body;
  if (data?.code === 200 && data?.url) {
    // 处理酷我加密链接
    if (platform === 'kw' && KW_DECRYPT_PROXY.allowEncryptedLossless && data.ekey && KW_DECRYPT_PROXY.url) {
      return `${KW_DECRYPT_PROXY.url}?${KW_DECRYPT_PROXY.urlParamName}=${encodeURIComponent(data.url)}&${KW_DECRYPT_PROXY.ekeyParamName}=${encodeURIComponent(data.ekey)}`;
    }
    return data.url;
  }
  throw new Error(data?.msg || `星海后端获取失败(code:${data?.code})`);
}

/* ---- 星海GD Studio（网易高音质） ---- */
async function resolveWyGdStudio(info, quality) {
  const id = info.songmid || info.id || info.hash;
  if (!id) throw new Error('缺少网易歌曲ID');
  const br = GD_BR_MAP[quality] || '320';
  const url = `${API.gdStudio}?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light&types=url&source=netease&id=${id}&br=${br}`;
  const resp = await httpFetch(url);
  if (resp.body?.url) return resp.body.url;
  // 若hires失败回退到flac
  if (quality === 'hires' || quality === 'flac24bit') {
    const fallbackUrl = `${API.gdStudio}?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light&types=url&source=netease&id=${id}&br=740`;
    const resp2 = await httpFetch(fallbackUrl);
    if (resp2.body?.url) return resp2.body.url;
  }
  throw new Error(resp.body?.msg || 'GD Studio获取失败');
}

/* ---- 星海ChKSz（网易SVIP/QQ高音质） ---- */
async function resolveWyChksz(info, quality) {
  if (!CHKSZ_APIKEY) throw new Error('ChKSz未配置apikey');
  const id = info.songmid || info.id || info.hash;
  if (!id) throw new Error('缺少网易歌曲ID');
  const level = CHKSZ_WY_LEVEL[quality];
  if (!level) throw new Error(`ChKSz不支持网易音质:${quality}`);
  const resp = await httpFetch(`${API.chkszWy}?id=${id}&level=${level}&apikey=${encodeURIComponent(CHKSZ_APIKEY)}`);
  if (resp.body?.code === 200 && resp.body?.data?.url) return resp.body.data.url;
  throw new Error(resp.body?.msg || 'ChKSz网易获取失败');
}

async function resolveTxChksz(info, quality) {
  if (!CHKSZ_APIKEY) throw new Error('ChKSz未配置apikey');
  const mid = info.songmid || info.id;
  if (!mid) throw new Error('缺少QQ mid');
  const size = CHKSZ_TX_SIZE[quality];
  if (!size) throw new Error(`ChKSz不支持QQ音质:${quality}`);
  const resp = await httpFetch(`${API.chkszTx}?mid=${mid}&size=${size}&type=json&apikey=${encodeURIComponent(CHKSZ_APIKEY)}`);
  if (resp.body?.code === 200 && resp.body?.url) return resp.body.url;
  throw new Error(resp.body?.msg || 'ChKSz QQ获取失败');
}

/* ---- 裤佬QSVIP搜索 ---- */
async function searchQsVip(keywords, page = 1, pageSize = 30) {
  if (!keywords) return { isEnd: true, list: [] };
  const urls = [API.qsVip, API.qsVipFallback];
  let lastErr = null;
  for (const baseUrl of urls) {
    try {
      const url = `${baseUrl}?act=search&keywords=${encodeURIComponent(keywords)}&page=${page}&pagesize=${pageSize}&type=music`;
      const resp = await httpFetch(url);
      const data = resp.body;
      if (data?.code === 200 && Array.isArray(data?.data?.list)) {
        const list = data.data.list.map(item => ({
          id: item.id || '',
          songmid: item.id || '',
          hash: item.id || '',
          name: item.name || '',
          singer: item.singer || item.artist || '',
          albumName: item.albumName || item.album || '',
          duration: item.duration || 0,
          pic: item.pic || item.cover || ''
        }));
        const total = Number(data.data.total) || list.length;
        return { isEnd: list.length < pageSize, list, total };
      }
      lastErr = new Error(data?.msg || 'QSVIP搜索异常');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('QSVIP搜索全部失败');
}

/* ---- 歌词/封面缓存 ---- */
const extraCache = new Map();

// ==================== 核心：获取音乐URL ====================
async function fetchMusicUrl(platform, info, quality) {
  const actualQuality = mapQuality(quality, MUSIC_QUALITIES[platform] || ['128k', '320k', 'flac']);
  const id = info.hash || info.songmid || info.id;
  if (!id) throw new Error('缺少歌曲标识符');

  // 按平台定义回退链
  const chains = {
    wy: [
      { name: 'ChKSz网易', fn: () => resolveWyChksz(info, actualQuality) },
      { name: 'GD Studio', fn: () => resolveWyGdStudio(info, actualQuality) },
      { name: 'c.wwwweb.top', fn: () => resolveWyWeb(info, actualQuality) },
      { name: '星海后端', fn: () => resolveXhBackend('wy', info, actualQuality, API.xhBackend) },
      { name: '星海后端(备)', fn: () => resolveXhBackend('wy', info, actualQuality, API.xhBackendFallback) }
    ],
    tx: [
      { name: 'ChKSz QQ', fn: () => resolveTxChksz(info, actualQuality) },
      { name: 'vkeys QQ', fn: () => resolveTxVkeys(info, actualQuality) },
      { name: '星海后端', fn: () => resolveXhBackend('tx', info, actualQuality, API.xhBackend) },
      { name: '星海后端(备)', fn: () => resolveXhBackend('tx', info, actualQuality, API.xhBackendFallback) }
    ],
    kw: [
      { name: '星海后端', fn: () => resolveXhBackend('kw', info, actualQuality, API.xhBackend) },
      { name: '酷我mobi', fn: () => resolveKwMobi(info, actualQuality) },
      { name: '星海后端(备)', fn: () => resolveXhBackend('kw', info, actualQuality, API.xhBackendFallback) }
    ],
    kg: [
      { name: '酷狗安妮', fn: () => resolveKgAnnie(info, actualQuality) },
      { name: '星海后端', fn: () => resolveXhBackend('kg', info, actualQuality, API.xhBackend) },
      { name: '星海后端(备)', fn: () => resolveXhBackend('kg', info, actualQuality, API.xhBackendFallback) }
    ],
    mg: [
      { name: '星海后端', fn: () => resolveXhBackend('mg', info, actualQuality, API.xhBackend) },
      { name: '星海后端(备)', fn: () => resolveXhBackend('mg', info, actualQuality, API.xhBackendFallback) }
    ]
  };

  const chain = chains[platform];
  if (!chain) throw new Error(`不支持的平台: ${platform}`);

  const errors = [];
  for (const provider of chain) {
    try {
      const url = await provider.fn();
      if (typeof url === 'string' && url.startsWith('http')) {
        extraCache.set(id, { provider: provider.name });
        return url;
      }
      errors.push(`${provider.name}: 返回无效URL`);
    } catch (e) {
      errors.push(`${provider.name}: ${e.message}`);
    }
  }
  throw new Error(`所有接口均失败: ${errors.join('; ')}`);
}

// ==================== 事件处理 ====================
on(EVENT_NAMES.request, async ({ action, source, info }) => {
  if (!source || !PLATFORMS.includes(source)) {
    throw new Error(`不支持的音乐源: ${source}`);
  }

  // 搜索
  if (action === 'search') {
    const keywords = info?.text || '';
    const page = info?.page || 1;
    const pageSize = info?.limit || 30;
    return searchQsVip(keywords, page, pageSize);
  }

  // 获取音乐URL
  if (action === 'musicUrl') {
    if (!info?.musicInfo || !info?.type) throw new Error('参数不完整');
    return fetchMusicUrl(source, info.musicInfo, info.type);
  }

  // 歌词（暂未实现独立歌词API，返回空）
  if (action === 'lyric') {
    return { lyric: '', tlyric: '' };
  }

  // 封面图
  if (action === 'pic') {
    const id = info?.musicInfo?.hash || info?.musicInfo?.songmid || info?.musicInfo?.id;
    return null;
  }

  throw new Error(`不支持的操作: ${action}`);
});

// ==================== 启动 ====================
const sources = {};
PLATFORMS.forEach(p => {
  sources[p] = {
    name: PLATFORM_NAMES[p],
    type: 'music',
    actions: ['search', 'musicUrl', 'lyric', 'pic'],
    qualitys: MUSIC_QUALITIES[p]
  };
});

send(EVENT_NAMES.inited, {
  status: true,
  openDevTools: false,
  sources
});