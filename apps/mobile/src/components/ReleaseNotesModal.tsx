import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Newspaper } from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { ReleaseNote } from '../types';

interface ReleaseNotesModalProps {
  visible: boolean;
  onClose: () => void;
  releaseNote: ReleaseNote;
}

export default function ReleaseNotesModal({ visible, onClose, releaseNote }: ReleaseNotesModalProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const styles = createStyles(colors);

  const handleDismiss = async () => {
    setLoading(true);
    try {
      const response = await api.dismissReleaseNotes(releaseNote.version);
      if (response.success) {
        onClose();
      }
    } catch (error) {
      console.error('Failed to dismiss release notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const markdownStyles = {
    body: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
    },
    heading1: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700' as const,
      marginBottom: 12,
      marginTop: 16,
    },
    heading2: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600' as const,
      marginBottom: 8,
      marginTop: 16,
    },
    heading3: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600' as const,
      marginBottom: 8,
      marginTop: 12,
    },
    bullet_list: {
      marginVertical: 8,
    },
    ordered_list: {
      marginVertical: 8,
    },
    list_item: {
      marginVertical: 4,
    },
    paragraph: {
      marginVertical: 8,
    },
    link: {
      color: colors.primary,
    },
    code_inline: {
      backgroundColor: colors.surface,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: 'monospace',
    },
    code_block: {
      backgroundColor: colors.surface,
      padding: 12,
      borderRadius: 8,
      fontFamily: 'monospace',
    },
    strong: {
      fontWeight: '600' as const,
    },
    em: {
      fontStyle: 'italic' as const,
    },
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
          <Newspaper size={24} color={colors.primary} />
          <View style={styles.headerText}>
            <Text style={styles.title}>{releaseNote.title}</Text>
            <Text style={styles.version}>
              v{releaseNote.version} &bull; {formatDate(releaseNote.published_at)}
            </Text>
          </View>
          {releaseNote.is_major && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Major</Text>
            </View>
          )}
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <Markdown style={markdownStyles}>
            {releaseNote.content}
          </Markdown>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleDismiss}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.buttonText, styles.primaryButtonText]}>
                Got it!
              </Text>
            )}
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
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  version: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButtonText: {
    color: '#fff',
  },
});
