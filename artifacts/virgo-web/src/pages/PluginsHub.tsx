import { Link } from 'wouter';
import { listPlugins } from '@/plugins/registry';
import type { PluginDefinition } from '@/lib/plugin-engine/types';
import { Sparkles, Wrench } from 'lucide-react';

const GOLD = '#E8A030';

export default function PluginsHub() {
  const plugins = listPlugins();
  const mastering = plugins.filter((p) => p.category === 'mastering');
  const restoration = plugins.filter((p) => p.category === 'restoration');

  return (
    <div className="p-8 max-w-6xl mx-auto w-full space-y-10 animate-in fade-in duration-500">
      <header>
        <h1 className="font-serif text-4xl text-foreground mb-2">Plugins</h1>
        <p className="text-muted-foreground">
          Studio-grade mastering and restoration modules. Load audio, process in real time, export the result.
        </p>
      </header>

      <Section title="Mastering" icon={<Sparkles className="w-5 h-5" style={{ color: GOLD }} />} plugins={mastering} />
      <Section title="Restoration" icon={<Wrench className="w-5 h-5" style={{ color: GOLD }} />} plugins={restoration} />
    </div>
  );
}

function Section({ title, icon, plugins }: { title: string; icon: React.ReactNode; plugins: PluginDefinition[] }) {
  return (
    <section>
      <h2 className="text-2xl font-serif text-foreground mb-5 flex items-center gap-2">
        {icon} {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {plugins.map((p) => <PluginTile key={p.id} plugin={p} />)}
      </div>
    </section>
  );
}

function PluginTile({ plugin }: { plugin: PluginDefinition }) {
  const inner = (
    <div
      className={`relative rounded-lg border overflow-hidden transition-all duration-300 h-44 flex flex-col ${
        plugin.available
          ? 'border-[#3A3A3A] hover:border-[#E8A030]/70 hover:shadow-lg hover:shadow-[#E8A030]/10 cursor-pointer'
          : 'border-[#242424] opacity-60'
      }`}
      style={{ background: 'linear-gradient(160deg,#191919 0%,#0F0F0F 65%)' }}
    >
      {/* tile artwork: gold waveform arcs */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 200 100">
        <path d="M0 78 Q 50 58 100 74 T 200 70" fill="none" stroke={GOLD} strokeOpacity="0.18" strokeWidth="1.5" />
        <path d="M0 86 Q 60 70 120 82 T 200 80" fill="none" stroke={GOLD} strokeOpacity="0.10" strokeWidth="1" />
        <circle cx="168" cy="24" r="30" fill="none" stroke={GOLD} strokeOpacity="0.07" strokeWidth="8" />
      </svg>

      <div className="relative p-4 flex flex-col h-full">
        <div className="flex items-center justify-between">
          <div className="w-7 h-7 rounded-sm flex items-center justify-center border border-[#E8A030]/40 bg-[#E8A030]/10">
            <span className="text-[10px] font-bold" style={{ color: GOLD }}>VA</span>
          </div>
          {!plugin.available && (
            <span className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-[#333] text-muted-foreground">
              Coming soon
            </span>
          )}
        </div>
        <div className="mt-auto">
          <h3 className="font-semibold text-foreground">{plugin.name}</h3>
          <p className="text-xs mt-0.5" style={{ color: GOLD }}>{plugin.tagline}</p>
          <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{plugin.description}</p>
        </div>
      </div>
    </div>
  );

  return plugin.available ? <Link href={`/plugins/${plugin.id}`}>{inner}</Link> : inner;
}
