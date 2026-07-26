import { useParams, Link } from 'wouter';
import { getPlugin } from '@/plugins/registry';
import { PluginWindow } from '@/components/plugin/PluginWindow';
import { ArrowLeft } from 'lucide-react';

export default function PluginHost() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const plugin = pluginId ? getPlugin(pluginId) : undefined;

  if (!plugin || !plugin.available) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center space-y-4">
        <h1 className="font-serif text-3xl text-foreground mt-16">
          {plugin ? `${plugin.name} is coming soon` : 'Plugin not found'}
        </h1>
        <p className="text-muted-foreground">
          {plugin ? plugin.description : 'This plugin does not exist.'}
        </p>
        <Link href="/plugins" className="inline-flex items-center gap-2 text-[#E8A030] hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to plugins
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-4 animate-in fade-in duration-500">
      <Link href="/plugins" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> All plugins
      </Link>
      {/* key remounts the shell (and its audio engine) when switching plugins */}
      <PluginWindow key={plugin.id} definition={plugin} />
      <p className="text-xs text-muted-foreground max-w-2xl">{plugin.description}</p>
    </div>
  );
}
