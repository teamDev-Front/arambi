-- Contas bancárias da empresa (Aramburu)

insert into public.contas_bancarias_empresa (nome, apelido, banco, agencia, tipo, ordem) values
  ('Banco Cora (0001)', 'Cora', 'Banco Cora', '0001', 'corrente', 1),
  ('Cooperativa Sicredi (0902)', 'Sicredi MJU', 'Cooperativa Sicredi', '0902', 'corrente', 2),
  ('Cooperativa Sicredi (0913)', 'Sicredi CGR', 'Cooperativa Sicredi', '0913', 'corrente', 3)
on conflict (nome) do nothing;
