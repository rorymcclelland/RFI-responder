/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0a0a0a',
          900: '#111111',
          800: '#1c1c1c',
          700: '#2a2a2a',
          600: '#3d3d3d',
          500: '#555555',
          400: '#777777',
          300: '#999999',
          200: '#cccccc',
          100: '#e8e8e8',
          50:  '#f5f5f5',
        },
        coral: {
          700: '#c0392b',
          600: '#e74c3c',
          500: '#ff4d3d',
          400: '#ff6b5b',
          300: '#ff9387',
          200: '#ffc5bf',
          100: '#fff0ee',
          50:  '#fff8f7',
        },
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover': '0 4px 16px 0 rgb(0 0 0 / 0.10), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
        'modal': '0 20px 60px -10px rgb(0 0 0 / 0.25)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
        '4xl': '1.5rem',
      },
      animation: {
        'slide-up': 'slideUp 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
