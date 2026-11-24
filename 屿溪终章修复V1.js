/*!
 * @name 屿溪-终章（修复版）
 * @description 山水两相离，此篇至终章
 * @version 0.1.0
 * @author 屿溪（接口修复：Kodi）
 * @homepage https://www.97abc.com/
 * 原版解析服务已停服（APP_UPGRADE_REQUIRED / sign+ticket），本版改为多通路容灾：
 *   主通路 星海音乐源公开聚合接口（按其公告要求标注来源、控制频率）
 *   备用通路 各平台公开取流接口（网易/GD API、QQ vkey、酷狗 playInfo、酷我 mobi）
 * 咪咕（mg）通路在本次实测中取流失败，已从音源列表中移除。
 * 仅做接口适配，不内置任何账号或密钥。
 */

const { EVENT_NAMES, request, on, send } = globalThis.lx;

const PLATFORM_NAME = {
  wy: '网易云音乐',
  tx: 'QQ音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐'
};

const SOURCE_QUALITY_LIST = {
  wy: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
  tx: ['128k', '320k', 'flac', 'flac24bit', 'atmos', 'atmos_plus', 'master'],
  kg: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
  kw: ['128k', '320k', 'flac', 'flac24bit', 'atmos', 'atmos_plus', 'master']
};

const LX_LEVELS = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'];

// 星海后端接受的档位名
const BACKEND_LEVEL = {
  master: 'master',
  atmos_plus: 'atmos',
  atmos: 'atmos',
  hires: 'hires',
  flac24bit: 'hires',
  flac: 'flac',
  '320k': '320k',
  '128k': '128k'
};

// 酷我 mobi 档位（br + format）
const KW_LEVEL = {
  master: ['320kmp3', 'mp3'],
  atmos_plus: ['320kmp3', 'mp3'],
  atmos: ['320kmp3', 'mp3'],
  hires: ['4000kflac', 'flac'],
  flac24bit: ['4000kflac', 'flac'],
  flac: ['2000kflac', 'flac'],
  '320k': ['320kmp3', 'mp3'],
  '128k': ['128kmp3', 'mp3']
};

const GD_BR = { master: 999, atmos_plus: 999, atmos: 999, hires: 999, flac24bit: 999, flac: 999, '320k': 320, '128k': 128 };

const TAG = '[屿溪-终章]';
const log = (...args) => console.log(TAG, ...args);

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

function parseBody(body) {
  if (body == null) return null;
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch (e) {
    return body;
  }
}

function httpFetch(url, options = {}) {
  const opts = Object.assign({}, options);
  const timeout = opts.timeout || 8000;
  delete opts.timeout;
  opts.headers = Object.assign({ 'User-Agent': UA_PC }, opts.headers || {});
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('请求超时'));
    }, timeout);
    request(url, opts, (err, resp) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) return reject(err instanceof Error ? err : new Error(String(err)));
      const raw = resp && resp.body;
      resolve({
        body: parseBody(raw),
        raw,
        statusCode: resp && resp.statusCode,
        headers: (resp && resp.headers) || {}
      });
    });
  });
}

function isHttpUrl(str) {
  return typeof str === 'string' && /^https?:\/\//i.test(str.trim());
}

function pick(url) {
  if (isHttpUrl(url)) return url.trim();
  return null;
}

function degradeOrder(level) {
  const idx = LX_LEVELS.indexOf(level);
  if (idx < 0) return ['320k', '128k'];
  return LX_LEVELS.slice(idx);
}

