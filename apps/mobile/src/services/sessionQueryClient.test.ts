import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSessionQueryClient } from './sessionQueryClient';

describe('authenticated query cache lifetime', () => {
  it('does not expose a previous account or server administration cache', () => {
    const previous = createSessionQueryClient();
    previous.setQueryData(['administration'], { users: [{ email: 'private@example.test' }] });
    previous.setQueryData(['billing', 'same-server'], { effective_tier: 'pro' });
    const next = createSessionQueryClient();
    expect(next.getQueryData(['administration'])).toBeUndefined();
    expect(next.getQueryData(['billing', 'same-server'])).toBeUndefined();
    previous.clear();
    next.clear();
  });

  it('keeps a late old-session response out of the next session', async () => {
    const previous = createSessionQueryClient();
    let finish!: (value: string[]) => void;
    const pending = previous.fetchQuery({
      queryKey: ['administration'],
      queryFn: () => new Promise<string[]>((resolve) => { finish = resolve; }),
    }).catch(() => undefined);
    previous.clear();
    const next = createSessionQueryClient();
    finish(['previous users']);
    await pending;
    expect(next.getQueryData(['administration'])).toBeUndefined();
    expect(previous.getQueryData(['administration'])).toBeUndefined();
    next.clear();
  });

  it('mounts the cache inside both profile and authenticated identity boundaries', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('<AuthProvider key={activeProfile.id}>');
    expect(app).toContain('<SessionQueryProvider sessionKey={sessionKey}>');
    expect(app).toContain("const sessionKey = `${activeProfile.id}:${isAuthenticated ? `user:${user?.id}` : 'anonymous'}`");
    expect(app).not.toContain('const queryClient = new QueryClient');
  });
});
