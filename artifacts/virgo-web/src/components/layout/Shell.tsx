import { Link, useLocation } from 'wouter';
import { Settings2, Music, ListMusic, Home } from 'lucide-react';
import { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const links = [
    { href: '/', label: 'Dashboard', icon: Home },
    { href: '/presets', label: 'EQ Presets', icon: Settings2 },
    { href: '/genres', label: 'Mastering Styles', icon: ListMusic },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col z-10">
        <div className="h-16 flex items-center px-6 border-b border-border flex-shrink-0">
          <Link href="/" className="flex items-center gap-3">
            {/* SVG Constellation/V logo */}
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                <path d="M4 4l8 16 8-16" />
                <circle cx="4" cy="4" r="2" fill="currentColor" />
                <circle cx="20" cy="4" r="2" fill="currentColor" />
                <circle cx="12" cy="20" r="2" fill="currentColor" />
              </svg>
            </div>
            <span className="font-serif text-lg font-bold tracking-wide text-foreground">
              Virgo<span className="text-primary">Audio</span>Masters
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          {links.map((link) => {
            const active = location === link.href || (link.href !== '/' && location.startsWith(link.href));
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  active 
                    ? 'bg-primary/10 text-primary' 
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative bg-background">
        {children}
      </main>
    </div>
  );
}