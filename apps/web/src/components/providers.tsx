"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStudioStore } from "@/lib/client/store";
import { Toasts } from "@/components/ui/toasts";

export interface StudioWorkspace {
  id: string;
  slug: string;
  name: string;
  role: string;
}

/**
 * Who is signed in and which workspace they act in, passed down from the
 * (studio) layout. Client code reads it with useStudioSession() or
 * useWorkspaceId(), for example to subscribe to the realtime channel
 * `workspace:<id>`.
 */
export interface StudioSession {
  userId: string;
  email: string;
  /** Null while the account has no workspace membership yet. */
  workspace: StudioWorkspace | null;
  /** ENABLE_MOCK_PROVIDER is on: generations are simulated. */
  demoMode: boolean;
}

const StudioSessionContext = createContext<StudioSession | null>(null);

/** Session of the signed-in owner, or null outside the studio layout (login, public pages). */
export function useStudioSession(): StudioSession | null {
  return useContext(StudioSessionContext);
}

/** Current workspace id, or null when there is none (yet). */
export function useWorkspaceId(): string | null {
  return useContext(StudioSessionContext)?.workspace?.id ?? null;
}

export function Providers({ children, session = null }: { children: ReactNode; session?: StudioSession | null }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
        },
      }),
  );

  useEffect(() => {
    // Drafts are persisted in localStorage; hydrate after mount to avoid SSR mismatches.
    void useStudioStore.persist.rehydrate();
  }, []);

  return (
    <StudioSessionContext.Provider value={session}>
      <QueryClientProvider client={client}>
        {children}
        <Toasts />
      </QueryClientProvider>
    </StudioSessionContext.Provider>
  );
}
