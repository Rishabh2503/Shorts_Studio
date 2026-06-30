import { createTheme, alpha } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
    neon: { pink: string; violet: string; cyan: string; lime: string };
  }
  interface PaletteOptions {
    neon?: { pink: string; violet: string; cyan: string; lime: string };
  }
}

// Video-editor design system — DaVinci / CapCut inspired medium-gray palette
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#5b8af5', light: '#7ea5ff', dark: '#3b6de0' },
    secondary:  { main: '#22d3ee', light: '#67e8f9', dark: '#0891b2' },
    error:      { main: '#f43f5e' },
    warning:    { main: '#f59e0b' },
    success:    { main: '#10b981' },
    background: { default: '#1e2028', paper: '#272a35' },
    text:       { primary: '#e8eaf0', secondary: '#9599b3' },
    divider:    'rgba(255,255,255,0.09)',
    neon: { pink: '#f43f5e', violet: '#5b8af5', cyan: '#22d3ee', lime: '#10b981' }
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      "'Inter', 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 700, letterSpacing: '-0.03em' },
    h2: { fontWeight: 700, letterSpacing: '-0.025em' },
    h3: { fontWeight: 600, letterSpacing: '-0.02em' },
    h4: { fontWeight: 600, letterSpacing: '-0.015em' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '-0.01em' },
    caption: { letterSpacing: '0.01em', fontSize: '0.7rem' }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { scrollbarWidth: 'thin', scrollbarColor: '#3a3e52 #1e2028' }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#272a35',
          border: '1px solid rgba(255,255,255,0.09)'
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          paddingInline: 14,
          paddingBlock: 7,
          fontSize: '0.8125rem',
          transition: 'all 160ms ease'
        },
        containedPrimary: {
          background: 'linear-gradient(135deg,#5b8af5 0%,#3b6de0 100%)',
          boxShadow: '0 2px 12px rgba(91,138,245,0.35)',
          '&:hover': {
            background: 'linear-gradient(135deg,#7ea5ff 0%,#5b8af5 100%)',
            boxShadow: '0 4px 18px rgba(91,138,245,0.45)',
            transform: 'translateY(-1px)'
          }
        },
        outlinedPrimary: {
          borderColor: 'rgba(91,138,245,0.45)',
          '&:hover': { borderColor: '#5b8af5', background: 'rgba(91,138,245,0.1)' }
        },
        outlinedSecondary: {
          borderColor: 'rgba(34,211,238,0.4)',
          '&:hover': { borderColor: '#22d3ee', background: 'rgba(34,211,238,0.08)' }
        }
      }
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: 'background 140ms ease, color 140ms ease, transform 140ms ease',
          '&:hover': { transform: 'scale(1.05)' }
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: '0.7rem',
          height: 22,
          fontWeight: 600,
          letterSpacing: '0.02em'
        }
      }
    },
    MuiSlider: {
      styleOverrides: {
        root: { color: '#5b8af5', padding: '10px 0' },
        rail:  { opacity: 0.3, height: 3, backgroundColor: '#4a4e62' },
        track: { height: 3 },
        thumb: {
          width: 13,
          height: 13,
          '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 6px rgba(91,138,245,0.2)' }
        }
      }
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            fontSize: '0.8125rem',
            backgroundColor: '#1e2028',
            '& fieldset': { borderColor: 'rgba(255,255,255,0.13)' },
            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.25)' },
            '&.Mui-focused fieldset': { borderColor: '#5b8af5', borderWidth: 1 }
          },
          '& .MuiInputLabel-root': { fontSize: '0.8125rem' }
        }
      }
    },
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 500 },
      styleOverrides: {
        tooltip: {
          background: '#1a1d28',
          border: '1px solid rgba(255,255,255,0.13)',
          fontSize: '0.7rem',
          borderRadius: 6,
          padding: '5px 9px'
        },
        arrow: { color: '#1a1d28' }
      }
    },
    MuiMenu: {
      styleOverrides: {
        paper: { background: '#1e2028', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 36px rgba(0,0,0,0.5)' }
      }
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.8125rem',
          borderRadius: 6,
          margin: '2px 4px',
          minHeight: 32,
          '&:hover':              { background: 'rgba(91,138,245,0.12)' },
          '&.Mui-selected':       { background: 'rgba(91,138,245,0.18)' },
          '&.Mui-selected:hover': { background: 'rgba(91,138,245,0.24)' }
        }
      }
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, height: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
        bar:  { background: 'linear-gradient(90deg,#5b8af5,#22d3ee)' }
      }
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': { color: '#22d3ee' },
          '&.Mui-checked + .MuiSwitch-track': { backgroundColor: alpha('#22d3ee', 0.5) }
        },
        track: { backgroundColor: 'rgba(255,255,255,0.15)' }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.07)' }
      }
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: 'rgba(255,255,255,0.07)' } }
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { background: '#1e2028', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 32px rgba(0,0,0,0.45)' },
        listbox: { fontSize: '0.8125rem' }
      }
    }
  }
});
