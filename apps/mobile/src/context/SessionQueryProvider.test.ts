import React, { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { SessionQueryProvider } from './SessionQueryProvider';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('mounted session query boundary', () => {
  it.each([
    ['another account', 'server-one:user:2'],
    ['another server with the same user id', 'server-two:user:1'],
    ['logout', 'server-one:anonymous'],
  ])('replaces private data before children render on %s', async (_label, nextSession) => {
    const rendered: unknown[] = [];
    const committed: unknown[] = [];
    let client!: QueryClient;
    function Probe() {
      client = useQueryClient();
      const data = client.getQueryData(['administration']);
      rendered.push(data);
      useLayoutEffect(() => { committed.push(data); });
      return null;
    }
    const tree = (sessionKey: string) => React.createElement(SessionQueryProvider, {
      sessionKey, children: React.createElement(Probe),
    });
    let root!: ReactTestRenderer;
    await act(async () => { root = create(tree('server-one:user:1')); });
    const previous = client;
    previous.setQueryData(['administration'], ['private old-account users']);
    await act(async () => { root.update(tree('server-one:user:1')); });
    expect(rendered.at(-1)).toEqual(['private old-account users']);

    let finish!: (value: string[]) => void;
    const pending = previous.fetchQuery({
      queryKey: ['late-response'],
      queryFn: () => new Promise<string[]>((resolve) => { finish = resolve; }),
    }).catch(() => undefined);
    rendered.length = 0;
    committed.length = 0;
    await act(async () => { root.update(tree(nextSession)); });
    expect(client).not.toBe(previous);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.every((value) => value === undefined)).toBe(true);
    expect(committed.every((value) => value === undefined)).toBe(true);
    expect(previous.getQueryCache().getAll()).toEqual([]);
    await act(async () => { finish(['late private data']); await pending; });
    expect(client.getQueryData(['late-response'])).toBeUndefined();
    expect(previous.getQueryData(['late-response'])).toBeUndefined();
    await act(async () => { root.unmount(); });
  });
});
