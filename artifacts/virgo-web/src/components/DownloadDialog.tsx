import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Download, Loader2, CheckCircle2 } from 'lucide-react';
import {
  fetchAndDecodeAudio,
  renderWithEffects,
  encodeToWav,
  downloadBlob,
  OUTPUT_FORMATS,
  OutputFormat,
  EqBand,
  MasteringParams,
  WavBitDepth,
} from '@/lib/audio-encoder';
import { toast } from 'sonner';

export interface DownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Either pass a URL (server-hosted file) or an already-decoded AudioBuffer */
  audioSource:
    | { type: 'url'; url: string }
    | { type: 'buffer'; buffer: AudioBuffer };
  filename: string; // base name without extension
  eqBands: EqBand[];
  mastering: MasteringParams;
}

const STEP_LABELS: Record<string, string> = {
  idle:      '',
  loading:   'Loading audio…',
  rendering: 'Applying effects…',
  encoding:  'Encoding…',
  done:      'Complete!',
};

export function DownloadDialog({
  open,
  onOpenChange,
  audioSource,
  filename,
  eqBands,
  mastering,
}: DownloadDialogProps) {
  const [format, setFormat]       = useState<OutputFormat>('wav-24');
  const [progress, setProgress]   = useState(0);
  const [step, setStep]           = useState<'idle'|'loading'|'rendering'|'encoding'|'done'>('idle');

  const isProcessing = step !== 'idle' && step !== 'done';

  const reset = () => { setProgress(0); setStep('idle'); };

  const handleExport = useCallback(async () => {
    try {
      // ── 1. Get AudioBuffer ─────────────────────────────────────────────
      let buffer: AudioBuffer;
      if (audioSource.type === 'buffer') {
        buffer = audioSource.buffer;
        setStep('rendering');
        setProgress(15);
      } else {
        setStep('loading');
        setProgress(5);
        buffer = await fetchAndDecodeAudio(audioSource.url);
        setProgress(20);
        setStep('rendering');
      }

      // ── 2. Render through effects ──────────────────────────────────────
      const rendered = await renderWithEffects(
        buffer,
        eqBands,
        mastering,
        (pct) => setProgress(20 + pct * 0.65)
      );

      // ── 3. Encode to WAV ───────────────────────────────────────────────
      setStep('encoding');
      setProgress(88);
      const bitDepth: WavBitDepth = format === 'wav-16' ? 16 : format === 'wav-24' ? 24 : 32;
      const blob = encodeToWav(rendered, bitDepth);

      setProgress(98);

      // ── 4. Download ────────────────────────────────────────────────────
      const suffix = format === 'wav-16' ? '' : format === 'wav-24' ? '_24bit' : '_32f';
      downloadBlob(blob, `${filename}${suffix}_mastered.wav`);

      setStep('done');
      setProgress(100);

      setTimeout(() => {
        onOpenChange(false);
        reset();
        toast.success('Download started!');
      }, 900);
    } catch (err) {
      toast.error('Export failed', { description: String(err) });
      reset();
    }
  }, [audioSource, eqBands, mastering, format, filename, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : (v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Export Mastered Audio
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-5">
          <p className="text-sm text-muted-foreground">
            Your EQ and mastering settings will be baked into the exported file.
          </p>

          <RadioGroup
            value={format}
            onValueChange={(v) => !isProcessing && setFormat(v as OutputFormat)}
            className="space-y-2"
          >
            {OUTPUT_FORMATS.map((f) => (
              <label
                key={f.value}
                htmlFor={f.value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                  ${format === f.value
                    ? 'border-primary bg-primary/8 text-foreground'
                    : 'border-border hover:border-primary/40 text-muted-foreground'
                  }`}
              >
                <RadioGroupItem value={f.value} id={f.value} />
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${format === f.value ? 'text-foreground' : ''}`}>
                    {f.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                </div>
              </label>
            ))}
          </RadioGroup>

          {/* Progress */}
          {step !== 'idle' && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {step === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                  {STEP_LABELS[step]}
                </span>
                <span className="font-mono">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { reset(); onOpenChange(false); }}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isProcessing}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isProcessing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing…</>
            ) : (
              <><Download className="w-4 h-4 mr-2" /> Export</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
