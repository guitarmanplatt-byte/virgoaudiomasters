import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  PanResponder,
  Animated,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

// ────────────────────────────────────────────────
// AudioSlider — touch-based slider, no extra deps
// ────────────────────────────────────────────────
interface AudioSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  onChange: (v: number) => void;
}

export function AudioSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  hint,
  onChange,
}: AudioSliderProps) {
  const colors = useColors();
  const trackWidth = useRef(0);
  const startX = useRef(0);
  const startValue = useRef(value);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const snap = (v: number) => Math.round(v / step) * step;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        startValue.current = value;
      },
      onPanResponderMove: (_, gs) => {
        if (trackWidth.current === 0) return;
        const delta = gs.dx / trackWidth.current;
        const newVal = clamp(snap(startValue.current + delta * (max - min)));
        onChange(newVal);
      },
    })
  ).current;

  const pct = ((value - min) / (max - min)) * 100;
  const displayValue =
    step >= 1
      ? Math.round(value).toString()
      : value.toFixed(step < 0.1 ? 2 : 1);

  return (
    <View style={styles.sliderRow} testID={`slider-${label}`}>
      <View style={styles.sliderLabelRow}>
        <Text style={[styles.sliderLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.sliderValue, { color: colors.primary }]}>{displayValue}</Text>
      </View>
      {hint && (
        <Text style={[styles.sliderHint, { color: colors.mutedForeground }]}>{hint}</Text>
      )}
      <View
        style={[styles.trackContainer, { backgroundColor: colors.secondary }]}
        onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      >
        <View
          style={[styles.trackFill, { width: `${pct}%` as `${number}%`, backgroundColor: colors.primary }]}
        />
        <View
          style={[
            styles.thumb,
            { left: `${pct}%` as `${number}%`, backgroundColor: colors.primary },
          ]}
        />
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────
// ToggleRow — labeled Switch
// ────────────────────────────────────────────────
interface ToggleRowProps {
  label: string;
  value: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
}

export function ToggleRow({ label, value, hint, onChange }: ToggleRowProps) {
  const colors = useColors();
  return (
    <View style={styles.toggleRow} testID={`toggle-${label}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.sliderLabel, { color: colors.foreground }]}>{label}</Text>
        {hint && <Text style={[styles.sliderHint, { color: colors.mutedForeground }]}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.secondary, true: colors.primary + '88' }}
        thumbColor={value ? colors.primary : colors.mutedForeground}
        ios_backgroundColor={colors.secondary}
      />
    </View>
  );
}

// ────────────────────────────────────────────────
// SectionCard — card wrapper for settings sections
// ────────────────────────────────────────────────
interface SectionCardProps {
  title: string;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  children: React.ReactNode;
}

export function SectionCard({ title, enabled, onToggleEnabled, children }: SectionCardProps) {
  const colors = useColors();
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionAccent, { backgroundColor: colors.primary }]} />
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
        <Switch
          value={enabled}
          onValueChange={onToggleEnabled}
          trackColor={{ false: colors.secondary, true: colors.primary + '88' }}
          thumbColor={enabled ? colors.primary : colors.mutedForeground}
          ios_backgroundColor={colors.secondary}
        />
      </View>
      <View style={[styles.sectionBody, { opacity: enabled ? 1 : 0.4 }]} pointerEvents={enabled ? 'auto' : 'none'}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sliderRow: {
    gap: 8,
    paddingVertical: 8,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    fontWeight: '500',
  },
  sliderValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'right',
  },
  sliderHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: -4,
  },
  trackContainer: {
    height: 6,
    borderRadius: 3,
    position: 'relative',
    overflow: 'visible',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    top: -5,
    marginLeft: -8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  sectionCard: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  sectionAccent: {
    width: 3,
    height: 20,
    borderRadius: 2,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  sectionBody: {
    padding: 14,
    gap: 2,
  },
});
