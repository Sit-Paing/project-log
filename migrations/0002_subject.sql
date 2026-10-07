-- Subject section: free-text notes per project, and images per project.
ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  data_b64 TEXT NOT NULL,
  ord REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_project ON images(project_id, ord);
