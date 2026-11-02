/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mg: {
          red: '#E60012',
          emerald: '#10B981',
          cyan: '#06B6D4',
          dark: '#0A0E17',
          card: '#131B2E',
        },
      },
    },
  },
  plugins: [],
};
