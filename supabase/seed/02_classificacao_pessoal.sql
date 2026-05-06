-- Plano de contas PESSOAL dos sócios (códigos 1.01 a 1.06)
-- Extraído dos cabeçalhos da aba 'Dados Bancários'.

insert into public.classificacao_pessoal (codigo, nome, ordem) values
  ('1.01', 'Imóvel', 1),
  ('1.02', 'Família', 2),
  ('1.03', 'Renda Mensal/Qualidade de Vida', 3),
  ('1.04', 'Despesas Pessoais', 4),
  ('1.05', 'Fazenda Aramburu', 5),
  ('1.06', 'Contratos de Venda', 6)
on conflict (codigo) do nothing;
