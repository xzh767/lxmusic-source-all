/*!
 * @name 回避聚合 (HuiBi Aggregate)
 * @version 0.0.1
 * @description 融合多源之精华，全平台母带/全景声，智能缓存+并发/顺序Fallback，支持酷我代理解密、ChKSz API。
 * @author 回避
 * @homepage https://github.com/your-repo/HuiBiAggregate
 * @license MIT
 * @update 2026-08-18
 * @changelog
 *   - 基于星澜 v3.2.0 与星海 v3.2.13 深度融合
 *   - 新增用户配置区域（酷我代理解密、ChKSz apikey）
 *   - 引入Token认证与客户端头（星海）
 *   - 保留全部后端池
 *   - 保留LRU缓存 + 并发/顺序Fallback
 *   - 保留_u()混淆编码
 *   - v0.0.1: 智能音质降级，超时5s，音质匹配校验，高音质后端优先
 *   - 移除自动更新检查
 *   - 酷狗速度优化：高音质8s超时，低音质3s超时
 *   - 强制最高音质优先，拒绝降级到低音质
 *
 * ==================== 借鉴源标注 ====================
 * 本音源综合以下开源音源之优点创作而成：
 * 1. 独家音源 v5        - 动态配置思想、指纹/版本校验、混淆编码
 * 2. 屿溪-终章          - 咪咕24bit/母带、酷狗/酷我官方接口、长青海棠
 * 3. K×H测试·暗香浮动夜  - 混淆编码、日志脱敏、音质降级链、API分组并发竞速、
 *                          QQ越权、ygking、残像、星海聚合、yunmge、念心、
 *                          HelloWorld签名、FishAPI签名、FFAPI、酷我代理解密、
 *                          Token认证、LRU缓存
 * 4. 玉宁熙-Pro          - 缓存系统、版本检查、音质分平台定义
 * 5. 星海音乐源 v2.2.8   - 动态源配置、服务器状态检查、音质映射
 * 6. 星澜聚合音源 v3.2.0 - QQ/WY/KW/KG/MG 全平台后端池、SHA256纯JS实现、
 *                          Promise.any并发、网易云EAPI加密
 * 7. 星海音乐源 v3.2.13  - ChKSz API 支持、酷我代理解密配置、GD API音质映射
 * ====================================================
 */

const { EVENT_NAMES, request, on, send, utils, env, version, currentScriptInfo } = globalThis.lx;

// ==================== 用户配置区域 ====================
const USER_CONFIG = {
    kwDecrypt: {
        url: '',
        allowEncryptedLossless: false,
        urlParamName: 'url',
        ekeyParamName: 'ekey',
    },
    chksz: {
        apikey: '',
        enableNetease: true,
        enableQQ: true,
    },
    debug: false,
};

// ==================== 解码函数 ====================
const _u = (str) => str.split('').map(c => String.fromCharCode(c.charCodeAt(0) + 5)).join('');

// ==================== 解析头部注解（支持 Cookie） ====================
const currentScript = currentScriptInfo
    ? currentScriptInfo.rawScript
    : (typeof document !== 'undefined' ? document.currentScript?.textContent || '' : '');

const parseHeader = (str) => {
    const comment = /^\/\*!(?:.|\n)+?\*\//.exec(str)?.[0];
    if (!comment) return {};
    const result = {};
    const pairs = [
        { key: 'tx_cookie', regex: /\*\s*@tx_cookie\s+(.+)/ },
        { key: 'wy_cookie', regex: /\*\s*@wy_cookie\s+(.+)/ },
    ];
    for (const { key, regex } of pairs) {
        const match = regex.exec(comment);
        const val = match?.[1]?.trim();
        result[key] = (!val || val === 'null') ? '' : val;
    }
    return result;
};
const config = parseHeader(currentScript);
const TX_COOKIE = config.tx_cookie;
const WY_COOKIE = config.wy_cookie;
const HAS_TX_COOKIE = !!TX_COOKIE;
const HAS_WY_COOKIE = !!WY_COOKIE;

// ==================== 音质列表（固定全音质） ====================
const MUSIC_QUALITY = {
    tx: ['128k','192k','320k','flac','flac24bit','hires','atmos','atmos_plus','master'],
    wy: ['128k','192k','320k','flac','flac24bit','hires','atmos','master'],
    kw: ['128k','192k','320k','flac','flac24bit'],
    kg: ['128k','192k','320k','flac','hires','atmos','master'],
    mg: ['128k','320k','flac'],
};
const MUSIC_SOURCE = Object.keys(MUSIC_QUALITY);
const QUALITY_PRIORITY = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k'];

// ==================== 工具函数 ====================
const httpFetch = (url, options = {}) => new Promise((resolve, reject) => {
    // 默认超时，高音质单独控制
    const timeout = options.timeout || 5000;
    const finalOptions = { ...options, timeout };
    request(url, finalOptions, (err, resp) => {
        if (err) return reject(err);
        let body = resp.body;
        if (typeof body === 'string') {
            const trimmed = body.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
                try { body = JSON.parse(trimmed); } catch (e) {}
            }
        }
        resolve({ body, statusCode: resp.statusCode, headers: resp.headers || {} });
    });
});

