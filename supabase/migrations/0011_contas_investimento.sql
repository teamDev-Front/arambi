-- ============================================================================
-- 0011 — Contas de investimento (XP, Invest, Invest Evolutivo)
-- ============================================================================
-- Na planilha esses 3 cards (INVEST, INVEST EVOLUTIVO, XP) são valores fixos
-- digitados na mão. No sistema, são contas como qualquer outra: ela cadastra,
-- faz um lançamento de "Saldo inicial" + movimentações (resgate, aplicação,
-- rendimento) e o saldo aparece no dashboard automaticamente via
-- v_saldo_atual_por_banco.

insert into public.contas_bancarias_empresa (nome, apelido, banco, agencia, tipo, ordem) values
  ('XP (Conta)',         'XP',                'XP Investimentos', null, 'investimento', 4),
  ('Invest',             'Invest',            'XP Investimentos', null, 'investimento', 5),
  ('Invest Evolutivo',   'Invest Evolutivo',  'XP Investimentos', null, 'investimento', 6)
on conflict (nome) do nothing;

-- Os nomes acima são plausíveis mas a Lola pode ajustar pelo cadastro depois.
-- O importante é que cada conta tem id único + apelido pro card do dashboard.
