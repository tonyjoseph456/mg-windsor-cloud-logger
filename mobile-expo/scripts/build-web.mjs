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
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
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
        width: 100% !important;
        height: 100% !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background-color: #0A0E17 !important;
        background: #0A0E17 !important;
        color-scheme: dark;
        -webkit-tap-highlight-color: transparent;
        overscroll-behavior-y: none;
        overflow: hidden !important;
      }
      body {
        overflow: hidden !important;
      }
      #root {
        display: flex !important;
        flex-direction: column !important;
        width: 100% !important;
        height: 100% !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        flex: 1 !important;
        background-color: #0A0E17 !important;
        background: #0A0E17 !important;
        overflow: hidden !important;
      }
      /* iOS 26 Liquid Glass Floating Pill Bottom Navigation Bar */
      #liquid-glass-tabbar,
      [data-testid="liquid-glass-tabbar"],
      .liquid-glass-tabbar {
        position: fixed !important;
        bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important;
        left: 16px !important;
        right: 16px !important;
        width: auto !important;
        max-width: 440px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding-top: 8px !important;
        padding-bottom: 6px !important;
        padding-left: 10px !important;
        padding-right: 10px !important;
        border-radius: 9999px !important;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(15, 23, 42, 0.72) 35%, rgba(10, 15, 29, 0.82) 100%) !important;
        -webkit-backdrop-filter: blur(32px) saturate(220%) contrast(108%) !important;
        backdrop-filter: blur(32px) saturate(220%) contrast(108%) !important;
        border: 1px solid rgba(255, 255, 255, 0.32) !important;
        box-shadow: 
          0 24px 48px -6px rgba(0, 0, 0, 0.75),
          0 10px 24px -3px rgba(0, 0, 0, 0.5),
          inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.65),
          inset 0 -1.5px 2px 0 rgba(255, 255, 255, 0.15),
          0 0 0 1px rgba(255, 255, 255, 0.1) !important;
        z-index: 9999 !important;
        overflow: hidden !important;
      }
      #liquid-glass-tabbar::before,
      .liquid-glass-tabbar::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border-radius: 9999px;
        padding: 1px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.75) 0%, rgba(245, 158, 11, 0.28) 25%, rgba(56, 189, 248, 0.28) 75%, rgba(255, 255, 255, 0.45) 100%);
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
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