const md5 = (str) => utils.crypto.md5(str);
const randomGuid = () => {
    const hex = '0123456789abcdef';
    let guid = '';
    for (let i = 0; i < 32; i++) guid += hex[Math.floor(Math.random() * 16)];
    return guid;
};
const aesEncrypt = (data, key, iv, mode) => {
    if (!version) mode = mode.split('-').pop();
    return utils.crypto.aesEncrypt(data, mode, key, iv);
};
const buf2hex = (buffer) => {
    return version
        ? utils.buffer.bufToString(buffer, 'hex')
        : [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
};
const wyEapi = (url, object) => {
    const eapiKey = 'e82ckenh8dichen8';
    const text = typeof object === 'object' ? JSON.stringify(object) : object;
    const digest = md5('nobody' + url + 'use' + text + 'md5forencrypt');
    const data = url + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest;
    return { params: buf2hex(aesEncrypt(data, eapiKey, '', 'aes-128-ecb')).toUpperCase() };
};
const objToForm = (obj) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
const extractUrl = (obj, paths) => {
    for (const path of paths) {
        let val = obj;
        for (const key of path) {
            if (val == null) { val = undefined; break; }
            val = val[key];
        }
        if (Array.isArray(val)) val = val[0];
        if (typeof val === 'string' && (val.startsWith(_u('cook5**')) || val.startsWith(_u('cookn5**')))) return val;
        if (typeof val === 'string' && val.startsWith('//')) return 'https:' + val;
    }
    return '';
};
const cleanUrl = (url) => {
    if (!url) return '';
    const s = String(url).replace(/\\?u0026/gi, '&').replace(/\\&/g, '&').replace(/\$/g, '&');
    const idx = s.indexOf('?');
    return idx > 0 ? s.substring(0, idx) : s;
};
const qualityToLevel = (quality) => {
    const map = {
        '128k': 'standard', '192k': 'standard', '320k': 'exhigh',
        'flac': 'lossless', 'flac24bit': 'lossless', 'hires': 'lossless',
        'atmos': 'lossless', 'atmos_plus': 'lossless', 'master': 'lossless',
    };
    return map[quality] || 'standard';
};

const simpleGetQueryParam = (url, key) => {
    if (typeof url !== 'string' || !url) return null;
    const qIdx = url.indexOf('?');
    if (qIdx < 0) return null;
    const query = url.substring(qIdx + 1).split('#')[0];
    const pairs = query.split('&');
    for (const p of pairs) {
        const eq = p.indexOf('=');
        if (eq < 0) continue;
        if (p.substring(0, eq) === key) return decodeURIComponent(p.substring(eq + 1));
    }
    return null;
};

// ==================== 音质匹配校验（严格） ====================
const qualityMatch = (url, quality) => {
    if (!url) return false;
    const lower = url.toLowerCase();
    // 高音质不得是 .mp3，必须包含 .flac 或 .mflac 或 .wav 等无损格式
    if (quality === 'master' || quality === 'hires' || quality === 'flac24bit' || quality === 'atmos' || quality === 'atmos_plus') {
        return !lower.includes('.mp3') && (lower.includes('.flac') || lower.includes('.mflac') || lower.includes('.wav'));
    }
    if (quality === 'flac') {
        return lower.includes('.flac') && !lower.includes('.mp3');
    }
    // 128k/192k/320k 允许 mp3 或其它，但一般 mp3
    return true;
};

// ==================== SHA256 ====================
var HEX_CHARS = '0123456789abcdef'.split('');
function Sha256() {
    this.blocks = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    this.h0 = 0x6a09e667;
    this.h1 = 0xbb67ae85;
    this.h2 = 0x3c6ef372;
    this.h3 = 0xa54ff53a;
    this.h4 = 0x510e527f;
    this.h5 = 0x9b05688c;
    this.h6 = 0x1f83d9ab;
    this.h7 = 0x5be0cd19;
    this.block = this.start = this.bytes = this.hBytes = 0;
    this.finalized = this.hashed = false;
    this.first = true;
}
Sha256.prototype.update = function(message) {
    if (this.finalized) return;
    var notString = typeof message !== 'string';
    var blocks = this.blocks;
    for (var i = 0; i < message.length; i++) {
        if (this.hashed) {
            this.hashed = false;
            blocks[0] = this.block;
            blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
        }
        var code = notString ? message[i] : message.charCodeAt(i);
        blocks[this.start >> 2] |= code << (24 - (this.start % 4) * 8);
        this.start++;
        if (this.start === 64) {
            this.block = blocks[16];
            this.start = 0;
            this.hash();
            this.hashed = true;
        }
    }
    this.bytes += message.length;
    if (this.bytes > 4294967295) {
        this.hBytes += this.bytes / 4294967296 << 0;
        this.bytes = this.bytes % 4294967296;
    }
    return this;
};
Sha256.prototype.finalize = function() {
    if (this.finalized) return;
    this.finalized = true;
    var blocks = this.blocks;
    var i = this.start;
    blocks[16] = this.block;
    blocks[i >> 2] |= 0x80 << (24 - (i % 4) * 8);
    this.block = blocks[16];
    if (i >= 56) {
        if (!this.hashed) this.hash();
        blocks[0] = this.block;
        blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
    }
    blocks[14] = this.hBytes << 3 | this.bytes >>> 29;
    blocks[15] = this.bytes << 3;
    this.hash();
};
Sha256.prototype.hash = function() {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var a = this.h0, b = this.h1, c = this.h2, d = this.h3, e = this.h4, f = this.h5, g = this.h6, h = this.h7, blocks = this.blocks;
    for (var j = 0; j < 64; j++) {
        if (j >= 16) {
            var w0 = blocks[j - 15];
            var w1 = blocks[j - 2];
            var s0 = ((w0 >>> 7) | (w0 << 25)) ^ ((w0 >>> 18) | (w0 << 14)) ^ (w0 >>> 3);
            var s1 = ((w1 >>> 17) | (w1 << 15)) ^ ((w1 >>> 19) | (w1 << 13)) ^ (w1 >>> 10);
            blocks[j] = blocks[j - 16] + s0 + blocks[j - 7] + s1;
        }
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = h + S1 + ch + K[j] + (blocks[j] >>> 0);
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = S0 + maj;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
};
Sha256.prototype.hex = function() {
    this.finalize();
    var h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3, h4 = this.h4, h5 = this.h5, h6 = this.h6, h7 = this.h7;
    return HEX_CHARS[(h0 >> 28) & 0x0F] + HEX_CHARS[(h0 >> 24) & 0x0F] + HEX_CHARS[(h0 >> 20) & 0x0F] + HEX_CHARS[(h0 >> 16) & 0x0F] + HEX_CHARS[(h0 >> 12) & 0x0F] + HEX_CHARS[(h0 >> 8) & 0x0F] + HEX_CHARS[(h0 >> 4) & 0x0F] + HEX_CHARS[h0 & 0x0F] + HEX_CHARS[(h1 >> 28) & 0x0F] + HEX_CHARS[(h1 >> 24) & 0x0F] + HEX_CHARS[(h1 >> 20) & 0x0F] + HEX_CHARS[(h1 >> 16) & 0x0F] + HEX_CHARS[(h1 >> 12) & 0x0F] + HEX_CHARS[(h1 >> 8) & 0x0F] + HEX_CHARS[(h1 >> 4) & 0x0F] + HEX_CHARS[h1 & 0x0F] + HEX_CHARS[(h2 >> 28) & 0x0F] + HEX_CHARS[(h2 >> 24) & 0x0F] + HEX_CHARS[(h2 >> 20) & 0x0F] + HEX_CHARS[(h2 >> 16) & 0x0F] + HEX_CHARS[(h2 >> 12) & 0x0F] + HEX_CHARS[(h2 >> 8) & 0x0F] + HEX_CHARS[(h2 >> 4) & 0x0F] + HEX_CHARS[h2 & 0x0F] + HEX_CHARS[(h3 >> 28) & 0x0F] + HEX_CHARS[(h3 >> 24) & 0x0F] + HEX_CHARS[(h3 >> 20) & 0x0F] + HEX_CHARS[(h3 >> 16) & 0x0F] + HEX_CHARS[(h3 >> 12) & 0x0F] + HEX_CHARS[(h3 >> 8) & 0x0F] + HEX_CHARS[(h3 >> 4) & 0x0F] + HEX_CHARS[h3 & 0x0F] + HEX_CHARS[(h4 >> 28) & 0x0F] + HEX_CHARS[(h4 >> 24) & 0x0F] + HEX_CHARS[(h4 >> 20) & 0x0F] + HEX_CHARS[(h4 >> 16) & 0x0F] + HEX_CHARS[(h4 >> 12) & 0x0F] + HEX_CHARS[(h4 >> 8) & 0x0F] + HEX_CHARS[(h4 >> 4) & 0x0F] + HEX_CHARS[h4 & 0x0F] + HEX_CHARS[(h5 >> 28) & 0x0F] + HEX_CHARS[(h5 >> 24) & 0x0F] + HEX_CHARS[(h5 >> 20) & 0x0F] + HEX_CHARS[(h5 >> 16) & 0x0F] + HEX_CHARS[(h5 >> 12) & 0x0F] + HEX_CHARS[(h5 >> 8) & 0x0F] + HEX_CHARS[(h5 >> 4) & 0x0F] + HEX_CHARS[h5 & 0x0F] + HEX_CHARS[(h6 >> 28) & 0x0F] + HEX_CHARS[(h6 >> 24) & 0x0F] + HEX_CHARS[(h6 >> 20) & 0x0F] + HEX_CHARS[(h6 >> 16) & 0x0F] + HEX_CHARS[(h6 >> 12) & 0x0F] + HEX_CHARS[(h6 >> 8) & 0x0F] + HEX_CHARS[(h6 >> 4) & 0x0F] + HEX_CHARS[h6 & 0x0F] + HEX_CHARS[(h7 >> 28) & 0x0F] + HEX_CHARS[(h7 >> 24) & 0x0F] + HEX_CHARS[(h7 >> 20) & 0x0F] + HEX_CHARS[(h7 >> 16) & 0x0F] + HEX_CHARS[(h7 >> 12) & 0x0F] + HEX_CHARS[(h7 >> 8) & 0x0F] + HEX_CHARS[(h7 >> 4) & 0x0F] + HEX_CHARS[h7 & 0x0F];
};
const sha256 = (message) => new Sha256().update(message).hex();

// ==================== Fish API 签名 ====================
const FISH_DOMAIN = 'music.gdstudio.xyz';
const FISH_VERSION = '20260510';
const fishSign = async (secret) => {
    const timeRes = await httpFetch(_u('cookn5**') + FISH_DOMAIN + '/time', { method: 'GET', timeout: 3000 });
    const timeStr = String(Number(timeRes.body) || Date.now()).slice(0, 9);
    const signInput = FISH_DOMAIN + '|' + FISH_VERSION + '|' + timeStr + '|' + secret;
    return md5(signInput).slice(-8).toUpperCase();
};
const fishPost = async (params, secret) => {
    const sign = await fishSign(secret);
    params.s = sign;
    const body = objToForm(params);
    const res = await httpFetch(_u('cookn5**') + FISH_DOMAIN + '/api.php', {
        method: 'POST',
        timeout: 5000,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Origin: _u('cookn5**') + FISH_DOMAIN,
            Referer: _u('cookn5**') + FISH_DOMAIN + '/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: body,
    });
    return res.body;
};

// ==================== Hello World 常量 ====================
const HELLO_WORLD_API_KEY = 'lxmusic';
const HELLO_WORLD_SECRET_KEY = 'JaJ?a7Nwk_Fgj?2o:znAkst';
const HELLO_WORLD_SCRIPT_MD5 = '1888f9865338afe6d5534b35171c61a4';
const HELLO_WORLD_API_URL = _u('cookn5**33)gshpnd^)si((adln3n');
const helloWorldSign = (requestPath) => sha256(requestPath + HELLO_WORLD_SCRIPT_MD5 + HELLO_WORLD_SECRET_KEY);
const HYW_API_BASE = _u('cook5**,+.)24),3/)42');
const HYW_CARD_KEY = 'MOLAN-BAIJI';

// ==================== QQ 文件配置 ====================
const TX_FILE_CONFIG = {
    '128k': { s: 'M500', e: '.mp3', br: '128k' },
    '320k': { s: 'M800', e: '.mp3', br: '320k' },
    flac: { s: 'F000', e: '.flac', br: 'flac' },
    flac24bit: { s: 'AI00', e: '.flac', br: 'flac24bit' },
    hires: { s: 'AI00', e: '.flac', br: 'hires' },
    atmos: { s: 'AI00', e: '.flac', br: 'atmos' },
    atmos_plus: { s: 'AI00', e: '.flac', br: 'atmos' },
    master: { s: 'AI00', e: '.flac', br: 'master' },
};

// ==================== 网易云音质映射 ====================
const WY_LEVEL_MAP = {
    '128k': 'standard',
    '320k': 'exhigh',
    flac: 'lossless',
    flac24bit: 'hires',
    hires: 'hires',
    atmos: 'sky',
    master: 'jymaster',
};

// ==================== 酷我音质 Level 映射 ====================
const KW_LEVEL_MAP = {
    '128k': '128k',
    '192k': '128k',
    '320k': '320k',
    flac: 'lossless',
    flac24bit: 'lossless',
};
const KW_STREAM_LEVEL_MAP = {
    '128k': '128k',
    '192k': '128k',
    '320k': '320k',
    flac: 'flac',
    flac24bit: 'flac',
    hires: 'hires',
    atmos: 'atmos',
    atmos_plus: 'atmos_plus',
    master: 'master',
};

// ==================== 酷狗音质 Level 映射 ====================
const KG_LEVEL_MAP = {
    '128k': 'standard',
    '192k': 'standard',
    '320k': 'exhigh',
    flac: 'lossless',
    flac24bit: 'hires',
    hires: 'hires',
    atmos: 'atmos',
    atmos_plus: 'atmos',
    master: 'clear',
};

// ==================== QQ越权（3重策略） ====================
const getQQExploit = async (songId, quality, musicInfo) => {
    const songmid = songId || musicInfo?.songmid || musicInfo?.id;
    if (!songmid) throw new Error('QQ越权: 缺少 songmid');
    const mediaMid = musicInfo?.mediaMid || musicInfo?.strMediaMid || musicInfo?.media_mid || '';
    const prefixMap = { '128k':'M500','192k':'M800','320k':'M800','flac':'F000','flac24bit':'RS01','hires':'RS01','atmos':'atmosphere','atmos_plus':'atmosphere','master':'AIM00' };
    const prefix = prefixMap[quality] || 'M800';
    const extMap = { 'M500':'mp3','M800':'mp3','F000':'flac','RS01':'flac','AIM00':'mflac','atmosphere':'flac' };
    const ext = extMap[prefix] || 'mp3';
    const midForFile = mediaMid || songmid;
    const qqKey = '1984LZXvCR';
    const qqUin = '1234567890';
    const pgv_pvid = Math.floor(Math.random() * 10000000000).toString();
    const qqCookie = `qm_keyst=${qqKey}; uin=o${qqUin}; pgv_pvid=${pgv_pvid}; qqmusic_key=${qqKey}; qqmusic_uin=o${qqUin}; psrf_qqaccess_token=${qqKey}; ts_uid=${pgv_pvid}; psi=${pgv_pvid}`;

    const filename = `${prefix}${midForFile}.${ext}`;
    const bodyA = {
        comm: { ct: 19, cv: 0, guid: pgv_pvid, tmeAppID: 'qqmusic', qq: qqUin },
        hot: { method: 'CgiGetHotVkey', module: 'music.vkey.GetEVkey', param: { filename: [filename], songmid: [songmid] } },
        ekey: { method: 'GetEkey', module: 'music.vkey.GetEVkey', param: { finfo: [{ filename, mid: midForFile || '0' }] } }
    };
    try {
        const resp = await httpFetch(_u('cookn5**po)t)ll)^jh*^bd(]di*hpnd^p)a^b'), {
            method: 'POST', timeout: 5000,
            headers: { 'Content-Type': 'application/json', 'Referer': _u('cookn5**t)ll)^jh*'), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': qqCookie },
            body: JSON.stringify(bodyA)
        });
        const d = resp.body;
        if (d?.hot?.data?.urls?.[0]?.purl) {
            return _u('cookn5**_g)nom`\\h)llhpnd^)ll)^jh*') + d.hot.data.urls[0].purl;
        }
    } catch (e) {}

    const variants = [
        { filename: `${prefix}${songmid}${songmid}.${ext}`, uin: qqUin, loginflag: 1 },
        { filename: `${prefix}${songmid}.${ext}`, uin: qqUin, loginflag: 1 },
        { filename: `${prefix}${songmid}${songmid}.${ext}`, uin: '', loginflag: 1 },
        { filename: `${prefix}${songmid}.${ext}`, uin: '', loginflag: 1 }
    ];
    for (const v of variants) {
        try {
            const param = { filename: [v.filename], songmid: [songmid], songtype: [0], uin: v.uin, loginflag: v.loginflag, platform: '23', firstlogin: 1, newver: 1, nohash: 0, cms: 0 };
            const apiData = JSON.stringify({
                comm: { uin: v.uin ? parseInt(v.uin) : 0, format: 'json', ct: 23, cv: 0, ...(v.uin ? { qq: v.uin } : {}) },
                req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param }
            });
            const url = _u('cookn5**p)t)ll)^jh*^bd(]di*hpnd^p)a^b:ajmh\\o8enji!_\\o\\8') + encodeURIComponent(apiData);
            const resp = await httpFetch(url, {
                method: 'GET', timeout: 5000,
                headers: { 'Referer': _u('cookn5**t)ll)^jh*'), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': qqCookie }
            });
            const d = resp.body;
            if (d?.code === 0 && d?.req_0?.data?.midurlinfo?.[0]?.purl) {
                const sip = d.req_0.data.sip?.[0] || _u('cookn5**_g)nom`\\h)llhpnd^)ll)^jh*');
                return sip + d.req_0.data.midurlinfo[0].purl;
            }
        } catch (e) {}
    }

    try {
        const bodyC = {
            comm: { ct: 19, cv: 0, guid: pgv_pvid, tmeAppID: 'qqmusic', qq: qqUin },
            hot: { method: 'CgiGetHotVkey', module: 'music.vkey.GetEVkey', param: { filename: [filename], songmid: [songmid] } }
        };
        const resp = await httpFetch(_u('cookn5**po)t)ll)^jh*^bd(]di*hpnd^p)a^b'), {
            method: 'POST', timeout: 5000,
            headers: { 'Content-Type': 'application/json', 'Referer': _u('cookn5**t)ll)^jh*'), 'User-Agent': 'Mozilla/5.0 QQMusic/2201', 'Cookie': qqCookie },
            body: JSON.stringify(bodyC)
        });
        const d = resp.body;
        if (d?.hot?.data?.urls?.[0]?.purl) {
            return _u('cookn5**_g)nom`\\h)llhpnd^)ll)^jh*') + d.hot.data.urls[0].purl;
        }
    } catch (e) {}

    throw new Error('QQ越权全部失败');
};

// -------- ygking QQ --------
const getYgkingTx = async (songId, quality, musicInfo) => {
    const mid = musicInfo?.songmid || musicInfo?.strMediaMid || musicInfo?.mediaMid || songId;
    if (!mid) throw new Error('ygking: 缺少 mid');
    const qMap = { '128k':'128','192k':'320','320k':'320','flac':'flac','flac24bit':'hires','hires':'hires','master':'master','atmos':'master','atmos_plus':'master' };
    const q = qMap[quality] || '320';
    const url = _u('cookn5**\\kd)tbfdib)^i*\\kd*njib*pmg:hd_8') + encodeURIComponent(mid) + _u('!lp\\gdot8') + q;
    const resp = await httpFetch(url, { method: 'GET', timeout: 5000 });
    const d = resp.body;
    if (d?.code === 0 && d?.data?.[mid]) {
        return d.data[mid];
    }
    throw new Error('ygking 失败');
};

// -------- 残像 WY --------
const getCanxiang = async (songId, quality, musicInfo) => {
    const id = musicInfo?.songId || musicInfo?.id || songId;
    const name = musicInfo?.songName || musicInfo?.name || '';
    const singer = musicInfo?.singer || '';
    const qMap = { '128k':'128k','192k':'320k','320k':'320k','flac':'flac','flac24bit':'hires','hires':'hires','master':'jymaster','atmos':'jymaster','atmos_plus':'jymaster' };
    const type = qMap[quality] || '320k';
    const token = 'canxiang_token_2026';
    let params = { token, type };
    if (id) params.id = String(id);
    else if (name) { params.msg = name + (singer ? ' ' + singer : ''); params.n = 1; }
    else throw new Error('残像: 缺少 id 或歌名');
    const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    const url = _u('cookn5**\\kd)^\\isd\\ib)^i*\\kd*rtthpnd^:') + query;
    const resp = await httpFetch(url, { method: 'GET', timeout: 5000 });
    const d = resp.body;
    if (d?.code === 200 && d?.data?.url) {
        return d.data.url;
    }
    throw new Error('残像 失败');
};

// -------- 星海聚合 --------
const getXinghai = async (platform, songId, quality, musicInfo) => {
    const sourceMap = { kw: 'kw', kg: 'kg', mg: 'migu' };
    const source = sourceMap[platform];
    if (!source) throw new Error('星海聚合: 不支持平台 ' + platform);
    const id = platform === 'kg' ? (musicInfo?.hash || songId) : (musicInfo?.songmid || musicInfo?.rid || songId);
    if (!id) throw new Error('星海聚合: 缺少 id');
    const name = musicInfo?.name || musicInfo?.songName || '';
    const singer = musicInfo?.singer || '';
    const qMap = { '128k':'128kmp3','192k':'320kmp3','320k':'320kmp3','flac':'flac','flac24bit':'hires','hires':'hires','master':'flac','atmos':'flac','atmos_plus':'flac' };
    const qualityParam = qMap[quality] || '320kmp3';
    const url = _u('cookn5**\\kd)sdibc\\d)^jh*gs*\\kd*:njpm^`8') + source + _u('!i\\h`8') + encodeURIComponent(name + ' ' + singer) + _u('!njibhd_8') + encodeURIComponent(id) + _u('!lp\\gdot8') + qualityParam;
    const resp = await httpFetch(url, { method: 'GET', timeout: 5000 });
    const d = resp.body;
    if (d?.code === 200 && d?.url) return d.url;
    throw new Error('星海聚合 失败');
};
const getXinghaiKw = (songId, quality, musicInfo) => getXinghai('kw', songId, quality, musicInfo);
const getXinghaiKg = (songId, quality, musicInfo) => getXinghai('kg', songId, quality, musicInfo);
const getXinghaiMg = (songId, quality, musicInfo) => getXinghai('mg', songId, quality, musicInfo);

// -------- yunmge 酷我 --------
const getYunmgeKw = async (songId, quality, musicInfo) => {
    const id = musicInfo?.rid || musicInfo?.songmid || songId;
    if (!id) throw new Error('yunmge: 缺少 id');
    const brMap = { '128k':128, '192k':192, '320k':320, 'flac':2000, 'flac24bit':2000, 'hires':4000, 'master':4000 };
    const wantBr = brMap[quality] || 320;
    const url = _u('cookn5**\\kd)tpihb`)^jh*fprj:f`t8tpihb`Zf`t!ojf`i8tpihb`Zojf`i!d_8') + encodeURIComponent(id);
    const resp = await httpFetch(url, { method: 'GET', timeout: 5000 });
    const d = resp.body;
    if (d?.code === 200 && d?.data?.all_bitrates) {
        const list = d.data.all_bitrates;
        const brOrder = [4000, 2000, 320, 192, 128];
        for (const br of brOrder) {
            if (br < wantBr) continue;
            const item = list.find(b => b.bitrate === br || String(b.bitrate) === String(br));
            if (item && item.play_url) return item.play_url;
        }
        const fallback = list.find(b => b.play_url);
        if (fallback) return fallback.play_url;
    }
    throw new Error('yunmge 失败');
};

// -------- 念心酷狗 --------
const getNianxinKg = async (songId, quality, musicInfo) => {
    const hash = musicInfo?.hash || musicInfo?.songmid || songId;
    if (!hash) throw new Error('念心: 缺少 hash');
    const levelMap = { '128k':'128kmp3','192k':'320kmp3','320k':'320kmp3','flac':'2000kflac','flac24bit':'4000kflac','hires':'hires','master':'4000kflac','atmos':'4000kflac','atmos_plus':'4000kflac' };
    const level = levelMap[quality] || '320kmp3';
    const url = _u('cookn5**h^k)id\\isdisu)^jh*fbll*fb)kck:d_8') + encodeURIComponent(hash) + _u('!g`q`g8') + level + _u('!otk`8hk.');
    const resp = await httpFetch(url, { method: 'GET', timeout: 5000 });
    const d = resp.body;
    if (d?.code === 200 && d?.url) return d.url;
    if (typeof d === 'string' && d.startsWith('http')) return d;
    throw new Error('念心 失败');
};

// ==================== FFAPI ====================
const extractFFURL = (d) => {
    if (!d || typeof d !== 'object') return '';
    if (typeof d.url === 'string' && d.url.startsWith('http')) return d.url;
    if (d.data) {
        if (typeof d.data === 'string' && d.data.startsWith('http')) return d.data;
        if (typeof d.data.url === 'string' && d.data.url.startsWith('http')) return d.data.url;
        if (typeof d.data.play_url === 'string' && d.data.play_url.startsWith('http')) return d.data.play_url;
        if (d.data.vipmusic && typeof d.data.vipmusic.url === 'string' && d.data.vipmusic.url.startsWith('http')) return d.data.vipmusic.url;
        if (Array.isArray(d.data) && d.data[0]) {
            if (typeof d.data[0].url === 'string' && d.data[0].url.startsWith('http')) return d.data[0].url;
            if (typeof d.data[0] === 'string' && d.data[0].startsWith('http')) return d.data[0];
        }
    }
    return '';
};
const getFFAPI = async (songmid, quality, musicInfo) => {
    const src = (musicInfo && musicInfo.source) || '';
    const id = songmid || '';
    if (!id) return '';
    let page = '';
    if (src === 'tx') page = 'https://y.qq.com/n/ryqq/songDetail/' + id;
    else if (src === 'wy') page = 'https://music.163.com/song?id=' + id;
    else if (src === 'kw') page = 'https://www.kuwo.cn/play_detail/' + id;
    else if (src === 'kg') page = 'https://www.kugou.com/song/#hash=' + id;
    else if (src === 'mg') page = 'https://music.migu.cn/v3/music/song/' + id;
    else return '';
    const res = await httpFetch('https://ffapi.cn/int/v2/songurl?url=' + encodeURIComponent(page), { method: 'GET', timeout: 5000 });
    const d = res && res.body;
    if (typeof d === 'string') {
        try { const j = JSON.parse(d); return extractFFURL(j); } catch (e) { return ''; }
    }
    return extractFFURL(d);
};

// ==================== ChKSz 接口 ====================
const CHKSZ_CONFIG = USER_CONFIG.chksz;
const CHKSZ_NETEASE_LEVEL_MAP = {
    '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless',
    'hires': 'hires', 'atmos': 'jymaster', 'master': 'jymaster'
};
const CHKSZ_QQ_SIZE_MAP = {
    '128k': '128k', '192k': '320k', '320k': '320k',
    'flac': 'flac', 'hires': 'hires',
    'atmos': 'master', 'atmos_plus': 'master', 'master': 'master'
};
const getChkszWy = async (id, quality) => {
    const level = CHKSZ_NETEASE_LEVEL_MAP[quality];
    if (!level) throw new Error('chksz不支持该品质');
    const url = `https://api.chksz.com/api/163_music?id=${id}&level=${level}&apikey=${encodeURIComponent(CHKSZ_CONFIG.apikey)}`;
    const resp = await httpFetch(url, { timeout: 5000 });
    if (resp.statusCode !== 200 || resp.body.code !== 200 || !resp.body.data?.url)
        throw new Error(`chksz网易失败: ${resp.body?.msg || '无url'}`);
    return resp.body.data.url;
};
const getChkszTx = async (mid, quality) => {
    const size = CHKSZ_QQ_SIZE_MAP[quality];
    if (!size) throw new Error('chksz不支持该品质');
    const url = `https://api.chksz.com/api/qq_music?mid=${mid}&size=${size}&type=json&apikey=${encodeURIComponent(CHKSZ_CONFIG.apikey)}`;
    const resp = await httpFetch(url, { timeout: 5000 });
    if (resp.statusCode !== 200 || resp.body.code !== 200 || !resp.body.url)
        throw new Error(`chksz QQ失败: ${resp.body?.msg || '无url'}`);
    return resp.body.url;
};

// ==================== 酷我代理解密 ====================
const KW_DECRYPT_PROXY = USER_CONFIG.kwDecrypt;
const processKwEncryptedUrl = (data, source) => {
    if (source !== 'kw' || !KW_DECRYPT_PROXY.allowEncryptedLossless) return data?.url || '';
    let ekey = data?.ekey || simpleGetQueryParam(data?.url, 'ekey') || '';
    if (!ekey || !KW_DECRYPT_PROXY.url) return data?.url || '';
    const rawUrl = typeof data.url === 'string' ? data.url : String(data.url);
    try {
        return `${KW_DECRYPT_PROXY.url}?${KW_DECRYPT_PROXY.urlParamName}=${encodeURIComponent(rawUrl)}&${KW_DECRYPT_PROXY.ekeyParamName}=${encodeURIComponent(ekey)}`;
    } catch (e) { return rawUrl; }
};

// ==================== Token 认证 ====================
let userToken = '';
let tokenTimestamp = 0;
const TOKEN_TTL = 5 * 60 * 1000;
let deviceId = '';
let clientHeader = '';

const generateDeviceId = () => 'lx-online-' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
const buildClientHeader = () => {
    let deviceType = 'unknown';
    try {
        const p = (env?.platform || '').toLowerCase();
        if (p.includes('android')) deviceType = 'Android';
        else if (p.includes('ios')) deviceType = 'iOS';
        else if (p.includes('win')) deviceType = 'Windows';
        else if (p.includes('mac')) deviceType = 'macOS';
        else if (p.includes('linux')) deviceType = 'Linux';
    } catch (e) {}
    return `HuiBiAggregate/v0.0.1 (${deviceType})`;
};
const generateToken = (ip) => {
    if (!deviceId) deviceId = generateDeviceId();
    const payload = {
        device_id: deviceId,
        ip: ip || '0.0.0.0',
        timestamp: Math.floor(Date.now() / 1000),
        random: Math.random().toString(36).substring(2, 12)
    };
    tokenTimestamp = Date.now();
    try {
        if (globalThis.lx?.utils?.buffer?.from) {
            const buf = globalThis.lx.utils.buffer.from(JSON.stringify(payload), 'utf-8');
            return globalThis.lx.utils.buffer.bufToString(buf, 'base64');
        }
        if (typeof Buffer !== 'undefined') return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
        return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch (e) { return ''; }
};
const ensureTokenFresh = () => {
    if (!userToken || (Date.now() - tokenTimestamp) > TOKEN_TTL) {
        userToken = generateToken(null);
    }
};

// ==================== 缓存系统 ====================
const CACHE_TTL_MS = 21600000;
const CACHE_MAX_SIZE = 300;
const urlCache = new Map();
const getCachedUrl = (key) => {
    const entry = urlCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        urlCache.delete(key);
        return null;
    }
    return entry.url;
};
const setCachedUrl = (key, url) => {
    urlCache.set(key, { url, timestamp: Date.now() });
    if (urlCache.size > CACHE_MAX_SIZE) {
        const oldest = urlCache.keys().next().value;
        if (oldest) urlCache.delete(oldest);
    }
};
const buildCacheKey = (source, songId, quality) => `${source}_${songId}_${quality}`;

// ==================== 后端定义 ====================

// -------- QQ 音乐后端 --------
const TX_BACKENDS = [
    ...(CHKSZ_CONFIG.apikey && CHKSZ_CONFIG.enableQQ ? [{ name: 'ChKSz QQ', fetch: async (songId, quality, info) => getChkszTx(info?.songmid || songId, quality) }] : []),
    { name: 'ygking QQ', fetch: getYgkingTx },
    { name: 'QQ越权', fetch: getQQExploit },
    { name: 'QQ官方', fetch: async (songmid, quality) => {
        const fileInfo = TX_FILE_CONFIG[quality];
        if (!fileInfo) throw new Error('不支持的音质');
        const guid = randomGuid();
        const file = fileInfo.s + songmid + fileInfo.e;
        const reqData = {
            req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { filename: [file], guid, songmid: [songmid], songtype: [0], uin: '0', loginflag: HAS_TX_COOKIE ? 1 : 0, platform: '20' } },
            loginUin: '0',
            comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
        };
        const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: _u('cookn5**t)ll)^jh*') };
        if (HAS_TX_COOKIE) headers.Cookie = TX_COOKIE;
        const res = await httpFetch(_u('cookn5**p)t)ll)^jh*^bd(]di*hpnd^p)a^b'), { method: 'POST', headers, body: JSON.stringify(reqData) });
        const d = res.body;
        if (d && d.req_0 && d.req_0.data && d.req_0.data.midurlinfo && d.req_0.data.midurlinfo[0] && d.req_0.data.midurlinfo[0].purl) {
            const sip = d.req_0.data.sip || [_u('cookn5**dnpm`)nom`\\h)llhpnd^)ll)^jh*')];
            return sip[Math.floor(Math.random() * sip.length)] + d.req_0.data.midurlinfo[0].purl;
        }
        throw new Error('QQ官方: 无数据');
    } },
    { name: '星海主后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8ll!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海主后端: ' + (d?.msg || '无数据'));
    } },
    { name: '星海备后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8ll!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海备后端: ' + (d?.msg || '无数据'));
    } },
    { name: 'HelloWorld QQ', fetch: async (songmid, quality, musicInfo) => {
        const keyword = encodeURIComponent(musicInfo?.name || musicInfo?.songName || '');
        if (!keyword) throw new Error('HelloWorld QQ: 缺少歌曲名');
        const qMap = { '128k': '0', '320k': '1', 'flac': '4', 'master': '5' };
        const type = qMap[quality] || '1';
        const url = _u('cookn5**\\)\\\\)^\\]*ll)hpnd^:hnb8') + keyword + _u('!i8,!otk`8') + type;
        const res = await httpFetch(url, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d) {
            if (d.data?.music && typeof d.data.music === 'string' && d.data.music.startsWith('http')) return d.data.music;
            if (d.playUrl && typeof d.playUrl === 'string' && d.playUrl.startsWith('http')) return d.playUrl;
            if (d.url && typeof d.url === 'string' && d.url.startsWith('http')) return d.url;
            if (d.data?.url && typeof d.data.url === 'string' && d.data.url.startsWith('http')) return d.data.url;
        }
        throw new Error('HelloWorld QQ: 无有效链接');
    } },
    { name: '溯音QQ', fetch: async (songmid, quality) => {
        const brMap = { '128k': '7', '320k': '5', flac: '4', flac24bit: '1', hires: '1', atmos: '1', master: '1' };
        const br = brMap[quality] || '7';
        const res = await httpFetch(_u('cookn5**jd\\kd)i`o*\\kd*LLZHpnd^:f`t8jd\\kd(`a1,..]2(\\^-a(_^2_(323^(_.`-+2\\3-020!otk`8enji!]m8') + br + '&n=1&mid=' + songmid, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['data', 'music'], ['data', 'url'], ['url']]);
        if (url) return url;
        throw new Error('溯音QQ: 无数据');
    } },
    { name: 'xcvts', fetch: async (songmid, quality) => {
        const apiKeys = ['78993344b9bf1105655599009cdba3d2', 'ce778eb0d1858edfb4b2071a115f1edf'];
        const qualityMap = { '128k': 'standard', '320k': 'exhigh', flac: 'lossless', flac24bit: 'hires' };
        const q = qualityMap[quality] || 'standard';
        const errors = [];
        for (const key of apiKeys) {
            try {
                const res = await httpFetch(_u('cookn5**\\kd)s^qon)^i*\\kd*hpnd^*ll:\\kdF`t8') + key + '&mid=' + songmid + '&type=' + q, { method: 'GET', timeout: 5000 });
                const d = res.body;
                const url = extractUrl(d, [['data', 'music'], ['data', 'url'], ['url']]);
                if (url) return url;
            } catch (e) { errors.push(e.message); }
        }
        throw new Error('xcvts: ' + errors.join(' | '));
    } },
    { name: 'vkeys', fetch: async (songmid, quality) => {
        const qualityMap = { '128k': '8', '320k': '9', flac: '10', flac24bit: '16', hires: '14', atmos: '13', atmos_plus: '12', master: '11' };
        const q = qualityMap[quality];
        if (!q) throw new Error('vkeys 不支持的音质');
        const res = await httpFetch(_u('cookn5**\\kd)qf`tn)^i*q-*hpnd^*o`i^`io*b`opmg:hd_8') + songmid + '&quality=' + q, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data && d.data.url) return d.data.url;
        if (d && d.url) return d.url;
        throw new Error('vkeys: 无数据');
    } },
    { name: 'vkeys旧版', fetch: async (songmid, quality) => {
        const qualityMap = { '128k': '8', '320k': '9', flac: '10', flac24bit: '16', hires: '14', atmos: '13', atmos_plus: '12', master: '11' };
        const q = qualityMap[quality];
        if (!q) throw new Error('vkeys旧版 不支持的音质');
        const res = await httpFetch(_u('cookn5**\\kd)qf`tn)^i*hpnd^*o`i^`io*njib*gdif:hd_8') + songmid + '&quality=' + q, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['data', 'url'], ['url']]);
        if (url) return url;
        throw new Error('vkeys旧版: 无数据');
    } },
    { name: '柳云API', fetch: async (songmid, quality) => {
        const qualityMap = { '128k': '128k', '320k': '320k', flac: 'flac', flac24bit: 'master', hires: 'atmos', atmos: 'atmos', atmos_plus: 'atmos', master: 'master' };
        const q = qualityMap[quality] || '128k';
        let card = '';
        try {
            const cardRes = await httpFetch(_u('cookn5**bdocp])^jh*>c\\mg`nKdf\\^cp*hpnd^_g*m`g`\\n`n*_jrigj\\_*f`tn*]\\dhpnd^)oso'), { method: 'GET', timeout: 5000 });
            card = String(cardRes.body || '').trim();
        } catch (e) {}
        const res = await httpFetch(_u('cookn5**\\kd)gdptpid_^)^i*]\\dhpnd^*hpnd^pmg)kck:njpm^`8os!hpnd^D_8') + songmid + '&quality=' + q + (card ? '&card=' + encodeURIComponent(card) : ''), { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('柳云API: 无数据');
    } },
    { name: '317ak', fetch: async (songmid, quality) => {
        const brMap = { '128k': '5', '320k': '6', flac: '8', flac24bit: '7', hires: '9', atmos: '10', atmos_plus: '10', master: '10' };
        const br = brMap[quality] || '5';
        const res = await httpFetch(_u('cookn5**\\kd).,2\\f)^i*\\kd*tditp`*lltditp`:^f`t8UF21LE>DC0KKD>EJJSPC!d8') + songmid + '&br=' + br + '&type=json&lrc=1', { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('317ak: 无数据');
    } },
    { name: '玉宁熙', fetch: async (songmid, quality) => {
        const qualityMap = { '128k': '标准', '320k': 'HQ', flac: 'SQ', flac24bit: '母带', hires: '母带', atmos: '母带', master: '母带' };
        const q = qualityMap[quality] || '标准';
        const res = await httpFetch(_u('cookn5**\\kd(q-)tp\\a`ib)^i*<KD*llhpnd^)kck:otk`8') + encodeURIComponent(q) + '&mid=' + songmid + '&apikey=3ff23523e47465224a3f48579acf41f241540ce04b6cc0b94164f37a5b6299d5', { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data && d.data.music) return d.data.music;
        throw new Error('玉宁熙: 无数据');
    } },
    { name: '收集聚合', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**^t\\kd)ojk*<KD*llZhpnd^)kck:\\kdf`t8,aa_a02..a0_0.321+`1._2`/1]\\,2/.3_4a2]4_a^,3^0,]`,,+4.31a_2/^.\\,!otk`8enji!hd_8') + songmid, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.url) return d.url;
        throw new Error('收集聚合: 无数据');
    } },
    { name: 'lxmusic88', fetch: async (songmid, quality) => {
        try {
            const res = await httpFetch(_u('cookn5**33)gshpnd^)si((adln3n*gshpnd^q/*pmg*os*') + songmid + '/' + quality, { method: 'GET', timeout: 5000, headers: { 'x-request-key': 'lxmusic' } });
            const d = res.body;
            if (d && (d.code === 0 || d.code === 200) && d.data) return d.data;
            if (d && d.url) return d.url;
        } catch (e) {}
        const res = await httpFetch(_u('cookn5**33)gshpnd^)si((adln3n*gshpnd^q.*pmg*os*') + songmid + '/' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data) return d.data;
        throw new Error('lxmusic88: 无数据');
    } },
    { name: '念心直链', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**hpnd^)isdisu)^jh*fbll*os)kck:d_8') + songmid + '&level=' + quality + '&type=mp3', { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d;
        if (d && d.url) return d.url;
        throw new Error('念心直链: 无数据');
    } },
    { name: '妖狐', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*llZkgpn:d_8') + songmid + '&level=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('妖狐: 无数据');
    } },
    { name: 'ChKsZ', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)^cfnu)ojk*\\kd'), { method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'qq', songmid, quality }) });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('ChKsZ: ' + (d?.msg || '无数据'));
    } },
    { name: 'Huibq', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**gshpnd^\\kd)jim`i_`m)^jh*pmg*os*') + songmid + '/' + quality, { method: 'GET', timeout: 5000, headers: { 'X-Request-Key': 'share-v3' } });
        const d = res.body;
        if (d && d.code === 0) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('Huibq: 无数据');
    } },
    { name: '聚合API', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*os'), { method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicInfo: { songmid }, type: quality }) });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('聚合API: 无数据');
    } },
    { name: 'FishAPI', fetch: async (songmid, quality) => {
        const brMap = { '128k': 128, '320k': 320, flac: 740, flac24bit: 999 };
        const br = brMap[quality];
        if (!br) throw new Error('FishAPI 不支持的音质');
        const result = await fishPost({ types: 'url', id: songmid, source: 'qq', br: br }, encodeURIComponent(songmid));
        const url = result && result.url ? cleanUrl(String(result.url)) : '';
        if (url.startsWith('http')) return url;
        throw new Error('FishAPI: 无数据');
    } },
    { name: 'HYWmusic', fetch: async (songmid, quality) => {
        const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=tx&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, { method: 'GET', timeout: 5000, headers: { 'X-Card-Key': HYW_CARD_KEY } });
        const d = res.body;
        if (d && d.code === 200) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('HYWmusic: 无数据');
    } },
    { name: 'FFAPI', fetch: getFFAPI },
];

// -------- 网易云音乐后端 --------
const WY_BACKENDS = [
    ...(CHKSZ_CONFIG.apikey && CHKSZ_CONFIG.enableNetease ? [{ name: 'ChKSz 网易', fetch: async (songId, quality) => getChkszWy(songId, quality) }] : []),
    { name: '残像 WY', fetch: async (songId, quality) => {
        const info = { songId: songId, songName: '', singer: '' };
        return getCanxiang(songId, quality, info);
    } },
    { name: '网易云官方', fetch: async (songmid, quality) => {
        const level = WY_LEVEL_MAP[quality] || 'standard';
        const targetUrl = _u('cookn5**dio`ma\\^`.)hpnd^),1.)^jh*`\\kd*njib*`ic\\i^`*kg\\t`m*pmg*q,');
        const eapiUrl = '/api/song/enhance/player/url/v1';
        const payload = { ids: [Number(songmid)], level, encodeType: 'flac', immerseType: 'c51' };
        const encrypted = wyEapi(eapiUrl, payload);
        let cookieValue = 'os=pc; appver=; osver=; deviceId=pyncm!';
        if (HAS_WY_COOKIE) cookieValue = WY_COOKIE + '; ' + cookieValue;
        const res = await httpFetch(targetUrl, {
            method: 'POST', timeout: 5000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
                Referer: _u('cookn5**hpnd^),1.)^jh*'),
                Cookie: cookieValue,
            },
            form: encrypted,
        });
        const d = res.body;
        if (d && d.data && d.data[0] && d.data[0].url && !d.data[0].freeTrialInfo) return d.data[0].url;
        if (d && d.data && d.data[0] && d.data[0].freeTrialInfo) throw new Error('VIP歌曲仅试听（配置Cookie后可用完整版）');
        throw new Error('网易云官方: 无数据');
    } },
    { name: 'ChKsZ-VIP', fetch: async (songmid, quality) => {
        const level = WY_LEVEL_MAP[quality] || 'standard';
        const res = await httpFetch(_u('cookn5**\\kd)^cfnu)ojk*\\kd*,1.Zhpnd^:d_8') + songmid + '&level=' + level, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('ChKsZ-VIP: ' + (d?.msg || '无数据'));
    } },
    { name: '笒鬼鬼', fetch: async (songmid, quality) => {
        const level = WY_LEVEL_MAP[quality] || 'standard';
        const res = await httpFetch(_u('cookn5**\\kd)^`ibpdbpd)^i*\\kd*i`o`\\n`*hpnd^Zq,)kck:d_8') + songmid + '&type=json&level=' + level, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data && d.data.url) return d.data.url;
        if (d && d.url) return d.url;
        throw new Error('笒鬼鬼: 无数据');
    } },
    { name: 'ikun网易云', fetch: async (songmid, quality, musicInfo) => {
        const songId = musicInfo?.hash ?? songmid;
        const res = await httpFetch(_u('cookn5**^)rrrr`])ojk*hpnd^*pmg'), {
            method: 'POST', timeout: 5000,
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'lx-music-request/2.9.0', 'X-Api-Key': '' },
            body: { source: 'wy', musicId: songId, quality: quality },
            follow_max: 5,
        });
        const d = res.body;
        if (!d || isNaN(Number(d.code))) throw new Error('ikun网易云: 未知错误');
        if (d.code === 200 && d.url) return d.url;
        if (d.code === 403) throw new Error('ikun网易云: 鉴权失败');
        if (d.code === 429) throw new Error('ikun网易云: 请求过速');
        throw new Error('ikun网易云: ' + (d.message || '获取URL失败'));
    } },
    { name: '溯音163', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**jd\\kd)i`o*\\kd*Hpnd^Z,1.:d_8') + songmid + '&type=json', { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.url) return d.url;
        if (d && d.data && d.data[0] && d.data[0].url) return d.data[0].url;
        if (d && d.data && d.data.url) return d.data.url;
        throw new Error('溯音163: 无数据');
    } },
    { name: 'toubiec', fetch: async (songmid, quality) => {
        const level = WY_LEVEL_MAP[quality] || 'standard';
        const res = await httpFetch(_u('cookn5**rt\\kd)ojp]d`^)^i*\\kd*hpnd^*pmg'), {
            method: 'POST', timeout: 5000,
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Origin: _u('cookn5**rt\\kd)ojp]d`^)^i'), Referer: _u('cookn5**rt\\kd)ojp]d`^)^i*') },
            body: JSON.stringify({ id: songmid, level }),
        });
        const d = res.body;
        if (d && d.data && d.data[0] && d.data[0].url) return d.data[0].url;
        if (d && d.url) return d.url;
        throw new Error('toubiec: 无数据');
    } },
    { name: '星海主后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8i`o`\\n`!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海主后端: ' + (d?.msg || '无数据'));
    } },
    { name: '星海备后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8i`o`\\n`!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海备后端: ' + (d?.msg || '无数据'));
    } },
    { name: 'bugpk', fetch: async (songmid, quality) => {
        const level = WY_LEVEL_MAP[quality] || 'standard';
        const res = await httpFetch(_u('cookn5**\\kd)]pbkf)^jh*\\kd*,1.Zhpnd^:otk`8enji!d_n8') + songmid + '&level=' + level, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url'], ['data', 0, 'url']]);
        if (url) return url;
        throw new Error('bugpk: 无数据');
    } },
    { name: '念心直链', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cook5**hpnd^)isdisu)^jh*rt)kck:d_8') + songmid + '&level=' + quality + '&type=mp3', { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d;
        if (d && d.url) return d.url;
        throw new Error('念心直链: 无数据');
    } },
    { name: '妖狐', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*rtqdk:d_8') + songmid + '&level=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('妖狐: 无数据');
    } },
    { name: 'lxmusic88', fetch: async (songmid, quality) => {
        const level = WY_LEVEL_MAP[quality] || 'standard';
        const res = await httpFetch(_u('cookn5**33)gshpnd^)si((adln3n*gshpnd^q/*pmg*rt*') + songmid + '/' + level, { method: 'GET', timeout: 5000, headers: { 'x-request-key': 'lxmusic' } });
        const d = res.body;
        if (d && (d.code === 0 || d.code === 200)) {
            if (d.data) return d.data;
            if (d.url) return d.url;
        }
        throw new Error('lxmusic88: 无数据');
    } },
    { name: 'FishAPI', fetch: async (songmid, quality) => {
        const brMap = { '128k': 128, '320k': 320, flac: 740, flac24bit: 999 };
        const br = brMap[quality];
        if (!br) throw new Error('FishAPI 不支持的音质');
        const result = await fishPost({ types: 'url', id: songmid, source: 'netease', br: br }, encodeURIComponent(songmid));
        const url = result && result.url ? cleanUrl(String(result.url)) : '';
        if (url.startsWith('http')) return url;
        throw new Error('FishAPI: 无数据');
    } },
    { name: 'Huibq', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**gshpnd^\\kd)jim`i_`m)^jh*pmg*rt*') + songmid + '/' + quality, { method: 'GET', timeout: 5000, headers: { 'X-Request-Key': 'share-v3' } });
        const d = res.body;
        if (d && d.code === 0) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('Huibq: 无数据');
    } },
    { name: '聚合API', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*rt'), { method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicInfo: { songmid }, type: quality }) });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('聚合API: 无数据');
    } },
    { name: 'HYWmusic', fetch: async (songmid, quality) => {
        const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=wy&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, { method: 'GET', timeout: 5000, headers: { 'X-Card-Key': HYW_CARD_KEY } });
        const d = res.body;
        if (d && d.code === 200) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('HYWmusic: 无数据');
    } },
    { name: 'FFAPI', fetch: getFFAPI },
];

