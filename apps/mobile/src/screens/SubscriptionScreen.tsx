import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { SubscriptionStatus, BillingUsage } from '../types';

type Props = NativeStackScreenProps<any, 'Subscription'>;


const PRICING = {
  basic: { monthly: 5, annual: 50 },
  plus: { monthly: 7.5, annual: 75 },
};

const PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    badge: 'Popular',
    badgeColor: '#228be6',
    features: [
      'Unlimited bills & income',
      'Up to 2 family members',
      '1 bill group',
      'Export to CSV/PDF',
      'Full analytics',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    badge: 'Best Value',
    badgeColor: '#7950f2',
    features: [
      'Everything in Basic',
      'Up to 5 family members',
      '3 bill groups',
      'Priority support',
      'Early access to new features',
    ],
  },
];

export default function SubscriptionScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { isSelfHosted } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');

  const styles = createStyles(colors);

  const getAnnualSavings = (tier: 'basic' | 'plus') => {
    const monthly = PRICING[tier].monthly * 12;
    const annual = PRICING[tier].annual;
    return Math.round((1 - annual / monthly) * 100);
  };

  const getPrice = (tier: 'basic' | 'plus') => {
    return billingInterval === 'monthly'
      ? `$${PRICING[tier].monthly}`
      : `$${PRICING[tier].annual}`;
  };

  const getPeriod = () => {
    return billingInterval === 'monthly' ? '/month' : '/year';
  };

  const fetchSubscription = useCallback(async () => {
    // Self-hosted servers don't have subscription management
    if (isSelfHosted) {
      setIsLoading(false);
      return;
    }

    try {
      const [statusRes, usageRes] = await Promise.all([
        api.getSubscriptionStatus(),
        api.getBillingUsage(),
      ]);

      if (statusRes.success && statusRes.data) {
        setSubscription(statusRes.data);
      }
      if (usageRes.success && usageRes.data) {
        setUsage(usageRes.data);
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isSelfHosted]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  useFocusEffect(
    useCallback(() => {
      fetchSubscription();
    }, [fetchSubscription])
  );

  const handleUpgrade = async (planId: string) => {
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;

    Alert.alert(
      'Upgrade to ' + plan.name,
      'You will be redirected to our secure payment page to complete your subscription.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            setIsProcessing(true);
            try {
              const response = await api.createCheckoutSession(
                planId as 'basic' | 'plus',
                billingInterval
              );

              if (response.success && response.data?.url) {
                await Linking.openURL(response.data.url);
              } else {
                Alert.alert('Error', response.error || 'Failed to create checkout session');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to start checkout. Please try again.');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleManageSubscription = async () => {
    setIsProcessing(true);
    try {
      const response = await api.createPortalSession();

      if (response.success && response.data?.url) {
        await Linking.openURL(response.data.url);
      } else {
        Alert.alert('Error', response.error || 'Failed to open billing portal');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open billing portal. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Self-hosted servers don't need subscription management
  if (isSelfHosted) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Billing & Subscription</Text>
          <View style={styles.placeholder} />
        </View>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.selfHostedCard}>
            <Text style={styles.selfHostedTitle}>Self-Hosted Instance</Text>
            <Text style={styles.selfHostedDescription}>
              You are connected to a self-hosted BillManager server.
            </Text>
            <Text style={styles.selfHostedSubtitle}>Unlimited Access to All Features:</Text>
            <View style={styles.featuresList}>
              {[
                'Unlimited bills and income tracking',
                'Unlimited family members and users',
                'Unlimited bill groups',
                'Full analytics and reporting',
                'Export to CSV/PDF',
                'Mobile app access',
                'No subscription required',
              ].map((feature, index) => (
                <View key={index} style={styles.featureRow}>
                  <Text style={styles.featureCheck}>✓</Text>
                  <Text style={styles.selfHostedFeature}>{feature}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  const currentPlan = PLANS.find(p => p.id === subscription?.effective_tier);
  const isFreeTier = !subscription?.has_subscription;
  const currentTierName = currentPlan?.name || 'Free';

  const getStatusBadge = () => {
    if (isFreeTier) {
      if (subscription?.is_trialing) {
        return { text: 'Free Trial', color: '#228be6' };
      }
      return { text: 'Free', color: colors.border };
    }
    switch (subscription?.status) {
      case 'active':
        return { text: 'Active', color: colors.success };
      case 'trialing':
        return { text: 'Trial', color: '#228be6' };
      case 'past_due':
        return { text: 'Past Due', color: colors.warning };
      case 'canceled':
        return { text: 'Canceled', color: colors.danger };
      default:
        return { text: subscription?.status || 'Unknown', color: colors.border };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Billing & Subscription</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Current Plan */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Plan</Text>
          <View style={styles.currentPlanCard}>
            <View style={styles.currentPlanHeader}>
              <Text style={styles.currentPlanName}>{currentTierName}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusBadge.color }]}>
                <Text style={styles.statusBadgeText}>{statusBadge.text}</Text>
              </View>
            </View>

            {subscription?.is_trial_expired && (
              <View style={[styles.trialAlert, { backgroundColor: colors.warning + '20' }]}>
                <Text style={[styles.trialAlertText, { color: colors.warning }]}>
                  Your trial has expired. Subscribe to continue with full features.
                </Text>
              </View>
            )}

            {subscription?.is_trialing && !subscription.is_trial_expired && subscription.trial_days_remaining !== undefined && (
              <View style={[styles.trialAlert, { backgroundColor: '#228be620' }]}>
                <Text style={[styles.trialAlertText, { color: '#228be6' }]}>
                  You have {subscription.trial_days_remaining} days remaining in your free trial.
                  {subscription.trial_days_remaining <= 3 && ' Subscribe now to keep your data!'}
                </Text>
              </View>
            )}

            {!isFreeTier && (
              <>
                <View style={styles.planDetailRow}>
                  <Text style={styles.planDetailLabel}>Billing</Text>
                  <Text style={styles.planDetailValue}>
                    {subscription?.billing_interval === 'annual' ? 'Annual' : 'Monthly'}
                  </Text>
                </View>
                {subscription?.current_period_end && (
                  <View style={styles.planDetailRow}>
                    <Text style={styles.planDetailLabel}>
                      {subscription.cancel_at_period_end ? 'Expires on' : 'Renews on'}
                    </Text>
                    <Text style={styles.planDetailValue}>
                      {formatDate(subscription.current_period_end)}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>

          {!isFreeTier && (
            <View style={styles.manageButtons}>
              <TouchableOpacity
                style={styles.manageButton}
                onPress={handleManageSubscription}
                disabled={isProcessing}
              >
                <Text style={styles.manageButtonText}>Manage Subscription</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Current Usage - Only show for free tier */}
        {isFreeTier && usage && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Usage</Text>
            <View style={styles.usageCard}>
              {/* Bills Usage */}
              <View style={styles.usageItem}>
                <View style={styles.usageHeader}>
                  <Text style={styles.usageLabel}>Bills</Text>
                  <Text style={styles.usageValue}>
                    {usage.usage.bills.unlimited
                      ? 'Unlimited'
                      : `${usage.usage.bills.used} / ${usage.usage.bills.limit}`}
                  </Text>
                </View>
                {!usage.usage.bills.unlimited && (
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min((usage.usage.bills.used / usage.usage.bills.limit) * 100, 100)}%`,
                          backgroundColor: usage.usage.bills.used >= usage.usage.bills.limit ? colors.danger : colors.success,
                        }
                      ]}
                    />
                  </View>
                )}
              </View>

              {/* Bill Groups Usage */}
              <View style={styles.usageItem}>
                <View style={styles.usageHeader}>
                  <Text style={styles.usageLabel}>Bill Groups</Text>
                  <Text style={styles.usageValue}>
                    {usage.usage.bill_groups.unlimited
                      ? 'Unlimited'
                      : `${usage.usage.bill_groups.used} / ${usage.usage.bill_groups.limit}`}
                  </Text>
                </View>
                {!usage.usage.bill_groups.unlimited && (
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min((usage.usage.bill_groups.used / usage.usage.bill_groups.limit) * 100, 100)}%`,
                          backgroundColor: usage.usage.bill_groups.used >= usage.usage.bill_groups.limit ? colors.danger : colors.success,
                        }
                      ]}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Pricing Plans - Only show if not subscribed */}
        {isFreeTier && (
          <View style={styles.section}>
            {/* Billing Interval Toggle */}
            <View style={styles.intervalToggle}>
              <TouchableOpacity
                style={[
                  styles.intervalOption,
                  billingInterval === 'monthly' && styles.intervalOptionActive,
                ]}
                onPress={() => setBillingInterval('monthly')}
              >
                <Text style={[
                  styles.intervalOptionText,
                  billingInterval === 'monthly' && styles.intervalOptionTextActive,
                ]}>Monthly</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.intervalOption,
                  billingInterval === 'annual' && styles.intervalOptionActive,
                ]}
                onPress={() => setBillingInterval('annual')}
              >
                <Text style={[
                  styles.intervalOptionText,
                  billingInterval === 'annual' && styles.intervalOptionTextActive,
                ]}>Annual (Save {getAnnualSavings('basic')}%)</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Choose a Plan</Text>
            {PLANS.map((plan) => {
              const isCurrentPlan = plan.id === subscription?.effective_tier;
              const planId = plan.id as 'basic' | 'plus';
              const isPlus = plan.id === 'plus';

              return (
                <View
                  key={plan.id}
                  style={[
                    styles.planCard,
                    isCurrentPlan && styles.planCardCurrent,
                    isPlus && { borderColor: '#7950f2', borderWidth: 2 },
                  ]}
                >
                  <View style={styles.planHeader}>
                    <View>
                      <Text style={styles.planName}>{plan.name}</Text>
                      <View style={styles.priceRow}>
                        <Text style={styles.planPrice}>{getPrice(planId)}</Text>
                        <Text style={styles.planPeriod}>{getPeriod()}</Text>
                      </View>
                      {billingInterval === 'annual' && (
                        <Text style={styles.monthlyEquivalent}>
                          That's ${(PRICING[planId].annual / 12).toFixed(2)}/month
                        </Text>
                      )}
                    </View>
                    <View style={[styles.planBadge, { backgroundColor: plan.badgeColor }]}>
                      <Text style={styles.planBadgeText}>{plan.badge}</Text>
                    </View>
                  </View>
                  <View style={styles.featureList}>
                    {plan.features.map((feature, index) => (
                      <View key={index} style={styles.featureRow}>
                        <Text style={styles.featureCheck}>✓</Text>
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.upgradeButton,
                      isPlus && { backgroundColor: '#7950f2' },
                    ]}
                    onPress={() => handleUpgrade(plan.id)}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.upgradeButtonText}>Get {plan.name}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Info */}
        <View style={styles.infoSection}>
          <Text style={styles.infoText}>
            14-day free trial included. Cancel anytime.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: colors.surface,
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  placeholder: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginLeft: 4,
  },
  intervalToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  intervalOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  intervalOptionActive: {
    backgroundColor: colors.primary + '20',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  intervalOptionText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  intervalOptionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  currentPlanCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
  },
  currentPlanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  currentPlanName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  trialAlert: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  trialAlertText: {
    fontSize: 14,
    lineHeight: 20,
  },
  planDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  planDetailLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  planDetailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.border,
  },
  activeBadge: {
    backgroundColor: colors.success,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  currentPlanPrice: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  currentPlanPeriod: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textMuted,
  },
  renewalText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 8,
  },
  manageButtons: {
    marginTop: 16,
    gap: 8,
  },
  manageButton: {
    backgroundColor: colors.border,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  manageButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  cancelButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  cancelButtonText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '500',
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  planCardCurrent: {
    borderColor: colors.primary,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  planName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  planPeriod: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textMuted,
    marginLeft: 2,
  },
  monthlyEquivalent: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  planBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  currentBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  currentBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  featureList: {
    marginBottom: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  featureCheck: {
    color: colors.success,
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 8,
  },
  featureText: {
    fontSize: 14,
    color: colors.text,
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  infoSection: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  infoText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  selfHostedContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selfHostedCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 24,
    marginTop: 16,
  },
  selfHostedTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  selfHostedDescription: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  selfHostedSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  selfHostedText: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  featuresList: {
    marginTop: 8,
  },
  selfHostedFeature: {
    fontSize: 14,
    color: colors.text,
  },
  usageCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
  },
  usageItem: {
    marginBottom: 16,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  usageLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  usageValue: {
    fontSize: 14,
    color: colors.textMuted,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
});
