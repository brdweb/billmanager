import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { BillIcon, availableIcons } from './BillIcon';

interface IconPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (icon: string) => void;
  currentIcon?: string;
}

const { width } = Dimensions.get('window');
const ICON_SIZE = 40;
const GAP = 16;
const COLS = Math.floor((width - 32) / (ICON_SIZE + GAP));

export default function IconPicker({ visible, onClose, onSelect, currentIcon }: IconPickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');

  const styles = createStyles(colors, insets.top);

  const filteredIcons = availableIcons.filter((icon) =>
    icon.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderItem = ({ item }: { item: string }) => (
    <TouchableOpacity
      style={[
        styles.iconButton,
        item === currentIcon && styles.selectedIconButton,
      ]}
      onPress={() => {
        onSelect(item);
        onClose();
      }}
    >
      <BillIcon
        icon={item}
        size={24}
        color={item === currentIcon ? '#fff' : colors.text}
      />
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Icon</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchContainer}>
          <Search size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search icons..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={filteredIcons}
          renderItem={renderItem}
          keyExtractor={(item) => item}
          numColumns={COLS}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrapper}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </Modal>
  );
}

const createStyles = (colors: any, topInset: number) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: topInset,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    height: 24,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  columnWrapper: {
    gap: GAP,
    marginBottom: GAP,
  },
  iconButton: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedIconButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