// -------- 酷我音乐后端 --------
const KW_BACKENDS = [
    { name: '酷我官方', fetch: async (songmid, quality, musicInfo) => {
        const brMap = { '128k': '128kmp3', '192k': '128kmp3', '320k': '320kmp3', flac: '2000kflac', flac24bit: '4000kflac' };
        const br = brMap[quality];
        if (!br) throw new Error('酷我官方 不支持的音质');
        let rid = musicInfo?.rid || '';
        if (!rid && musicInfo?.musicrid) rid = String(musicInfo.musicrid).replace(/^MUSIC_/, '');
        if (!rid) rid = songmid;
        const res = await httpFetch(_u('cookn5**hj]d)fprj)^i*hj]d)n:a8r`]!md_8') + rid + '&br=' + br + '&source=jiakong&type=convert_url_with_sign&surl=1', { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.surl) return d.data.surl;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('酷我官方: 无数据');
    } },
    { name: 'yunmge酷我', fetch: getYunmgeKw },
    { name: '星海主后端', fetch: async (songmid, quality, musicInfo) => {
        const name = musicInfo?.name || '';
        const singer = musicInfo?.singer || '';
        const interval = musicInfo?.interval || '';
        const albumName = musicInfo?.albumName || musicInfo?.album || '';
        const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8fr!i\\h`8') + encodeURIComponent(name) + '&singer=' + encodeURIComponent(singer) + '&songmid=' + encodeURIComponent(songmid) + '&interval=' + encodeURIComponent(interval) + '&albumName=' + encodeURIComponent(albumName) + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海主后端: ' + (d?.msg || '无数据'));
    } },
    { name: '星海备后端', fetch: async (songmid, quality, musicInfo) => {
        const name = musicInfo?.name || '';
        const singer = musicInfo?.singer || '';
        const interval = musicInfo?.interval || '';
        const albumName = musicInfo?.albumName || musicInfo?.album || '';
        const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8fr!i\\h`8') + encodeURIComponent(name) + '&singer=' + encodeURIComponent(singer) + '&songmid=' + encodeURIComponent(songmid) + '&interval=' + encodeURIComponent(interval) + '&albumName=' + encodeURIComponent(albumName) + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海备后端: ' + (d?.msg || '无数据'));
    } },
    { name: '酷我流媒体', fetch: async (songmid, quality, musicInfo) => {
        const level = KW_STREAM_LEVEL_MAP[quality] || 'master';
        const songIdTmp = musicInfo?.songmid || musicInfo?.id || musicInfo?.hash || musicInfo?.songId || musicInfo?.musicId || songmid;
        if (!songIdTmp) throw new Error('酷我流媒体: 找不到歌曲ID');
        const songId = String(songIdTmp).trim();
        return _u('cook5**,20)-2),11)-.1534-3*frnom`\\h:d_8') + encodeURIComponent(songId) + '&level=' + level + '&stream=1';
    } },
    { name: '念心直链', fetch: async (songmid, quality) => {
        const level = qualityToLevel(quality);
        const res = await httpFetch(_u('cookn5**hpnd^)isdisu)^jh*fbll*fr)kck:d_8') + songmid + '&level=' + level + '&type=mp3', { method: 'GET', timeout: 5000 });
        if (typeof res.body === 'string' && res.body.startsWith('http')) return res.body;
        if (res.body?.url) return res.body.url;
        throw new Error('念心直链: 无数据');
    } },
    { name: '笒鬼鬼', fetch: async (songmid, quality) => {
        const level = KW_LEVEL_MAP[quality] || '128k';
        const res = await httpFetch(_u('cookn5**\\kd)^`ibpdbpd)^i*\\kd*fprj*hpnd^Zq,)kck:d_8') + songmid + '&type=song&format=json&level=' + level, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['data', 'url'], ['url']]);
        if (url) return url;
        throw new Error('笒鬼鬼: 无数据');
    } },
    { name: '妖狐', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*frqdk:d_8') + songmid + '&level=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('妖狐: 无数据');
    } },
    { name: '聚合API', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*fr'), { method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicInfo: { songmid }, type: quality }) });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('聚合API: 无数据');
    } },
    { name: '酷我手机版', fetch: async (songmid, quality) => {
        const brMap = { '128k': '128kmp3', '192k': '128kmp3', '320k': '320kmp3', flac: '2000kflac', flac24bit: '4000kflac' };
        const br = brMap[quality];
        if (!br) throw new Error('酷我手机版 不支持的音质');
        const res = await httpFetch(_u('cookn5**ihj]d)fprj)^i*hj]d)n:a8r`]!pn`m8+!njpm^`8frkg\\t`mc_Z\\mZ/).)+)3Zod\\i]\\jZO,<Zldmpd)\\kf!otk`8^jiq`moZpmgZrdocZndbi!md_8') + songmid + '&br=' + br, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        if (d && d.code === 200 && d.data && d.data.surl) return d.data.surl;
        throw new Error('酷我手机版: 无数据');
    } },
    { name: '酷我车机版', fetch: async (songmid, quality) => {
        const brMap = { '128k': '128kmp3', '192k': '128kmp3', '320k': '320kmp3', flac: '2000kflac', flac24bit: '4000kflac' };
        const br = brMap[quality];
        if (!br) throw new Error('酷我车机版 不支持的音质');
        const res = await httpFetch(_u('cookn5**hj]d)fprj)^i*hj]d)n:a8r`]!pn`m8+!njpm^`8frkg\\t`m^\\mZ\\mZ1)+)+)4Z=Zed\\fjibZqc)\\kf!otk`8^jiq`moZpmgZrdocZndbi!]m8') + br + '&sig=0&rid=' + songmid, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        if (d && d.code === 200 && d.data && d.data.surl) return d.data.surl;
        throw new Error('酷我车机版: 无数据');
    } },
    { name: '聆澜', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**njpm^`)ncdld\\ied\\ib)^i*\\kd*hpnd^*pmg:njpm^`8fr!njibD_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        if (d && d.data && d.data.url) return d.data.url;
        throw new Error('聆澜: 无数据');
    } },
    { name: 'HYWmusic', fetch: async (songmid, quality) => {
        const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=kw&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, { method: 'GET', timeout: 5000, headers: { 'X-Card-Key': HYW_CARD_KEY } });
        const d = res.body;
        if (d && d.code === 200) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('HYWmusic: 无数据');
    } },
    { name: '溯音酷我', fetch: async (songmid, quality, musicInfo) => {
        const brMap = { '128k': '7', '192k': '5', '320k': '5', flac: '1', flac24bit: '1' };
        const br = brMap[quality] || '7';
        const name = musicInfo?.name || '';
        const singer = musicInfo?.singer || '';
        const keyword = name + (singer ? ' ' + singer : '');
        if (!keyword) throw new Error('溯音酷我: 缺少歌曲名');
        const res = await httpFetch(_u('cookn5**jd\\kd)i`o*\\kd*Fprj:hnb8') + encodeURIComponent(keyword) + '&n=1&br=' + br, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data && d.data.url) return d.data.url;
        if (d && d.url) return d.url;
        throw new Error('溯音酷我: 无数据');
    } },
    { name: 'HelloWorld', fetch: async (songmid, quality, musicInfo) => {
        const songId = musicInfo?.rid || musicInfo?.hash || musicInfo?.songmid || musicInfo?.id || songmid;
        if (!songId) throw new Error('HelloWorld: 找不到歌曲ID');
        const requestPath = '/lxmusicv4/url/kw/' + songId + '/' + quality;
        const sign = helloWorldSign(requestPath);
        const url = HELLO_WORLD_API_URL + requestPath + '?sign=' + sign;
        const res = await httpFetch(url, { method: 'GET', timeout: 5000, headers: { 'accept': 'application/json', 'x-request-key': HELLO_WORLD_API_KEY } });
        const d = res.body;
        if (d && (d.code === 0 || d.code === 200)) {
            const musicUrl = d.data || d.url;
            if (musicUrl) return musicUrl;
        }
        throw new Error('HelloWorld: ' + (d?.msg || '无数据'));
    } },
    { name: '星海酷我', fetch: getXinghaiKw },
    { name: 'FFAPI', fetch: getFFAPI },
];

