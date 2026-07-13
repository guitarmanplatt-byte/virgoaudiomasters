import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useListAudioProjects,
  getListAudioProjectsQueryKey,
  useDeleteAudioProject,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ProjectCard } from '@/components/ProjectCard';
import { useUploadAudio } from '@/hooks/useUploadAudio';

export default function ProjectsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: projects, isLoading, refetch } = useListAudioProjects();
  const deleteProject = useDeleteAudioProject();
  const { upload, isUploading } = useUploadAudio();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleUpload = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'video/mp4'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const { project, error } = await upload(
        asset.uri,
        asset.name,
        asset.mimeType ?? 'audio/mpeg'
      );

      if (error || !project) {
        Alert.alert('Upload Failed', error ?? 'Unknown error');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: getListAudioProjectsQueryKey() });
      router.push(`/project/${project.id}`);
    } catch (err) {
      Alert.alert('Error', 'Could not open file picker');
    }
  };

  const handleDelete = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    deleteProject.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAudioProjectsQueryKey() });
        },
        onError: () => {
          Alert.alert('Error', 'Could not delete project');
        },
      }
    );
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top + 16;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad, backgroundColor: colors.background }]}>
        <View style={styles.logoRow}>
          <MaterialCommunityIcons name="waveform" size={26} color={colors.primary} />
          <Text style={[styles.logoText, { color: colors.foreground }]}>
            Virgo<Text style={{ color: colors.primary }}>Audio</Text>Masters
          </Text>
        </View>
        <TouchableOpacity
          testID="button-upload"
          style={[styles.uploadBtn, { backgroundColor: colors.primary }]}
          onPress={handleUpload}
          disabled={isUploading}
          activeOpacity={0.8}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather name="upload" size={18} color={colors.primaryForeground} />
          )}
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={projects ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 16 },
          ]}
          scrollEnabled={!!(projects && projects.length > 0)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="waveform" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No projects yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
                Tap the upload button to add your first audio track
              </Text>
              <TouchableOpacity
                testID="button-upload-empty"
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={handleUpload}
                disabled={isUploading}
                activeOpacity={0.8}
              >
                <Feather name="upload-cloud" size={18} color={colors.primaryForeground} />
                <Text style={[styles.emptyBtnText, { color: colors.primaryForeground }]}>
                  Upload Audio
                </Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <ProjectCard
              project={item as Parameters<typeof ProjectCard>[0]['project']}
              onPress={() => router.push(`/project/${item.id}`)}
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoText: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },
  uploadBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: 16,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
});
