import { EmailMessage } from 'cloudflare:email';

// tail-studio.com 記事コメント用 Worker。
// 方針: IP アドレス・Cookie は保存しない。投稿は承認制（承認されるまで公開されない）。
// 保存するのは「記事の URL パス・名前(任意)・コメント本文・投稿時刻」だけ。

const MAX_NAME = 40;
const MAX_BODY = 2000;
const MIN_BODY = 2;
const MIN_FILL_MS = 3000;          // 表示してから 3 秒未満の投稿は bot とみなす
const MAX_PENDING_PER_SLUG = 20;
const MAX_PENDING_TOTAL = 300;
const MAX_REQUEST_BYTES = 16 * 1024;   // 投稿リクエスト全体の上限
const NOTIFY_INTERVAL_MS = 10 * 60 * 1000; // 通知メールは 10 分に 1 通まで
const NOTIFY_FROM = 'comments@tail-studio.com';
const ADMIN_URL = 'https://tail-studio-comments.waw71068.workers.dev/admin';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

// 制御文字と、表示を偽装できる双方向制御文字を取り除く。改行は keepNewlines のときだけ残す。
function clean(text, keepNewlines) {
  let t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  t = t.replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  if (!keepNewlines) t = t.replace(/\n/g, ' ');
  return t.replace(/\n{4,}/g, '\n\n\n').trim();
}

function b64utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 新着コメントの通知メール。利用者が入力した文字列はヘッダーに入れず、本文(base64)だけに入れる。
async function notify(env, slug, name, body) {
  if (!env.MAIL || !env.NOTIFY_TO) return;
  const now = Date.now();
  const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_notified'").first();
  if (last && now - Number(last.value) < NOTIFY_INTERVAL_MS) return;
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_notified', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(now)).run();
  const pending = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE approved = 0').first();
  const text = [
    'tail-studio.com の記事に新しいコメントが届きました（承認待ち ' + pending.n + ' 件）。',
    '',
    '記事: https://tail-studio.com' + slug,
    '名前: ' + name,
    '',
    body,
    '',
    '----',
    '承認・削除は管理画面から行ってください（合言葉の入力が必要です）。',
    ADMIN_URL,
    'このメールは 10 分に 1 通までしか送られません。ほかにも承認待ちがある場合があります。',
  ].join('\n');
  const b64 = b64utf8(text).replace(/(.{76})/g, '$1\r\n');
  const raw = [
    'From: Tail Studio Comments <' + NOTIFY_FROM + '>',
    'To: <' + env.NOTIFY_TO + '>',
    'Subject: =?UTF-8?B?' + b64utf8('[tail-studio.com] 新しいコメント') + '?=',
    'Message-ID: <' + crypto.randomUUID() + '@tail-studio.com>',
    'Date: ' + new Date(now).toUTCString().replace('GMT', '+0000'),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
  ].join('\r\n');
  await env.MAIL.send(new EmailMessage(NOTIFY_FROM, env.NOTIFY_TO, raw));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const h = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(data, status, request, env, noCors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...(noCors ? {} : corsHeaders(request, env)),
    },
  });
}

function validSlug(slug) {
  return typeof slug === 'string' && slug.length <= 200 && /^\/blog\/[A-Za-z0-9\/_\-.%]+$/.test(slug);
}

function authed(request, env) {
  const h = request.headers.get('Authorization') || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!env.ADMIN_KEY || key.length === 0 || key.length !== env.ADMIN_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ env.ADMIN_KEY.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    // 公開: 承認済みコメントの一覧
    if (path === '/comments' && request.method === 'GET') {
      const slug = url.searchParams.get('slug');
      if (!validSlug(slug)) return json({ error: 'bad slug' }, 400, request, env);
      const { results } = await env.DB.prepare(
        'SELECT id, name, body, created_at FROM comments WHERE slug = ? AND approved = 1 ORDER BY created_at ASC LIMIT 200'
      ).bind(slug).all();
      return json({ comments: results }, 200, request, env);
    }

    // 公開: コメント投稿（承認待ちで保存）
    if (path === '/comments' && request.method === 'POST') {
      const origin = request.headers.get('Origin') || '';
      if (!(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin)) {
        return json({ error: 'forbidden' }, 403, request, env);
      }
      if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
        return json({ error: 'bad content type' }, 415, request, env);
      }
      if (Number(request.headers.get('Content-Length') || 0) > MAX_REQUEST_BYTES) {
        return json({ error: 'too large' }, 413, request, env);
      }
      let data;
      try {
        const rawBody = await request.text();
        if (rawBody.length > MAX_REQUEST_BYTES) return json({ error: 'too large' }, 413, request, env);
        data = JSON.parse(rawBody);
      } catch { return json({ error: 'bad json' }, 400, request, env); }
      if (!data || typeof data !== 'object') return json({ error: 'bad json' }, 400, request, env);
      const slug = data.slug;
      const name = clean(data.name, false).slice(0, MAX_NAME) || '名無しさん';
      const body = clean(data.body, true);
      const hp = String(data.website || '');            // ハニーポット（人間は空のまま）
      const filled = Date.now() - Number(data.t || 0);   // 表示から投稿までの時間
      if (!validSlug(slug)) return json({ error: 'bad slug' }, 400, request, env);
      if (hp !== '') return json({ ok: true }, 200, request, env);          // bot には成功を装う
      if (!(filled >= MIN_FILL_MS)) return json({ error: 'too fast' }, 429, request, env);
      if (body.length < MIN_BODY || body.length > MAX_BODY) return json({ error: 'bad body' }, 400, request, env);
      if ((body.match(/https?:\/\//g) || []).length > 2) return json({ error: 'too many links' }, 400, request, env);

      const slugPending = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE slug = ? AND approved = 0').bind(slug).first();
      const totalPending = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE approved = 0').first();
      if (slugPending.n >= MAX_PENDING_PER_SLUG || totalPending.n >= MAX_PENDING_TOTAL) {
        return json({ error: 'busy' }, 429, request, env);
      }
      await env.DB.prepare('INSERT INTO comments (slug, name, body, created_at, approved) VALUES (?, ?, ?, ?, 0)')
        .bind(slug, name, body, Date.now()).run();
      ctx.waitUntil(notify(env, slug, name, body).catch((e) => console.log('notify failed: ' + e)));
      return json({ ok: true }, 200, request, env);
    }

    // 管理: 管理画面（合言葉は入力欄に入れる。ブラウザのタブを閉じるまで sessionStorage に保持）
    if (path === '/admin' && request.method === 'GET') {
      return new Response(ADMIN_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          ...SECURITY_HEADERS,
        },
      });
    }

    if (path.startsWith('/admin/')) {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401, request, env, true);
      if (path === '/admin/list' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, slug, name, body, created_at, approved FROM comments ORDER BY approved ASC, created_at DESC LIMIT 200'
        ).all();
        return json({ comments: results }, 200, request, env, true);
      }
      if (request.method === 'POST') {
        const data = await request.json().catch(() => ({}));
        const id = Number(data.id);
        if (!Number.isInteger(id)) return json({ error: 'bad id' }, 400, request, env, true);
        if (path === '/admin/approve') {
          await env.DB.prepare('UPDATE comments SET approved = 1 WHERE id = ?').bind(id).run();
          return json({ ok: true }, 200, request, env, true);
        }
        if (path === '/admin/delete') {
          await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
          return json({ ok: true }, 200, request, env, true);
        }
      }
    }

    return json({ error: 'not found' }, 404, request, env);
  },
};