// -------- 酷狗音乐后端（高音质后端优先） --------
const KG_BACKENDS = [
    // 高音质后端（支持 master/hires/atmos）
    { name: '星海主后端', fetch: async (songmid, quality, musicInfo) => {
        const hash = musicInfo?.hash || (musicInfo?._types?.[quality]?.hash) || songmid;
        const albumId = musicInfo?.albumId || '';
        const mainHash = hash;
        const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8fb!lp\\gdot8') + quality + '&songmid=' + (musicInfo?.songmid || songmid) + '&albumId=' + albumId + '&mainHash=' + mainHash + '&hash=' + hash, { method: 'GET', timeout: 8000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海主后端: ' + (d?.msg || '无数据'));
    } },
    { name: '念心KG', fetch: getNianxinKg },
    { name: '长青海棠', fetch: async (songmid, quality, musicInfo) => {
        const level = KG_LEVEL_MAP[quality] || 'standard';
        const hash = musicInfo?.hash || musicInfo?.songmid || songmid;
        const res = await httpFetch(_u('cookn5**hpnd^n`mq`m)c\\do\\ibr)^^*q,*hpnd^*m`njgq`(pmg'), {
            method: 'POST', timeout: 8000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'kg', rid: hash, level: level }),
        });
        const d = res.body;
        if (d && d.code === 0 && d.data && d.data.url) return d.data.url;
        throw new Error('长青海棠: ' + (d?.msg || '无数据'));
    } },
    { name: 'HelloWorld', fetch: async (songmid, quality, musicInfo) => {
        const songId = musicInfo?.hash || musicInfo?.songmid || musicInfo?.id || songmid;
        if (!songId) throw new Error('HelloWorld: 找不到歌曲ID');
        const requestPath = '/lxmusicv4/url/kg/' + songId + '/' + quality;
        const sign = helloWorldSign(requestPath);
        const url = HELLO_WORLD_API_URL + requestPath + '?sign=' + sign;
        const res = await httpFetch(url, { method: 'GET', timeout: 8000, headers: { 'accept': 'application/json', 'x-request-key': HELLO_WORLD_API_KEY } });
        const d = res.body;
        if (d && (d.code === 0 || d.code === 200)) {
            const musicUrl = d.data || d.url;
            if (musicUrl) return musicUrl;
        }
        throw new Error('HelloWorld: ' + (d?.msg || '无数据'));
    } },
    { name: 'ChKsZ', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)^cfnu)ojk*\\kd'), {
            method: 'POST', timeout: 8000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'kg', songmid, quality }),
        });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('ChKsZ: ' + (d?.msg || '无数据'));
    } },
    // 中音质及兜底后端（降级用，超时短）
    { name: '星海备后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8fb!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 3000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海备后端: ' + (d?.msg || '无数据'));
    } },
    { name: '妖狐', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*fbqdk:d_8') + songmid + '&level=' + quality, { method: 'GET', timeout: 3000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('妖狐: 无数据');
    } },
    { name: '酷狗官方', fetch: async (songmid, quality, musicInfo) => {
        const hash = musicInfo?.hash || songmid;
        const albumId = musicInfo?.albumId || '';
        const res = await httpFetch(_u('cookn5**rrr\\kd)fpbjp)^jh*tt*di_`s)kck:m8kg\\t*b`o_\\o\\!c\\nc8') + hash + '&platid=4&album_id=' + albumId + '&mid=00000000000000000000000000000000', { method: 'GET', timeout: 3000 });
        const d = res.body;
        if (d && d.status === 1 && d.data && d.data.play_backup_url) return d.data.play_backup_url;
        if (d && d.status === 1 && d.data && d.data.play_url) return d.data.play_url;
        throw new Error('酷狗官方: 无数据');
    } },
    { name: '长青SVIP直链', fetch: async (songmid, quality, musicInfo) => {
        const level = KG_LEVEL_MAP[quality] || 'standard';
        const hash = musicInfo?.hash || musicInfo?.songmid || songmid;
        const url = _u('cookn5**hpnd^)c\\do\\ibr)^^*fbll,*fb)kck:otk`8hk.!d_8') + hash + '&level=' + level;
        const res = await httpFetch(url, { method: 'GET', timeout: 3000 });
        const d = res.body;
        if (typeof d === 'string' && d.startsWith('http')) return d;
        if (d && d.url) return d.url;
        throw new Error('长青SVIP直链: 无数据');
    } },
    { name: '长青POST', fetch: async (songmid, quality, musicInfo) => {
        const level = KG_LEVEL_MAP[quality] || 'standard';
        const hash = musicInfo?.hash || songmid;
        const res = await httpFetch(_u('cook5**,20)-2),11)-.1*fbll,*fb)kck'), {
            method: 'POST', timeout: 3000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'kg', id: hash, level: level }),
        });
        const d = res.body;
        if (typeof d === 'string' && d.startsWith('http')) return d;
        if (d && d.url) return d.url;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('长青POST: 无数据');
    } },
    { name: '聚合API', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*fb'), { method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicInfo: { songmid }, type: quality }) });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('聚合API: 无数据');
    } },
    { name: '海棠API', fetch: async (songmid, quality, musicInfo) => {
        const level = KG_LEVEL_MAP[quality] || 'standard';
        const hash = musicInfo?.hash || (musicInfo?._types?.[quality]?.hash) || songmid;
        const res = await httpFetch(_u('cookn5**hpnd^\\kd)c\\do\\ibr)i`o*fbll*fb)kck:otk`8enji!d_8') + hash + '&level=' + level, { method: 'GET', timeout: 3000 });
        const d = res.body;
        const url = extractUrl(d, [['url'], ['data', 'url']]);
        if (url) return url;
        throw new Error('海棠API: 无数据');
    } },
    { name: '聆澜', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**njpm^`)ncdld\\ied\\ib)^i*\\kd*hpnd^*pmg:njpm^`8fb!njibD_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 3000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        if (d && d.data && d.data.url) return d.data.url;
        throw new Error('聆澜: 无数据');
    } },
    { name: 'HYWmusic', fetch: async (songmid, quality) => {
        const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=kg&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, { method: 'GET', timeout: 3000, headers: { 'X-Card-Key': HYW_CARD_KEY } });
        const d = res.body;
        if (d && d.code === 200) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('HYWmusic: 无数据');
    } },
    { name: '星海酷狗', fetch: getXinghaiKg },
    { name: 'FFAPI', fetch: getFFAPI },
];

