-- LitAgents 2.0 Migration
-- Adds new columns to chapters table and creates plot_threads table

-- 1. Add new columns to chapters table for scene-based pipeline
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS scene_breakdown JSONB;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS editor_feedback JSONB;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS quality_score INTEGER;

-- 2. Create plot_threads table for Narrative Director
CREATE TABLE IF NOT EXISTS plot_threads (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    intensity_score INTEGER DEFAULT 5,
    last_updated_chapter INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_plot_threads_project ON plot_threads(project_id);
CREATE INDEX IF NOT EXISTS idx_plot_threads_status ON plot_threads(project_id, status);
