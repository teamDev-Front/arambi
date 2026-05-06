-- Parâmetros da obra Sede (substitui o external link da planilha)
-- Valores que estavam hardcoded em '$ obra sede'!F8/F12/F13/F14.

insert into public.obra_parametros (chave, valor_numerico, data_referencia, observacao) values
  ('capital_inicial',         1147800.00, '2025-05-01', 'Capital Inicial Maio/2025 ($ obra sede!F8)'),
  ('pago_2025_lts_medicao',   524574.25,  '2025-12-31', 'Total LTS Medições pago em 2025 ($ obra sede!F12)'),
  ('pago_2025_lts_oc',        523480.46,  '2025-12-31', 'Total LTS Ordens de Compra pago em 2025 ($ obra sede!F13)'),
  ('pago_2025_outras',        317416.73,  '2025-12-31', 'Outras despesas pago em 2025 ($ obra sede!F14)'),
  ('resgate_xp_para_mju',     180000.00,  '2025-12-09', 'Resgate XP → Sicredi MJU'),
  ('resgate_xp_para_cgr',     119598.61,  '2025-12-17', 'Resgate XP → Sicredi CGR'),
  ('resgate_xp_3',            100488.96,  '2026-01-09', 'Resgate XP (3ª operação)'),
  ('resgate_extra',           200084.84,  null,         'Resgate adicional')
on conflict (chave) do nothing;
