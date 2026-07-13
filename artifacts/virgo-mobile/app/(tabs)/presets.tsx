import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListEqPresets } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const CATEGORY_ICONS: Record<string, string> = {
  voice: 'microphone',
  music: 'music-note',
  podcast: 'headphones',
  broadcast: 'radio-tower',
  film: 'filmstrip',
  restoration: 'restore',
};

const CATEGORY_LABELS: Record<string, string> = {
  voice: 'Voice',
  music: 'Music',
  podcast: 'Podcast',
  broadcast: 'Broadcast',
  film: 'Film',
  restoration: 'Restoration',
};

const ALL_CATEGORIES = ['all', 'voice', 'music', 'podcast', 'broadcast', 'film', 'restoration'];

interface EqBand {
  frequency: number;
  gain: number;
  q: number;
  type: string;
}
interface EqPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  bands: EqBand[];
}

function MiniBandViz({ bands }: { bands: EqBand[] }) {
  const colors = useColors();
  // Show 8 bars representing gain at different freq points
  const points = [80, 200, 500, 1000, 2000, 4000, 8000, 16000];
  const maxGain = 10;

  return (
    <View style={vizStyles.container}>
      {points.map((freq, i) => {
        // Find closest band
        const closest = bands.reduce((best, b) => {
          return Math.abs(b.frequency - freq) < Math.abs(best.frequency - freq) ? b : best;
        }, bands[0] ?? { frequency: freq, gain: 0, q: 1, type: 'peaking' });
        const gain = closest?.gain ?? 0;
        const pct = (gain + maxGain) / (maxGain * 2);
        const barH = Math.max(2, pct * 28);
        const isBoost = gain > 0;
        return (
          <View key={i} style={vizStyles.barWrap}>
            <View
              style={[
                vizStyles.bar,
                {
                  height: barH,
                  backgroundColor: isBoost ? colors.primary : '#4A9EFF',
                  opacity: 0.7 + Math.abs(gain) * 0.03,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const vizStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 32,
    gap: 2,
    marginTop: 8,
  },
  barWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 2,
  },
});

export default function PresetsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { data: presets, isLoading } = useListEqPresets();

  const filtered = (presets ?? []).filter(
    (p) => selectedCategory === 'all' || p.category === selectedCategory
  );

  const topPad = Platform.OS === 'web' ? 67 : insets.top + 16;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>EQ Presets</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          {presets?.length ?? 0} presets available
        </Text>
      </View>

      {/* Category filter */}
      <FlatList
        data={ALL_CATEGORIES}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(c) => c}
        contentContainerStyle={styles.filterRow}
        renderItem={({ item: cat }) => {
          const active = cat === selectedCategory;
          return (
            <TouchableOpacity
              testID={`button-category-${cat}`}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? colors.primary : colors.secondary,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedCategory(cat)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Presets list */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered as EqPreset[]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
          ]}
          numColumns={1}
          renderItem={({ item }) => (
            <View
              testID={`card-preset-${item.id}`}
              style={[styles.presetCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primary + '22' }]}>
                  <MaterialCommunityIcons
                    name={(CATEGORY_ICONS[item.category] ?? 'equalizer') as any}
                    size={18}
                    color={colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.presetName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.presetCategory, { color: colors.primary }]}>
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </Text>
                </View>
                <View style={[styles.bandCount, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.bandCountText, { color: colors.mutedForeground }]}>
                    {item.bands.length} bands
                  </Text>
                </View>
              </View>
              <Text style={[styles.presetDesc, { color: colors.mutedForeground }]}>
                {item.description}
              </Text>
              <MiniBandViz bands={item.bands} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: 16, gap: 10 },
  presetCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetName: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  presetCategory: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bandCount: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  bandCountText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  presetDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});
