import { Modal, Stack, Text, Button, Group, List, Badge, ActionIcon, Divider } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { releaseNotes, markVersionAsSeen, getVersionIndex } from '../config/releaseNotes';
import { germanReleaseNotes } from '../config/releaseNotes.de';
import { getLocale } from '../lib/currency';

interface ReleaseNotesModalProps {
  opened: boolean;
  onClose: () => void;
  initialVersion?: string;
}

export function ReleaseNotesModal({ opened, onClose, initialVersion }: ReleaseNotesModalProps) {
  const { t, i18n } = useTranslation();
  // State initializes from props; parent should use key prop to force reset when modal reopens
  const [currentIndex, setCurrentIndex] = useState(() => getVersionIndex(initialVersion));

  const localizedReleaseNotes = i18n.resolvedLanguage === 'de' ? germanReleaseNotes : releaseNotes;
  const release = localizedReleaseNotes[currentIndex];
  const canGoNewer = currentIndex > 0;
  const canGoOlder = currentIndex < localizedReleaseNotes.length - 1;

  const handleClose = () => {
    // Mark current version as seen when closing
    markVersionAsSeen();
    onClose();
  };

  const goNewer = () => {
    if (canGoNewer) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goOlder = () => {
    if (canGoOlder) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  if (!release) return null;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="sm">
          <Text fw={600}>{t('releaseNotesModal.title')}</Text>
          <Badge variant="light" color="blue">
            v{release.version}
          </Badge>
        </Group>
      }
      size="lg"
    >
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <div>
            <Text size="lg" fw={600}>
              {release.title}
            </Text>
            <Text size="sm" c="dimmed">
              {new Date(release.date).toLocaleDateString(getLocale(), {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </div>
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              onClick={goOlder}
              disabled={!canGoOlder}
              title={t('releaseNotesModal.olderRelease')}
            >
              <IconChevronLeft size={18} />
            </ActionIcon>
            <Text size="sm" c="dimmed">
              {t('releaseNotesModal.pageIndicator', { current: currentIndex + 1, total: localizedReleaseNotes.length })}
            </Text>
            <ActionIcon
              variant="subtle"
              onClick={goNewer}
              disabled={!canGoNewer}
              title={t('releaseNotesModal.newerRelease')}
            >
              <IconChevronRight size={18} />
            </ActionIcon>
          </Group>
        </Group>

        <Divider />

        {release.sections.map((section, sectionIndex) => (
          <div key={sectionIndex}>
            <Text size="sm" fw={600} mb="xs">
              {section.heading}
            </Text>
            <List size="sm" spacing="xs">
              {section.items.map((item, itemIndex) => (
                <List.Item key={itemIndex}>{item}</List.Item>
              ))}
            </List>
          </div>
        ))}

        <Group justify="flex-end" mt="md">
          <Button onClick={handleClose}>{t('releaseNotesModal.close')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
