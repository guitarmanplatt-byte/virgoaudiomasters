import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetAudioProject,
  getGetAudioProjectQueryKey,
  useUpdateEnhancementSettings,
  useUpdateMasteringSettings,
  useListEqPresets,
  useListMasteringGenres,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { WaveformDisplay } from '@/components/WaveformDisplay';
import { AudioSlider, ToggleRow, SectionCard } from '@/components/ControlRow';

const LUFS_PRESETS = [
  { label: 'Spotify', value: -14 },
  { label: 'Apple Music', value: -16 },
  { label: 'YouTube', value: -14 },
  { label: 'Tidal', value: -14 },
  { label: 'Custom', value: -12 },
];

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useGetAudioProject(id, {
    query: { enabled: !!id, queryKey: getGetAudioProjectQueryKey(id) },
  });
  const { data: eqPresets } = useListEqPresets();
  const { data: genres } = useListMasteringGenres();
  const updateEnh = useUpdateEnhancementSettings();
  const updateMaster = useUpdateMasteringSettings();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetAudioProjectQueryKey(id) });
  }, [queryClient, id]);

  // Enhancement settings helpers
  const enh = (project?.enhancementSettings ?? {}) as {
    eqPresetId?: string | null;
    stereoWidth?: number;
    clarityAmount?: number;
    humReduction?: boolean;
    humFrequency?: number | null;
    noiseReduction?: number;
    sibilanceReduction?: number;
    clipRepair?: boolean;
    preRingFix?: boolean;
    enabled?: boolean;
  };
  const mst = (project?.masteringSettings ?? {}) as {
    genreId?: string | null;
    compressionAmount?: number;
    dynamicEqAmount?: number;
    exciterAmount?: number;
    targetLufs?: number;
    enabled?: boolean;
  };

  const patchEnhancement = (patch: Record<string, unknown>) => {
    Haptics.selectionAsync();
    updateEnh.mutate(
      { id, data: patch },
      { onSuccess: invalidate }
    );
  };

  const patchMastering = (patch: Record<string, unknown>) => {
    Haptics.selectionAsync();
    updateMaster.mutate(
      { id, data: patch },
      { onSuccess: invalidate }
    );
  };

  const applyGenre = (genreId: string) => {
    const genre = genres?.find((g) => g.id === genreId);
    if (!genre) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateMaster.mutate(
      {
        id,
        data: {
          genreId,
          compressionAmount: genre.compressionAmount,
          dynamicEqAmount: genre.dynamicEqAmount,
          exciterAmount: genre.exciterAmount,
          targetLufs: genre.targetLufs,
        },
      },
      { onSuccess: invalidate }
    );
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 16;

  if (isLoading || !project) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background }]}>
        <TouchableOpacity
          testID="button-back"
          style={[styles.backBtn, { backgroundColor: colors.secondary }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          {project.name}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Waveform */}
        <View style={[styles.waveformCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <WaveformDisplay height={72} />
          <View style={styles.waveformMeta}>
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {project.originalFilename}
            </Text>
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {project.sampleRate ? `${project.sampleRate / 1000}kHz` : '--'} · {project.status}
            </Text>
          </View>
        </View>

        {/* Enhancement Section */}
        <SectionCard
          title="Enhancement"
          enabled={!!enh.enabled}
          onToggleEnabled={(v) => patchEnhancement({ enabled: v })}
        >
          {/* EQ Preset */}
          <View style={styles.pickerGroup}>
            <Text style={[styles.pickerLabel, { color: colors.foreground }]}>EQ Preset</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.presetChips}>
                <TouchableOpacity
                  testID="chip-eq-none"
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: !enh.eqPresetId ? colors.primary : colors.secondary,
                      borderColor: !enh.eqPresetId ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => patchEnhancement({ eqPresetId: null })}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.presetChipText, { color: !enh.eqPresetId ? colors.primaryForeground : colors.mutedForeground }]}>
                    None
                  </Text>
                </TouchableOpacity>
                {(eqPresets ?? []).map((preset) => {
                  const active = enh.eqPresetId === preset.id;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      testID={`chip-eq-${preset.id}`}
                      style={[
                        styles.presetChip,
                        {
                          backgroundColor: active ? colors.primary : colors.secondary,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => patchEnhancement({ eqPresetId: preset.id })}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.presetChipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                        {preset.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <AudioSlider
            label="Stereo Width"
            value={enh.stereoWidth ?? 1.0}
            min={0}
            max={2}
            step={0.05}
            hint="Narrow ← Original → Wide"
            onChange={(v) => patchEnhancement({ stereoWidth: v })}
          />
          <AudioSlider
            label="Clarity"
            value={enh.clarityAmount ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchEnhancement({ clarityAmount: v })}
          />
          <AudioSlider
            label="Noise Reduction"
            value={enh.noiseReduction ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchEnhancement({ noiseReduction: v })}
          />
          <AudioSlider
            label="Sibilance Reduction"
            value={enh.sibilanceReduction ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchEnhancement({ sibilanceReduction: v })}
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <ToggleRow
            label="Hum Reduction"
            value={!!enh.humReduction}
            hint="Removes 50/60Hz electrical hum"
            onChange={(v) => patchEnhancement({ humReduction: v })}
          />
          {enh.humReduction && (
            <View style={styles.humFreqRow}>
              <Text style={[styles.humFreqLabel, { color: colors.mutedForeground }]}>Hum frequency:</Text>
              {[50, 60].map((f) => (
                <TouchableOpacity
                  key={f}
                  testID={`button-hum-${f}`}
                  style={[
                    styles.freqBtn,
                    {
                      backgroundColor: enh.humFrequency === f ? colors.primary : colors.secondary,
                      borderColor: enh.humFrequency === f ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => patchEnhancement({ humFrequency: f })}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.freqBtnText, { color: enh.humFrequency === f ? colors.primaryForeground : colors.mutedForeground }]}>
                    {f}Hz
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <ToggleRow
            label="Clip Repair"
            value={!!enh.clipRepair}
            hint="Reconstructs clipped audio peaks"
            onChange={(v) => patchEnhancement({ clipRepair: v })}
          />
          <ToggleRow
            label="Pre-Ring Fix"
            value={!!enh.preRingFix}
            hint="Reduces linear-phase filter artifacts"
            onChange={(v) => patchEnhancement({ preRingFix: v })}
          />
        </SectionCard>

        {/* Mastering Section */}
        <SectionCard
          title="Mastering"
          enabled={!!mst.enabled}
          onToggleEnabled={(v) => patchMastering({ enabled: v })}
        >
          {/* Genre Picker */}
          <View style={styles.pickerGroup}>
            <Text style={[styles.pickerLabel, { color: colors.foreground }]}>Genre Style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.presetChips}>
                <TouchableOpacity
                  testID="chip-genre-none"
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: !mst.genreId ? colors.primary : colors.secondary,
                      borderColor: !mst.genreId ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => patchMastering({ genreId: null })}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.presetChipText, { color: !mst.genreId ? colors.primaryForeground : colors.mutedForeground }]}>
                    None
                  </Text>
                </TouchableOpacity>
                {(genres ?? []).map((genre) => {
                  const active = mst.genreId === genre.id;
                  return (
                    <TouchableOpacity
                      key={genre.id}
                      testID={`chip-genre-${genre.id}`}
                      style={[
                        styles.presetChip,
                        {
                          backgroundColor: active ? colors.primary : colors.secondary,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => applyGenre(genre.id)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.presetChipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                        {genre.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <AudioSlider
            label="Compression"
            value={mst.compressionAmount ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            hint="Gentle → Firm"
            onChange={(v) => patchMastering({ compressionAmount: v })}
          />
          <AudioSlider
            label="Dynamic EQ"
            value={mst.dynamicEqAmount ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchMastering({ dynamicEqAmount: v })}
          />
          <AudioSlider
            label="Exciter (Warmth & Air)"
            value={mst.exciterAmount ?? 0.3}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchMastering({ exciterAmount: v })}
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Target LUFS */}
          <View style={styles.pickerGroup}>
            <Text style={[styles.pickerLabel, { color: colors.foreground }]}>Target LUFS</Text>
            <View style={styles.lufsGrid}>
              {LUFS_PRESETS.map((preset) => {
                const active = mst.targetLufs === preset.value;
                return (
                  <TouchableOpacity
                    key={preset.label}
                    testID={`button-lufs-${preset.label}`}
                    style={[
                      styles.lufsBtn,
                      {
                        backgroundColor: active ? colors.primary : colors.secondary,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => patchMastering({ targetLufs: preset.value })}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.lufsBtnLabel, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                      {preset.label}
                    </Text>
                    <Text style={[styles.lufsBtnValue, { color: active ? colors.primaryForeground : colors.foreground }]}>
                      {preset.value} LUFS
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </SectionCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  scrollContent: { padding: 16, gap: 4 },
  waveformCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  waveformMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  pickerGroup: { gap: 8, paddingVertical: 6 },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
  },
  presetChips: { flexDirection: 'row', gap: 8 },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  divider: { height: 1, marginVertical: 6 },
  humFreqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    marginBottom: 4,
  },
  humFreqLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  freqBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  freqBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  lufsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  lufsBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 90,
    alignItems: 'center',
  },
  lufsBtnLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lufsBtnValue: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    marginTop: 2,
  },
});
