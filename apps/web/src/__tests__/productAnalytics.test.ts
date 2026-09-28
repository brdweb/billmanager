import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { umamiPlugin } from '../../build/umami';

const src = 'https://metrics.example.test:8443/custom/script.js';
const websiteId = '11111111-2222-3333-4444-555555555555';

async function renderIndex(scriptUrl = '', id = '') {
  vi.stubEnv('VITE_UMAMI_SCRIPT_URL', scriptUrl);
  vi.stubEnv('VITE_UMAMI_WEBSITE_ID', id);
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
  try {
    const html = await readFile('index.html', 'utf8');
    return new DOMParser().parseFromString(await server.transformIndexHtml('/', html), 'text/html');
  } finally {
    await server.close();
  }
}

afterEach(() => vi.unstubAllEnvs());

describe('product analytics HTML integration', () => {
  it('leaves a default self-hosted build without any tracker', async () => {
    const doc = await renderIndex();
    expect(doc.querySelector('script[data-website-id]')).toBeNull();
    expect(doc.querySelectorAll(`script[src="${src}"]`)).toHaveLength(0);
    expect([...doc.scripts].some(s => s.src.startsWith('https:'))).toBe(false);
    expect(doc.documentElement.innerHTML).not.toContain('analytics.billmanager.app');
  });

  it('loads exactly the configured tracker through the real Vite config', async () => {
    const doc = await renderIndex(src, websiteId);
    const scripts = doc.querySelectorAll('script[data-website-id]');
    expect(scripts).toHaveLength(1);
    expect(doc.querySelectorAll(`script[src="${src}"]`)).toHaveLength(1);
    const script = scripts[0];
    expect(script.parentElement).toBe(doc.head);
    expect(script.getAttribute('src')).toBe(src);
    expect(script.getAttribute('data-website-id')).toBe(websiteId);
    expect(script.hasAttribute('defer')).toBe(true);
    expect(script.getAttribute('data-do-not-track')).toBe('true');
    expect(script.getAttribute('data-exclude-search')).toBe('true');
    expect(script.getAttribute('data-exclude-hash')).toBe('true');
    expect(doc.documentElement.innerHTML).not.toContain('analytics.billmanager.app');
  });

  it.each([
    { VITE_UMAMI_SCRIPT_URL: src },
    { VITE_UMAMI_WEBSITE_ID: websiteId },
  ])('fails an incomplete build configuration: %j', env => {
    expect(() => umamiPlugin(env)).toThrow('Set both');
  });

  it.each([
    'http://metrics.example.test/script.js',
    '//metrics.example.test/script.js',
    'javascript:alert(1)',
    'https://user:password@metrics.example.test/script.js',
    'https://metrics.example.test/script.js?secret=value',
    'https://metrics.example.test/script.js#fragment',
    'https://metrics.example.test/script.js" onload="alert(1)',
    'https://*.example.test/script.js',
    "https://metrics.example.test/;script-src *",
  ])('rejects unsafe tracker URL %s', url => {
    expect(() => umamiPlugin({ VITE_UMAMI_SCRIPT_URL: url, VITE_UMAMI_WEBSITE_ID: websiteId })).toThrow();
  });

  it('rejects an invalid website id', () => {
    expect(() => umamiPlugin({ VITE_UMAMI_SCRIPT_URL: src, VITE_UMAMI_WEBSITE_ID: 'not-a-uuid' })).toThrow('UUID');
  });
});
