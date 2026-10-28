export function pushMessage(kind: string, payload: Record<string, unknown>) {
    const customerName = typeof payload.customerName === 'string' ? payload.customerName : '';
    if (kind === 'finance_alert' && payload.event === 'financial_adjustment_requested') {
      const type = payload.requestType === 'settlement' ? 'تصفية' : 'خصم';
      const amount = payload.amount != null ? Number(payload.amount).toLocaleString('en-US') : '';
      const currency = typeof payload.currency === 'string' ? payload.currency : '';
      return {
        title: `طلب ${type} يحتاج المراجعة`,
        body: `${customerName || 'عميل'}${amount ? ` — ${amount} ${currency}` : ''}`,
      };
    }
    if (kind === 'finance_alert' && payload.event === 'financial_adjustment_reviewed') {
      const type = payload.requestType === 'settlement' ? 'التصفية' : 'الخصم';
      const decision = payload.decision === 'approved' ? 'اعتماد' : 'رفض';
      return {
        title: `تم ${decision} طلب ${type}`,
        body: customerName || 'تمت معالجة الطلب المالي',
      };
    }
    const messages: Record<string, [string, string]> = {
      task_new: ['مهمة تحصيل جديدة', 'افتح مهام التحصيل للاطلاع على التفاصيل'],
      task_overdue: ['مهمة تحصيل متأخرة', 'توجد مهمة لم تسجل لها نتيجة بعد'],
      collection_reversal_requested: ['طلب عكس تحصيل', 'يوجد طلب يحتاج المراجعة'],
      scheduled_job_failed: ['تعذر إكمال إجراء مجدول', 'راجع حالة المزامنة داخل النظام'],
      sync_failed: ['تعذر إكمال المزامنة', 'راجع حالة الاتصال والمزامنة'],
      oracle_exception_movement_published: ['تحديث حركة حساب', 'تم تحديث حركة حساب مرتبطة بك'],
      followup_due: ['متابعة مستحقة', customerName ? `حان موعد متابعة ${customerName}` : 'لديك متابعة مستحقة'],
      promise_due: ['وعد سداد مستحق', customerName ? `حان موعد وعد السداد للعميل ${customerName}` : 'لديك وعد سداد مستحق'],
      promise_overdue: ['وعد سداد متأخر', customerName ? `تأخر وعد السداد للعميل ${customerName}` : 'لديك وعد سداد متأخر'],
      collection_created: ['تحصيل جديد', customerName ? `سُجّل تحصيل جديد من ${customerName}` : 'سُجّل تحصيل جديد'],
      receipt_uploaded: ['صورة إيصال جديدة', customerName ? `رفع المحصل صورة إيصال ${customerName}` : 'رفع المحصل صورة إيصال جديدة'],
      customer_transferred: ['إسناد عميل جديد', customerName ? `تم إسناد ${customerName} إليك` : 'تم إسناد عميل جديد إليك'],
      assignment_change_requested: ['طلب تغيير إسناد', customerName ? `طلب جديد لتغيير إسناد ${customerName}` : 'يوجد طلب تغيير إسناد يحتاج المراجعة'],
      assignment_change_reviewed: ['نتيجة طلب تغيير الإسناد', customerName ? `تمت معالجة طلب إسناد ${customerName}` : 'تمت معالجة طلب تغيير الإسناد'],
      finance_alert: ['تنبيه مالي مهم', 'يوجد إجراء مالي يتطلب المراجعة'],
    };
    const [title, body] = messages[kind] ?? ['تنبيه من الراقي', 'لديك تحديث جديد في نظام التحصيل'];
    return { title, body };
  }
