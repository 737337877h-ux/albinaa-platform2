CREATE TABLE hr_task_attachments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), uploaded_by uuid NOT NULL REFERENCES users(id),
 purpose text NOT NULL CHECK(purpose IN ('instruction','completion')), target_id uuid NOT NULL,
 task_id uuid REFERENCES hr_tasks(id), assignment_id uuid REFERENCES hr_task_assignments(id), submission_version integer,
 name text NOT NULL, mime text NOT NULL, size integer NOT NULL CHECK(size>0 AND size<=10485760),digest text NOT NULL,content bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((purpose='instruction' AND assignment_id IS NULL) OR (purpose='completion' AND task_id IS NULL))
);
CREATE INDEX hr_task_attachments_task_id_idx ON hr_task_attachments(task_id);
CREATE INDEX hr_task_attachments_assignment_id_idx ON hr_task_attachments(assignment_id);
CREATE INDEX hr_task_attachments_uploaded_by_created_at_idx ON hr_task_attachments(uploaded_by,created_at);
