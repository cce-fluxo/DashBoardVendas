-- 0013_foto_da_pessoa.sql
--
-- O pódio da TV (/tv) mostrava só iniciais: num painel visto de longe, rosto
-- identifica mais rápido que "AF". A foto é da PESSOA, não da grafia, para valer
-- em todas as gestões de uma vez.
--
-- Só a URL: a imagem mora fora do banco (Supabase Storage público ou outro host
-- de imagem). NULL = sem foto, a tela cai nas iniciais.

BEGIN;

ALTER TABLE pessoa ADD COLUMN IF NOT EXISTS foto_url text;

COMMIT;
