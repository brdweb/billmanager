import { Modal, Stack, Text, Button, Group, Badge, ScrollArea, TypographyStylesProvider } from '@mantine/core';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { marked } from 'marked';
import * as api from '../api/client';
import { ApiError } from '../api/client';
import type { ReleaseNote } from '../api/client';

interface ReleaseNotesModalProps {
  opened: boolean;
  onClose: () => void;
  releaseNote: ReleaseNote;
}

export function ReleaseNotesModal({ opened, onClose, releaseNote }: ReleaseNotesModalProps) {
  const [loading, setLoading] = useState(false);

  const handleDismiss = async () => {
    setLoading(true);
    try {
      await api.dismissReleaseNotes(releaseNote.version);
      onClose();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to dismiss release notes';
      notifications.show({
        title: 'Error',
        message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  // Convert markdown to HTML
  const contentHtml = marked(releaseNote.content) as string;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {}} // Prevent closing without explicit dismiss
      title={
        <Group gap="sm">
          <Text fw={600}>{releaseNote.title}</Text>
          {releaseNote.is_major && <Badge color="blue">Major Update</Badge>}
        </Group>
      }
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Version {releaseNote.version} &bull; {formatDate(releaseNote.published_at)}
        </Text>

        <ScrollArea.Autosize mah={400}>
          <TypographyStylesProvider>
            <div dangerouslySetInnerHTML={{ __html: contentHtml }} />
          </TypographyStylesProvider>
        </ScrollArea.Autosize>

        <Group justify="flex-end">
          <Button onClick={handleDismiss} loading={loading}>
            Got it!
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
