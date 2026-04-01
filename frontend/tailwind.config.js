import { backgroundClip } from 'html2canvas/dist/types/css/property-descriptors/background-clip'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta Confiança e Profissionalismo (Clássica SaaS) do Painel 1
        brand: {
          // --- Suas Cores Originais ---
          primary: '#0942b3',      // Azul Royal Intenso - Ação/Primária
          accent: '#E6EEFF',       // Azul Claro Suave - Acerto Secundário
          surface: '#E6EEFF',      // Superfícies de destaque
          foreground: '#0A0A0A',   // Preto Suave / Chumbo - Texto Principal
          background: '#FFFFFF',   // Branco Puro - Fundo Principal
          'foreground-secondary': '#1E1E1E', // Cinza Escuro - Texto Secundário (Títulos menores)
          border: '#1E1E1E',       // Cinza Escuro - Bordas com alto contraste

          // --- Adições: Estados de Interação ---
          'primary-hover': '#0046CC',  // Azul mais escuro - Para passar o mouse em botões
          'primary-active': '#003599', // Azul profundo - Para o momento do clique (active)

          // --- Adições: Neutros de Apoio ---
          'text-muted': '#6B7280',     // Cinza Médio Verdadeiro - Para placeholders, datas e texto desabilitado
          'border-light': '#E5E7EB',   // Cinza Muito Claro - Para divisórias sutis, tabelas e bordas de cards
          'surface-alt': '#F9FAFB',    // Fundo alternativo quase branco - Para diferenciar seções sem usar o azul

          // --- Adições: Cores Semânticas (Status) ---
          success: '#10B981',      // Verde Esmeralda - Sucesso, confirmações, concluído
          warning: '#F59E0B',      // Laranja Amarelado - Alertas, atenção, pendente
          error: '#EF4444',        // Vermelho Suave - Erros, falhas, botões de exclusão
          info: '#3B82F6',         // Azul Claro Vibrante - Dicas e informações gerais

          // --- Adições: Fundo whatsapp (Status) ---
          'whatsapp-background': '#ede9e1',
        },
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
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
      },
    },
  },
  plugins: [],
}