import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Request,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Notification } from './notification.entity';


@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) { }

  @Get()
  async getNotifications(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Request() req: any,
  ): Promise<{
    notifications: Notification[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const wallet = req.user?.wallet || req.headers['x-user-wallet'];

    if (!wallet) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    return this.notificationsService.findByUser(wallet, pageNum, limitNum);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any): Promise<{ unreadCount: number }> {
    const wallet = req.user?.wallet || req.headers['x-user-wallet'];

    if (!wallet) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const unreadCount = await this.notificationsService.getUnreadCount(wallet);
    return { unreadCount };
  }

  @Patch(':id/read')
  async markAsRead(
    @Param('id') notificationId: string,
    @Request() req: any,
  ): Promise<Notification | null> {
    const wallet = req.user?.wallet || req.headers['x-user-wallet'];

    if (!wallet) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    return this.notificationsService.markAsRead(notificationId);
  }

  @Patch('mark-all-read')
  async markAllAsRead(@Request() req: any): Promise<{ success: boolean }> {
    const wallet = req.user?.wallet || req.headers['x-user-wallet'];

    if (!wallet) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    await this.notificationsService.markAllAsRead(wallet);
    return { success: true };
  }

  @Delete(':id')
  async deleteNotification(
    @Param('id') notificationId: string,
    @Request() req: any,
  ): Promise<{ success: boolean }> {
    const wallet = req.user?.wallet || req.headers['x-user-wallet'];

    if (!wallet) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    await this.notificationsService.deleteNotification(notificationId);
    return { success: true };
  }
}
