import { LoginForm } from "./LoginForm";
import { destinoSeguro } from "@/lib/acessos/permissoes";

interface Props {
  searchParams: Promise<{ motivo?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { motivo, next } = await searchParams;
  return <LoginForm motivo={motivo ?? null} next={destinoSeguro(next)} />;
}
