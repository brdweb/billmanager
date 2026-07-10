import { Modal, Stack, Text, Button, Group, List, Anchor } from '@mantine/core';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';
import { ApiError } from '../api/client';

interface TelemetryNoticeModalProps {
  opened: boolean;
  onClose: () => void;
}

export function TelemetryNoticeModal({ opened, onClose }: TelemetryNoticeModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    setLoading(true);
    try {
      await api.acceptTelemetry();
      notifications.show({
        message: t('telemetryNoticeModal.acceptedMessage'),
        color: 'green',
      });
      onClose();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('telemetryNoticeModal.saveFailedDefault');
      notifications.show({
        title: t('telemetryNoticeModal.errorTitle'),
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
        message: t('telemetryNoticeModal.optOutMessage'),
        color: 'blue',
      });
      onClose();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('telemetryNoticeModal.saveFailedDefault');
      notifications.show({
        title: t('telemetryNoticeModal.errorTitle'),
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
      title={t('telemetryNoticeModal.title')}
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      <Stack gap="md">
        <Text size="sm">
          {t('telemetryNoticeModal.introPrefix')} <strong>{t('telemetryNoticeModal.introBold')}</strong> {t('telemetryNoticeModal.introSuffix')}
        </Text>

        <div>
          <Text size="sm" fw={500} mb="xs">
            {t('telemetryNoticeModal.whatWeCollect')}
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>{t('telemetryNoticeModal.collectItem1')}</List.Item>
            <List.Item>{t('telemetryNoticeModal.collectItem2')}</List.Item>
            <List.Item>{t('telemetryNoticeModal.collectItem3')}</List.Item>
            <List.Item>{t('telemetryNoticeModal.collectItem4')}</List.Item>
          </List>
        </div>

        <div>
          <Text size="sm" fw={500} mb="xs">
            {t('telemetryNoticeModal.whatWeNeverCollect')}
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>{t('telemetryNoticeModal.neverItem1')}</List.Item>
            <List.Item>{t('telemetryNoticeModal.neverItem2')}</List.Item>
            <List.Item>{t('telemetryNoticeModal.neverItem3')}</List.Item>
            <List.Item>{t('telemetryNoticeModal.neverItem4')}</List.Item>
          </List>
        </div>

        <Text size="xs" c="dimmed">
          {t('telemetryNoticeModal.changePreferenceNotice')}{' '}
          <Anchor
            href="https://github.com/brdweb/billmanager/blob/main/TELEMETRY.md"
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
          >
            TELEMETRY.md
          </Anchor>{' '}
          {t('telemetryNoticeModal.fullDetailsSuffix')}
        </Text>

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={handleOptOut} loading={loading} disabled={loading}>
            {t('telemetryNoticeModal.optOut')}
          </Button>
          <Button onClick={handleAccept} loading={loading} disabled={loading}>
            {t('telemetryNoticeModal.acceptContinue')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
