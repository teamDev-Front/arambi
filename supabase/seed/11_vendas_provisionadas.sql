-- Vendas Futuras / Provisionamento
-- Origem: Provisionamento_VENDAS 2026.xlsx, aba Detalhado, R6:R9
-- 4 vendas de Soja 24/25 à Copasul, total R$ 3.513.265,29
-- A primeira (R6) já foi paga em 30/01/2026 — entra como liquidada.

insert into public.vendas_provisionadas (
  data_venda, comprador, cultura, safra, aut_fixacao, nota_fiscal,
  kg, preco_sc, data_pgto_prevista, destino_empresa, socio_destino_id,
  status, observacao, origem_planilha
)
values
  -- R6 — Aramburu: paga em 30/01/2026
  ('2025-07-11', 'Copasul', 'soja'::public.cultura_safra, '24/25', '153076', '8066969',
   480000, 120.0000, '2026-01-30', true, null,
   'liquidada', 'Pagamento em 4 parcelas — esta é a primeira (jan/26)', 'VENDAS!R6'),
  -- R7 — Aramburu: a receber em 30/03/2026
  ('2025-07-11', 'Copasul', 'soja'::public.cultura_safra, '24/25', '153330', '8066874',
   600000, 123.5040, '2026-03-30', true, null,
   'firmada', null, 'VENDAS!R7'),
  -- R8 — Ana Beatriz: a receber em 30/03/2026
  ('2025-07-11', 'Copasul', 'soja'::public.cultura_safra, '24/25', '153333', '8066943',
   271080, 123.5040, '2026-03-30', false,
   (select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   'firmada', 'Repasse Soja - parte direta da sócia Ana Beatriz', 'VENDAS!R8'),
  -- R9 — Aramburu: liquidada em 30/07/2025
  ('2025-07-16', 'Copasul', 'soja'::public.cultura_safra, '24/25', '154432', '8082622',
   360574, 126.5040, '2025-07-30', true, null,
   'liquidada', null, 'VENDAS!R9');
