import { useState } from 'react';

interface AudioProject {
  id: string;
  name: string;
  originalFilename: string;
  fileUrl: string;
  status: string;
  createdAt: string;
  duration: number | null;
  sampleRate: number | null;
  enhancementSettings: Record<string, unknown>;
  masteringSettings: Record<string, unknown>;
}

interface UploadResult {
  project: AudioProject | null;
  error: string | null;
}

export function useUploadAudio() {
  const [isUploading, setIsUploading] = useState(false);

  const upload = async (
    uri: string,
    name: string,
    mimeType: string
  ): Promise<UploadResult> => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('audio', {
        uri,
        name,
        type: mimeType || 'audio/mpeg',
      } as unknown as Blob);

      // Use the same domain that the generated API hooks use (set via setBaseUrl in _layout.tsx).
      // EXPO_PUBLIC_DOMAIN is the raw host without scheme.
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) throw new Error('EXPO_PUBLIC_DOMAIN is not set — cannot reach API server.');
      const baseUrl = `https://${domain}`;

      const response = await fetch(`${baseUrl}/api/audio/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        return { project: null, error: text || 'Upload failed' };
      }

      const project = await response.json();
      return { project, error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      return { project: null, error: msg };
    } finally {
      setIsUploading(false);
    }
  };

  return { upload, isUploading };
}
