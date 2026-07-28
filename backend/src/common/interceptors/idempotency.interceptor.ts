import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, from, map, mergeMap, catchError, throwError, of } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!isIdempotent) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) return next.handle();

    const compositeKey = `${req.method}:${req.path}:${idempotencyKey}`;

    return from(
      this.prisma.idempotencyKey.findUnique({ where: { key: compositeKey } }),
    ).pipe(
      mergeMap((existing) => {
        if (existing) {
          res.setHeader('X-Idempotent-Replayed', 'true');
          return of(existing.response as any);
        }
        return next.handle().pipe(
          mergeMap((data) =>
            from(
              this.prisma.idempotencyKey.create({
                data: { key: compositeKey, response: data ?? {} },
              }),
            ).pipe(
              map(() => data),
              catchError((err) => {
                if (err.code === 'P2002') {
                  // Race condition — another request just stored this key
                  res.setHeader('X-Idempotent-Replayed', 'true');
                  return from(
                    this.prisma.idempotencyKey.findUniqueOrThrow({
                      where: { key: compositeKey },
                    }),
                  ).pipe(map((record) => record.response as any));
                }
                return throwError(() => err);
              }),
            ),
          ),
          catchError((err) => {
            // Don't store on failure — the client can retry
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}
