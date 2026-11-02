/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/public/**/*.{html,js}', './client/views/**/*.html'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Black Ops One"', 'system-ui', 'sans-serif'],
        sans: ['Rajdhani', 'system-ui', 'sans-serif'],
      },
      colors: {
        blood: { 400: '#f87171', 500: '#dc2626', 600: '#b91c1c', 700: '#7f1d1d' },
        toxic: { 400: '#a3e635', 500: '#84cc16' },
      },
    },
  },
  plugins: [],
};
