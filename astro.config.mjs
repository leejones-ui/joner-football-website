// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jonerfootball.com',
  integrations: [sitemap({
    filter: (page) => {
      const excludedPaths = [
        '/checkout-success/',
        '/camps/test-signup/',
        '/home-ball-prototype/',
        '/home-concept/',
        '/home-object-prototype/',
        '/home-storyboard-prototype/',
        '/join/',
        '/new-coaching-role/',
      ];
      return !excludedPaths.some((path) => page.endsWith(path));
    },
  })],
  vite: {
    plugins: [tailwindcss()],
  },
});
