import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListMasteringGenres } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const GENRE_ICONS: Record<string, string> = {
  pop: 'star-circle',
  rock: 'lightning-bolt',
  'hip-hop': 'music-box',
  electronic: 'sine-wave',
  jazz: 'music-clef-treble',
  classical: 'violin',
  country: 'guitar-acoustic',
  'rnb-soul': 'heart-circle',
  metal: 'fire',
  acoustic: 'guitar-acoustic',
  podcast: 'microphone',
  'film-score': 'filmstrip',
  lofi: 'cassette',
  ambient: 'weather-night',
};

interface MasteringGenre {
  id: string;
  name: string;
  description: string;
  targetLufs: number;
  compressionAmount: number;
  dynamicEqAmount: number;
  exciterAmount: number;
  character?: string;
}

function MeterBar({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <View style={meterStyles.row}>
      <Text style={[meterStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[meterStyles.track, { backgroundColor: colors.secondary }]}>
        <View
          style={[
            meterStyles.fill,
            { width: `${Math.round(value * 100)}%` as `${number}%`, backgroundColor: colors.primary },
          ]}
        />
      </View>
      <Text style={[meterStyles.val, { color: colors.primary }]}>
        {Math.round(value * 100)}%
      </Text>
    </View>
  );
}

const meterStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  label: { fontSize: 11, fontFamily: 'Inter_400Regular', width: 72 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  val: { fontSize: 11, fontFamily: 'Inter_600SemiBold', width: 30, textAlign: 'right' },
});

export default function GenresScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: genres, isLoading } = useListMasteringGenres();

  const topPad = Platform.OS === 'web' ? 67 : insets.top + 16;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Mastering Styles</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          Genre-optimized mastering profiles
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={genres as MasteringGenre[]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
          ]}
          renderItem={({ item }) => (
            <View
              testID={`card-genre-${item.id}`}
              style={[styles.genreCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, { backgroundColor: colors.primary + '18' }]}>
                  <MaterialCommunityIcons
                    name={(GENRE_ICONS[item.id] ?? 'music-note') as any}
                    size={22}
                    color={colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.genreName, { color: colors.foreground }]}>{item.name}</Text>
                  {item.character && (
                    <Text style={[styles.character, { color: colors.primary }]}>
                      {item.character}
                    </Text>
                  )}
                </View>
                <View style={[styles.lufsBadge, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.lufsLabel, { color: colors.mutedForeground }]}>Target</Text>
                  <Text style={[styles.lufsValue, { color: colors.foreground }]}>
                    {item.targetLufs} LUFS
                  </Text>
                </View>
              </View>

              <Text style={[styles.genreDesc, { color: colors.mutedForeground }]}>
                {item.description}
              </Text>

              <View style={styles.meters}>
                <MeterBar label="Compression" value={item.compressionAmount} />
                <MeterBar label="Dynamic EQ" value={item.dynamicEqAmount} />
                <MeterBar label="Exciter" value={item.exciterAmount} />
              </View>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16 },
  genreCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genreName: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  character: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lufsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  lufsLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lufsValue: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  genreDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  meters: { marginTop: 4 },
});
