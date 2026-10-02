// Serves the operators' dashboard (index.html) and nothing else. No secrets live here: the page signs the operator
// in with the app's own login (phone + code) and then reads public.app_analytics with their own token, so the page
// is safe to leave open to the world — without an account listed in app_settings.console_admin_emails it shows
// nothing. SUPABASE_URL and SUPABASE_ANON_KEY (the app's public key) are substituted at request time.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://opoqjzjmretyvomuhvct.supabase.co').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const page = fs
  .readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace('__SUPABASE_URL__', SUPABASE_URL)
  .replace('__ANON_KEY__', ANON_KEY);

if (!ANON_KEY) console.warn('SUPABASE_ANON_KEY is not set: the page will not be able to sign anyone in.');

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('method not allowed');
    }
    const url = (req.url || '/').split('?')[0];
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, anon_key: !!ANON_KEY }));
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? '' : page);
  })
  .listen(PORT, () => console.log(`dashboard on :${PORT}`));