// -------- 咪咕音乐后端 --------
const MG_BACKENDS = [
    { name: '星海咪咕', fetch: getXinghaiMg },
    { name: 'Migu直接源', fetch: async (songmid, quality) => {
        const level = qualityToLevel(quality);
        const res = await httpFetch(_u('cookn5**hpnd^)hdbp)^i*q.*\\kd*hpnd^*\\p_djKg\\t`m*b`oKg\\tDiaj:^jktmdbcoD_8') + encodeURIComponent(String(songmid)) + '&level=' + level, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data && d.data.playUrl) return d.data.playUrl;
        if (d && d.url) return d.url;
        if (d && d.playUrl) return d.playUrl;
        throw new Error('Migu直接源: 无数据');
    } },
    { name: 'Migu API', fetch: async (songmid, quality) => {
        const levelMap = { '128k': 'PQ', '320k': 'HQ', flac: 'SQ' };
        const level = levelMap[quality] || 'HQ';
        const res = await httpFetch(_u('cookn5**\\kk)^)ia)hdbp)^i*HDBPH-)+*nom\\o`bt*gdno`i(pmg*q-)-:^jktmdbcoD_8') + encodeURIComponent(String(songmid)) + '&quality=' + level, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.data && d.data.url) return d.data.url;
        if (d && d.url) return d.url;
        if (d && d.data && d.data.playUrl) return d.data.playUrl;
        throw new Error('Migu API: 无数据');
    } },
    { name: '星海主后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8hdbp!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海主后端: ' + (d?.msg || '无数据'));
    } },
    { name: '星海备后端', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8hdbp!njibhd_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        throw new Error('星海备后端: ' + (d?.msg || '无数据'));
    } },
    { name: '聚合API', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*hb'), { method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicInfo: { songmid }, type: quality }) });
        const d = res.body;
        if (d && d.code === 200 && d.data && d.data.url) return d.data.url;
        throw new Error('聚合API: 无数据');
    } },
    { name: '念心直链', fetch: async (songmid, quality) => {
        const level = qualityToLevel(quality);
        const res = await httpFetch(_u('cook5**hpnd^)isdisu)^jh*hb)kck:d_8') + encodeURIComponent(String(songmid)) + '&level=' + level + '&type=mp3', { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (typeof d === 'string' && d.startsWith('http')) return d;
        if (d && d.url) return d.url;
        throw new Error('念心直链: 无数据');
    } },
    { name: '聆澜', fetch: async (songmid, quality) => {
        const res = await httpFetch(_u('cookn5**njpm^`)ncdld\\ied\\ib)^i*\\kd*hpnd^*pmg:njpm^`8hb!njibD_8') + songmid + '&quality=' + quality, { method: 'GET', timeout: 5000 });
        const d = res.body;
        if (d && d.code === 200 && d.url) return d.url;
        if (d && d.data && d.data.url) return d.data.url;
        throw new Error('聆澜: 无数据');
    } },
    { name: 'HYWmusic', fetch: async (songmid, quality) => {
        const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=mg&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, { method: 'GET', timeout: 5000, headers: { 'X-Card-Key': HYW_CARD_KEY } });
        const d = res.body;
        if (d && d.code === 200) {
            if (d.url) return d.url;
            if (d.data && d.data.url) return d.data.url;
        }
        throw new Error('HYWmusic: 无数据');
    } },
    { name: 'FFAPI', fetch: getFFAPI },
];

