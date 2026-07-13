import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

interface EnhancementSettings {
  enabled: boolean;
}
interface MasteringSettings {
  enabled: boolean;
}
interface AudioProject {
  id: string;
  name: string;
  originalFilename: string;
  fileUrl: string;
  status: string;
  createdAt: string;
  duration: number | null;
  enhancementSettings: EnhancementSettings;
  masteringSettings: MasteringSettings;
}

interface ProjectCardProps {
  project: AudioProject;
  onPress: () => void;
  onDelete: () => void;
}

function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  const config = {
    ready: { color: '#4A9EFF', label: 'Ready' },
    processing: { color: '#E8A030', label: 'Processing' },
    done: { color: '#4CAF50', label: 'Done' },
    error: { color: '#F04040', label: 'Error' },
  }[status] ?? { color: '#A6A6A6', label: status };

  return (
    <View style={[styles.badge, { backgroundColor: config.color + '22', borderColor: config.color + '55' }]}>
      <View style={[styles.badgeDot, { backgroundColor: config.color }]} />
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export function ProjectCard({ project, onPress, onDelete }: ProjectCardProps) {
  const colors = useColors();

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Delete Project', `Delete "${project.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  const enhEnabled = project.enhancementSettings?.enabled;
  const masterEnabled = project.masteringSettings?.enabled;

  return (
    <TouchableOpacity
      testID={`card-project-${project.id}`}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      onLongPress={handleLongPress}
      activeOpacity={0.75}
    >
      {/* Gold left accent */}
      <View style={[styles.accentBar, { backgroundColor: colors.primary }]} />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="waveform" size={20} color={colors.primary} />
          </View>
          <View style={styles.titleWrap}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {project.name}
            </Text>
            <Text style={[styles.filename, { color: colors.mutedForeground }]} numberOfLines={1}>
              {project.originalFilename}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </View>

        <View style={styles.bottomRow}>
          <StatusBadge status={project.status} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {formatDuration(project.duration)}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {formatDate(project.createdAt)}
          </Text>
          <View style={styles.chips}>
            {enhEnabled && (
              <View style={[styles.chip, { backgroundColor: '#4A9EFF22' }]}>
                <Text style={[styles.chipText, { color: '#4A9EFF' }]}>ENH</Text>
              </View>
            )}
            {masterEnabled && (
              <View style={[styles.chip, { backgroundColor: '#E8A03022' }]}>
                <Text style={[styles.chipText, { color: '#E8A030' }]}>MST</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  accentBar: {
    width: 3,
  },
  body: {
    flex: 1,
    padding: 14,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8A03015',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  filename: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  chips: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 'auto',
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
});
