import { Modal, Stack, Text, Button, Group, List, Anchor } from '@mantine/core';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../api/client';
import { ApiError } from '../api/client';

interface TelemetryNoticeModalProps {
  opened: boolean;
  onClose: () => void;
}

export function TelemetryNoticeModal({ opened, onClose }: TelemetryNoticeModalProps) {
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    setLoading(true);
    try {
      await api.acceptTelemetry();
      notifications.show({
        message: 'Thank you for helping improve BillManager!',
        color: 'green',
      });
      onClose();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to save preference';
      notifications.show({
        title: 'Error',
        message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOptOut = async () => {
    setLoading(true);
    try {
      await api.optOutTelemetry();
      notifications.show({
        message: 'Telemetry disabled. No data will be collected.',
        color: 'blue',
      });
      onClose();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to save preference';
      notifications.show({
        title: 'Error',
        message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {}} // Prevent closing without choice
      title="Anonymous Usage Statistics"
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      <Stack gap="md">
        <Text size="sm">
          BillManager collects <strong>anonymous usage statistics</strong> to help improve the product.
          This data helps us understand which features are most valuable and guide development priorities.
        </Text>

        <div>
          <Text size="sm" fw={500} mb="xs">
            What we collect:
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>Total users, bills, and databases (counts only)</List.Item>
            <List.Item>Feature usage (auto-pay, variable bills, mobile devices)</List.Item>
            <List.Item>Platform info (Python version, OS, database type)</List.Item>
            <List.Item>Anonymous instance ID and app version</List.Item>
          </List>
        </div>

        <div>
          <Text size="sm" fw={500} mb="xs">
            What we never collect:
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>Personal information (names, emails, addresses)</List.Item>
            <List.Item>Bill amounts or financial data</List.Item>
            <List.Item>Bill names or descriptions</List.Item>
            <List.Item>Payment history or dates</List.Item>
          </List>
        </div>

        <Text size="xs" c="dimmed">
          You can change this preference at any time. All telemetry submissions are logged locally for transparency.
          See{' '}
          <Anchor
            href="https://github.com/yourusername/billmanager/blob/main/TELEMETRY.md"
            target="_blank"
            size="xs"
          >
            TELEMETRY.md
          </Anchor>{' '}
          for full details.
        </Text>

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={handleOptOut} loading={loading} disabled={loading}>
            Opt Out
          </Button>
          <Button onClick={handleAccept} loading={loading} disabled={loading}>
            Accept & Continue
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
