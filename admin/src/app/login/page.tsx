export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-medium text-blue-600">Trend-Scope</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">管理端登录</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          认证 API 将在 Phase 1 T3 接入。当前页面用于验证 Admin 应用路由、样式和运行时环境。
        </p>
      </section>
    </main>
  );
}