// ==================== 核心请求函数（智能降级 + 并发/顺序Fallback） ====================
const handleGetMusicUrl = async (source, musicInfo, userQuality) => {
    const songId = musicInfo.hash ?? musicInfo.songmid ?? musicInfo.id;
    if (!songId) throw new Error('无法获取歌曲ID');

    const supportedQualities = MUSIC_QUALITY[source] || ['128k'];
    let startIndex = QUALITY_PRIORITY.indexOf(userQuality);
    if (startIndex === -1) startIndex = QUALITY_PRIORITY.length - 1;

    const backends = {
        tx: TX_BACKENDS,
        wy: WY_BACKENDS,
        kw: KW_BACKENDS,
        kg: KG_BACKENDS,
        mg: MG_BACKENDS,
    }[source];
    if (!backends) throw new Error('未知音源: ' + source);

    const startTime = Date.now();

    for (let i = startIndex; i < QUALITY_PRIORITY.length; i++) {
        const quality = QUALITY_PRIORITY[i];
        if (!supportedQualities.includes(quality)) continue;

        const cacheKey = buildCacheKey(source, songId, quality);
        const cached = getCachedUrl(cacheKey);
        if (cached) {
            console.log(`[回避聚合] 缓存命中: ${source} ${quality}`);
            if (quality !== userQuality) console.warn(`[回避聚合] 用户请求 ${userQuality}，已降级至 ${quality}`);
            return cached;
        }

        console.log(`[回避聚合] 尝试音质: ${quality} (用户请求: ${userQuality})`);

        // 对于高音质（master/hires/flac24bit/atmos），只尝试前N个高音质后端，超时设8秒
        let firstTierCount = 5;
        if (quality === 'master' || quality === 'hires' || quality === 'flac24bit' || quality === 'atmos' || quality === 'atmos_plus') {
            firstTierCount = 8; // 更多高音质后端
        }
        const firstTier = backends.slice(0, firstTierCount);
        let finalUrl = null;
        const errors = [];

        try {
            const result = await Promise.any(firstTier.map(async (backend) => {
                let url = await backend.fetch(songId, quality, musicInfo);
                // 音质严格校验
                if (!qualityMatch(url, quality)) {
                    throw new Error(`音质不匹配: 请求 ${quality}，但返回链接不符合高音质格式`);
                }
                if (source === 'kw' && typeof url === 'string' && url.includes('ekey')) {
                    url = processKwEncryptedUrl({ url, ekey: simpleGetQueryParam(url, 'ekey') }, source) || url;
                }
                if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                    return url;
                }
                throw new Error(`${backend.name} 返回无效URL`);
            }));
            finalUrl = result;
        } catch (err) {
            if (err.errors) err.errors.forEach(e => errors.push(e.message || e));
            else errors.push(err.message);
        }

        if (!finalUrl) {
            // 如果高音质后端失败，再尝试剩余所有后端（可能降级），但使用较短超时
            for (const backend of backends.slice(firstTierCount)) {
                try {
                    let url = await backend.fetch(songId, quality, musicInfo);
                    if (!qualityMatch(url, quality)) {
                        throw new Error(`音质不匹配: 请求 ${quality}，但返回链接不符合`);
                    }
                    if (source === 'kw') url = processKwEncryptedUrl({ url, ekey: simpleGetQueryParam(url, 'ekey') }, source) || url;
                    if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                        finalUrl = url;
                        break;
                    }
                    errors.push(`${backend.name}: 返回无效URL`);
                } catch (e) {
                    errors.push(`${backend.name}: ${e.message}`);
                }
            }
        }

        if (finalUrl) {
            setCachedUrl(cacheKey, finalUrl);
            const elapsed = Date.now() - startTime;
            console.log(`[回避聚合] ✅ 成功获取 ${source} ${quality} (${elapsed}ms)`);
            if (quality !== userQuality) console.warn(`[回避聚合] ⚠️ 用户请求 ${userQuality}，已降级至 ${quality}`);
            return finalUrl;
        }

        console.warn(`[回避聚合] ❌ 音质 ${quality} 全部失败，尝试降级`);
    }

    throw new Error(`所有音质尝试失败（从 ${userQuality} 降至最低）`);
};

