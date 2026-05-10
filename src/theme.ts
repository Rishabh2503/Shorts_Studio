import { createTheme, alpha } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
    neon: { pink: string; violet: string; cyan: string; lime: string };
  }
  interface PaletteOptions {
    neon?: { pink: string; violet: string; cyan: string; lime: string };
  }
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c3aed', light: '#a78bfa', dark: '#5b21b6' },
    secondary: { main: '#22d3ee' },
    error: { main: '#ff3ea5' },
    success: { main: '#a3e635' },
    background: { default: '#07070d', paper: '#10101e' },
    text: { primary: '#e9e9f6', secondary: '#a8a8c4' },
    neon: { pink: '#ff3ea5', violet: '#7c3aed', cyan: '#22d3ee', lime: '#a3e635' }
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily:
      "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    h1: { fontWeight: 800, letterSpacing: '-0.02em' },
    h2: { fontWeight: 800, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.01em' },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 600 }
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: alpha('#10101e', 0.7),
          backdropFilter: 'blur(12px)',
          border: `1px solid ${alpha('#ffffff', 0.08)}`
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 12, paddingInline: 16, paddingBlock: 8 },
        containedPrimary: {
          background: 'linear-gradient(135deg,#7c3aed 0%,#22d3ee 100%)',
          boxShadow: '0 8px 24px rgba(124,58,237,0.35)',
          '&:hover': {
            background: 'linear-gradient(135deg,#8b5cf6 0%,#67e8f9 100%)'
          }
        }
      }
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiSlider: {
      styleOverrides: {
        root: { color: '#a78bfa' },
        rail: { opacity: 0.3 }
      }
    }
  }
});
