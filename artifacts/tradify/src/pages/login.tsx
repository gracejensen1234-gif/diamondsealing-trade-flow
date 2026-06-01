import { FormEvent, useState } from "react";
import { Lock, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { login, setupStatus } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.ok) setError(result.error ?? "Could not sign in");
  };

  return (
    <main className="min-h-screen bg-sidebar text-sidebar-foreground sm:bg-[radial-gradient(circle_at_top_left,_rgba(255,122,0,0.25),_transparent_30%),linear-gradient(135deg,#050505,#2a2a2a_58%,#050505)]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-14 w-14 overflow-hidden rounded-md border border-white/15 bg-black shadow-sm">
            <img src="/diamond-sealing-logo.jpeg" alt="Company logo" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Operations App</h1>
            <p className="text-sm text-white/65">Operations login</p>
          </div>
        </div>

        <Card className="border-white/10 bg-background/95 shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Sign in
            </CardTitle>
          </CardHeader>
          <CardContent>
            {setupStatus && !setupStatus.configured ? (
              <div className="mb-4 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-950">
                Login needs admin environment variables on Render before the app can be used live.
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" className="h-11 w-full" disabled={submitting}>
                <LogIn className="mr-2 h-4 w-4" />
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
