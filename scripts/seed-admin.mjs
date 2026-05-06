import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://acxrdcszcbrisnerkzvg.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("❌  Defina SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADMIN_EMAIL    = "admin@arambi.com";
const ADMIN_PASSWORD = "Admin@2024!";
const ADMIN_NAME     = "Administrador";

async function main() {
  console.log("🌱  Criando usuário admin de teste...");

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message.includes("already been registered")) {
      console.log("ℹ️   Usuário já existe no Auth. Pulando criação.");
    } else {
      console.error("❌  Erro ao criar usuário:", authError.message);
      process.exit(1);
    }
  } else {
    console.log("✅  Auth user criado:", authData.user?.id);
  }

  // Upsert profile in public.users (if the table exists)
  const userId = authData?.user?.id;
  if (userId) {
    const { error: profileError } = await supabase.from("users").upsert({
      id: userId,
      email: ADMIN_EMAIL,
      full_name: ADMIN_NAME,
      role: "admin",
    });

    if (profileError) {
      console.warn("⚠️   Tabela 'users' ainda não existe ou erro ao inserir perfil:", profileError.message);
      console.warn("    (Normal se as tabelas ainda não foram criadas no Supabase)");
    } else {
      console.log("✅  Perfil admin inserido na tabela users.");
    }
  }

  console.log("\n🎉  Pronto! Credenciais de teste:");
  console.log("    E-mail:  ", ADMIN_EMAIL);
  console.log("    Senha:   ", ADMIN_PASSWORD);
}

main();
