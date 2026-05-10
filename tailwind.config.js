/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0a0a14',
          800: '#10101e',
          700: '#181830',
          600: '#222244'
        },
        neon: {
          pink: '#ff3ea5',
          violet: '#7c3aed',
          cyan: '#22d3ee',
          lime: '#a3e635'
        }
      },
      backgroundImage: {
        'mesh-1':
          'radial-gradient(at 20% 10%, rgba(124,58,237,0.35) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(34,211,238,0.25) 0px, transparent 50%), radial-gradient(at 50% 100%, rgba(255,62,165,0.25) 0px, transparent 50%)'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 10px 40px rgba(124,58,237,0.25)'
      }
    }
  },
  plugins: [],
  corePlugins: { preflight: false }
};
