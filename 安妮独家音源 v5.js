/*!
 * @name 安妮独家音源
 * @description 公益api收集整理by电狗，QQ群912385038
 * @version v5
 * @author 
 */

const CHANGQING_API = "https://musicserver.haitangw.cc/v1/music/resolve-url"
const CHANGQING_QUALITY_MAP = {
    "kg": {
        "128k": "standard",
        "320k": "exhigh",
        "flac": "lossless",
        "flac24bit": "hires",
        "atmos": "atmos",
        "master": "clear"
    },
    "tx": {
        "128k": "standard",
        "320k": "exhigh",
        "flac": "lossless",
        "flac24bit": "lossless",
        "hires": "lossless"
    }
}

const QUALITY_MAP_KW = {
    "128k": "128kmp3",
    "320k": "320kmp3",
    "flac": "2000kflac",
    "flac24bit": "4000kflac"
}
const API_CONFIG_KW = {
    baseUrl: "http://nmobi.kuwo.cn/mobi.s",
    source: "kwplayerhd_ar_4.3.0.8_tianbao_T1A_qirui.apk"
}

const NETEASE_API_URL = "https://c.wwwweb.top/music/url"
const NETEASE_LEVEL_MAP = {
    "128k": "128k",
    "192k": "128k",
    "320k": "320k",
    "flac": "flac",
    "flac24bit": "flac24bit",
    "hires": "hires",
    "jyeffect": "hires",
    "sky": "atmos",
    "jymaster": "master"
}

const MUSIC_QUALITY = {
    "kg": ["128k", "320k", "flac", "flac24bit", "atmos", "master"],
    "tx": ["128k", "320k", "flac", "flac24bit", "hires"],
    "kw": ["128k", "320k", "flac", "flac24bit"],
    "wy": ["128k", "192k", "320k", "flac", "flac24bit", "hires", "jyeffect", "sky", "jymaster"]
}

const {EVENT_NAMES, request, on, send, env, version} = globalThis.lx

const httpFetch = (url, options) => {
    return new Promise((resolve, reject) => {
        request(url, options, (err, resp, body) => {
            if (err) return reject(err)
            resp.body = body
            resolve(resp)
        })
    })
}

const getKugouUrl = async (musicInfo, quality) => {
    const hash = musicInfo.SQFileHash || musicInfo.HQFileHash || musicInfo.FileHash || musicInfo.hash || musicInfo.songmid
    if (!hash) throw new Error("无法找到歌曲标识符")

    const level = CHANGQING_QUALITY_MAP.kg[quality] || "lossless"

    // 长青SVIP解析接口 - POST JSON
    const resp = await httpFetch(CHANGQING_API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36",
            "Accept": "application/json"
        },
        body: {
            source: "kg",
            rid: hash,
            level: level
        },
        timeout: 8000
    })

    const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
    if (body.code === 0 && body.data?.url) {
        return body.data.url
    }
    throw new Error(body.message || `获取失败 (code: ${body.code})`)
}

const getQQUrl = async (musicInfo, quality) => {
    const songMid = musicInfo.songmid
    if (!songMid) throw new Error("缺少songmid")

    const level = CHANGQING_QUALITY_MAP.tx[quality] || "lossless"

    // 长青SVIP解析接口 - POST JSON
    const resp = await httpFetch(CHANGQING_API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36",
            "Accept": "application/json"
        },
        body: {
            source: "tx",
            rid: songMid,
            level: level
        },
        timeout: 8000
    })

    const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
    if (body.code === 0 && body.data?.url) {
        return body.data.url
    }
    throw new Error(body.message || `获取失败 (code: ${body.code})`)
}

const getKWUrl = async (musicInfo, quality) => {
    const rid = musicInfo.rid || musicInfo.hash || musicInfo.songId || musicInfo.id || musicInfo.songmid
    if (!rid) throw new Error("缺少歌曲ID")
    const br = QUALITY_MAP_KW[quality]
    if (!br) throw new Error("不支持的音质")
    const params = {
        f: "web",
        user: "0",
        source: API_CONFIG_KW.source,
        type: "convert_url_with_sign",
        rid: rid,
        br: br
    }
    const queryString = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&")
    const url = `${API_CONFIG_KW.baseUrl}?${queryString}`
    const resp = await httpFetch(url, {
        method: "GET",
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36" }
    })
    const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
    if (body.code === 200 && body.data?.url) {
        return body.data.url
    }
    throw new Error(body.msg || `获取失败 (code: ${body.code})`)
}

const getWyUrl = async (musicInfo, quality) => {
    const songId = musicInfo.songmid || musicInfo.id || musicInfo.hash
    if (!songId) throw new Error("缺少歌曲ID")
    const level = NETEASE_LEVEL_MAP[quality] || "flac"
    const requestResp = await httpFetch(NETEASE_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": `${env ? `lx-music-${env}/${version}` : `lx-music-request/${version}`}`,
        },
        body: {
            source: "wy",
            musicId: songId,
            quality: level,
        },
        follow_max: 5,
    })
    const {body} = requestResp
    if (!body || isNaN(Number(body.code))) throw new Error("unknow error")
    switch (body.code) {
        case 200:
            return body.url
        case 403:
            throw new Error("鉴权失败")
        case 429:
            throw new Error("请求过速")
        case 500:
            throw new Error(`获取URL失败, ${body.message ?? "未知错误"}`)
        default:
            throw new Error(body.message ?? "未知错误")
    }
}

const handleRequest = async (source, musicInfo, quality) => {
    if (source === "kg" || source === "kugou") {
        return await getKugouUrl(musicInfo, quality)
    }
    if (source === "tx") {
        return await getQQUrl(musicInfo, quality)
    }
    if (source === "kw") {
        return await getKWUrl(musicInfo, quality)
    }
    if (source === "wy") {
        return await getWyUrl(musicInfo, quality)
    }
    throw new Error("不支持的音源")
}

const sources = {}
Object.keys(MUSIC_QUALITY).forEach(key => {
    sources[key] = {
        name: key,
        type: "music",
        actions: ["musicUrl"],
        qualitys: MUSIC_QUALITY[key]
    }
})

on(EVENT_NAMES.request, ({action, source, info}) => {
    if (action === "musicUrl") {
        return handleRequest(source, info.musicInfo, info.type)
            .then(data => Promise.resolve(data))
            .catch(err => {
                console.error("[音源错误]", err.message)
                return Promise.reject(err)
            })
    }
    return Promise.reject("不支持的操作")
})

send(EVENT_NAMES.inited, {
    status: true,
    openDevTools: false,
    sources: sources
})
