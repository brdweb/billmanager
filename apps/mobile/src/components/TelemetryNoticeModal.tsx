import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';

interface TelemetryNoticeModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function TelemetryNoticeModal({ visible, onClose }: TelemetryNoticeModalProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const styles = createStyles(colors);

  const handleAccept = async () => {
    setLoading(true);
    try {
      const response = await api.acceptTelemetry();
      if (response.success) {
        onClose();
      }
    } catch (error) {
      console.error('Failed to accept telemetry:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOptOut = async () => {
    setLoading(true);
    try {
      const response = await api.optOutTelemetry();
      if (response.success) {
        onClose();
      }
    } catch (error) {
      console.error('Failed to opt out of telemetry:', error);
    } finally {
      setLoading(false);
    }
  };

  const openDocumentation = () => {
    Linking.openURL('https://github.com/brdweb/billmanager/blob/main/TELEMETRY.md');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {}} // Prevent closing without choice
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <AlertCircle size={24} color={colors.primary} />
          <Text style={styles.title}>Anonymous Usage Statistics</Text>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.description}>
            BillManager collects <Text style={styles.bold}>anonymous usage statistics</Text> to help improve the product.
            This data helps us understand which features are most valuable and guide development priorities.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What we collect:</Text>
            <Text style={styles.bullet}>• Total users, bills, and databases (counts only)</Text>
            <Text style={styles.bullet}>• Feature usage (auto-pay, variable bills, mobile devices)</Text>
            <Text style={styles.bullet}>• Platform info (Python version, OS, database type)</Text>
            <Text style={styles.bullet}>• Anonymous instance ID and app version</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What we never collect:</Text>
            <Text style={styles.bullet}>• Personal information (names, emails, addresses)</Text>
            <Text style={styles.bullet}>• Bill amounts or financial data</Text>
            <Text style={styles.bullet}>• Bill names or descriptions</Text>
            <Text style={styles.bullet}>• Payment history or dates</Text>
          </View>

          <TouchableOpacity onPress={openDocumentation} style={styles.linkContainer}>
            <Text style={styles.linkText}>
              See TELEMETRY.md for full details
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            You can change this preference at any time. All telemetry submissions are logged locally for transparency.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleOptOut}
            disabled={loading}
          >
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>
              Opt Out
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleAccept}
            disabled={loading}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>
              Accept & Continue
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginBottom: 20,
  },
  bold: {
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  bullet: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 4,
  },
  linkContainer: {
    marginVertical: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkText: {
    fontSize: 14,
    color: colors.primary,
    textAlign: 'center',
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginBottom: 20,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButtonText: {
    color: '#fff',
  },
  secondaryButtonText: {
    color: colors.text,
  },
});
