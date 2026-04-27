import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Notification } from './notification.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

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
    const wallet: string = req.user.wallet;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    return this.notificationsService.findByUser(wallet, pageNum, limitNum);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any): Promise<{ unreadCount: number }> {
    const wallet: string = req.user.wallet;

    const unreadCount = await this.notificationsService.getUnreadCount(wallet);
    return { unreadCount };
  }

  @Patch(':id/read')
  async markAsRead(
    @Param('id') notificationId: string,
    @Request() req: any,
  ): Promise<Notification | null> {
    const wallet: string = req.user.wallet;

    return this.notificationsService.markAsRead(notificationId, wallet);
  }

  @Patch('mark-all-read')
  async markAllAsRead(@Request() req: any): Promise<{ success: boolean }> {
    const wallet: string = req.user.wallet;

    await this.notificationsService.markAllAsRead(wallet);
    return { success: true };
  }

  @Delete(':id')
  async deleteNotification(
    @Param('id') notificationId: string,
    @Request() req: any,
  ): Promise<{ success: boolean }> {
    const wallet: string = req.user.wallet;

    await this.notificationsService.deleteNotification(notificationId, wallet);
    return { success: true };
  }
}
