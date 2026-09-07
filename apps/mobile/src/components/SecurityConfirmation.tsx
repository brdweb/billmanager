import { useEffect, useRef, useState } from 'react';
import { Button, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { type ConfirmationRequest, setConfirmationListener } from '../services/securityConfirmation';

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
  return <Modal visible={!!request} transparent animationType="fade" onRequestClose={() => finish(null)}>
    <View style={styles.overlay}><View style={styles.panel} accessibilityViewIsModal>
      <Text style={styles.title}>Confirm your identity</Text>
      <Text style={styles.text}>Verify your identity before {actionLabels[request?.purpose ?? ''] ?? 'continuing'}.</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
      {request?.method === 'oidc' ? <Button title="Sign in again with your identity provider" disabled={busy} onPress={async () => {
        const current = pending.current;
        if (!current?.authenticate || busy) return;
        setBusy(true);
        try { const token = await current.authenticate(); if (pending.current === current) finish(token); }
        catch { if (pending.current === current) setError('Sign-in could not be confirmed. Try again with your existing linked account.'); }
        finally { if (pending.current === current) setBusy(false); }
      }} /> : <>
      <Text style={styles.text}>{request?.method === 'password' ? 'Current password' : 'Code sent to your verified email'}</Text>
      <TextInput style={styles.input} value={value} onChangeText={setValue} secureTextEntry={request?.method === 'password'} autoCapitalize="none" autoCorrect={false}
        accessibilityLabel={request?.method === 'password' ? 'Current password' : 'Email confirmation code'}
        keyboardType={request?.method === 'email' ? 'number-pad' : 'default'} />
      <Button title="Confirm" disabled={!value} onPress={() => finish(value)} />
      </>}
      <Button title="Cancel" onPress={() => finish(null)} />
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0008' },
  panel: { padding: 24, gap: 16, borderRadius: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '600', color: '#111' },
  text: { color: '#111' },
  input: { borderWidth: 1, borderColor: '#777', borderRadius: 8, padding: 12, color: '#111' },
});
