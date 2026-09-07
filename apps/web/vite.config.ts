import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-api-documentation-assets',
      generateBundle() {
        for (const name of ['swagger-ui-bundle.js', 'swagger-ui.css']) {
          // Only fixed build-owned package assets are read; no request input is involved.
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          this.emitFile({ type: 'asset', fileName: `docs/${name}`, source: readFileSync(require.resolve(`swagger-ui-dist/${name}`)) })
        }
      },
    },
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

          if (id.includes('/dayjs/locale/')) {
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
