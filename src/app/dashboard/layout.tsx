import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userName = user?.email?.split("@")[0] ?? "Usuário";
  let userRole = "viewer";

  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from("users")
      .select("full_name, role")
      .eq("id", user.id)
      .single() as { data: { full_name?: string | null; role?: string } | null };
    if (profile) {
      userName = profile.full_name ?? userName;
      userRole = profile.role ?? userRole;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f0e8]">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header userName={userName} userRole={userRole} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
