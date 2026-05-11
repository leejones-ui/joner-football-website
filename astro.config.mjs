// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://jonerfootball.com',
  integrations: [react(), sitemap({
    filter: (page) => {
      const excludedPaths = [
        '/checkout-success/',
        '/camps/test-signup/',
        '/home-ball-prototype/',
        '/home-concept/',
        '/home-object-prototype/',
        '/home-storyboard-prototype/',
        '/join-preview/',
        '/join/',
      ];
      return !excludedPaths.some((path) => page.endsWith(path));
    },
  })],
  vite: {
    plugins: [tailwindcss()],
  },
});
