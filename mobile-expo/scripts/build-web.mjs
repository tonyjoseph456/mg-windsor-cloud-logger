// Builds the PWA into ./dist-web and injects the manifest + iOS "Add to Home Screen" tags.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = 'dist-web';
fs.rmSync(out, { recursive: true, force: true });
const nodeBinDir = path.dirname(process.execPath);
const envWithNode = {
  ...process.env,
  PATH: `${nodeBinDir}${path.delimiter}${process.env.PATH || ''}`,
};
execSync(`"${process.execPath}" node_modules/expo/bin/cli export -p web --output-dir ${out}`, {
  stdio: 'inherit',
  env: envWithNode,
});

if (fs.existsSync('public')) {
  fs.cpSync('public', out, { recursive: true });
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
      /* Prevent iOS Safari from zooming in on input focus */
      input, textarea, select {
        font-size: 16px !important;
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
        box-sizing: border-box !important;
        position: fixed !important;
        bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important;
        left: 16px !important;
        right: 16px !important;
        width: auto !important;
        max-width: 420px !important;
        height: 64px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding: 3px 4px !important;
        border-radius: 9999px !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        z-index: 9999 !important;
        overflow: visible !important;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        -webkit-touch-callout: none !important;
      }
      #liquid-glass-tabbar-surface,
      .liquid-glass-tabbar-surface {
        box-sizing: border-box !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        border-radius: 9999px !important;
        overflow: hidden !important;
        background: rgba(255, 255, 255, 0.07) !important;
        -webkit-backdrop-filter: blur(22px) saturate(180%) !important;
        backdrop-filter: blur(22px) saturate(180%) !important;
        border: 1px solid rgba(255, 255, 255, 0.16) !important;
        box-shadow:
          inset 0 1px 0 0 rgba(255, 255, 255, 0.38),
          0 12px 32px rgba(0, 0, 0, 0.45) !important;
        pointer-events: none !important;
      }
      #liquid-glass-tabbar-surface.reduced-transparency,
      .liquid-glass-tabbar-surface.reduced-transparency {
        background: #131B2E !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        box-shadow:
          inset 0 1px 0 0 rgba(255, 255, 255, 0.16),
          0 12px 30px rgba(0, 0, 0, 0.6) !important;
      }
      @media (prefers-reduced-transparency: reduce) {
        #liquid-glass-tabbar-surface,
        .liquid-glass-tabbar-surface {
          background: #131B2E !important;
          -webkit-backdrop-filter: none !important;
          backdrop-filter: none !important;
          border: 1px solid rgba(255, 255, 255, 0.18) !important;
          box-shadow:
            inset 0 1px 0 0 rgba(255, 255, 255, 0.16),
            0 12px 30px rgba(0, 0, 0, 0.6) !important;
        }
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

// Ensure viewport includes viewport-fit=cover and disables auto-zoom on mobile inputs
html = html.replace(
  /<meta\s+name=["']viewport["'][^>]*>/i,
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />'
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
