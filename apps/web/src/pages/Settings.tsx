import { Container, Title, Stack, Divider } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { TwoFactorSettings } from '../components/TwoFactorSettings';
import { LinkedAccounts } from '../components/LinkedAccounts';

export function Settings() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <Title order={2}>
          <IconSettings size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Security Settings
        </Title>

        <TwoFactorSettings />

        <Divider />

        <LinkedAccounts />
      </Stack>
    </Container>
  );
}
