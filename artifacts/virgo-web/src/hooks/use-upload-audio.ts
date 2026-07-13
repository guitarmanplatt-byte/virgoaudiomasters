import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getListAudioProjectsQueryKey, AudioProject } from '@workspace/api-client-react';
import { toast } from 'sonner';

export function useUploadAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('audio', file);

      // Use absolute URL so the request always routes to the API server
      // (avoids any ambiguity with the Vite dev server at the same origin).
      const response = await fetch(`${window.location.origin}/api/audio/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let detail = 'Upload failed';
        try {
          const body = await response.json();
          detail = body?.error || body?.message || detail;
        } catch {
          detail = await response.text().catch(() => detail);
        }
        throw new Error(detail);
      }

      return response.json() as Promise<AudioProject>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListAudioProjectsQueryKey() });
    },
    onError: (err: Error) => {
      toast.error('Upload failed', { description: err.message });
    },
  });
}
