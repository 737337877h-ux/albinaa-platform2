CREATE TABLE hr_attendance_policies(organization_id uuid PRIMARY KEY REFERENCES organizations(id),start_date date NOT NULL);
INSERT INTO hr_attendance_policies SELECT id,(now() AT TIME ZONE 'Asia/Aden')::date FROM organizations;
CREATE TABLE hr_attendance(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES hr_employees(id),work_date date NOT NULL,
 check_in timestamptz NOT NULL,check_out timestamptz,in_operation_id uuid NOT NULL UNIQUE,out_operation_id uuid UNIQUE,
 in_evidence jsonb NOT NULL,out_evidence jsonb,schedule jsonb NOT NULL,
 UNIQUE(employee_id,work_date),CHECK(check_out IS NULL OR check_out>=check_in)
);
CREATE UNIQUE INDEX hr_attendance_one_open ON hr_attendance(employee_id) WHERE check_out IS NULL;
INSERT INTO permissions(code,description_ar) VALUES ('hr.attendance.read','عرض سجل الحضور والانصراف'),('hr.attendance.qr','عرض رمز حضور المنشأة') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='مدير النظام' AND p.code IN ('hr.attendance.read','hr.attendance.qr') ON CONFLICT DO NOTHING;
