/**
 * TAKTO — Tailwind preset (v2)
 * Derivado de takto-tokens.json. Colores de marca + tokens semanticos.
 * Regla de marca: naranja (secondary-500 #FF6A00) nunca como texto fino sobre claro;
 * botones naranjas usan texto navy (action.onSecondary #131C4A).
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: { primary: '#131C4A', secondary: '#FF6A00', onPrimary: '#FFFFFF' },
        primary: {"50": "#EEF0F7", "100": "#D9DDEC", "200": "#B3BAD8", "300": "#8A94BF", "400": "#5F6BA1", "500": "#3B477E", "600": "#26315F", "700": "#1A2352", "800": "#131C4A", "900": "#0E1538", "950": "#080C20"},
        secondary: {"50": "#FFF3EB", "100": "#FFE1CC", "200": "#FFC299", "300": "#FFA366", "400": "#FF8533", "500": "#FF6A00", "600": "#E05C00", "700": "#C24A00", "800": "#963900", "900": "#6B2900", "950": "#3D1700"},
        neutral: {"0": "#FFFFFF", "50": "#F7F8FA", "100": "#EFF1F5", "200": "#E2E5EC", "300": "#CBD0DB", "400": "#9AA1B2", "500": "#6E7688", "600": "#525A6B", "700": "#3B4252", "800": "#272C38", "900": "#171B24", "950": "#0D1017"},
        surface: {"default": "#FFFFFF", "subtle": "#F7F8FA", "inverse": "#131C4A"},
        border: {"default": "#E2E5EC", "strong": "#CBD0DB", "focus": "#3B477E"},
        text: {"primary": "#171B24", "secondary": "#525A6B", "disabled": "#9AA1B2", "inverse": "#FFFFFF", "link": "#1A2352"},
        action: {"primary": "#131C4A", "primaryHover": "#0E1538", "secondary": "#FF6A00", "secondaryHover": "#E05C00", "onSecondary": "#131C4A", "quietBg": "#EFF1F5"},
        status: {"success": "#0E8A5F", "successSurface": "#E6F5EF", "warning": "#B26A00", "warningSurface": "#FFF4E0", "error": "#C42B2B", "errorSurface": "#FCEAEA", "info": "#2A5FD6", "infoSurface": "#E8EFFD"},
        pipeline: {"nuevo": "#6E7688", "contactado": "#2A5FD6", "cotizado": "#C24A00", "negociacion": "#3B477E", "ganado": "#0E8A5F", "perdido": "#C42B2B"},
      },
      fontFamily: {
        brand: ['Archivo','Helvetica Neue','Arial','sans-serif'],
        ui: ['IBM Plex Sans','Helvetica Neue','Arial','sans-serif'],
        data: ['IBM Plex Mono','ui-monospace','monospace'],
      },
      fontSize: {
        'display-1':'64px','display-2':'48px',
        h1:'36px', h2:'28px', h3:'22px',
        'body-lg':'18px', body:'16px',
        sm:'14px', xs:'12px',
      },
      spacing: {"0": "0", "1": "4px", "2": "8px", "3": "12px", "4": "16px", "5": "20px", "6": "24px", "8": "32px", "10": "40px", "12": "48px", "16": "64px", "20": "80px", "24": "96px"},
      borderRadius: {"xs": "2px", "sm": "4px", "md": "6px", "lg": "10px", "xl": "14px", "pill": "9999px"},
      boxShadow: {"xs": "0 1px 2px rgba(19,28,74,.06)", "sm": "0 1px 3px rgba(19,28,74,.10), 0 1px 2px rgba(19,28,74,.06)", "md": "0 4px 12px rgba(19,28,74,.10)", "lg": "0 12px 32px rgba(19,28,74,.14)", "focus": "0 0 0 3px rgba(59,71,126,.35)"},
      screens: { sm:'640px', md:'900px', lg:'1200px', xl:'1536px' },
      transitionTimingFunction: {
        standard:'cubic-bezier(.2,.8,.2,1)', entrance:'cubic-bezier(.16,1,.3,1)', exit:'cubic-bezier(.4,0,1,1)',
      },
      transitionDuration: { instant:'80ms', fast:'140ms', base:'200ms', slow:'320ms', scene:'520ms' },
    },
  },
};
