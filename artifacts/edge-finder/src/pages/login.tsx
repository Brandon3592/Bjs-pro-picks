import { useEffect, useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      login();
    }
  }, [isAuthenticated, isLoading, login]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-foreground font-mono">
      <div className="w-full max-w-md p-8 border border-border bg-card shadow-2xl rounded-sm text-center">
        <h1 className="text-3xl font-bold tracking-tight mb-2 text-primary">EdgeFinder</h1>
        <p className="text-muted-foreground mb-8">Data-dense betting intelligence terminal.</p>
        
        {isLoading ? (
          <div className="animate-pulse bg-muted h-10 w-full rounded" />
        ) : (
          <Button onClick={login} className="w-full font-mono font-bold tracking-wider" size="lg">
            AUTHENTICATE
          </Button>
        )}
      </div>
    </div>
  );
}
