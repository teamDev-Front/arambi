-- Sócios (4)

insert into public.socios (nome_completo, apelido) values
  ('Ana Beatriz Ponte Fragelli', 'Ana Beatriz'),
  ('Claudio Luiz Resta Fragelli', 'Cláudio Luiz'),
  ('Isamelia Ponte Fragelli', 'Isamélia'),
  ('Pedro Henrique Ponte Fragelli', 'Pedro Henrique')
on conflict (nome_completo) do nothing;
