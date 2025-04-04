/*!
 * @name 聚合API接口
 * @description v3.0.0
 * @version 3
 * @author lerd
 */
const{EVENT_NAMES,request,on,send,version,utils}=globalThis.lx;const A='https://lerd.sukimon.me';const h=(u,o={method:'GET'})=>new Promise((v,j)=>{request(u,o,(e,p)=>{if(e)return j(e);v(p)})});on(EVENT_NAMES.request,async({source,info})=>{const r=await h(`${A}/${source}/${source=="kg"?info.musicInfo.hash:info.musicInfo.songmid}/${info.type}`);if(r.body.code==200)return r.body.data.url;else if(r.body.code==303){const S=JSON.parse(JSON.stringify(r.body.data));S.request.url=utils.buffer.bufToString(utils.buffer.from(S.request.url,'base64'),'utf-8');S.replaceList.forEach(i=>{let v=i.value.reduce((a,c)=>a&&a[c],info);i.path.reduce((a,c,x)=>{if(x===i.path.length-1) a[c]=i.path.reduce((a,c)=>a&&a[c],S.request).replace(i.key,i.map==undefined?v:i.map[v]);return a[c];},S.request);});const q=await h(encodeURI(S.request.url),S.request.options);if(S.response.check.key.reduce((a,c)=>a&&a[c],q)==S.response.check.value){const u=S.response.url.reduce((a,c)=>a&&a[c],q);if(u.startsWith("http"))return u;}}else throw new Error(r.body.msg);});h(`${A}/init/v3`).then(q=>{if(q.body.code!==200)throw new Error("脚本初始化失败");if(q.body.data.update.version>version)send(EVENT_NAMES.updateAlert,q.body.data.update);send(EVENT_NAMES.inited,q.body.data.init)}).catch(e=>{throw new Error(e)})