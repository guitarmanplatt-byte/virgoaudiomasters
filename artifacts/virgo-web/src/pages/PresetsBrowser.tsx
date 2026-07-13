import { useListEqPresets } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Settings2, Activity, Radio, Mic, Film, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const categoryIcons: Record<string, React.ElementType> = {
  voice: Mic,
  music: Activity,
  podcast: Radio,
  broadcast: Radio,
  film: Film,
  restoration: Sparkles,
};

export default function PresetsBrowser() {
  const { data: presets, isLoading } = useListEqPresets();

  const groupedPresets = presets?.reduce((acc, preset) => {
    if (!acc[preset.category]) {
      acc[preset.category] = [];
    }
    acc[preset.category].push(preset);
    return acc;
  }, {} as Record<string, typeof presets>);

  return (
    <div className="p-8 max-w-6xl mx-auto w-full space-y-12 animate-in fade-in duration-500">
      <header>
        <h1 className="font-serif text-4xl text-foreground mb-3 flex items-center gap-3">
          <Settings2 className="w-8 h-8 text-primary" />
          Equalization Presets
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Precision-crafted EQ curves designed for specific audio contexts. 
          Use these as starting points for your mastering chain.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-8">
          {[1, 2].map(i => (
            <div key={i}>
              <div className="h-8 w-48 bg-card animate-pulse rounded mb-4" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(j => (
                  <Card key={j} className="h-40 animate-pulse bg-card border-border" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-12">
          {Object.entries(groupedPresets || {}).map(([category, categoryPresets]) => {
            const Icon = categoryIcons[category] || Settings2;
            return (
              <section key={category}>
                <h2 className="text-2xl font-serif text-foreground mb-6 flex items-center gap-2 capitalize border-b border-border pb-2">
                  <Icon className="w-5 h-5 text-primary" />
                  {category}
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {categoryPresets.map(preset => (
                    <Card key={preset.id} className="bg-card border-border hover:border-primary/50 transition-colors group">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start mb-2">
                          <CardTitle className="text-lg font-medium group-hover:text-primary transition-colors">
                            {preset.name}
                          </CardTitle>
                          <Badge variant="outline" className="bg-background">
                            {preset.bands.length} bands
                          </Badge>
                        </div>
                        <CardDescription className="text-muted-foreground">
                          {preset.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Mini abstract EQ curve visualization */}
                        <div className="h-12 w-full bg-background rounded border border-border relative overflow-hidden flex items-end px-2 pt-2">
                          <div className="absolute inset-0 opacity-20 pointer-events-none">
                            <div className="w-full h-full bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAiLz4KPHBhdGggZD0iTTAgMEw4IDhaTTAgOEw4IDBaIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMC41IiBzdHJva2Utb3BhY2l0eT0iMC4xIi8+Cjwvc3ZnPg==')] mix-blend-overlay" />
                          </div>
                          <div className="flex items-end justify-between w-full h-full gap-[2px]">
                            {preset.bands.map((band, idx) => {
                              // Rough height calc based on gain
                              const height = Math.max(10, Math.min(100, 50 + (band.gain * 5)));
                              return (
                                <div 
                                  key={idx} 
                                  className="w-full bg-primary/40 rounded-t-sm"
                                  style={{ height: `${height}%` }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}