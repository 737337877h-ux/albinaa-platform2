import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * صيغة خطأ موحدة لكل الـ API:
 * { statusCode, error, message, timestamp, path, requestId }
 * لا يظهر Stack Trace في الإنتاج إطلاقًا.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : null;

    let message: string | string[] = 'خطأ داخلي في الخادم';
    let error = 'Internal Server Error';
    if (isHttp) {
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        message = (body as any).message ?? message;
        error = (body as any).error ?? HttpStatus[status] ?? error;
      }
    }

    if (!isHttp) {
      // خطأ غير متوقع: يُسجّل داخليًا كاملاً، ولا يصل للعميل إلا رسالة عامة
      this.logger.error(
        `Unhandled exception [${(req as any).requestId}] ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
      requestId: (req as any).requestId ?? null,
      ...(process.env.NODE_ENV !== 'production' && !isHttp && exception instanceof Error
        ? { debug: exception.message }
        : {}),
    });
  }
}
