/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f5f7fa',
          100: '#e4e9f0',
          500: '#3b82f6',
          700: '#1d4ed8',
          900: '#0f1f3a'
        }
      }
    }
  },
  plugins: []
}
