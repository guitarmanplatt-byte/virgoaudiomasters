import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getListAudioProjectsQueryKey, AudioProject } from '@workspace/api-client-react';

export function useUploadAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('audio', file);
      
      const response = await fetch(`${import.meta.env.BASE_URL}api/audio/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      return response.json() as Promise<AudioProject>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListAudioProjectsQueryKey() });
    }
  });
}
