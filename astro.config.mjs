// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const appSeoSitemapRules = /** @type {const} */ ({
  '/app/': { priority: 1.0, changefreq: 'weekly' },
  '/football-training-app/': { priority: 0.95, changefreq: 'weekly' },
  '/join/': { priority: 0.9, changefreq: 'weekly' },
  '/app/for-coaches/': { priority: 0.85, changefreq: 'monthly' },
  '/free-bundle/': { priority: 0.8, changefreq: 'monthly' },
  '/reviews/': { priority: 0.9, changefreq: 'weekly' },
});

export default defineConfig({
  site: 'https://jonerfootball.com',
  integrations: [sitemap({
    filter: (page) => {
      const pathname = new URL(page, 'https://jonerfootball.com').pathname;
      // Keep this list in sync with pages that set noindex: a URL should never
      // be noindexed and listed in the sitemap at the same time.
      const excludedPaths = [
        '/checkout-success/',
        '/camp-success/',
        '/download-success/',
        '/camps/test-signup/',
        '/home-ball-prototype/',
        '/home-concept/',
        '/home-object-prototype/',
        '/home-storyboard-prototype/',
        '/draftjoin/',

        '/new-coaching-role/',
        '/training/joners-juniors/',
        '/training/jfp-program/',
        '/player-waiver/',
        '/email-assets/',
        '/free-bundle/watch/',
      ];
      return !pathname.startsWith('/drafts/') && !excludedPaths.includes(pathname);
    },
    serialize: (item) => {
      const pathname = new URL(item.url).pathname;
      const appSeoRule = appSeoSitemapRules[/** @type {keyof typeof appSeoSitemapRules} */ (pathname)];

      if (appSeoRule) {
        item.priority = appSeoRule.priority;
        item.changefreq = /** @type {any} */ (appSeoRule.changefreq);
      }

      if (pathname.startsWith('/blog/')) {
        item.priority = pathname === '/blog/' ? 0.75 : 0.65;
        item.changefreq = 'monthly';
      }

      return item;
    },
  })],
  vite: {
    plugins: [tailwindcss()],
  },
});
