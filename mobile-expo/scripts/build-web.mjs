// Builds the PWA into ./dist-web and injects the manifest + iOS "Add to Home Screen" tags.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = 'dist-web';
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx expo export -p web --output-dir ${out}`, { stdio: 'inherit' });

fs.copyFileSync('public/icon.svg', path.join(out, 'icon.svg'));
if (fs.existsSync('public/sw.js')) {
  fs.copyFileSync('public/sw.js', path.join(out, 'sw.js'));
}
fs.writeFileSync(
  path.join(out, 'manifest.json'),
  JSON.stringify(
    {
      name: 'MG iSMART India',
      short_name: 'MG iSMART',
      description: 'MG Windsor EV companion: live status, trips, charging and Google Sheets logging',
      start_url: '/',
      display: 'standalone',
      background_color: '#0A0E17',
      theme_color: '#0A0E17',
      orientation: 'portrait-primary',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    null,
    2
  )
);

const tags = `
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="MG iSMART" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0A0E17" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0A0E17" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#0A0E17" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icon.svg" />
    <style>
      :root {
        color-scheme: dark;
      }
      html, body {
        width: 100%;
        min-height: 100%;
        height: 100%;
        min-height: 100dvh;
        height: 100dvh;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        margin: 0;
        padding: 0;
        background-color: #0A0E17 !important;
        background: #0A0E17 !important;
        color-scheme: dark;
        -webkit-tap-highlight-color: transparent;
        overscroll-behavior-y: none;
      }
      body {
        overflow: hidden;
      }
      #root {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-height: 100%;
        height: 100%;
        min-height: 100dvh;
        height: 100dvh;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        flex: 1;
        background-color: #0A0E17 !important;
        background: #0A0E17 !important;
        overflow: hidden;
      }
    </style>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.register('/sw.js').then(function(reg) {
            reg.update();
          }).catch(function(err) {
            console.log('SW registration error:', err);
          });
        });
      }
    </script>`;
const htmlPath = path.join(out, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Ensure viewport includes viewport-fit=cover so the background extends into the safe areas seamlessly
html = html.replace(
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />'
);

html = html.replace('</head>', `${tags}\n  </head>`);
fs.writeFileSync(htmlPath, html);

// Single-page app fallback for Cloudflare Pages
fs.writeFileSync(path.join(out, '_redirects'), '/* /index.html 200\n');

// Cache control headers for Cloudflare Pages to prevent stale HTML caching
fs.writeFileSync(
  path.join(out, '_headers'),
  `/*
  X-Frame-Options: SAMEORIGIN
/index.html
  Cache-Control: no-cache, no-store, must-revalidate
/manifest.json
  Cache-Control: no-cache, no-store, must-revalidate
/sw.js
  Cache-Control: no-cache, no-store, must-revalidate
/_expo/*
  Cache-Control: public, max-age=31536000, immutable
`
);
console.log('\nPWA ready in ./' + out);