// ---------- 星海公开聚合接口 ----------
async function fromBackend(source, level, musicInfo) {
  const map = { wy: 'wy', tx: 'qq', kg: 'kg', kw: 'kw' };
  const params = { source: map[source], quality: BACKEND_LEVEL[level] || '320k' };
  if (source === 'kg') {
    params.songmid = musicInfo.songmid || musicInfo.id || '';
    params.albumId = musicInfo.albumId || (musicInfo.meta && musicInfo.meta.albumId) || '';
    params.mainHash = musicInfo.hash || '';
    params.hash = musicInfo.hash || '';
  } else {
    params.name = musicInfo.name || '';
    params.singer = musicInfo.singer || '';
    params.songmid = musicInfo.songmid || musicInfo.id || '';
    params.interval = musicInfo.interval || '';
    params.albumName = musicInfo.albumName || (musicInfo.meta && musicInfo.meta.albumName) || '';
  }
  const qs = Object.keys(params)
    .filter(k => params[k] !== '' && params[k] != null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const resp = await httpFetch('https://yy.zddyr.top/lx/api/?' + qs, { timeout: 8000 });
  const d = resp.body || {};
  const url = pick(d.url);
  if (d.code === 200 && url) return { url, quality: d.quality || level, from: '星海后端' };
  throw new Error(d.msg || ('后端返回 ' + (d.code == null ? resp.statusCode : d.code)));
}

// ---------- 网易云 ----------
async function fromWyGd(id, level) {
  const br = GD_BR[level] || 320;
  const resp = await httpFetch('https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=' + encodeURIComponent(id) + '&br=' + br, { timeout: 13000 });
  const d = resp.body || {};
  const url = pick(d.url);
  if (url) return { url, quality: level, from: 'GD API' };
  throw new Error('GD API 无链接');
}

function fromWyOuter(id) {
  return { url: 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(id) + '.mp3', quality: '128k', from: '网易外链' };
}

async function fromWyMeting(id, level) {
  const br = level === '128k' ? 128 : 320;
  const inst = ['https://api.qijieya.cn/meting/', 'https://metingapi.nanorocky.top/'];
  let lastErr;
  for (const base of inst) {
    try {
      const resp = await httpFetch(base + '?server=netease&type=url&br=' + br + '&id=' + encodeURIComponent(id), { timeout: 9000 });
      const loc = resp.headers && (resp.headers.location || resp.headers.Location);
      if (pick(loc)) return { url: loc, quality: level, from: 'Meting' };
      if (pick(resp.body)) return { url: resp.body, quality: level, from: 'Meting' };
      lastErr = new Error('Meting 未返回直链');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Meting 无链接');
}

// ---------- QQ 音乐 ----------
const QQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function qqPost(payload) {
  const resp = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
    body: JSON.stringify(payload),
    timeout: 9000
  });
  const d = resp.body;
  if (!d || typeof d !== 'object') throw new Error('QQ 接口返回异常');
  return d;
}

async function qqMediaMid(songmid) {
  const d = await qqPost({
    comm: { ct: 24, cv: 0 },
    req_1: { module: 'music.pf_song_detail_svr', method: 'get_song_detail', param: { song_mid: songmid } }
  });
  const ti = d.req_1 && d.req_1.data && d.req_1.data.track_info;
  if (!ti) throw new Error('QQ 歌曲信息缺失');
  return (ti.file && ti.file.media_mid) || ti.mid || songmid;
}

async function fromTxVkey(mid, level) {
  const mediaMid = await qqMediaMid(mid);
  const nameMap = {
    '128k': 'M500' + mediaMid + '.mp3',
    '320k': 'M800' + mediaMid + '.mp3',
    flac: 'F000' + mediaMid + '.flac',
    flac24bit: 'F000' + mediaMid + '.flac',
    hires: 'F000' + mediaMid + '.flac',
    atmos: 'M800' + mediaMid + '.mp3',
    atmos_plus: 'M800' + mediaMid + '.mp3',
    master: 'F000' + mediaMid + '.flac'
  };
  const filename = nameMap[level] || nameMap['128k'];
  const guid = '10000';
  const payload = {
    req: {
      module: 'CDN.SrfCdnDispatchServer',
      method: 'GetCdnDispatch',
      param: { guid: guid, calltype: 0, userip: '' }
    },
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid: guid,
        songmid: [mid],
        songtype: [0],
        uin: '0',
        loginflag: 1,
        platform: '20',
        filename: [filename]
      }
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 }
  };
  const d = await qqPost(payload);
  const sips = (d.req && d.req.data && d.req.data.sip) || [];
  const info = (d.req_0 && d.req_0.data && d.req_0.data.midurlinfo && d.req_0.data.midurlinfo[0]) || {};
  if (!info.purl) throw new Error('QQ 无播放权限(' + (info.result || info.errtype || 'empty') + ')');
  const hosts = [];
  sips.forEach(u => {
    const h = String(u).replace(/^https?:\/\//, '').split('/')[0];
    if (h && !/^\d+\.\d+\.\d+\.\d+$/.test(h)) hosts.push('https://' + h + '/');
  });
  hosts.push('https://ws.stream.qqmusic.qq.com/', 'https://isure.stream.qqmusic.qq.com/');
  return { url: hosts[0] + info.purl, quality: level, from: 'QQ vkey', altHosts: hosts, purl: info.purl };
}

// ---------- 酷狗 ----------
async function fromKgPlayInfo(hash) {
  const resp = await httpFetch('http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=' + encodeURIComponent(hash), {
    headers: { 'User-Agent': UA_MOBILE },
    timeout: 9000
  });
  const d = resp.body || {};
  const url = pick(d.url);
  if (url) return { url, quality: d.bitRate ? d.bitRate + 'k' : '128k', from: '酷狗 playInfo' };
  throw new Error('酷狗无直链(版权限制)');
}

