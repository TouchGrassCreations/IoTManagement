CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planned',
  accent TEXT NOT NULL DEFAULT 'green',
  icon TEXT NOT NULL DEFAULT 'PRJ',
  next_step TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

-- Doubles as the owner's list index: every read is prefixed by owner_id.
CREATE UNIQUE INDEX idx_projects_identity ON projects(owner_id, normalized_name);
--> statement-breakpoint

CREATE TABLE project_parts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  model TEXT,
  model_key TEXT NOT NULL DEFAULT '__unknown__',
  category TEXT NOT NULL,
  quantity_required INTEGER NOT NULL DEFAULT 1,
  match_mode TEXT NOT NULL DEFAULT 'identity',
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

-- Requirements carry no owner of their own; they are always reached by joining
-- to projects under the owner predicate, and always read in display order.
CREATE INDEX idx_project_parts_project ON project_parts(project_id, position);
