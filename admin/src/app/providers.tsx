"use client";

import {
  QueryClient,
  QueryClientProvider as TanStackProvider,
} from "@tanstack/react-query";
import { useState } from "react";

export function QueryClientProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 60 * 1000,
          },
        },
      }),
  );

  return <TanStackProvider client={queryClient}>{children}</TanStackProvider>;
}
