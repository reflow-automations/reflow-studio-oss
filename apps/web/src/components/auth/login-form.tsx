"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, fieldMessageId } from "@/components/ui/field";
import { Banner, ErrorBanner } from "@/components/ui/banner";
import { STUDIO_NAME } from "@/components/brand/site";
import { cn } from "@/lib/utils/cn";

type Mode = "signin" | "signup" | "magic";
type Tab = "signin" | "signup";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

const HEADINGS: Record<Mode, { title: string; description: string }> = {
  signin: { title: "Welcome back", description: `Sign in to ${STUDIO_NAME}.` },
  signup: { title: "Create your account", description: "This is the account you will sign in with." },
  magic: { title: "Sign in with a link", description: "We e-mail you a one-time sign-in link." },
};

/**
 * Password sign-in, magic link, and (when allowed) account creation. The
 * mode switch is only rendered when there is more than one tab; it follows
 * the WAI-ARIA tabs pattern (roving tabindex, arrow keys, Home/End).
 */
export function LoginForm({ next, initialError, allowSignup = true }: { next: string; initialError?: string; allowSignup?: boolean }) {
  const router = useRouter();
  const baseId = useId();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs = TABS.filter((t) => allowSignup || t.id !== "signup");
  const showTabs = tabs.length > 1;
  const activeTab: Tab = mode === "signup" ? "signup" : "signin";
  const tabId = (id: Tab) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  const heading = HEADINGS[mode];

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (target === null) return;
    event.preventDefault();
    switchMode(tabs[target].id);
    tabRefs.current[target]?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const supabase = supabaseBrowser();
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        router.replace(next as Route);
        router.refresh();
        return;
      }
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
        if (err) throw err;
        if (data.session) {
          router.replace(next as Route);
          router.refresh();
          return;
        }
        setMessage("Account created. Check your inbox to confirm your e-mail address, then sign in.");
        return;
      }
      const { error: err } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: false } });
      if (err) throw err;
      setMessage("Sign-in link sent. Open it on this device to finish signing in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  const form = (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
      id={showTabs ? panelId : undefined}
      role={showTabs ? "tabpanel" : undefined}
      aria-labelledby={showTabs ? tabId(activeTab) : undefined}
    >
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-11 sm:h-10" />
      </Field>
      {mode !== "magic" ? (
        <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === "signup" ? fieldMessageId("password") : undefined}
              className="h-11 pr-11 sm:h-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-xs text-muted transition-colors hover:bg-hover hover:text-fg sm:size-8"
            >
              {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </Field>
      ) : null}

      {error ? <ErrorBanner title="Could not sign you in" message={error} /> : null}
      {message ? (
        <Banner tone="success" role="status">
          {message}
        </Banner>
      ) : null}

      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
        {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send sign-in link"}
      </Button>

      {mode === "magic" ? (
        <Button variant="ghost" size="md" onClick={() => switchMode("signin")} className="w-full">
          <KeyRound className="size-4" aria-hidden /> Use a password instead
        </Button>
      ) : (
        <Button variant="ghost" size="md" onClick={() => switchMode("magic")} className="w-full">
          <Mail className="size-4" aria-hidden /> E-mail me a sign-in link
        </Button>
      )}
    </form>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold text-fg">{heading.title}</h1>
        <p className="text-sm text-muted">{heading.description}</p>
      </div>

      {showTabs ? (
        <div role="tablist" aria-label="Account" className="grid grid-cols-2 gap-1 rounded-md border border-border bg-panel p-1">
          {tabs.map((t, index) => {
            const selected = activeTab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={tabId(t.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => switchMode(t.id)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                className={cn("h-9 rounded-sm text-[13px] font-medium transition-colors", selected ? "bg-elevated text-fg shadow-raised" : "text-muted hover:text-fg")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {form}
    </div>
  );
}
