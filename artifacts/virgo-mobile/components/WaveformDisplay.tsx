import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface WaveformDisplayProps {
  barCount?: number;
  height?: number;
}

export function WaveformDisplay({ barCount = 60, height = 80 }: WaveformDisplayProps) {
  const colors = useColors();

  // Generate deterministic pseudo-random bar heights
  const bars = useMemo(() => {
    const result: number[] = [];
    let prev = 0.4;
    for (let i = 0; i < barCount; i++) {
      const r = Math.sin(i * 1.7 + 2.3) * 0.35 + Math.sin(i * 0.4 + 1.1) * 0.25 + 0.4;
      prev = prev * 0.6 + r * 0.4;
      result.push(Math.max(0.05, Math.min(1, prev)));
    }
    return result;
  }, [barCount]);

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.bars}>
        {bars.map((h, i) => {
          const isCenter = Math.abs(i - barCount / 2) < barCount * 0.15;
          const color = isCenter
            ? colors.primary
            : i > barCount * 0.6
            ? '#4A9EFF'
            : '#4ECDC4';
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: h * height * 0.85,
                  backgroundColor: color,
                  opacity: 0.6 + h * 0.4,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    paddingHorizontal: 4,
  },
  bar: {
    flex: 1,
    borderRadius: 1,
    minHeight: 2,
  },
});
