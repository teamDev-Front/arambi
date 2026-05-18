-- Depósitos da Safra 25/25 (Milho) na Copasul
-- 16 DFe's de jul/2025, total 866.616 kg
-- Origem: aba Detalhado__ R16:R31 — Provisionamento Safra 25.25.xlsx

do $$
declare
  v_armazem uuid;
begin
  select id into v_armazem from public.armazens where nome = 'Copasul';
  if v_armazem is null then return; end if;

  insert into public.safra_depositos (armazem_id, cultura, safra, data_deposito, dfe_entrada, nfp, kg_bruto, origem_planilha)
  values
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-15', '54383', '8285721', 43840, 'Detalhado__!R16'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-15', '54411', '8285722', 44170, 'Detalhado__!R17'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-16', '54489', '8285723', 46149, 'Detalhado__!R18'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55986', '8285724', 44835, 'Detalhado__!R19'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55004', '8285725', 61808, 'Detalhado__!R20'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55014', '8285726', 62829, 'Detalhado__!R21'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55029', '8285727', 61631, 'Detalhado__!R22'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55048', '8285728', 45031, 'Detalhado__!R23'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55061', '8285729', 61245, 'Detalhado__!R24'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55093', '8285730', 59987, 'Detalhado__!R25'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55098', '8285731', 61582, 'Detalhado__!R26'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55126', '8285732', 44676, 'Detalhado__!R27'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55144', '8285733', 61256, 'Detalhado__!R28'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55153', '8285734', 60524, 'Detalhado__!R29'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55174', '8285735', 60970, 'Detalhado__!R30'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-21', '55344', '8285736', 46083, 'Detalhado__!R31')
  on conflict do nothing;
end$$;
