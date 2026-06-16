// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

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
  })],
  vite: {
    plugins: [tailwindcss()],
  },
});
