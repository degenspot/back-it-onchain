import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Notification } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationEventsService } from './notification-events.service';
import { NotificationListeners } from './notification.listeners';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  providers: [NotificationsService, NotificationEventsService, NotificationListeners],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationEventsService],
})
export class NotificationsModule { }
