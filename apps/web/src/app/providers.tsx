"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { isApiError } from "@/lib/api";

const PUBLIC_PATHS = ["/login", "/signup"];

// An expired or revoked session on any request sends the user back to login, keeping their place.
function onError(err: unknown) {
  if (!isApiError(err, 401) || PUBLIC_PATHS.includes(window.location.pathname)) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            // Client errors (404, 403, validation) will not fix themselves; network and 5xx might.
            retry: (count, err) => count < 2 && !(isApiError(err) && err.status >= 400 && err.status < 500),
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
