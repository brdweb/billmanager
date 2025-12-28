import { useState } from 'react';
import {
  Modal,
  PasswordInput,
  Button,
  Stack,
  Alert,
} from '@mantine/core';
import { IconLock, IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

interface PasswordChangeModalProps {
  opened: boolean;
  onClose: () => void;
}

export function PasswordChangeModal({ opened, onClose }: PasswordChangeModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { completePasswordChange } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const result = await completePasswordChange(currentPassword, newPassword);
      if (result.success) {
        onClose();
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setError(result.error || 'Failed to change password');
      }
    } catch {
      setError('Failed to change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {}} // Prevent closing - must change password
      title="Change Password"
      centered
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Alert
            icon={<IconInfoCircle size={16} />}
            title="Password Change Required"
            color="blue"
            variant="light"
          >
            You must change your password before continuing.
          </Alert>

          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="Error"
              color="red"
              variant="light"
            >
              {error}
            </Alert>
          )}

          <PasswordInput
            label="Current Password"
            placeholder="Enter current password"
            leftSection={<IconLock size={16} />}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
          />

          <PasswordInput
            label="New Password"
            placeholder="Enter new password"
            description="Minimum 6 characters"
            leftSection={<IconLock size={16} />}
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
          />

          <PasswordInput
            label="Confirm New Password"
            placeholder="Confirm new password"
            leftSection={<IconLock size={16} />}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
          />

          <Button type="submit" fullWidth loading={loading}>
            Change Password
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
