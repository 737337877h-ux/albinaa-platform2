import { getClient } from './client';

class ReceiptContentError extends Error {}

// Android can return a Blob with an empty type even for a valid JPEG.
// Identify the actual bytes; never trust a .jpg filename or render HTML as an image.
export function normalizeReceiptDataUrl(value: string): string {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) throw new ReceiptContentError('تعذر قراءة محتوى صورة الإيصال.');
  const base64 = match[1].replace(/\s/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let bits = 0, buffer = 0;
  for (const char of base64.slice(0, 24)) {
    const index = alphabet.indexOf(char);
    if (index < 0) break;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  const ascii = String.fromCharCode(...bytes);
  const mime = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png'
    : /^GIF8[79]a/.test(ascii) ? 'image/gif'
    : ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new ReceiptContentError('المرفق ليس صورة مدعومة أو أن محتواه تالف.');
  return `data:${mime};base64,${base64}`;
}

export async function loadReceiptImage(id: string, signal?: AbortSignal): Promise<string> {
  const client = await getClient();
  // Use the authenticated client: native Image/downloadAsync bypass its
  // refresh and safe read-only route failover interceptors.
  const { data } = await client.get<Blob>(`/mobile/receipts/${encodeURIComponent(id)}`, {
    responseType: 'blob', signal,
  });
  if (!data?.size) throw new ReceiptContentError('ملف الإيصال فارغ.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(normalizeReceiptDataUrl(String(reader.result))); }
      catch (error) { reject(error); }
    };
    reader.onerror = () => reject(new ReceiptContentError('تعذر فك محتوى صورة الإيصال على الهاتف.'));
    reader.readAsDataURL(data);
  });
}

export function receiptErrorMessage(error: any): string {
  if (error instanceof ReceiptContentError) return error.message;
  switch (error?.response?.status) {
    case 401: return 'انتهت الجلسة. سجّل الدخول مرة أخرى.';
    case 403: return 'لا تملك صلاحية عرض هذا الإيصال.';
    case 404: return 'ملف الإيصال غير موجود على الخادم.';
    default: return error?.response
      ? 'تعذر تحميل الإيصال من الخادم. أعد المحاولة.'
      : `تعذر تحميل الصورة. تحقق من الاتصال وأعد المحاولة. (${['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error?.code) ? error.code : 'IMAGE_READ'})`;
  }
}
