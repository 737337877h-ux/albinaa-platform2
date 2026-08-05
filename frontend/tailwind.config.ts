import type { Config } from 'tailwindcss';

/**
 * هوية "البناء الراقي" — قرارات موثقة في خطة التصميم:
 * خرسانة دافئة كخلفية، صنوبر عميق كأساسي، كهرمان السلامة للمتأخر حصريًا.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { 0: 'var(--surface-0)', 1: 'var(--surface-1)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' },
        ink: { hi: 'var(--text-hi)', mid: 'var(--text-mid)', low: 'var(--text-low)' },
        brand: { DEFAULT: 'var(--brand)', dim: 'var(--brand-dim)' },
        gold: { DEFAULT: 'var(--gold)', dim: 'var(--gold-dim)' },
        line: { DEFAULT: 'var(--border)', lit: 'var(--border-lit)' },
        info: 'var(--info)',
        whatsapp: 'var(--wa)',
        concrete: {
          50: '#F0F3F1', 100: '#F7F9F8', 200: '#D8E0DC', 300: '#C5D0CB',
          400: '#899997', 500: '#526365', 700: '#344648',
        },
        iron: { 800: '#24333B', 900: '#1C2B33' },
        pine: {
          50: '#E2ECE8', 100: '#CFE1DA', 500: '#176B50',
          600: '#10543E', 700: '#0B3C2D', 800: '#06241B', 900: '#041A13',
        },
        hazard: { 100: '#F9F3E5', 500: '#C59B27', 700: '#967517' },
        debt: { 50: '#FCECEA', 400: '#DA756F', 500: '#C64A40', 600: '#B3261E', 700: '#8F1E18' },
        credit: { 50: '#E9F5EE', 400: '#72B88D', 600: '#1E7E45', 700: '#176337' },
      },
      fontFamily: {
        // مكدّس نظام آمن يدعم العربية بلا أي اعتماد على شبكة وقت البناء.
        // يمكن إضافة خط "البناء الراقي" الرسمي أولاً في القائمتين لاحقًا.
        display: ['Cairo', 'Tahoma', 'Segoe UI', 'system-ui', 'sans-serif'],
        body: ['Cairo', 'Tahoma', 'Segoe UI', 'system-ui', 'sans-serif'],
        numeric: ['Space Grotesk', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 4px rgba(15,26,28,.05), 0 10px 28px rgba(15,26,28,.07)',
        glow: 'var(--glow-brand)',
        critical: 'var(--glow-crit)',
      },
      borderRadius: { brand: 'var(--radius)' },
    },
  },
  plugins: [],
};
export default config;
