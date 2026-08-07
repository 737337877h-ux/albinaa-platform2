import { Module } from '@nestjs/common';
import { AgingModule } from '../aging/aging.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({ imports: [AgingModule], controllers: [MessagingController], providers: [MessagingService] })
export class MessagingModule {}
