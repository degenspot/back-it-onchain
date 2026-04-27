import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationsRepository: Repository<Notification>,
  ) {}

  async create(data: {
    recipientWallet: string;
    type: NotificationType;
    payload: Record<string, any>;
    resourceId?: string;
    resourceType?: string;
  }): Promise<Notification> {
    const notification = this.notificationsRepository.create(data);
    return this.notificationsRepository.save(notification);
  }

  async findByUser(
    recipientWallet: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    notifications: Notification[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [notifications, total] =
      await this.notificationsRepository.findAndCount({
        where: { recipientWallet },
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
        relations: ['recipient'],
      });

    return {
      notifications,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUnreadCount(recipientWallet: string): Promise<number> {
    return this.notificationsRepository.count({
      where: { recipientWallet, isRead: false },
    });
  }

  async markAsRead(
    notificationId: string,
    wallet: string,
  ): Promise<Notification | null> {
    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId },
    });
    if (!notification) {
      return null;
    }
    if (notification.recipientWallet !== wallet) {
      throw new ForbiddenException(
        'You can only modify your own notifications',
      );
    }
    await this.notificationsRepository.update(notificationId, { isRead: true });
    return this.notificationsRepository.findOne({
      where: { id: notificationId },
    });
  }

  async markAllAsRead(recipientWallet: string): Promise<void> {
    await this.notificationsRepository.update(
      { recipientWallet, isRead: false },
      { isRead: true },
    );
  }

  async deleteNotification(
    notificationId: string,
    wallet: string,
  ): Promise<void> {
    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId },
    });
    if (!notification) {
      return;
    }
    if (notification.recipientWallet !== wallet) {
      throw new ForbiddenException(
        'You can only delete your own notifications',
      );
    }
    await this.notificationsRepository.delete(notificationId);
  }

  async deleteOldNotifications(daysOld: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    await this.notificationsRepository
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .execute();
  }
}
