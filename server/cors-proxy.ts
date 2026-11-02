/**
 * Lightweight CORS & User-Agent Relay for MG iSMART India API
 * Can be run locally (`npm run proxy`) or deployed to a free Cloudflare Worker / Vercel Edge Function
 * so your iPhone 14 Plus Safari PWA can communicate with iov-tap.mgindia.co.in 24/7 anywhere.
 */
import http from 'node:http';
import { USER_AGENT } from '../src/sdk/client';

const PORT = Number(process.env.PORT || 8787);

const ALLOWED_HOSTS = new Set([
  'iov-tap.mgindia.co.in',
  'iov-gateway.mgindia.co.in',
]);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Accept-Language, APP-SIGNATURE, SIGNATURE, APP-CONTENT-ENCRYPTED, APP-LANGUAGE-TYPE, APP-LOGIN-TOKEN, APP-USER-ID, APP-SEND-DATE, APP-VERIFICATION-STRING, ORIGINAL-CONTENT-TYPE',
  'Access-Control-Expose-Headers':
    'APP-SEND-DATE, ORIGINAL-CONTENT-TYPE, app-send-date, original-content-type, x-mg-send-date',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const targetUrlStr = reqUrl.searchParams.get('url');

    if (!targetUrlStr) {
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'MG iSMART India CORS Relay',
          allowedHosts: Array.from(ALLOWED_HOSTS),
        })
      );
      return;
    }

    const targetUrl = new URL(targetUrlStr);
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
      res.end('Forbidden target host');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const bodyBuffer = Buffer.concat(chunks);

    const forwardHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT,
    };

    for (const [key, val] of Object.entries(req.headers)) {
      const upper = key.toUpperCase();
      if (
        upper.startsWith('APP-') ||
        upper === 'SIGNATURE' ||
        upper === 'ORIGINAL-CONTENT-TYPE' ||
        upper === 'CONTENT-TYPE' ||
        upper === 'ACCEPT' ||
        upper === 'ACCEPT-LANGUAGE'
      ) {
        if (typeof val === 'string') {
          forwardHeaders[upper] = val;
        }
      }
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? bodyBuffer : undefined,
    });

    const responseText = await upstream.text();
    const outHeaders: Record<string, string> = {
      ...CORS_HEADERS,
      'Content-Type': upstream.headers.get('content-type') || 'text/plain',
    };

    const sendDate =
      upstream.headers.get('APP-SEND-DATE') || upstream.headers.get('app-send-date');
    if (sendDate) {
      outHeaders['APP-SEND-DATE'] = sendDate;
      outHeaders['x-mg-send-date'] = sendDate;
    }
    const origCt =
      upstream.headers.get('ORIGINAL-CONTENT-TYPE') ||
      upstream.headers.get('original-content-type');
    if (origCt) {
      outHeaders['ORIGINAL-CONTENT-TYPE'] = origCt;
    }

    res.writeHead(upstream.status, outHeaders);
    res.end(responseText);
  } catch (err) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end(`Relay error: ${(err as Error).message}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MG iSMART India CORS Relay listening on http://0.0.0.0:${PORT}`);
});
