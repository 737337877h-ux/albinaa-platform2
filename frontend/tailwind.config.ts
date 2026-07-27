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
        concrete: {
          50: '#F7F6F3', 100: '#EFEDE7', 200: '#E2DFD6', 300: '#CFCAC0',
          400: '#A8A398', 500: '#8A8578', 700: '#57534A',
        },
        iron: { 800: '#24333B', 900: '#1C2B33' },
        pine: {
          50: '#EBF4F3', 100: '#CFE5E3', 500: '#177470',
          600: '#12615E', 700: '#0F5C5A', 800: '#0B4341', 900: '#082F2E',
        },
        hazard: { 100: '#FBEFD8', 500: '#E8A33D', 700: '#B67A1E' },
        debt: { 50: '#FAECEA', 400: '#E08278', 500: '#C64A40', 600: '#B3372F', 700: '#8F2B25' },
        credit: { 50: '#EAF4EE', 400: '#7FBB97', 600: '#2E7D4F', 700: '#225F3C' },
      },
      fontFamily: {
        // مكدّس نظام آمن يدعم العربية بلا أي اعتماد على شبكة وقت البناء.
        // يمكن إضافة خط "البناء الراقي" الرسمي أولاً في القائمتين لاحقًا.
        display: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
        body: ['Tahoma', 'Segoe UI', 'system-ui', 'ui-sans-serif', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,43,51,.06), 0 4px 12px rgba(28,43,51,.05)',
      },
    },
  },
  plugins: [],
};
export default config;
