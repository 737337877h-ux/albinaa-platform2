ALTER TABLE "hr_attendance_policies" ADD COLUMN "payroll_rules" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
