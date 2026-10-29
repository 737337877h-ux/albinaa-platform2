package com.albinaa.collector

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PersistableBundle
import android.widget.Toast
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/** Copies the caption and shares only the PDF, avoiding automatic text plus manual paste. */
class StatementShareModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "StatementShare"

  @ReactMethod
  fun share(contentUri: String, message: String, promise: Promise) {
    try {
      val uri = Uri.parse(contentUri)
      require(uri.scheme == "content" && uri.authority?.startsWith(context.packageName + ".") == true) {
        "Only this application's statement files may be shared"
      }
      val activity = context.currentActivity ?: throw IllegalStateException("Open the application before sharing")
      require(message.isNotBlank()) { "رسالة التنبيه فارغة" }
      activity.runOnUiThread {
        try {
          // Copy only after the user's explicit share tap; do not read the clipboard.
          val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          val caption = ClipData.newPlainText("رسالة تنبيه بكشف حساب", message)
          caption.description.extras = PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
          }
          clipboard.setPrimaryClip(caption)
          Toast.makeText(activity, "تم نسخ رسالة التنبيه؛ الصقها مرة واحدة في خانة التعليق", Toast.LENGTH_LONG).show()
          val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            // Caption is clipboard-only: receivers must not append it as well as the user's paste.
            clipData = ClipData.newUri(context.contentResolver, "كشف حساب", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          activity.startActivity(Intent.createChooser(intent, "مشاركة كشف الحساب والتنبيه"))
          promise.resolve(true) // Chooser opened, NOT evidence of delivery.
        } catch (error: Exception) { promise.reject("STATEMENT_SHARE", error) }
      }
    } catch (error: Exception) { promise.reject("STATEMENT_SHARE", error) }
  }
}

class StatementSharePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(StatementShareModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
