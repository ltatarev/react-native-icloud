import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function ActionButton({
  label,
  isDestructive = false,
  isDisabled = false,
  onPress,
}: {
  label: string;
  isDestructive?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        isDestructive && styles.buttonDestructive,
        (pressed || isDisabled) && styles.buttonDimmed,
      ]}
      onPress={onPress}>
      <Text
        style={[styles.buttonText, isDestructive && styles.buttonTextLight]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        {...inputProps}
      />
    </View>
  );
}

export function StatusLine({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  return (
    <View style={styles.statusLine}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text
        selectable
        style={[
          styles.statusValue,
          tone === 'good' && styles.good,
          tone === 'bad' && styles.bad,
        ]}>
        {value}
      </Text>
    </View>
  );
}

export const colors = {
  background: '#f2f2f7',
  card: '#ffffff',
  text: '#1c1c1e',
  muted: '#6e6e73',
  accent: '#0a84ff',
  good: '#248a3d',
  bad: '#d70015',
  border: '#d1d1d6',
};

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.card,
    borderRadius: 12,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: '#e5f0ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonDestructive: {
    backgroundColor: colors.bad,
  },
  buttonDimmed: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '500',
  },
  buttonTextLight: {
    color: colors.card,
  },
  field: {
    flex: 1,
    gap: 4,
    minWidth: 140,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusLine: {
    flexDirection: 'row',
    gap: 8,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 13,
    width: 110,
  },
  statusValue: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
  },
  good: {
    color: colors.good,
  },
  bad: {
    color: colors.bad,
  },
});
