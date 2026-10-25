import { defineConfig } from 'vitest/config';
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

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    preact(),
    releaseInfoPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'] },
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
