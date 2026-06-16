// QQ Capital Investment Fund - Cloudflare Worker v3
// MT5 Bridge uses GET params (compatible with all brokers)

let mt5Cache = null;
let mt5CacheTime = 0;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'proxy';
  const targetUrl = url.searchParams.get('url');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, auth-token',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: cors });
  }

  // ── MT5 DATA via GET params ──────────────────────────────────
  if (mode === 'mt5data') {
    try {
      const p = url.searchParams;
      // Parse positions from pipe-separated string
      const posStr = p.get('pos') || '';
      const positions = posStr ? posStr.split('|').map(s => {
        const f = s.split(',');
        return {
          ticket: f[0], symbol: f[1],
          type: f[2]==='0'?'BUY':'SELL',
          lots: parseFloat(f[3]||0),
          open: parseFloat(f[4]||0),
          current: parseFloat(f[5]||0),
          sl: parseFloat(f[6]||0),
          tp: parseFloat(f[7]||0),
          profit: parseFloat(f[8]||0)
        };
      }) : [];

      mt5Cache = {
        balance:     parseFloat(p.get('bal')||0),
        equity:      parseFloat(p.get('eq')||0),
        margin:      parseFloat(p.get('mg')||0),
        freeMargin:  parseFloat(p.get('fm')||0),
        marginLevel: parseFloat(p.get('ml')||0),
        profit:      parseFloat(p.get('pnl')||0),
        login:       p.get('lgn')||'',
        broker:      p.get('brk')||'',
        server:      p.get('srv')||'',
        positions:   positions,
        history:     mt5Cache ? (mt5Cache.history||[]) : [],
        ts:          Date.now()
      };
      mt5CacheTime = Date.now();

      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...cors }
      });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
  }

  // ── MT5 BRIDGE (legacy POST) ─────────────────────────────────
  if (mode === 'mt5bridge') {
    if (request.method === 'POST') {
      try {
        const bodyText = await request.text();
        let data = null;
        try { data = JSON.parse(bodyText); } catch(e) { data = { raw: bodyText }; }
        mt5Cache = data;
        mt5CacheTime = Date.now();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...cors }
        });
      } catch(e) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...cors }
        });
      }
    } else {
      const age = Date.now() - mt5CacheTime;
      const hasData = mt5Cache && age < 60000;
      return new Response(JSON.stringify({
        ok: true,
        data: hasData ? mt5Cache : null,
        age: hasData ? Math.round(age/1000) : null
      }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
  }

  // ── POLL for terminal (GET /mt5) ─────────────────────────────
  if (mode === 'mt5') {
    const age = Date.now() - mt5CacheTime;
    const hasData = mt5Cache && age < 30000;
    return new Response(JSON.stringify({
      ok: true,
      data: hasData ? mt5Cache : null,
      age: hasData ? Math.round(age/1000) : null
    }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...cors }
    });
  }

  // ── AI PROXY ─────────────────────────────────────────────────
  if (mode === 'ai') {
    try {
      const body = await request.json();
      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      return new Response(await aiResp.text(), {
        status: aiResp.status, headers: { 'Content-Type': 'application/json', ...cors }
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 200, headers: cors });
    }
  }

  // ── ARTICLE EXTRACTION ───────────────────────────────────────
  if (mode === 'article') {
    if (!targetUrl) return new Response(JSON.stringify({ error: 'No URL' }), { status: 200, headers: cors });
    try {
      const r = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await r.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,4000);
      const img = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)||html.match(/<img[^>]+src="(https[^"]+\.(jpg|png|webp)[^"]*)"/i)||[])[1]||null;
      return new Response(JSON.stringify({ text, image: img }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 200, headers: cors });
    }
  }

  // ── CORS PROXY ───────────────────────────────────────────────
  if (!targetUrl) {
    return new Response(JSON.stringify({
      status: 'QQ Capital Worker v3 OK',
      mt5: mt5Cache ? `data from ${mt5Cache.broker||'MT5'} age=${Math.round((Date.now()-mt5CacheTime)/1000)}s` : 'no data'
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  }
  try {
    const r = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    return new Response(await r.text(), {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('Content-Type')||'application/json', ...cors }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 200, headers: cors });
  }
}
