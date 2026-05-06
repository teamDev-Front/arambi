-- Modelos de recibo (slugs já usados pelo front em RecibosPage.tsx)

insert into public.recibo_modelos (slug, nome, ordem) values
  ('simples', 'Recibo Simples', 1),
  ('prestacao_servico', 'Prestação de Serviço', 2),
  ('aluguel', 'Recibo de Aluguel', 3),
  ('emprestimo', 'Empréstimo', 4),
  ('declaracao', 'Declaração', 5)
on conflict (slug) do nothing;
