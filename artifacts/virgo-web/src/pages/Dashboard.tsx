import { useState, useRef, useEffect, useCallback } from 'react';
import {
  useListAudioProjects,
  useDeleteAudioProject,
  useUpdateEnhancementSettings,
  getListAudioProjectsQueryKey,
  useListEqPresets,
  useListMasteringGenres,
} from '@workspace/api-client-react';
import { useUploadAudio } from '@/hooks/use-upload-audio';
import { DownloadDialog } from '@/components/DownloadDialog';
import { decodeAudioFile, drawWaveform, fmtDuration, MasteringParams, EqBand } from '@/lib/audio-encoder';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  UploadCloud, Music, Clock, Calendar, Trash2, Loader2,
  Plus, AlertCircle, X, Download, ArrowRight,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function Dashboard() {
  const [_, setLocation] = useLocation();
  const { data: projects, isLoading, isError } = useListAudioProjects();
  const deleteProject = useDeleteAudioProject();
  const uploadAudio = useUploadAudio();
  const updateEnhancement = useUpdateEnhancementSettings();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: eqPresets } = useListEqPresets();
  const { data: genres } = useListMasteringGenres();

  // ── Upload / drop state ─────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  // Counter instead of bool so entering/leaving nested children doesn't flicker
  const dragCounterRef = useRef(0);

  // ── Waveform preview state ───────────────────────────────────────────────
  const [previewFile, setPreviewFile]       = useState<File | null>(null);
  const [previewBuffer, setPreviewBuffer]   = useState<AudioBuffer | null>(null);
  const [isDecoding, setIsDecoding]         = useState(false);
  const [decodeError, setDecodeError]       = useState(false);
  const [previewEqId, setPreviewEqId]       = useState<string>('none');
  const [previewGenreId, setPreviewGenreId] = useState<string>('none');
  const [showDownload, setShowDownload]     = useState(false);
  const canvasRef  = useRef<HTMLCanvasElement>(null);

  // Draw waveform whenever buffer + canvas are ready
  useEffect(() => {
    if (previewBuffer && canvasRef.current) {
      drawWaveform(canvasRef.current, previewBuffer);
    }
  }, [previewBuffer]);

  // Re-draw on resize
  useEffect(() => {
    if (!previewBuffer || !canvasRef.current) return;
    const ro = new ResizeObserver(() => {
      if (canvasRef.current && previewBuffer) drawWaveform(canvasRef.current, previewBuffer);
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [previewBuffer]);

  // ── File decode ──────────────────────────────────────────────────────────
  const handleFileChosen = useCallback(async (file: File) => {
    // Accept the file immediately — show info panel right away
    setPreviewFile(file);
    setPreviewBuffer(null);
    setDecodeError(false);
    setIsDecoding(true);
    setPreviewEqId('none');
    setPreviewGenreId('none');
    try {
      const buf = await decodeAudioFile(file);
      setPreviewBuffer(buf);
    } catch (err) {
      console.warn('Waveform decode failed (file will still work):', err);
      setDecodeError(true);
      // Do NOT clear previewFile — user can still upload / process
    } finally {
      setIsDecoding(false);
    }
  }, []);

  const clearPreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewBuffer(null);
    setDecodeError(false);
    setIsDecoding(false);
    setPreviewEqId('none');
    setPreviewGenreId('none');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ── Document-level drag listeners ────────────────────────────────────────
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      // DOMStringList uses .contains(), not .includes()
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (!hasFiles(e)) return;
      dragCounterRef.current += 1;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) handleFileChosen(file);
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover',  onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop',      onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover',  onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop',      onDrop);
    };
  }, [handleFileChosen]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileChosen(file);
  };

  // ── Upload to workspace (applies EQ preset selection after creation) ─────
  const handleUploadToWorkspace = useCallback(() => {
    if (!previewFile) return;
    uploadAudio.mutate(previewFile, {
      onSuccess: (project) => {
        // If user picked an EQ preset, save it to the new project before navigating
        if (previewEqId !== 'none' && project.enhancementSettings) {
          updateEnhancement.mutate({
            id: project.id,
            data: { ...project.enhancementSettings, eqPresetId: previewEqId },
          }, {
            onSettled: () => setLocation(`/project/${project.id}`),
          });
        } else {
          setLocation(`/project/${project.id}`);
        }
      },
    });
  }, [previewFile, previewEqId, uploadAudio, updateEnhancement, setLocation]);

  // ── Mastering params derived from genre selection ────────────────────────
  const masteringForExport = useCallback((): MasteringParams => {
    const genre = genres?.find((g) => g.id === previewGenreId);
    if (genre) {
      return {
        enabled: true,
        compressionAmount: genre.compressionAmount,
        targetLufs: genre.targetLufs,
        exciterAmount: genre.exciterAmount,
        dynamicEqAmount: genre.dynamicEqAmount,
      };
    }
    return { enabled: false, compressionAmount: 0.3, targetLufs: -14, exciterAmount: 0, dynamicEqAmount: 0 };
  }, [genres, previewGenreId]);

  const currentEqBands: EqBand[] =
    (eqPresets?.find((p) => p.id === previewEqId)?.bands ?? []) as EqBand[];

  // ── Status badge ─────────────────────────────────────────────────────────
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':      return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 font-medium">Ready</Badge>;
      case 'processing': return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 font-medium flex gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processing</Badge>;
      case 'done':       return <Badge className="bg-green-500/10 text-green-500 border-green-500/20 font-medium">Done</Badge>;
      case 'error':      return <Badge className="bg-destructive/10 text-destructive border-destructive/20 font-medium">Error</Badge>;
      default:           return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (s?: number | null) => {
    if (!s) return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Show the empty drop zone only when no file has been accepted yet
  const showDropZone = !previewFile;

  return (
    <div className="p-8 max-w-6xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="font-serif text-4xl text-foreground mb-2">Projects</h1>
        <p className="text-muted-foreground">Upload, master, and manage your high-fidelity audio tracks.</p>
      </header>

      {/* ── Upload / Preview Area ──────────────────────────────────────────── */}
      <Card
        className={`border-2 transition-all duration-300 bg-card/50
          ${previewFile ? 'border-primary/40' : 'border-dashed'}
          ${isDragging ? 'border-primary bg-primary/5 scale-[1.005]' : 'border-border'}
        `}
      >
        <CardContent className="p-0">

          {/* ── Empty drop zone ───────────────────────────────────────────── */}
          {showDropZone && (
            /*
             * The <label> wraps the entire zone and a real <input type="file">.
             * Clicking anywhere in the zone natively opens the OS file picker —
             * no JavaScript .click() needed, works in all sandboxed iframes.
             * The transparent input also accepts direct file drops in Chrome.
             */
            <label className="relative flex flex-col items-center justify-center py-16 cursor-pointer select-none">
              <input
                type="file"
                className="sr-only"
                accept=".mp3,.wav,.m4a,.flac,.aac,.aiff,.aif,.ogg,.opus,.wma,.webm"
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
              <div className="w-16 h-16 rounded-full bg-background border border-border flex items-center justify-center mb-4 pointer-events-none">
                <UploadCloud className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-medium text-foreground mb-2 pointer-events-none">
                {isDragging ? 'Drop file here' : 'Drag and drop audio file here'}
              </h3>
              <p className="text-sm text-muted-foreground mb-6 pointer-events-none">WAV, FLAC, AIFF, MP3, M4A — up to 2 GB</p>
              {/* Button is inside the label — clicking it also opens file picker */}
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium pointer-events-none">
                <Plus className="w-4 h-4" /> Select File
              </span>
            </label>
          )}

          {/* ── File accepted — show info + waveform ──────────────────────── */}
          {previewFile && (
            <div className="p-6 space-y-5">
              {/* File info row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <Music className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate text-sm" title={previewFile.name}>
                      {previewFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {previewBuffer
                        ? <>{fmtDuration(previewBuffer.duration)} &nbsp;·&nbsp; {previewBuffer.sampleRate / 1000} kHz &nbsp;·&nbsp; {previewBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</>
                        : <>{(previewFile.size / 1_048_576).toFixed(1)} MB</>
                      }
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  onClick={clearPreview}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Waveform canvas — spinner while decoding, placeholder on error */}
              <div className="relative rounded-xl overflow-hidden border border-border bg-[hsl(0,0%,5%)]" style={{ height: 140 }}>
                {isDecoding && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-primary">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <span className="text-xs text-muted-foreground">Analyzing waveform…</span>
                  </div>
                )}
                {decodeError && !isDecoding && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-xs text-muted-foreground">Waveform preview unavailable — file will still process normally.</p>
                  </div>
                )}
                <canvas
                  ref={canvasRef}
                  className="w-full h-full"
                  style={{ display: previewBuffer ? 'block' : 'none' }}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 via-transparent to-teal-900/10 pointer-events-none" />
              </div>

              {/* EQ + Mastering selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">EQ Profile</label>
                  <Select value={previewEqId} onValueChange={setPreviewEqId}>
                    <SelectTrigger className="bg-background border-border h-10">
                      <SelectValue placeholder="Flat (No EQ)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Flat (No EQ)</SelectItem>
                      {eqPresets?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span>{p.name}</span>
                          <span className="text-muted-foreground text-xs ml-3 uppercase">{p.category}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mastering Style</label>
                  <Select value={previewGenreId} onValueChange={setPreviewGenreId}>
                    <SelectTrigger className="bg-background border-border h-10">
                      <SelectValue placeholder="No mastering" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No mastering</SelectItem>
                      {genres?.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                          <span className="text-muted-foreground text-xs ml-2">({g.character})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  disabled={isDecoding}
                  onClick={() => setShowDownload(true)}
                >
                  <Download className="w-4 h-4" />
                  Process &amp; Download
                </Button>
                <Button
                  className="flex-1 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleUploadToWorkspace}
                  disabled={uploadAudio.isPending || updateEnhancement.isPending}
                >
                  {uploadAudio.isPending || updateEnhancement.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  ) : (
                    <>Open in Workspace <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Download dialog (client-side processing, no upload needed) */}
      {previewBuffer && previewFile && (
        <DownloadDialog
          open={showDownload}
          onOpenChange={setShowDownload}
          audioSource={{ type: 'buffer', buffer: previewBuffer }}
          filename={previewFile.name.replace(/\.[^.]+$/, '')}
          eqBands={currentEqBands}
          mastering={masteringForExport()}
        />
      )}

      {/* ── Projects List ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-serif text-foreground mb-6 flex items-center gap-2">
          <Music className="w-5 h-5 text-primary" /> Recent Sessions
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="h-32 animate-pulse bg-card/50 border-border" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center bg-destructive/5 rounded-lg border border-destructive/20 text-destructive flex flex-col items-center">
            <AlertCircle className="w-8 h-8 mb-2" />
            <p>Failed to load projects. Please try again.</p>
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="group relative overflow-hidden transition-all duration-300 hover:border-primary/50 hover:bg-card hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary/0 group-hover:bg-primary transition-colors" />
                <Link href={`/project/${project.id}`} className="block p-5">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-medium text-lg text-foreground truncate pr-4" title={project.name}>
                      {project.name}
                    </h3>
                    <div className="flex-shrink-0">{getStatusBadge(project.status)}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-auto pt-2">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(project.duration)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {format(new Date(project.createdAt), 'MMM d, yyyy')}
                    </div>
                  </div>
                </Link>

                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm('Delete this project?')) {
                      deleteProject.mutate(
                        { id: project.id },
                        {
                          onSuccess: () => {
                            queryClient.invalidateQueries({ queryKey: getListAudioProjectsQueryKey() });
                          },
                        }
                      );
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-card/30 rounded-xl border border-border border-dashed">
            <div className="w-16 h-16 rounded-full bg-background border border-border flex items-center justify-center mx-auto mb-4 text-muted-foreground">
              <Music className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-xl font-serif text-foreground mb-2">No projects yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Your audio sessions will appear here. Upload a track above to begin mastering.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
