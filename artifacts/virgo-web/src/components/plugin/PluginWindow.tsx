import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useListPluginPresets,
  useCreatePluginPreset,
  useUpdatePluginPreset,
  useDeletePluginPreset,
  getListPluginPresetsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Play, Pause, Square, Repeat, UploadCloud, Download, Loader2,
  Power, ChevronDown, Save, Trash2, Pencil, Check, X,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PluginAudioEngine } from '@/lib/plugin-engine/engine';
import { encodeToWav, downloadBlob, fmtDuration, WavBitDepth } from '@/lib/audio-encoder';
import { encodeToMp3 } from '@/lib/plugin-engine/mp3-encoder';
import { defaultParams, PluginDefinition } from '@/lib/plugin-engine/types';
import { Knob } from './Knob';
import { Fader } from './Fader';
import { LedMeter } from './LedMeter';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';

const GOLD = '#E8A030';

export interface PluginWindowProps {
  definition: PluginDefinition;
}

/**
 * Reusable iZotope-style plugin window shell: header (title, preset dropdown,
 * A/B compare, bypass), I/O gain + LED meter rails, transport/export footer,
 * and a central slot for the plugin's visualization & controls.
 */
export function PluginWindow({ definition }: PluginWindowProps) {
  const queryClient = useQueryClient();
  const [params, setParams] = useState<Record<string, number>>(() => defaultParams(definition));
  const [bypass, setBypass] = useState(false);
  const [inGainDb, setInGainDb] = useState(0);
  const [outGainDb, setOutGainDb] = useState(0);
  const [presetName, setPresetName] = useState('Default');

  // A/B compare
  const [slot, setSlot] = useState<'A' | 'B'>('A');
  const slotsRef = useRef<{ A: Record<string, number>; B: Record<string, number> }>({
    A: defaultParams(definition),
    B: defaultParams(definition),
  });

  // Engine
  const engineRef = useRef<PluginAudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PluginAudioEngine(definition.kernelCode ?? PASSTHROUGH_KERNEL, params);
  }
  const engine = engineRef.current;

  const [fileName, setFileName] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false); // triggers analyser re-render
  const [exporting, setExporting] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // User presets
  const { data: userPresets } = useListPluginPresets({ pluginId: definition.id });
  const createPreset = useCreatePluginPreset();
  const updatePreset = useUpdatePluginPreset();
  const deletePreset = useDeletePluginPreset();
  const invalidatePresets = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListPluginPresetsQueryKey({ pluginId: definition.id }) });
  }, [queryClient, definition.id]);

  useEffect(() => {
    engine.onEnded = () => setIsPlaying(false);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position polling
  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => setPosition(engine.position), 100);
    return () => clearInterval(t);
  }, [isPlaying, engine]);

  const setParam = useCallback((id: string, value: number) => {
    setParams((prev) => {
      const next = { ...prev, [id]: value };
      slotsRef.current[slot] = next;
      return next;
    });
    engine.setParam(id, value);
  }, [engine, slot]);

  const applyParams = useCallback((next: Record<string, number>, name?: string) => {
    setParams(next);
    slotsRef.current[slot] = next;
    engine.setParams(next);
    if (name) setPresetName(name);
  }, [engine, slot]);

  const switchSlot = (target: 'A' | 'B') => {
    if (target === slot) return;
    slotsRef.current[slot] = params;
    setSlot(target);
    const next = slotsRef.current[target];
    setParams(next);
    engine.setParams(next);
  };

  const copySlot = () => {
    const other = slot === 'A' ? 'B' : 'A';
    slotsRef.current[other] = { ...params };
    toast.success(`Copied ${slot} → ${other}`);
  };

  // ── Transport ─────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    try {
      const buf = await engine.loadFile(file);
      setFileName(file.name);
      setDuration(buf.duration);
      setPosition(0);
      setIsPlaying(false);
      setAudioReady(true);
      engine.setParams(params);
      engine.setBypass(bypass);
      engine.setInputGainDb(inGainDb);
      engine.setOutputGainDb(outGainDb);
    } catch (err) {
      console.error('[plugin] load failed', err);
      toast.error('Could not decode this audio file.');
    }
  };

  const togglePlay = async () => {
    if (!fileName) return;
    if (isPlaying) {
      engine.pause();
      setIsPlaying(false);
    } else {
      try {
        await engine.play();
        setIsPlaying(true);
        setAudioReady(true);
      } catch (err) {
        console.error('[plugin] play failed', err);
        toast.error('Playback failed to start.');
      }
    }
  };

  const stop = () => {
    engine.stop();
    setIsPlaying(false);
    setPosition(0);
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const doExport = async (format: 'wav-16' | 'wav-24' | 'wav-32f' | 'mp3') => {
    if (!fileName) return;
    setExporting(format);
    try {
      const rendered = await engine.renderOffline();
      const base = fileName.replace(/\.[^.]+$/, '');
      if (format === 'mp3') {
        const blob = encodeToMp3(rendered);
        downloadBlob(blob, `${base} - ${definition.name}.mp3`);
      } else {
        const depth: WavBitDepth = format === 'wav-16' ? 16 : format === 'wav-24' ? 24 : 32;
        const blob = encodeToWav(rendered, depth);
        downloadBlob(blob, `${base} - ${definition.name}.wav`);
      }
      toast.success('Export complete');
    } catch (err) {
      console.error(err);
      toast.error('Export failed');
    } finally {
      setExporting(null);
    }
  };

  // ── Presets ───────────────────────────────────────────────────────────────
  const saveNewPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    createPreset.mutate(
      { data: { pluginId: definition.id, name, params } },
      {
        onSuccess: () => {
          invalidatePresets();
          setPresetName(name);
          setSaveDialogOpen(false);
          setNewPresetName('');
          toast.success(`Preset “${name}” saved`);
        },
        onError: () => toast.error('Failed to save preset'),
      }
    );
  };

  const commitRename = (id: number) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name) return;
    updatePreset.mutate(
      { id, data: { name } },
      { onSuccess: () => invalidatePresets(), onError: () => toast.error('Rename failed') }
    );
  };

  const Controls = definition.Controls;

  return (
    <div className="rounded-lg overflow-hidden border border-[#2A2A2A] shadow-2xl shadow-black/60" style={{ background: '#0F0F0F' }}>
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 h-12 px-4 border-b border-[#2A2A2A]" style={{ background: 'linear-gradient(180deg,#1C1C1C,#121212)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-sm flex items-center justify-center border border-[#E8A030]/40 bg-[#E8A030]/10 flex-shrink-0">
            <span className="text-[10px] font-bold" style={{ color: GOLD }}>VA</span>
          </div>
          <span className="font-semibold tracking-wide text-sm text-foreground truncate">{definition.name}</span>
          <span className="hidden md:inline text-[10px] uppercase tracking-widest text-muted-foreground border-l border-[#333] pl-2 ml-1">
            {definition.category}
          </span>
        </div>

        <div className="flex-1" />

        {/* Preset dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 h-8 px-3 rounded-sm border border-[#333] bg-[#181818] text-xs text-foreground hover:border-[#E8A030]/50 transition-colors max-w-[220px]">
              <span className="truncate">{presetName}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 bg-[#161616] border-[#2E2E2E]">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Factory</DropdownMenuLabel>
            {definition.factoryPresets.map((p) => (
              <DropdownMenuItem key={p.name} onClick={() => applyParams({ ...defaultParams(definition), ...p.params }, p.name)}>
                {p.name}
              </DropdownMenuItem>
            ))}
            {definition.factoryPresets.length === 0 && (
              <DropdownMenuItem disabled>No factory presets</DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-[#2A2A2A]" />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">User</DropdownMenuLabel>
            {(userPresets ?? []).map((p) => (
              <div key={p.id} className="flex items-center group/preset">
                {renamingId === p.id ? (
                  <div className="flex items-center gap-1 px-2 py-1 w-full" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(p.id); if (e.key === 'Escape') setRenamingId(null); }}
                      className="h-6 text-xs bg-[#101010]"
                      autoFocus
                    />
                    <button className="p-1 text-green-500" onClick={() => commitRename(p.id)}><Check className="w-3 h-3" /></button>
                    <button className="p-1 text-muted-foreground" onClick={() => setRenamingId(null)}><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <>
                    <DropdownMenuItem
                      className="flex-1"
                      onClick={() => applyParams({ ...defaultParams(definition), ...(p.params as Record<string, number>) }, p.name)}
                    >
                      {p.name}
                    </DropdownMenuItem>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-foreground opacity-0 group-hover/preset:opacity-100"
                      onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameText(p.name); }}
                      title="Rename"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      className="p-1.5 mr-1 text-muted-foreground hover:text-destructive opacity-0 group-hover/preset:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePreset.mutate({ id: p.id }, { onSuccess: () => invalidatePresets() });
                      }}
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
            {(userPresets ?? []).length === 0 && (
              <DropdownMenuItem disabled className="text-muted-foreground">No user presets yet</DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-[#2A2A2A]" />
            <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
              <Save className="w-3.5 h-3.5 mr-2" /> Save current as…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* A/B compare */}
        <div className="flex items-center rounded-sm overflow-hidden border border-[#333]">
          {(['A', 'B'] as const).map((s) => (
            <button
              key={s}
              onClick={() => switchSlot(s)}
              className={`w-7 h-8 text-xs font-semibold transition-colors ${
                slot === s ? 'bg-[#E8A030] text-black' : 'bg-[#181818] text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={copySlot}
            className="px-2 h-8 text-[10px] bg-[#181818] text-muted-foreground hover:text-foreground border-l border-[#333]"
            title={`Copy ${slot} to ${slot === 'A' ? 'B' : 'A'}`}
          >
            →{slot === 'A' ? 'B' : 'A'}
          </button>
        </div>

        {/* Bypass */}
        <button
          onClick={() => { const b = !bypass; setBypass(b); engine.setBypass(b); }}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-sm border text-xs font-medium transition-all ${
            bypass
              ? 'border-[#555] bg-[#222] text-muted-foreground'
              : 'border-[#E8A030]/60 bg-[#E8A030]/10 text-[#E8A030] shadow-[0_0_10px_rgba(232,160,48,0.15)]'
          }`}
          title={bypass ? 'Plugin bypassed — click to enable' : 'Plugin active — click to bypass'}
        >
          <Power className="w-3.5 h-3.5" />
          {bypass ? 'Bypassed' : 'Active'}
        </button>
      </div>

      {/* ── Body: input rail | center | output rail ────────────────────────── */}
      <div className="flex" key={audioReady ? 'ready' : 'idle'}>
        {/* Input rail */}
        <div className="w-24 flex-shrink-0 flex flex-col items-center gap-3 py-5 px-2 border-r border-[#242424] bg-[#111]">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Input</span>
          <div className="flex items-start gap-2">
            <LedMeter analyser={engine.inputAnalyser} height={170} />
            <Fader value={inGainDb} min={-24} max={24} defaultValue={0} height={170}
              onChange={(v) => { setInGainDb(v); engine.setInputGainDb(v); }} />
          </div>
        </div>

        {/* Center visualization / controls */}
        <div className="flex-1 min-w-0 p-5 space-y-5">
          {Controls ? (
            <Controls
              params={params}
              setParam={setParam}
              analyser={engine.outputAnalyser}
              inputAnalyser={engine.inputAnalyser}
              analyserL={engine.outputAnalyserL}
              analyserR={engine.outputAnalyserR}
              definition={definition}
            />
          ) : (
            <>
              <SpectrumAnalyzer analyser={engine.outputAnalyser} referenceAnalyser={engine.inputAnalyser} height={230} />
              <div className="flex flex-wrap items-end justify-center gap-x-8 gap-y-5 pt-1">
                {definition.params.map((p) => (
                  <Knob
                    key={p.id}
                    value={params[p.id] ?? p.default}
                    min={p.min}
                    max={p.max}
                    defaultValue={p.default}
                    step={p.step}
                    log={p.scale === 'log'}
                    label={p.label}
                    unit={p.unit}
                    format={p.format}
                    size={64}
                    onChange={(v) => setParam(p.id, v)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Output rail */}
        <div className="w-24 flex-shrink-0 flex flex-col items-center gap-3 py-5 px-2 border-l border-[#242424] bg-[#111]">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Output</span>
          <div className="flex items-start gap-2">
            <Fader value={outGainDb} min={-24} max={24} defaultValue={0} height={170}
              onChange={(v) => { setOutGainDb(v); engine.setOutputGainDb(v); }} />
            <LedMeter analyser={engine.outputAnalyser} height={170} />
          </div>
        </div>
      </div>

      {/* ── Footer: transport + export ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-[#2A2A2A] bg-[#131313]">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".mp3,.wav,.m4a,.flac,.aac,.aiff,.aif,.ogg,.opus,.webm"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-[#333] bg-[#181818] hover:border-[#E8A030]/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="w-4 h-4" />
          {fileName ? <span className="max-w-[140px] truncate">{fileName}</span> : 'Load Audio'}
        </Button>

        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!fileName} onClick={togglePlay}>
            {isPlaying ? <Pause className="w-4 h-4 text-[#E8A030]" /> : <Play className="w-4 h-4 text-[#E8A030]" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!fileName} onClick={stop}>
            <Square className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={`h-8 w-8 ${loop ? 'text-[#E8A030]' : 'text-muted-foreground'}`}
            disabled={!fileName}
            onClick={() => { const l = !loop; setLoop(l); engine.setLoop(l); }}
            title="Loop"
          >
            <Repeat className="w-4 h-4" />
          </Button>
        </div>

        {/* Seek bar */}
        <div className="flex items-center gap-2 flex-1 min-w-[160px]">
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{fmtDuration(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.05}
            value={Math.min(position, duration)}
            disabled={!fileName}
            onChange={(e) => { const t = Number(e.target.value); engine.seek(t); setPosition(t); }}
            className="flex-1 h-1 accent-[#E8A030] cursor-pointer"
          />
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{fmtDuration(duration)}</span>
        </div>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={!fileName || exporting !== null} className="gap-2 bg-[#E8A030] text-black hover:bg-[#E8A030]/90">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-[#161616] border-[#2E2E2E]">
            <DropdownMenuItem onClick={() => doExport('wav-16')}>WAV 16-bit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => doExport('wav-24')}>WAV 24-bit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => doExport('wav-32f')}>WAV 32-bit float</DropdownMenuItem>
            <DropdownMenuItem onClick={() => doExport('mp3')}>MP3 320 kbps</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Save preset dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="bg-[#141414] border-[#2E2E2E] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Save preset</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Preset name"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNewPreset(); }}
            autoFocus
            className="bg-[#101010]"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={saveNewPreset}
              disabled={!newPresetName.trim() || createPreset.isPending}
              className="bg-[#E8A030] text-black hover:bg-[#E8A030]/90"
            >
              {createPreset.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PASSTHROUGH_KERNEL = `
() => ({
  process(input, output) {
    for (let c = 0; c < output.length; c++) {
      const src = input[Math.min(c, input.length - 1)];
      if (src) output[c].set(src);
    }
  }
})
`;
