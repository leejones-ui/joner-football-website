/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'joner-red': '#E30613',
        'joner-black': '#0A0A0A',
        'joner-white': '#FFFFFF',
        'joner-gray': '#1A1A1A',
        'joner-gray-light': '#F5F5F5',
      },
      fontFamily: {
        heading: ['Oswald', 'sans-serif'],
        body: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
