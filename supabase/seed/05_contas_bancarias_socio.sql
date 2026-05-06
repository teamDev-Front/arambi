-- Contas bancárias dos sócios (extraído de 'Dados Bancários')
-- Pedro Henrique não tem contas cadastradas na planilha (combinado: ficar só com o nome).

insert into public.contas_bancarias_socio (socio_id, nome, banco, ordem) values
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Bradesco 3489 C/C 2890-8', 'Bradesco', 1),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Inter 0001 C/C 12284789-0', 'Inter', 2),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Nubank 0001 C/C 6254033-3', 'Nubank', 3),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Nubank 0101 C/C 6254033-3', 'Nubank', 4),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'), 'B. Brasil cfragelli7@gmail.com', 'B.', 1),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'), 'Bradesco 1375 C/C 242867-9', 'Bradesco', 2),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'), 'Bradesco 3489 C/C 3154-2', 'Bradesco', 3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Bradesco 3489 C/C 35858-4', 'Bradesco', 1),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Inter 001 C/C 28333196-0', 'Inter', 2),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Inter 001 C/C 28333196-8', 'Inter', 3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Nubank isafragelli@gmail.com', 'Nubank', 4)
on conflict (socio_id, nome) do nothing;