const ADMIN_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>コメント管理</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#1a1a1a;line-height:1.6}
.c{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:12px 0}
.c.p{border-color:#f59e0b;background:#fffbeb}
.m{font-size:12px;color:#6b7280}.b{white-space:pre-wrap;word-break:break-word;margin:6px 0}
button{padding:6px 14px;border-radius:6px;border:1px solid #d1d5db;background:#fff;cursor:pointer;margin-right:8px}
button.ok{background:#2563eb;color:#fff;border-color:#2563eb}
</style></head><body>
<h1>コメント管理</h1>
<form id="f" hidden>
<input type="text" name="username" value="admin" autocomplete="username" hidden>
<p><label>合言葉<br><input type="password" id="k" name="password" autocomplete="current-password" required style="width:100%;box-sizing:border-box;padding:8px;font-size:16px;border:1px solid #d1d5db;border-radius:6px"></label></p>
<button type="submit" class="ok">開く</button>
</form>
<p id="s"></p><div id="l"></div><p><button id="o" hidden>ログアウト</button></p>
<script>
var key='';
try{key=sessionStorage.getItem('k')||'';}catch(e){}
// 以前の「URL の # 以降に合言葉」形式で開かれたときは、取り込んでから URL から消す
if(location.hash.length>1){key=decodeURIComponent(location.hash.slice(1));history.replaceState(null,'',location.pathname);}
var f=document.getElementById('f'),o=document.getElementById('o'),st=document.getElementById('s');
function show(login,msg){f.hidden=!login;o.hidden=login;if(login){document.getElementById('l').textContent='';}st.textContent=msg||'';}
f.addEventListener('submit',function(e){e.preventDefault();key=document.getElementById('k').value;load();});
o.addEventListener('click',function(){key='';try{sessionStorage.removeItem('k');}catch(e){}document.getElementById('k').value='';show(true,'');});
function api(p,o){o=o||{};o.headers=Object.assign({'Authorization':'Bearer '+key,'Content-Type':'application/json'},o.headers||{});return fetch(p,o).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();});}
function load(){if(!key){show(true,'');return;}st.textContent='読み込み中…';api('/admin/list').then(function(d){
 try{sessionStorage.setItem('k',key);}catch(e){}show(false,'');
 var l=document.getElementById('l');l.textContent='';
 var pend=d.comments.filter(function(c){return !c.approved}).length;
 document.getElementById('s').textContent='承認待ち '+pend+' 件 / 全 '+d.comments.length+' 件';
 d.comments.forEach(function(c){
  var div=document.createElement('div');div.className='c'+(c.approved?'':' p');
  var m=document.createElement('div');m.className='m';
  m.textContent=(c.approved?'公開中':'承認待ち')+' / '+new Date(c.created_at).toLocaleString('ja-JP')+' / '+c.slug+' / '+c.name;
  var b=document.createElement('div');b.className='b';b.textContent=c.body;
  div.appendChild(m);div.appendChild(b);
  if(!c.approved){var a=document.createElement('button');a.className='ok';a.textContent='承認';a.onclick=function(){act('approve',c.id)};div.appendChild(a);}
  var x=document.createElement('button');x.textContent='削除';x.onclick=function(){if(confirm('削除しますか？'))act('delete',c.id)};div.appendChild(x);
  l.appendChild(div);});
}).catch(function(e){key='';try{sessionStorage.removeItem('k');}catch(x){}show(true,e.message==='401'?'合言葉が違います。':'読み込めませんでした。時間をおいてお試しください。');});}
function act(a,id){api('/admin/'+a,{method:'POST',body:JSON.stringify({id:id})}).then(load);}
load();
</script></body></html>`;
