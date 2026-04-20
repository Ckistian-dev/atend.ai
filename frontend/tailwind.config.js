
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Novo Design System: "The Intelligent Stratum"
        is: {
          primary: '#0037b0',
          'primary-container': '#1d4ed8',
          'on-surface': '#0b1c30',
          'on-surface-variant': '#434655',
          surface: '#f8f9ff',
          'surface-container-low': '#eff4ff',
          'surface-container-lowest': '#ffffff',
          'surface-container-highest': '#d3e4fe',
          'outline-variant': '#c4c5d7',
          error: '#ba1a1a',
          'primary-fixed': '#dce1ff',
        },
        // MANTENDO BRAND PARA COMPATIBILIDADE (LEGACY)
        brand: {
          primary: '#0942b3',
          accent: '#E6EEFF',
          surface: '#E6EEFF',
          foreground: '#0A0A0A',
          background: '#FFFFFF',
          'foreground-secondary': '#1E1E1E',
          border: '#1E1E1E',
          'primary-hover': '#0046CC',
          'primary-active': '#003599',
          'text-muted': '#6B7280',
          'border-light': '#E5E7EB',
          'surface-alt': '#F9FAFB',
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#3B82F6',
          'whatsapp-background': '#ede9e1',
        },
      },
      fontFamily: {
        'plus-jakarta': ['"Plus Jakarta Sans"', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
      },
      // Animações mantidas para deixar a interface mais fluida
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'shake': 'shake 0.2s ease-in-out 0s 2',
      },
    },
  },
  plugins: [],
}