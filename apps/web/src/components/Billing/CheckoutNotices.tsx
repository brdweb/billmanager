import { Alert, Anchor, Button, Loader, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import { Trans, useTranslation } from 'react-i18next';
import { LEGAL_URLS } from '../../config/legal';

export function ProRenewalDisclosure({ price, interval }: { price: string; interval: 'monthly' | 'annual' }) {
  const { t } = useTranslation();
  const linkProps = { size: 'xs', target: '_blank', rel: 'noopener noreferrer' } as const;
  return (
    <Stack gap={4} mb="sm" data-testid="pro-renewal-disclosure">
      <Text size="xs" c="dimmed">
        {interval === 'monthly'
          ? t('billingPage.renewalDisclosureMonthly', { price })
          : t('billingPage.renewalDisclosureAnnual', { price })}
      </Text>
      <Text size="xs" c="dimmed">
        <Trans
          i18nKey="billingPage.renewalLegal"
          components={{
            termsLink: <Anchor href={LEGAL_URLS.terms} {...linkProps} />,
            privacyLink: <Anchor href={LEGAL_URLS.privacy} {...linkProps} />,
          }}
        />
      </Text>
    </Stack>
  );
}

export function CheckoutCanceledNotice() {
  const { t } = useTranslation();
  return (
    <Alert icon={<IconInfoCircle size={16} />} color="gray" variant="light" mb="lg">
      {t('billingPage.checkoutCanceled')}
    </Alert>
  );
}

export function CheckoutSuccessNotice({ active, timedOut, onRetry }: {
  active: boolean;
  timedOut: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (active) {
    return (
      <Alert icon={<IconCircleCheck size={16} />} color="green" variant="light" mb="lg">
        {t('billingPage.checkoutSuccessActive')}
      </Alert>
    );
  }
  if (timedOut) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light" mb="lg">
        <Text size="sm" mb="xs">{t('billingPage.checkoutSuccessTimeout')}</Text>
        <Button size="xs" variant="light" color="yellow" onClick={onRetry}>
          {t('billingPage.checkoutCheckAgain')}
        </Button>
      </Alert>
    );
  }
  return (
    <Alert icon={<Loader size={16} />} color="blue" variant="light" mb="lg">
      {t('billingPage.checkoutSuccessPending')}
    </Alert>
  );
}
