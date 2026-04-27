-- ============================================
-- TABELA DE USUÁRIOS
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'Usuário',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Habilitar RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Política de acesso
CREATE POLICY "Allow all for users" ON users
  FOR ALL USING (true) WITH CHECK (true);

-- Inserir usuários padrão
INSERT INTO users (username, password, role) VALUES
  ('office', '@820439', 'Escritório'),
  ('financeiro', 'ACICG820439', 'Financeiro')
ON CONFLICT (username) DO NOTHING;

-- Criar índice para performance
CREATE INDEX idx_users_username ON users(username);
