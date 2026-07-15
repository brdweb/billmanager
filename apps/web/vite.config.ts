import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
  build: {
    outDir: 'dist',
    modulePreload: {
      resolveDependencies(_, deps, context) {
        if (context.hostType !== 'html') {
          return deps;
        }

        return deps.filter(
          (dep) =>
            !dep.includes('vendor-charts') &&
            !dep.includes('vendor-pdf') &&
            !dep.includes('vendor-canvas') &&
            !dep.includes('vendor-sanitize')
        );
      },
    },
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('react') || id.includes('scheduler')) {
            return 'vendor-react';
          }

          if (id.includes('recharts') || id.includes('/d3-')) {
            return 'vendor-charts';
          }

          if (id.includes('@mantine/')) {
            return 'vendor-mantine';
          }

          if (id.includes('@tabler/icons-react')) {
            return 'vendor-icons';
          }

          if (id.includes('jspdf')) {
            return 'vendor-pdf';
          }

          if (id.includes('html2canvas')) {
            return 'vendor-canvas';
          }

          if (id.includes('dompurify')) {
            return 'vendor-sanitize';
          }

          if (id.includes('@simplewebauthn')) {
            return 'vendor-webauthn';
          }

          return 'vendor';
        },
      },
    },
  },
})
