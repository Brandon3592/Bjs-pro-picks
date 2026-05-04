import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  LayoutDashboard,
  TrendingUp,
  Activity,
  BookOpen,
  Settings,
  Zap,
  Users,
  Globe,
  Menu,
  X,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/all-markets", label: "All Markets", icon: Globe },
  { href: "/value-bets", label: "Value Bets", icon: TrendingUp },
  { href: "/props", label: "Player Props", icon: Users },
  { href: "/arb", label: "Arb Finder", icon: Zap },
  { href: "/games", label: "Games", icon: Activity },
  { href: "/tracker", label: "Bet Tracker", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLink({ href, label, icon: Icon, onClick }: { href: string; label: string; icon: React.ElementType; onClick?: () => void }) {
  const [location] = useLocation();
  const isActive = location === href;
  return (
    <Link href={href} onClick={onClick}>
      <div
        data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer group",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-accent-foreground")} />
        <span className="flex-1">{label}</span>
        {isActive && <ChevronRight className="h-3 w-3 text-primary" />}
      </div>
    </Link>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout, isAuthenticated } = useAuth();
  const initials = user?.name ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : "EF";

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
            <TrendingUp className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sidebar-foreground tracking-tight">EdgeFinder</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} onClick={onClose} />
        ))}
      </nav>

      {/* Disclaimer */}
      <div className="px-3 py-2 mx-2 mb-2 rounded bg-muted/50 border border-border">
        <p className="text-[10px] text-muted-foreground leading-snug">
          For entertainment only. Bet responsibly.
        </p>
      </div>

      {/* User */}
      {isAuthenticated && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-sidebar-border">
          <Avatar className="h-7 w-7 flex-shrink-0">
            <AvatarImage src={user?.profileImage} />
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name || "User"}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={logout} data-testid="button-logout">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthenticated, isLoading, login } = useAuth();
  const [location] = useLocation();

  if (!isLoading && !isAuthenticated) {
    login();
    return null;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-60 flex flex-col shadow-2xl">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
          <button onClick={() => setMobileOpen(true)} data-testid="button-menu">
            <Menu className="h-5 w-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-primary flex items-center justify-center">
              <TrendingUp className="h-3 w-3 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm tracking-tight">EdgeFinder</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 flex">
        {NAV_ITEMS.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className="flex-1">
              <div className={cn(
                "flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                <Icon className="h-4 w-4" />
                <span>{item.label.split(" ")[0]}</span>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
