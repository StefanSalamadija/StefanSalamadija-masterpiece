import { defineConfig } from 'vitest/config';
import { cpSync } from 'node:fs';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import release from './release.json' with { type: 'json' };

/**
 * Publishes release.json as dist/version.json, which the running app fetches to say what is new in an update. JSON is
 * not in the Workbox globPatterns, so the file is never precached and always comes from the network.
 */
function releaseInfoPlugin(): Plugin {
  return {
    name: 'masterpiece-release-info',
    apply: 'build',
    generateBundle() {
      if (release.version !== pkg.version) {
        this.error(`release.json is at version ${release.version} but package.json is at ${pkg.version}. Make them match.`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: release.version, whatsNew: release.whatsNew })}\n`,
      });
    },
  };
}

/**
 * Copies the pdf.js worker, standard fonts, CMaps, ICC profiles and wasm into dist/pdfjs/, where `src/library/pdfjs.ts`
 * loads them from (under the app base, so they are cached for offline use like the rest of the app).
 */
function pdfjsAssetsPlugin(): Plugin {
  return {
    name: 'masterpiece-pdfjs-assets',
    apply: 'build',
    closeBundle() {
      const from = 'node_modules/pdfjs-dist';
      const to = 'dist/pdfjs';
      cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
      for (const dir of ['standard_fonts', 'cmaps', 'iccs', 'wasm']) cpSync(`${from}/${dir}`, `${to}/${dir}`, { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    preact(),
    releaseInfoPlugin(),
    pdfjsAssetsPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2,mjs,pfb,bcmap,ttf,wasm,icc}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Masterpiece',
        short_name: 'Masterpiece',
        description: 'Ship office companion — works offline',
        theme_color: '#0B2545',
        background_color: '#0B2545',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setupDb.ts'],
  },
});
