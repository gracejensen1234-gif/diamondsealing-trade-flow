import { FormEvent, useState } from "react";
import { Building2, HardHat, Lock, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneSetupCard } from "@/components/phone-setup-card";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { login, register, setupStatus } = useAuth();
  const [mode, setMode] = useState<"login" | "company" | "employee">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [name, setName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.ok) setError(result.error ?? "Could not sign in");
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await register({
      accountType: mode === "company" ? "company" : "worker",
      companyName: mode === "company" ? companyName : undefined,
      companyCode: mode === "employee" ? companyCode : undefined,
      name,
      email: registerEmail,
      password: registerPassword,
    });
    setSubmitting(false);
    if (!result.ok) setError(result.error ?? "Could not create account");
  };

  const switchMode = (nextMode: "login" | "company" | "employee") => {
    setMode(nextMode);
    setError("");
  };

  const isRegistering = mode === "company" || mode === "employee";
  const registerTitle = mode === "company" ? "Create company account" : "Create employee/subcontractor account";
  const submitText = mode === "login" ? "Sign in" : registerTitle;

  return (
    <main className="min-h-screen bg-sidebar text-sidebar-foreground sm:bg-[radial-gradient(circle_at_top_left,_rgba(255,122,0,0.25),_transparent_30%),linear-gradient(135deg,#050505,#2a2a2a_58%,#050505)]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-14 w-14 overflow-hidden rounded-md border border-white/15 bg-black shadow-sm">
            <img src="/diamond-sealing-logo.jpeg" alt="Company logo" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SealFlow</h1>
            <p className="text-sm text-white/65">Operations platform</p>
          </div>
        </div>

        <Card className="border-white/10 bg-background/95 shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              {mode === "login" ? (
                <ShieldCheck className="h-5 w-5 text-primary" />
              ) : mode === "company" ? (
                <Building2 className="h-5 w-5 text-primary" />
              ) : (
                <HardHat className="h-5 w-5 text-primary" />
              )}
              {mode === "login" ? "Sign in" : registerTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-5 grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-1">
              <Button
                type="button"
                variant={mode === "login" ? "default" : "ghost"}
                className="h-9"
                onClick={() => switchMode("login")}
              >
                <LogIn className="mr-2 h-4 w-4" />
                Sign in
              </Button>
              <Button
                type="button"
                variant={mode === "company" ? "default" : "ghost"}
                className="h-9"
                onClick={() => switchMode("company")}
              >
                <Building2 className="mr-2 h-4 w-4" />
                Company
              </Button>
              <Button
                type="button"
                variant={mode === "employee" ? "default" : "ghost"}
                className="h-9"
                onClick={() => switchMode("employee")}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Employee
              </Button>
            </div>

            {setupStatus && !setupStatus.configured ? (
              <div className="mb-4 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-950">
                Login needs a session secret on Render before the app can be used live.
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={mode === "login" ? handleLogin : handleRegister}>
              {isRegistering ? (
                <>
                  {mode === "company" ? (
                    <div className="space-y-2">
                      <Label htmlFor="companyName">Company name</Label>
                      <Input
                        id="companyName"
                        type="text"
                        autoComplete="organization"
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                        required
                      />
                    </div>
                  ) : null}
                  {mode === "employee" ? (
                    <div className="space-y-2">
                      <Label htmlFor="companyCode">Company code</Label>
                      <Input
                        id="companyCode"
                        type="text"
                        autoComplete="organization"
                        value={companyCode}
                        onChange={(event) => setCompanyCode(event.target.value)}
                        required
                      />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="name">{mode === "company" ? "Owner name" : "Your name"}</Label>
                    <Input
                      id="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </div>
                </>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor={mode === "login" ? "email" : "registerEmail"}>Email</Label>
                <Input
                  id={mode === "login" ? "email" : "registerEmail"}
                  type="email"
                  autoComplete="email"
                  value={mode === "login" ? email : registerEmail}
                  onChange={(event) => (mode === "login" ? setEmail(event.target.value) : setRegisterEmail(event.target.value))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={mode === "login" ? "password" : "registerPassword"}>Password</Label>
                <Input
                  id={mode === "login" ? "password" : "registerPassword"}
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={mode === "login" ? password : registerPassword}
                  onChange={(event) => (mode === "login" ? setPassword(event.target.value) : setRegisterPassword(event.target.value))}
                  required
                  minLength={isRegistering ? 6 : undefined}
                />
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" className="h-11 w-full" disabled={submitting}>
                {mode === "login" ? <LogIn className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                {submitting
                  ? mode === "login" ? "Signing in..." : "Creating account..."
                  : submitText}
              </Button>
            </form>
          </CardContent>
        </Card>

        <PhoneSetupCard className="mt-4 border-white/15 bg-background/95 text-foreground" />
      </div>
    </main>
  );
}