// ---------- 酷我 ----------
async function fromKwMobi(rid, level, useCar) {
  const channels = useCar
    ? [{ base: 'http://anymatch.kuwo.cn/mobi.s', type: 'convert_url2', src: 'kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk' }]
    : [
        { base: 'https://mobi.kuwo.cn/mobi.s', type: 'convert_url_with_sign', src: 'kwplayer_ar_8.5.5.0_apk_keluze.apk' },
        { base: 'http://mobi.kuwo.cn/mobi.s', type: 'convert_url2', src: 'kwplayer_ar_8.5.5.0_apk_keluze.apk' }
      ];
  let lastErr;
  for (const ch of channels) {
    const br = KW_LEVEL[level] || KW_LEVEL['320k'];
    const qs = [
      'user=0',
      'source=' + encodeURIComponent(ch.src),
      'type=' + ch.type,
      'br=' + br[0],
      'format=' + br[1],
      'rid=' + encodeURIComponent(rid),
      'network=WIFI',
      'f=web',
      'mode=download'
    ].join('&') + (ch.type === 'convert_url_with_sign' ? '&sig=0' : '');
    try {
      const resp = await httpFetch(ch.base + '?' + qs, { headers: { 'User-Agent': UA_MOBILE }, timeout: 9000 });
      const body = resp.body;
      let url = null;
      let quality = level;
      if (body && typeof body === 'object' && body.data && body.data.url) {
        url = pick(body.data.url);
        if (body.data.bitrate) quality = body.data.bitrate + 'k';
      } else if (typeof body === 'string') {
        const m = /(?:^|\n)url=(https?:\/\/\S+)/.exec(body);
        if (m) url = m[1].trim();
      }
      if (url) return { url, quality, from: '酷我 mobi' };
      lastErr = new Error('酷我通道无链接');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('酷我无链接');
}

// ---------- 统一解析 ----------
function getRid(source, musicInfo) {
  if (!musicInfo) return '';
  if (source === 'kg') return musicInfo.hash || musicInfo.songmid || musicInfo.id || '';
  return musicInfo.songmid || musicInfo.id || musicInfo.hash || '';
}

async function resolveUrl(source, level, musicInfo) {
  const rid = getRid(source, musicInfo);
  if (!rid) throw new Error('缺少歌曲ID(songmid/hash)');
  const levels = degradeOrder(level);
  let lastErr = null;
  for (const lv of levels) {
    const attempts = [];
    attempts.push(() => fromBackend(source, lv, musicInfo));
    if (source === 'wy') {
      attempts.push(() => fromWyGd(rid, lv));
      attempts.push(async () => fromWyOuter(rid));
      attempts.push(() => fromWyMeting(rid, lv));
    } else if (source === 'tx') {
      attempts.push(() => fromTxVkey(rid, lv));
    } else if (source === 'kg') {
      attempts.push(() => fromKgPlayInfo(rid));
    } else if (source === 'kw') {
      attempts.push(() => fromKwMobi(rid, lv, false));
      attempts.push(() => fromKwMobi(rid, lv, true));
    }
    for (const fn of attempts) {
      try {
        const r = await fn();
        if (r && r.url) {
          log('解析成功', source, level, '->', r.quality, '(' + r.from + ')');
          return r.url;
        }
      } catch (e) {
        lastErr = e;
        log('通路失败', source, lv, e && e.message);
      }
    }
  }
  throw new Error('无可用播放链接：' + (lastErr && lastErr.message ? lastErr.message : '未知原因'));
}

on(EVENT_NAMES.request, async ({ action, source, info }) => {
  if (!SOURCE_QUALITY_LIST[source]) throw new Error('不支持音源：' + source);
  if (action !== 'musicUrl') throw new Error('不支持动作：' + action);
  const musicInfo = (info && info.musicInfo) || {};
  const level = (info && info.type) || '320k';
  return await resolveUrl(source, level, musicInfo);
});

(() => {
  const sources = {};
  Object.keys(SOURCE_QUALITY_LIST).forEach(key => {
    sources[key] = {
      name: PLATFORM_NAME[key],
      type: 'music',
      actions: ['musicUrl'],
      qualitys: SOURCE_QUALITY_LIST[key]
    };
  });
  send(EVENT_NAMES.inited, { status: true, sources: sources });
  log('初始化完成，可用音源：' + Object.keys(sources).join(','));
})();