// ==================== 事件注册 ====================
on(EVENT_NAMES.request, ({ action, source, info }) => {
    if (action === 'musicUrl') {
        return handleGetMusicUrl(source, info.musicInfo, info.type);
    }
    return Promise.reject('action not support: ' + action);
});

// ==================== 初始化 ====================
deviceId = generateDeviceId();
clientHeader = buildClientHeader();
userToken = generateToken(null);

const sources = {};
MUSIC_SOURCE.forEach(item => {
    const nameMap = { tx: 'QQ音乐', wy: '网易云音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐' };
    sources[item] = {
        name: nameMap[item] || item,
        type: 'music',
        actions: ['musicUrl'],
        qualitys: MUSIC_QUALITY[item],
    };
});

send(EVENT_NAMES.inited, {
    status: true,
    openDevTools: false,
    sources: sources,
});

console.log('[回避聚合] v0.0.1 已加载');
console.log('[回避聚合] 平台: ' + MUSIC_SOURCE.join(', '));
console.log('[回避聚合] 缓存 TTL: ' + (CACHE_TTL_MS / 3600000) + ' 小时');
if (CHKSZ_CONFIG.apikey) console.log('[回避聚合] ChKSz API 已启用');
if (KW_DECRYPT_PROXY.allowEncryptedLossless && KW_DECRYPT_PROXY.url) console.log('[回避聚合] 酷我代理解密已启用');