# وكيل لقطة مخزون Oracle للقراءة فقط

يعمل هذا الوكيل على جهاز Windows الذي يحتوي عميل Oracle القديم 32-bit. يبدأ جلسة Oracle بأمر `SET TRANSACTION READ ONLY`، ثم ينفذ استعلامات `SELECT` ثابتة على المخطط `IAS20261` فقط.

## ضوابط السلامة

- لا يقبل SQL من المستخدم أو الواجهة.
- يمنع أوامر الإدخال والتعديل والحذف والإنشاء والقفل و`SELECT FOR UPDATE`.
- لا يكتب إلى Oracle ولا إلى قاعدة المنصة.
- لا يحفظ كلمة المرور في ملف أو في اللقطة.
- ينشئ مجلدًا جديدًا لكل لقطة ولا يستبدل لقطة سابقة.
- لا توجد مهمة مجدولة؛ التشغيل يدوي فقط.

## التشغيل

تُمرر كلمة المرور مؤقتًا في العملية ولا تُضاف إلى Git أو ملفات البيئة:

```powershell
$secure = Read-Host 'Oracle password' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:ALBINAA_ORACLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  .\Run-OracleInventorySnapshot.ps1 -OutputRoot C:\Albinaa\oracle-snapshots
}
finally {
  Remove-Item Env:ALBINAA_ORACLE_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
```

## المخرجات

تحتوي كل لقطة على `manifest.json` وسبعة ملفات CSV: مجموعات الأصناف، الأصناف، وحدات الأصناف، مجموعات المستودعات، المستودعات، الأرصدة، والإجماليات الرقابية. يتضمن البيان عدد الصفوف وبصمة SHA-256 لكل ملف.

## فحص وتحميل المنصة

الأمر التالي يفحص اللقطة فقط، وهو الوضع الافتراضي ولا يكتب إلى قاعدة المنصة:

```powershell
npm run oracle:inventory:sync -- --snapshot <snapshot-directory> --organization <organization-uuid>
```

لا يحدث التحميل إلا بإضافة `--apply` صراحة. التحميل ينشئ تشغيلًا بحالة `validating` ولا ينشر اللقطة ولا يغير مؤشر اللقطة النشطة:

```powershell
npm run oracle:inventory:sync -- --snapshot <snapshot-directory> --organization <organization-uuid> --triggered-by <user-uuid> --apply
```
