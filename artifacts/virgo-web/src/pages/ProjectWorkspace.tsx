import { useState, useRef, useEffect, useCallback } from 'react';
import { useRoute, Link } from 'wouter';
import { 
  useGetAudioProject, 
  getGetAudioProjectQueryKey,
  useUpdateEnhancementSettings,
  useUpdateMasteringSettings,
  useListEqPresets,
  useListMasteringGenres,
  useRenameAudioProject
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch as UISwitch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Play, Pause, Square, Loader2, ArrowLeft, 
  Settings2, Activity, SlidersHorizontal, Share, Download, Edit2, Check,
  Waves
} from 'lucide-react';

// Stable waveform bar heights — seeded deterministically so they don't re-randomise on every render
const WAVEFORM_BARS = Array.from({ length: 150 }, (_, i) => {
  const x = Math.sin(i * 2.399963) * 43758.5453;
  return 10 + (Math.abs(x - Math.floor(x)) * 80);
});

export default function ProjectWorkspace() {
  const [, params] = useRoute('/project/:id');
  const id = params?.id || '';
  const queryClient = useQueryClient();

  const { data: project, isLoading: isProjectLoading } = useGetAudioProject(id, {
    query: { enabled: !!id, queryKey: getGetAudioProjectQueryKey(id) }
  });

  const { data: eqPresets } = useListEqPresets();
  const { data: genres } = useListMasteringGenres();

  const updateEnhancement = useUpdateEnhancementSettings();
  const updateMastering = useUpdateMasteringSettings();
  const renameProject = useRenameAudioProject();

  // Local state for UI responsiveness before API commits
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Web Audio API nodes for live EQ preview
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  // Refs for tracking initialized states
  const initializedId = useRef<string | null>(null);

  // Editable local state
  const [enhancement, setEnhancement] = useState(project?.enhancementSettings);
  const [mastering, setMastering] = useState(project?.masteringSettings);

  // Sync from server on load
  useEffect(() => {
    if (project && initializedId.current !== project.id) {
      initializedId.current = project.id;
      setEnhancement(project.enhancementSettings);
      setMastering(project.masteringSettings);
      setEditName(project.name);
    }
  }, [project]);

  // Build a BiquadFilter chain from EQ preset bands, replacing any existing chain.
  const applyEqChain = useCallback((bands: Array<{ frequency: number; gain: number; q: number; type: string }>) => {
    const ctx = audioCtxRef.current;
    const source = sourceNodeRef.current;
    if (!ctx || !source) return;

    // Tear down old chain
    try { source.disconnect(); } catch {}
    for (const f of filtersRef.current) { try { f.disconnect(); } catch {} }

    if (!bands.length) {
      source.connect(ctx.destination);
      filtersRef.current = [];
      return;
    }

    const filters = bands.map(band => {
      const f = ctx.createBiquadFilter();
      f.type = band.type as BiquadFilterType;
      f.frequency.value = band.frequency;
      f.gain.value = band.gain;
      f.Q.value = band.q;
      return f;
    });

    let prev: AudioNode = source;
    for (const f of filters) { prev.connect(f); prev = f; }
    prev.connect(ctx.destination);
    filtersRef.current = filters;
  }, []);

  // Initialize AudioContext + MediaElementSource on first user gesture.
  const initAudioCtx = useCallback(() => {
    if (!audioRef.current || audioCtxRef.current) return;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaElementSource(audioRef.current);
    sourceNodeRef.current = source;
    source.connect(ctx.destination); // flat until a preset is applied
  }, []);

  // Handle Playback — create audio element with crossOrigin for Web Audio API
  useEffect(() => {
    if (project?.fileUrl) {
      if (!audioRef.current) {
        // Use an absolute URL so the request reliably hits the API server
        const audioUrl = `${window.location.origin}${project.fileUrl}`;
        const audio = new Audio();
        audio.crossOrigin = 'anonymous'; // required for createMediaElementSource
        audio.src = audioUrl;
        audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime || 0));
        audio.addEventListener('ended', () => { setIsPlaying(false); setCurrentTime(0); });
        audio.addEventListener('error', () => setAudioError('Could not load audio file.'));
        audioRef.current = audio;
      }
    }
    return () => {
      audioRef.current?.pause();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      sourceNodeRef.current = null;
      filtersRef.current = [];
    };
  }, [project?.fileUrl]);

  // Live EQ — re-apply chain whenever the selected preset changes (if audio context is active)
  useEffect(() => {
    if (!audioCtxRef.current) return;
    const preset = eqPresets?.find(p => p.id === enhancement?.eqPresetId);
    applyEqChain(preset?.bands ?? []);
  }, [enhancement?.eqPresetId, eqPresets, applyEqChain]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    // First play: spin up AudioContext and apply current EQ preset
    if (!audioCtxRef.current) {
      initAudioCtx();
      const preset = eqPresets?.find(p => p.id === enhancement?.eqPresetId);
      applyEqChain(preset?.bands ?? []);
    }

    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => setAudioError(String(err)));
    }
    setIsPlaying(!isPlaying);
  };

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      setIsPlaying(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleRename = () => {
    if (editName.trim() && editName !== project?.name && id) {
      renameProject.mutate({ id, data: { name: editName.trim() } }, {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetAudioProjectQueryKey(id), data);
          setIsEditingName(false);
        }
      });
    } else {
      setIsEditingName(false);
    }
  };

  // Debounced auto-save triggers for settings
  const lastSavedEnhancement = useRef(enhancement);
  const lastSavedMastering = useRef(mastering);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  const triggerSave = useCallback(() => {
    if (!id || !enhancement || !mastering) return;
    
    if (saveTimeout.current) clearTimeout(saveTimeout.current);

    saveTimeout.current = setTimeout(() => {
      if (JSON.stringify(enhancement) !== JSON.stringify(lastSavedEnhancement.current)) {
        updateEnhancement.mutate({ id, data: enhancement }, {
           onSuccess: (data) => {
             queryClient.setQueryData(getGetAudioProjectQueryKey(id), data);
             lastSavedEnhancement.current = data.enhancementSettings;
           }
        });
      }
      
      if (JSON.stringify(mastering) !== JSON.stringify(lastSavedMastering.current)) {
        updateMastering.mutate({ id, data: mastering }, {
           onSuccess: (data) => {
             queryClient.setQueryData(getGetAudioProjectQueryKey(id), data);
             lastSavedMastering.current = data.masteringSettings;
           }
        });
      }
    }, 800);
  }, [id, enhancement, mastering, updateEnhancement, updateMastering, queryClient]);

  useEffect(() => {
    triggerSave();
  }, [enhancement, mastering, triggerSave]);

  const applyGenrePreset = (genreId: string) => {
    const genre = genres?.find(g => g.id === genreId);
    if (genre && mastering) {
      setMastering({
        ...mastering,
        genreId,
        compressionAmount: genre.compressionAmount,
        dynamicEqAmount: genre.dynamicEqAmount,
        exciterAmount: genre.exciterAmount,
        targetLufs: genre.targetLufs
      });
    }
  };

  if (isProjectLoading || !project || !enhancement || !mastering) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center text-primary">
          <Loader2 className="w-12 h-12 animate-spin mb-4" />
          <p className="font-medium text-lg">Loading Project Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-screen overflow-hidden animate-in fade-in duration-500">
      {/* Top Header */}
      <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6 flex-shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors hover-elevate p-1 rounded">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="h-6 w-px bg-border mx-2" />
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input 
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-64 bg-background font-serif text-lg h-9 border-primary/50 focus-visible:ring-1"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleRename()}
                onBlur={handleRename}
              />
              <Button size="icon" variant="ghost" onClick={handleRename} className="h-8 w-8 text-green-500">
                <Check className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingName(true)}>
              <h1 className="font-serif text-xl font-medium text-foreground">{project.name}</h1>
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          <div className="ml-4">
            <Badge variant="outline" className={`
              ${project.status === 'done' ? 'text-green-500 border-green-500/20 bg-green-500/10' : ''}
              ${project.status === 'processing' ? 'text-amber-500 border-amber-500/20 bg-amber-500/10' : ''}
              ${project.status === 'error' ? 'text-destructive border-destructive/20 bg-destructive/10' : ''}
              ${project.status === 'ready' ? 'text-blue-500 border-blue-500/20 bg-blue-500/10' : ''}
            `}>
              {project.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin mr-1 inline" />}
              {project.status.toUpperCase()}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="bg-background">
            <Share className="w-4 h-4 mr-2" /> Share
          </Button>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left/Middle Column (Visualizer & Enhancement) */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border overflow-y-auto">
          
          {/* Waveform Area */}
          <div className="h-72 flex-shrink-0 bg-background border-b border-border p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Waveform Analysis</h2>
                {enhancement?.eqPresetId && (
                  <Badge className="bg-primary/15 text-primary border-primary/30 gap-1 text-xs animate-in fade-in">
                    <Waves className="w-3 h-3" />
                    {eqPresets?.find(p => p.id === enhancement.eqPresetId)?.name ?? 'EQ Active'}
                  </Badge>
                )}
              </div>
              <div className="font-mono text-sm text-foreground bg-card px-3 py-1 rounded border border-border shadow-sm">
                {formatTime(currentTime)} / {formatTime(project.duration || 0)}
              </div>
            </div>

            {audioError && (
              <p className="text-xs text-destructive mb-2">{audioError}</p>
            )}
            
            {/* Visualizer */}
            <div className="flex-1 rounded-lg bg-card/50 border border-border relative overflow-hidden flex items-center justify-center p-4">
              {/* Spectral Gradient BG */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-900/20 via-purple-900/20 to-teal-900/20 mix-blend-screen opacity-50" />
              
              {/* Decorative CSS Bars — heights seeded from index so they're stable */}
              <div className="w-full h-full flex items-center gap-[1px] overflow-hidden relative z-10">
                {WAVEFORM_BARS.map((height, i) => {
                  const isPlayed = (i / WAVEFORM_BARS.length) * (project.duration || 1) <= currentTime;
                  return (
                    <div 
                      key={i} 
                      className={`flex-1 rounded-full transition-colors duration-150 ${isPlayed ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                      style={{ height: `${height}%`, opacity: isPlayed ? 1 : 0.6 }}
                    />
                  );
                })}
              </div>

              {/* Playhead */}
              {project.duration && currentTime > 0 && (
                <div 
                  className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] z-20 transition-none pointer-events-none"
                  style={{ left: `${(currentTime / project.duration) * 100}%` }}
                >
                  <div className="w-3 h-3 bg-white rounded-full absolute -top-1.5 -translate-x-[5px] shadow-sm" />
                </div>
              )}
            </div>

            {/* Transport Controls */}
            <div className="mt-4 flex items-center justify-center gap-4">
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-full hover:bg-card" onClick={stopPlayback}>
                <Square className="w-4 h-4" />
              </Button>
              <Button 
                className="h-12 w-12 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 transition-transform"
                onClick={togglePlay}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
              </Button>
            </div>
          </div>

          {/* Enhancement Panel */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Settings2 className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-serif">Enhancement Processing</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">{enhancement.enabled ? 'ON' : 'BYPASS'}</span>
                <UISwitch 
                  checked={enhancement.enabled} 
                  onCheckedChange={v => setEnhancement({...enhancement, enabled: v})} 
                  className="data-[state=checked]:bg-primary"
                />
              </div>
            </div>

            <div className={`space-y-8 transition-opacity duration-300 ${!enhancement.enabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
              <Card className="bg-card/50 shadow-none border-border">
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* EQ Preset */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">EQ Profile</label>
                    <Select value={enhancement.eqPresetId || "none"} onValueChange={v => setEnhancement({...enhancement, eqPresetId: v === "none" ? null : v})}>
                      <SelectTrigger className="w-full bg-background border-border">
                        <SelectValue placeholder="Select EQ Preset" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Flat (No EQ)</SelectItem>
                        {eqPresets?.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex justify-between w-full">
                              <span>{p.name}</span>
                              <span className="text-muted-foreground text-xs ml-4 uppercase">{p.category}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Stereo Width */}
                  <div className="space-y-4 pt-1">
                    <div className="flex justify-between text-sm">
                      <label className="font-medium text-foreground">Stereo Width</label>
                      <span className="text-muted-foreground font-mono">{(enhancement.stereoWidth * 100).toFixed(0)}%</span>
                    </div>
                    <Slider 
                      value={[enhancement.stereoWidth]} 
                      min={0} max={2} step={0.05}
                      onValueChange={v => setEnhancement({...enhancement, stereoWidth: v[0]})}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Narrow</span>
                      <span>Original</span>
                      <span>Wide</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Clarity & Noise */}
                <Card className="bg-card/50 shadow-none border-border">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" /> Clarity & Restoration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <label className="text-foreground">Clarity Amount</label>
                        <span className="font-mono text-primary">{(enhancement.clarityAmount * 100).toFixed(0)}%</span>
                      </div>
                      <Slider value={[enhancement.clarityAmount]} min={0} max={1} step={0.01} onValueChange={v => setEnhancement({...enhancement, clarityAmount: v[0]})} />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <label className="text-foreground">Noise Reduction</label>
                        <span className="font-mono text-primary">{(enhancement.noiseReduction * 100).toFixed(0)}%</span>
                      </div>
                      <Slider value={[enhancement.noiseReduction]} min={0} max={1} step={0.01} onValueChange={v => setEnhancement({...enhancement, noiseReduction: v[0]})} />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <label className="text-foreground">De-Esser (Sibilance)</label>
                        <span className="font-mono text-primary">{(enhancement.sibilanceReduction * 100).toFixed(0)}%</span>
                      </div>
                      <Slider value={[enhancement.sibilanceReduction]} min={0} max={1} step={0.01} onValueChange={v => setEnhancement({...enhancement, sibilanceReduction: v[0]})} />
                    </div>
                  </CardContent>
                </Card>

                {/* Repair */}
                <Card className="bg-card/50 shadow-none border-border">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" /> Artifact Repair
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-foreground">Hum Reduction</label>
                        <p className="text-xs text-muted-foreground">Remove electrical ground hum</p>
                      </div>
                      <UISwitch checked={enhancement.humReduction} onCheckedChange={v => setEnhancement({...enhancement, humReduction: v})} />
                    </div>
                    
                    {enhancement.humReduction && (
                      <div className="pl-4 border-l-2 border-primary/20 space-y-3 mt-2 animate-in slide-in-from-top-2">
                        <label className="text-sm font-medium text-foreground">Base Frequency</label>
                        <Select 
                          value={enhancement.humFrequency?.toString() || "60"} 
                          onValueChange={v => setEnhancement({...enhancement, humFrequency: parseInt(v)})}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="Select Frequency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="50">50 Hz (Europe/UK/Asia)</SelectItem>
                            <SelectItem value="60">60 Hz (US/Americas)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-foreground">Clip Repair</label>
                        <p className="text-xs text-muted-foreground">Reconstruct clipped peaks</p>
                      </div>
                      <UISwitch checked={enhancement.clipRepair} onCheckedChange={v => setEnhancement({...enhancement, clipRepair: v})} />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-foreground">Pre-Ring Fix</label>
                        <p className="text-xs text-muted-foreground">Reduce filter ringing artifacts</p>
                      </div>
                      <UISwitch checked={enhancement.preRingFix} onCheckedChange={v => setEnhancement({...enhancement, preRingFix: v})} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (Mastering) */}
        <div className="w-[400px] flex-shrink-0 bg-sidebar border-l border-border flex flex-col">
          <div className="p-6 border-b border-border bg-sidebar shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-serif text-foreground">Mastering Chain</h2>
              </div>
              <UISwitch 
                checked={mastering.enabled} 
                onCheckedChange={v => setMastering({...mastering, enabled: v})} 
                className="data-[state=checked]:bg-primary"
              />
            </div>
            <p className="text-sm text-muted-foreground">Final polish and loudness targets.</p>
          </div>

          <div className={`flex-1 overflow-y-auto p-6 space-y-8 ${!mastering.enabled ? 'opacity-40 pointer-events-none' : 'opacity-100'} transition-opacity duration-300`}>
            
            {/* Genre Style */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground uppercase tracking-wider">Style Profile</label>
              <Select value={mastering.genreId || "none"} onValueChange={applyGenrePreset}>
                <SelectTrigger className="h-12 bg-background border-border text-base">
                  <SelectValue placeholder="Custom Manual Settings" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Custom Manual Settings</SelectItem>
                  {genres?.map(g => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} <span className="text-muted-foreground ml-2">({g.character})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full h-px bg-border/50" />

            {/* Dynamics & EQ Sliders */}
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-baseline">
                  <div>
                    <label className="text-foreground font-medium block">Compression</label>
                    <span className="text-xs text-muted-foreground">Gentle ← → Firm</span>
                  </div>
                  <span className="font-mono text-primary text-sm">{(mastering.compressionAmount * 100).toFixed(0)}%</span>
                </div>
                <Slider 
                  value={[mastering.compressionAmount]} min={0} max={1} step={0.01} 
                  onValueChange={v => setMastering({...mastering, compressionAmount: v[0], genreId: null})} 
                  className="[&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-blue-500"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-baseline">
                  <div>
                    <label className="text-foreground font-medium block">Dynamic EQ</label>
                    <span className="text-xs text-muted-foreground">Tame harsh resonances</span>
                  </div>
                  <span className="font-mono text-primary text-sm">{(mastering.dynamicEqAmount * 100).toFixed(0)}%</span>
                </div>
                <Slider 
                  value={[mastering.dynamicEqAmount]} min={0} max={1} step={0.01} 
                  onValueChange={v => setMastering({...mastering, dynamicEqAmount: v[0], genreId: null})}
                  className="[&_[role=slider]]:border-purple-500 [&_[role=slider]]:bg-purple-500"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-baseline">
                  <div>
                    <label className="text-foreground font-medium block">Exciter</label>
                    <span className="text-xs text-muted-foreground">Warmth & Air</span>
                  </div>
                  <span className="font-mono text-primary text-sm">{(mastering.exciterAmount * 100).toFixed(0)}%</span>
                </div>
                <Slider 
                  value={[mastering.exciterAmount]} min={0} max={1} step={0.01} 
                  onValueChange={v => setMastering({...mastering, exciterAmount: v[0], genreId: null})}
                  className="[&_[role=slider]]:border-amber-500 [&_[role=slider]]:bg-amber-500"
                />
              </div>
            </div>

            <div className="w-full h-px bg-border/50" />

            {/* Target LUFS */}
            <div className="space-y-4">
              <label className="text-sm font-medium text-foreground uppercase tracking-wider">Delivery Target (LUFS)</label>
              <Select 
                value={mastering.targetLufs.toString()} 
                onValueChange={v => setMastering({...mastering, targetLufs: parseInt(v), genreId: null})}
              >
                <SelectTrigger className="h-14 bg-background border-border">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">
                      {mastering.targetLufs === -14 ? 'Spotify / YouTube / Tidal' : 
                       mastering.targetLufs === -16 ? 'Apple Music / Podcasts' : 
                       mastering.targetLufs === -23 ? 'EBU R128 (Broadcast)' : 'Custom Target'}
                    </span>
                    <span className="text-primary text-xs font-mono">{mastering.targetLufs} LUFS</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-14">-14 LUFS (Spotify/YouTube/Tidal)</SelectItem>
                  <SelectItem value="-16">-16 LUFS (Apple Music/Podcasts)</SelectItem>
                  <SelectItem value="-23">-23 LUFS (EBU R128 Broadcast)</SelectItem>
                  <SelectItem value="-9">-9 LUFS (Aggressive Club Master)</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}