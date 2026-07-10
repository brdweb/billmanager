import { useState } from 'react';
import {
  Modal,
  PasswordInput,
  Button,
  Stack,
  Alert,
} from '@mantine/core';
import { IconLock, IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

interface PasswordChangeModalProps {
  opened: boolean;
  onClose: () => void;
}

export function PasswordChangeModal({ opened, onClose }: PasswordChangeModalProps) {
  const { t } = useTranslation();
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
      setError(t('passwordChangeModal.allFieldsRequired'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('passwordChangeModal.passwordsMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('passwordChangeModal.passwordTooShort'));
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
        setError(result.error || t('passwordChangeModal.changeFailedDefault'));
      }
    } catch {
      setError(t('passwordChangeModal.changeFailedRetry'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {}} // Prevent closing - must change password
      title={t('passwordChangeModal.title')}
      centered
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Alert
            icon={<IconInfoCircle size={16} />}
            title={t('passwordChangeModal.requiredTitle')}
            color="blue"
            variant="light"
          >
            {t('passwordChangeModal.requiredBody')}
          </Alert>

          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title={t('passwordChangeModal.errorTitle')}
              color="red"
              variant="light"
            >
              {error}
            </Alert>
          )}

          <PasswordInput
            label={t('passwordChangeModal.currentPasswordLabel')}
            placeholder={t('passwordChangeModal.currentPasswordPlaceholder')}
            leftSection={<IconLock size={16} />}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
          />

          <PasswordInput
            label={t('passwordChangeModal.newPasswordLabel')}
            placeholder={t('passwordChangeModal.newPasswordPlaceholder')}
            description={t('passwordChangeModal.newPasswordDescription')}
            leftSection={<IconLock size={16} />}
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
          />

          <PasswordInput
            label={t('passwordChangeModal.confirmPasswordLabel')}
            placeholder={t('passwordChangeModal.confirmPasswordPlaceholder')}
            leftSection={<IconLock size={16} />}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
          />

          <Button type="submit" fullWidth loading={loading}>
            {t('passwordChangeModal.submitButton')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
