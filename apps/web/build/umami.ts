import type { Plugin } from 'vite';

// Build-time only: an unconfigured build contains no tracker tag or vendor URL.
export function umamiPlugin(env: Record<string, string | undefined>): Plugin {
  const src = env.VITE_UMAMI_SCRIPT_URL?.trim();
  const websiteId = env.VITE_UMAMI_WEBSITE_ID?.trim();
  if (Boolean(src) !== Boolean(websiteId)) {
    throw new Error('Set both VITE_UMAMI_SCRIPT_URL and VITE_UMAMI_WEBSITE_ID, or leave both empty.');
  }
  if (src) {
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      throw new Error('VITE_UMAMI_SCRIPT_URL must be an absolute HTTPS URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\s"'<>\\;*]/.test(src)) {
      throw new Error('VITE_UMAMI_SCRIPT_URL must be HTTPS without credentials, query, fragment, or unsafe characters.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(websiteId!)) {
      throw new Error('VITE_UMAMI_WEBSITE_ID must be a UUID.');
    }
  }
  return {
    name: 'optional-umami-tracker',
    transformIndexHtml() {
      return src && websiteId ? [{
        tag: 'script',
        attrs: {
          defer: true,
          src,
          'data-website-id': websiteId,
          'data-do-not-track': 'true',
          'data-exclude-search': 'true',
          'data-exclude-hash': 'true',
        },
        injectTo: 'head',
      }] : [];
    },
  };
}
