"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-blue-400 border-t-transparent mx-auto" />
          <p className="text-sm text-slate-400">验证登录状态...</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
