import { Modal, Stack, Text, Button, Group, List, Badge, ActionIcon, Divider } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { releaseNotes, currentVersion } from '../config/releaseNotes';

const SEEN_VERSION_KEY = 'billmanager_seen_version';

interface ReleaseNotesModalProps {
  opened: boolean;
  onClose: () => void;
  initialVersion?: string;
}

export function ReleaseNotesModal({ opened, onClose, initialVersion }: ReleaseNotesModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Reset to initial version when modal opens
  useEffect(() => {
    if (opened) {
      if (initialVersion) {
        const index = releaseNotes.findIndex((r) => r.version === initialVersion);
        setCurrentIndex(index >= 0 ? index : 0);
      } else {
        setCurrentIndex(0);
      }
    }
  }, [opened, initialVersion]);

  const release = releaseNotes[currentIndex];
  const canGoNewer = currentIndex > 0;
  const canGoOlder = currentIndex < releaseNotes.length - 1;

  const handleClose = () => {
    // Mark current version as seen when closing
    localStorage.setItem(SEEN_VERSION_KEY, currentVersion);
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
          <Text fw={600}>Release Notes</Text>
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
              {new Date(release.date).toLocaleDateString('en-US', {
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
              title="Older release"
            >
              <IconChevronLeft size={18} />
            </ActionIcon>
            <Text size="sm" c="dimmed">
              {currentIndex + 1} / {releaseNotes.length}
            </Text>
            <ActionIcon
              variant="subtle"
              onClick={goNewer}
              disabled={!canGoNewer}
              title="Newer release"
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
          <Button onClick={handleClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// Helper function to check if there are new release notes to show
export function hasUnseenReleaseNotes(): boolean {
  const seenVersion = localStorage.getItem(SEEN_VERSION_KEY);
  if (!seenVersion) return true;
  return seenVersion !== currentVersion;
}

// Helper to get the current version
export { currentVersion };
