import { useEffect, useRef, useState } from 'react';
import { Button, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { type ConfirmationRequest, setConfirmationListener } from '../utils/securityConfirmation';

const actionLabels: Record<string, string> = {
  oauth_link: 'linking a sign-in account', passkey_add: 'adding a passkey',
  recovery_codes: 'replacing recovery codes', delete_account: 'deleting your account',
};

export function SecurityConfirmation() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const pending = useRef<ConfirmationRequest | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setConfirmationListener((next) => {
      if (pending.current) { next.resolve(null); return; }
      pending.current = next;
      setValue('');
      setBusy(false);
      setError('');
      setRequest(next);
    });
    return () => { setConfirmationListener(null); pending.current?.resolve(null); pending.current = null; };
  }, []);
  const finish = (answer: string | null) => {
    pending.current?.resolve(answer);
    pending.current = null;
    setRequest(null);
    setValue('');
  };
  return <Modal opened={!!request} onClose={() => finish(null)} title="Confirm your identity" centered>
    <form onSubmit={(event) => { event.preventDefault(); finish(value); }}>
      <Stack>
        <Text>Verify your identity before {actionLabels[request?.purpose ?? ''] ?? 'continuing'}.</Text>
        {error && <Text c="red" role="alert">{error}</Text>}
        {request?.method === 'oidc' ? <Button loading={busy} onClick={async () => {
          const current = pending.current;
          if (!current?.authenticate || busy) return;
          setBusy(true);
          try { const token = await current.authenticate(); if (pending.current === current) finish(token); }
          catch { if (pending.current === current) setError('Sign-in could not be confirmed. Try again with your existing linked account.'); }
          finally { if (pending.current === current) setBusy(false); }
        }}>Sign in again with your identity provider</Button> : request?.method === 'password'
          ? <PasswordInput label="Current password" autoComplete="current-password" value={value} onChange={(event) => setValue(event.currentTarget.value)} data-autofocus required />
          : <TextInput label="Code sent to your verified email" autoComplete="one-time-code" inputMode="numeric" value={value} onChange={(event) => setValue(event.currentTarget.value)} data-autofocus required />}
        {request?.method !== 'oidc' && <Button type="submit" disabled={!value}>Confirm</Button>}
        <Button variant="subtle" onClick={() => finish(null)}>Cancel</Button>
      </Stack>
    </form>
  </Modal>;
}
