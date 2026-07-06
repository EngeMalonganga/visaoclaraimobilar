-- =====================================================
-- WEB CLIENTE - CONFIGURACAO SUPABASE
-- =====================================================
-- Executar no SQL Editor do Supabase Dashboard
-- =====================================================

-- 0. ADICIONAR COLUNAS A TABELA candidaturas
ALTER TABLE candidaturas ADD COLUMN IF NOT EXISTS estado_imovel VARCHAR(50);
ALTER TABLE candidaturas ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(100);
ALTER TABLE candidaturas ADD COLUMN IF NOT EXISTS faixa_preco VARCHAR(50);

-- 1. POLITICA RLS: candidatos - auto-servico
DROP POLICY IF EXISTS candidato_self ON candidatos;
CREATE POLICY candidato_self ON candidatos
  FOR ALL USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

-- 2. POLITICA RLS: documentos - acesso do dono da candidatura
DROP POLICY IF EXISTS documento_own ON documentos;
CREATE POLICY documento_own ON documentos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM candidaturas
      WHERE candidaturas.id = documentos.candidatura_id
        AND candidaturas.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM candidaturas
      WHERE candidaturas.id = documentos.candidatura_id
        AND candidaturas.usuario_id = auth.uid()
    )
  );

-- 3. FUNCAO RPC: criar candidatura completa (SECURITY DEFINER = bypass RLS)
CREATE OR REPLACE FUNCTION criar_candidatura_completa(p_usuario_id UUID, p_nome TEXT, p_data_nascimento DATE, p_telefone TEXT, p_email TEXT, p_bi TEXT DEFAULT NULL, p_nif TEXT DEFAULT NULL, p_nacionalidade TEXT DEFAULT 'Angolana', p_morada TEXT DEFAULT NULL, p_tipo_operacao TEXT DEFAULT 'Comprar', p_tipo_imovel TEXT DEFAULT 'Apartamento', p_localizacao_desejada TEXT DEFAULT NULL, p_quartos_desejados TEXT DEFAULT NULL, p_profissao TEXT DEFAULT NULL, p_empresa TEXT DEFAULT NULL, p_cargo TEXT DEFAULT NULL, p_rendimento TEXT DEFAULT NULL, p_observacoes TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_cand_id UUID; v_candt_id UUID; v_num VARCHAR(20); BEGIN IF auth.uid() IS NULL OR auth.uid() != p_usuario_id THEN RAISE EXCEPTION 'Unauthorized'; END IF; INSERT INTO candidatos (usuario_id, nome_completo, data_nascimento, bi, nif, nacionalidade, morada, telefone, email) VALUES (p_usuario_id, p_nome, p_data_nascimento, p_bi, p_nif, p_nacionalidade, p_morada, p_telefone, p_email) RETURNING id INTO v_cand_id; INSERT INTO candidaturas (usuario_id, candidato_id, tipo_operacao, tipo_imovel, localizacao_desejada, quartos_desejados, profissao, empresa, cargo, rendimento, observacoes, aceite_termos, status) VALUES (p_usuario_id, v_cand_id, p_tipo_operacao, p_tipo_imovel, p_localizacao_desejada, p_quartos_desejados, p_profissao, p_empresa, p_cargo, p_rendimento, p_observacoes, TRUE, 'Em analise') RETURNING id, numero_candidatura INTO v_candt_id, v_num; RETURN jsonb_build_object('candidato_id', v_cand_id, 'candidatura_id', v_candt_id, 'numero', v_num); END; $$;

-- 3b. POLITICA RLS: candidaturas - permitir INSERT do proprio usuario
DROP POLICY IF EXISTS candidatura_insert_self ON candidaturas;
CREATE POLICY candidatura_insert_self ON candidaturas
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

-- 4. FUNCAO RPC: listar candidaturas do usuario autenticado
CREATE OR REPLACE FUNCTION listar_minhas_candidaturas(p_usuario_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_usuario_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'numero_candidatura', c.numero_candidatura,
      'tipo_imovel', c.tipo_imovel,
      'localizacao_desejada', c.localizacao_desejada,
      'status', c.status,
      'data_submissao', c.data_submissao,
      'created_at', c.created_at
    ) ORDER BY c.data_submissao DESC
  ) INTO v_result
  FROM candidaturas c
  WHERE c.usuario_id = p_usuario_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
