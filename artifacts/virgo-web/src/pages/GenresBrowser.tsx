import { useListMasteringGenres } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ListMusic, SlidersHorizontal, ActivitySquare, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function GenresBrowser() {
  const { data: genres, isLoading } = useListMasteringGenres();

  return (
    <div className="p-8 max-w-6xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <header className="mb-10">
        <h1 className="font-serif text-4xl text-foreground mb-3 flex items-center gap-3">
          <ListMusic className="w-8 h-8 text-primary" />
          Mastering Styles
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Curated mastering profiles tailored for specific genres and distribution platforms.
          Each style balances dynamics, EQ, and harmonic excitement differently.
        </p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="h-48 animate-pulse bg-card border-border" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {genres?.map(genre => (
            <Card key={genre.id} className="bg-card border-border hover:border-primary/30 transition-all duration-300 flex flex-col h-full hover:shadow-lg hover:shadow-primary/5">
              <CardHeader className="pb-4 border-b border-border/50 bg-background/50">
                <div className="flex justify-between items-start mb-2">
                  <CardTitle className="text-2xl font-serif text-foreground">
                    {genre.name}
                  </CardTitle>
                  <Badge variant="secondary" className="bg-primary/10 text-primary border border-primary/20">
                    {genre.character}
                  </Badge>
                </div>
                <CardDescription className="text-muted-foreground text-base">
                  {genre.description}
                </CardDescription>
              </CardHeader>
              
              <CardContent className="pt-6 flex-grow">
                <div className="grid grid-cols-2 gap-y-6 gap-x-8">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                      <span className="flex items-center gap-1.5"><SlidersHorizontal className="w-4 h-4" /> Compression</span>
                      <span className="text-foreground font-mono">{(genre.compressionAmount * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500/80 rounded-full" style={{ width: `${genre.compressionAmount * 100}%` }} />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                      <span className="flex items-center gap-1.5"><ActivitySquare className="w-4 h-4" /> Dynamic EQ</span>
                      <span className="text-foreground font-mono">{(genre.dynamicEqAmount * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500/80 rounded-full" style={{ width: `${genre.dynamicEqAmount * 100}%` }} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                      <span className="flex items-center gap-1.5"><SparklesIcon className="w-4 h-4" /> Exciter</span>
                      <span className="text-foreground font-mono">{(genre.exciterAmount * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500/80 rounded-full" style={{ width: `${genre.exciterAmount * 100}%` }} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                      <span className="flex items-center gap-1.5"><Target className="w-4 h-4" /> Target LUFS</span>
                      <span className="text-foreground font-mono font-medium">{genre.targetLufs}</span>
                    </div>
                    <div className="w-full h-1.5 bg-background rounded-full overflow-hidden relative">
                       {/* LUFS visualization scale is roughly -24 to -6 */}
                      <div 
                        className="h-full bg-emerald-500/80 rounded-full absolute right-0" 
                        style={{ width: `${Math.max(0, Math.min(100, (genre.targetLufs + 24) / 18 * 100))}%` }} 
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/>
      <path d="M19 17v4"/>
      <path d="M3 5h4"/>
      <path d="M17 19h4"/>
    </svg>
  )
}
