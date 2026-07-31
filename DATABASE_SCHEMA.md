# قاعدة البيانات — Prisma Schema Report

**الإصدار:** v1.1.0
**المصدر:** `prisma/schema.prisma` (820 سطرًا)
**قاعدة البيانات:** PostgreSQL 16
**ORM:** Prisma Client

---

## نظرة عامة

المخطط يصف **38 جدولاً** تغطي كامل عمليات إدارة المديونية والتحصيل، مقسمة إلى 10 مجموعات وظيفية.

| # | المجموعة | الجداول | الوصف |
|---|---------|---------|-------|
| 1 | الهيكل التنظيمي | `Organization`, `Branch` | الشركة وفروعها |
| 2 | المستخدمون والأدوار (RBAC) | `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `Collector` | مصادقة JWT + صلاحيات |
| 3 | البيانات المرجعية | `Currency`, `DocumentType` | العملات وأنواع المستندات |
| 4 | العملاء | `Customer`, `CustomerAssignment`, `CustomerCreditPolicy`, `PotentialDuplicateCustomer` | العملاء والإسناد والسياسات |
| 5 | الاستيراد والأرصدة المحاسبية | `ImportTemplate`, `ImportJob`, `ImportedTransaction`, `CustomerBalance`, `BalanceSnapshot` | استيراد Excel/CSV + أرصدة |
| 6 | الدفتر التشغيلي | `OperationalLedger` | Append-only (Trigger يمنع التعديل) |
| 7 | التسوية | `BalanceReconciliation` | مطابقة محاسبي/تشغيلي |
| 8 | العمليات التشغيلية | `CollectionMethod`, `Collection`, `CashHandover`, `FollowupType`, `FollowupResult`, `Followup`, `PaymentPromise`, `Task` | التحصيل والمتابعات والوعود والمهام |
| 9 | الحجوزات | `Reservation`, `ReservationItem` | حجوزات الأصناف |
| 10 | تقييم/مرفقات/إشعارات/تدقيق/إعدادات | `CustomerScore`, `Attachment`, `GpsLog`, `Notification`, `AuditLog`, `SystemSetting`, `IdempotencyKey`, `AuthSession` | دعم ومراقبة |

---

## التفاصيل (38 جدولاً)

### 1) الهيكل التنظيمي

#### `organizations`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | `gen_random_uuid()` |
| name | String | |

#### `branches`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| organization_id | UUID (FK) | |
| name | String | `uq_branches_org_name` (org + name فريد) |
| active | Boolean | default `true` |

### 2) المستخدمون والأدوار (RBAC)

#### `users`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| organization_id | UUID (FK) | |
| branch_id | UUID? (FK) | |
| username | String | `uq_users_org_username` (org + username فريد) |
| full_name | String | |
| phone | String? | |
| password_hash | String | |
| is_active | Boolean | default `true` |
| last_login_at | Timestamptz? | |
| created_at | Timestamptz | |

#### `roles`, `permissions`, `role_permissions`, `user_roles`
- **roles**: اسم + `is_system` (org + name فريد)
- **permissions**: رمز فريد + وصف عربي (30+ صلاحية)
- **role_permissions**: ربط M:N (Cascade على الحذف)
- **user_roles**: ربط M:N + `granted_by`/`granted_at` (تتبع من منح الدور)

#### `collectors`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| user_id | UUID (FK, **فريد**) | محصل = مستخدم واحد |
| branch_id | UUID? (FK) | |
| active | Boolean | |

### 3) البيانات المرجعية

#### `currencies`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| code | String (PK) | `YER`, `SAR`, `USD` |
| source_code | String | رمز المصدر `YR`, `SR`, `$` |
| name_ar | String | الاسم العربي |
| decimals | SmallInt | default `2` |
| active | Boolean | default `true` |

**v1.1.0:** قائمة العملات تُجلب ديناميكيًا من `GET /currencies` في تطبيق المحصل.

#### `document_types`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| organization_id | UUID (FK) | |
| name | String | |
| effect | String | `debit`/`credit`/`mixed` (CHECK في SQL) |
| active | Boolean | |
| notes | String? | |

### 4) العملاء

#### `customers`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| organization_id | UUID (FK) | |
| branch_id | UUID? (FK) | |
| external_customer_code | String | `uq_customers_org_code` (org + code فريد) |
| account_number | String? | |
| name | String | |
| name_normalized | String | فهرس `idx_customers_name_norm` |
| trade_name | String? | |
| phone_primary / phone_secondary / whatsapp | String? | فهرس `idx_customers_phone` |
| region / address | String? | |
| geo_lat / geo_lng | Decimal(9,6)? | إحداثيات الموقع (تُستخدم في "فتح في الخرائط") |
| customer_type / status | String? | |
| relationship_start_date | Date? | |
| notes | String? | |
| created_by_import_job | UUID? | |
| created_at / updated_at | Timestamptz | |

#### `customer_assignments`
- إسناد عميل لمحصل مع `effective_from`/`effective_to`
- **فهرس فريد جزئي** `uq_current_assignment` (WHERE `effective_to IS NULL`) — يضمن إسنادًا حاليًا واحدًا لكل عميل
- فهرس `idx_assignments_collector`

#### `customer_credit_policies`
- سياسة الائتمان لكل عميل: `allow_credit_sale`, `allow_purchase_with_debt`, `credit_limit_amount` (Decimal 18,4), `credit_limit_currency`, `credit_status`

#### `potential_duplicate_customers`
- اقتراحات العملاء المكررين: `customer_a_id`/`customer_b_id` + `match_reason` + `review_status`
- `uq_dup_pair` (الزوج فريد)

### 5) الاستيراد والأرصدة المحاسبية

#### `import_templates`
- قوالب استيراد مع `column_mapping` (JsonB)

#### `import_jobs`
- سجلات كل عملية استيراد: `file_hash`, `status`, `rows_total`, `txns_inserted`, `txns_skipped_duplicate`, `errors_count`, `total_balance_before/after` (JsonB)
- فهرس `idx_import_jobs_hash`

#### `imported_transactions`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID (FK) | فهرس `idx_itxn_customer` |
| currency_code | String (FK) | |
| document_type_id | UUID (FK) | |
| tx_date | Date | |
| debit / credit | Decimal(18,4) | |
| line_hash | String (**فريد**) | منع تكرار السطر |
| source_row_number | Int? | |
| import_job_id | UUID (FK) | فهرس `idx_itxn_job` |

#### `customer_balances`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID (FK) | |
| currency_code | String (FK) | `uq_balance_customer_currency` (عميل + عملة فريد) |
| opening_debit / opening_credit | Decimal(18,4) | |
| accounting_balance | Decimal(18,4) | |
| declared_balance | Decimal(18,4)? | |
| declared_label | String? | |
| last_import_job_id | UUID? (FK) | |

#### `balance_snapshots`
- لقطة رصيد عند كل استيراد (سجل تاريخي) — فهرس `idx_snapshots`

### 6) الدفتر التشغيلي

#### `operational_ledger`
- **Append-only**: Trigger `forbid_mutation` في SQL يمنع UPDATE/DELETE
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID (FK) | فهرس `idx_ledger_customer` |
| currency_code | String (FK) | |
| entry_type | String | `collection`, `reversal`, ... |
| amount_signed | Decimal(18,4) | موجب/سالب حسب النوع |
| source_table / source_id | String / UUID | `uq_ledger_source` (source فريد) |
| created_by | UUID (FK) | |

### 7) التسوية

#### `balance_reconciliations`
- مطابقة الرصيد المحاسبي مع التشغيلي: `accounting_balance`, `operational_balance`, `difference`, `review_status`, `difference_reason`
- `uq_recon` (عميل + عملة + استيراد فريد)

### 8) العمليات التشغيلية

#### `collection_methods`
- طرق الدفع (نقدي/حوالة/شيك/POS) — `uq_methods_org_name`

#### `collections`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID (FK) | فهرس `idx_collections_customer` |
| collector_id | UUID (FK) | فهرس `idx_collections_collector` |
| branch_id | UUID? (FK) | |
| currency_code | String (FK) | |
| amount | Decimal(18,4) | |
| collected_at | Timestamptz | |
| method_id | UUID (FK) | |
| reference_number / bank_name / cheque_number / cheque_date / receipt_number | ? | بيانات الشيك |
| notes | String? | |
| status | String | `recorded`/`reversed`/... فهرس `idx_collections_status` |
| reversed_by_id | UUID? (FK) | علاقة عكسية `CollectionReversal` |

#### `cash_handover`
- تسليم النقد لأمين الصندوق: `collection_id` (فريد), `amount`, `cashier_id`, `receipt_number`

#### `followup_types` / `followup_results`
- أنواع المتابعات ونتائجها — `uq_ftypes_org_name` / `uq_fresults_org_name`

#### `followups`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID (FK) | فهرس `idx_followups_customer` |
| user_id | UUID (FK) | فهرس `idx_followups_user` |
| type_id / result_id | UUID (FK) | |
| followup_at | Timestamptz | |
| notes | String? | |
| next_followup_date | Date? | فهرس `idx_followups_next` |
| expected_amount / expected_currency | ? | |
| visit_lat / visit_lng | Decimal(9,6)? | إحداثيات الزيارة |
| deleted_at / deleted_by | Soft delete | |

#### `payment_promises`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID (FK) | فهرس `idx_promises_customer` |
| collector_id | UUID (FK) | |
| promise_date / due_date | Date | فهرس `idx_promises_due` (due + status) |
| status | String | State Machine: `upcoming` → `due_today` → `fulfilled`/`broken`/`cancelled` |
| status_reason | String? | |
| expected_amount | Decimal(18,4) | |
| fulfilled_amount | Decimal(18,4)? | |
| currency_code | String (FK) | |
| expected_method_id | UUID? (FK) | |
| notes | String? | |
| created_at | Timestamptz | فهرس `idx_promises_date` |

#### `tasks`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| customer_id | UUID? (FK) | فهرس `idx_tasks_customer` |
| assigned_to | UUID? (FK) | فهرس `idx_tasks_due` (محصل + تاريخ + حالة) |
| created_by | UUID? (FK) | |
| task_type | String | `visit`/`call`/`promise_due`/`followup`/`collection`/`other` |
| due_date | Date | |
| priority_reason | String? | |
| expected_amount / expected_currency | ? | |
| status | String | `open`/`completed` |
| source_promise_id | UUID? (FK) | |

### 9) الحجوزات

#### `reservations` / `reservation_items`
- حجز ائتمان: `credit_amount`, `used_amount`, `payment_date`, `warehouse`, `expires_at`, `status`
- بنود الحجز: `item_name`, `quantity`, `unit`, `received_qty`

### 10) الدعم والمراقبة

#### `customer_scores`
- درجة العميل + مستوى المخاطر: `score` Decimal(6,2), `risk_level`, `reasons` JsonB — فهرس `idx_scores_customer`

#### `attachments`
- مرفقات (السندات): `entity_table`, `entity_id`, `file_name`, `storage_key` — فهرس `idx_attachments_entity`

#### `gps_logs`
- نقاط GPS: `entity_table`, `entity_id`, `latitude`, `longitude`, `accuracy`, `timestamp` — فهارس على entity و user

#### `notifications`
| الحقل | النوع | ملاحظات |
|-------|------|---------|
| id | UUID (PK) | |
| user_id | UUID (FK) | فهرس `idx_notifications_user` |
| kind | String | `promise_due`, `promise_overdue`, `collection_created`, `customer_transferred`, `followup_due` |
| payload | JsonB | يحتوي `customerId`, `customerName`, `amount`, `currency`, `dueDate`... |
| read_at | Timestamptz? | |
| created_at | Timestamptz | |

**v1.1.0:** payload لـ `collection_created` أصبح يشمل `customerId` لتمكين الـDeep Link.

#### `audit_logs`
- سجل تدقيق شامل: `action`, `entity_table`, `entity_id`, `old_value`/`new_value` (JsonB), `reason`, `ip_address` (Inet), `user_agent` — فهارس على entity و user

#### `system_settings`
- إعدادات المنشأة: `key` + `value` (JsonB) — مفتاح مركب (org + key)

#### `idempotency_keys`
- منع تكرار العمليات: `key` (PK) + `response` (JsonB) — فهرس `idx_idempotency_created`

#### `auth_sessions`
- جلسات المصادقة: `token_hash` (فريد), `expires_at`, `revoked_at`, `replaced_by_id` (Rotation), `ip_address`, `user_agent` — فهرس `idx_auth_sessions_user`

---

## ميزات SQL خارج Prisma Schema

| الميزة | الموقع | الوصف |
|--------|--------|-------|
| CHECK constraints | migration SQL | `document_types.effect`, حالات الوعود/التحصيلات |
| فهرس فريد جزئي | migration SQL | `uq_current_assignment` (WHERE effective_to IS NULL) |
| Triggers | migration SQL | `forbid_mutation` على `operational_ledger` (يمنع UPDATE/DELETE) |
| Materialized View | migration SQL | `operational_balances` |

---

## العلاقات الرئيسية (Highlights)

```
Organization ─┬── Branch ─── Collector ─── Collection/Promise/Task
              ├── User ───── UserRole ─── Role ─── RolePermission ─── Permission
              ├── Customer ─── CustomerAssignment/Followup/Promise/Collection/Reservation
              ├── Currency (مرجعية لكل العمليات المالية)
              └── CollectionMethod/FollowupType/FollowupResult (مرجعية)

Customer ─── CustomerBalance (per currency)
Customer ─── OperationalLedger (append-only)
Customer ─── BalanceSnapshot ─── ImportJob ─── ImportedTransaction
Customer ─── CustomerScore
User ─── Notification / AuditLog / GpsLog / AuthSession
```

## مؤشرات الأداء

- **فهارس استراتيجية** على كل الاستعلامات الشائعة (حسب العميل/المحصل/التاريخ/الحالة)
- **فهارس فريدة** لمنع التكرار (العملاء، الأرصدة، الوعود، الخطوط المستوردة)
- **Decimal(18,4)** للكميات المالية و **Decimal(9,6)** للإحداثيات
