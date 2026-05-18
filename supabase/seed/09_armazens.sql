-- Armazéns (cerealistas onde a Aramburu armazena grãos)
-- Hoje só Copasul; a estrutura permite cadastrar outros.

insert into public.armazens (nome, apelido, cidade, uf, ordem) values
  ('Copasul', 'Copasul Maracaju', 'Maracaju', 'MS', 1)
on conflict (nome) do nothing;

-- Parâmetros default da safra 25/25 (Milho na Copasul)
-- Valores extraídos da aba Detalhado__ — Provisionamento Safra 25.25.xlsx
insert into public.safra_parametros (
  armazem_id, cultura, safra,
  quebra_quinzena_pct, armazenagem_por_kg_quinzena, devolucao_por_saca,
  carencia_dias, kg_por_saca, data_atual, cotacao_simulada_sc
)
select
  a.id, 'milho'::public.cultura_safra, '25/25',
  0.0015, 0.20, 4.75,
  30, 60.00, current_date, 50.00
from public.armazens a
where a.nome = 'Copasul'
on conflict (armazem_id, cultura, safra) do nothing;
