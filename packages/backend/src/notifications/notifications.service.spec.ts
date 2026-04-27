import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationEventsService } from './notification-events.service';
import { Notification, NotificationType } from './notification.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockNotification = (
  overrides: Partial<Notification> = {},
): Notification =>
  ({
    id: 'uuid-1',
    recipientWallet: '0xUSER',
    type: NotificationType.NEW_FOLLOWER,
    payload: { follower: '0xALICE' },
    isRead: false,
    createdAt: new Date('2026-01-01'),
    resourceId: null,
    resourceType: null,
    recipient: null,
    ...overrides,
  }) as Notification;

// ---------------------------------------------------------------------------
// NotificationsService
// ---------------------------------------------------------------------------

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const buildDeleteQbMock = () => {
    const qb = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 5 }),
    };
    return qb;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(Notification),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // create  (notifyUser)
  // -------------------------------------------------------------------------
  describe('create (notifyUser)', () => {
    it('persists a new notification and returns it', async () => {
      const data = {
        recipientWallet: '0xUSER',
        type: NotificationType.NEW_FOLLOWER,
        payload: { follower: '0xALICE' },
      };
      const built = mockNotification(data);
      const saved = mockNotification({ ...data, id: 'uuid-saved' });

      repo.create.mockReturnValue(built);
      repo.save.mockResolvedValue(saved);

      const result = await service.create(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(repo.save).toHaveBeenCalledWith(built);
      expect(result.id).toBe('uuid-saved');
    });

    it('stores optional resourceId and resourceType', async () => {
      const data = {
        recipientWallet: '0xUSER',
        type: NotificationType.MARKET_RESOLVED,
        payload: { callId: 42 },
        resourceId: '42',
        resourceType: 'call',
      };
      const saved = mockNotification(data);
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);

      const result = await service.create(data);

      expect(result.resourceId).toBe('42');
      expect(result.resourceType).toBe('call');
    });

    it('supports all NotificationType values', async () => {
      for (const type of Object.values(NotificationType)) {
        const data = {
          recipientWallet: '0xUSER',
          type,
          payload: {},
        };
        const built = mockNotification({ type });
        repo.create.mockReturnValue(built);
        repo.save.mockResolvedValue(built);

        const result = await service.create(data);
        expect(result.type).toBe(type);
      }
    });
  });

  // -------------------------------------------------------------------------
  // findByUser
  // -------------------------------------------------------------------------
  describe('findByUser', () => {
    it('returns paginated notifications for a wallet', async () => {
      const notifications = [
        mockNotification(),
        mockNotification({ id: 'uuid-2' }),
      ];
      repo.findAndCount.mockResolvedValue([notifications, 2]);

      const result = await service.findByUser('0xUSER', 1, 20);

      expect(result.notifications).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('calculates totalPages correctly', async () => {
      repo.findAndCount.mockResolvedValue([[], 45]);

      const result = await service.findByUser('0xUSER', 1, 20);

      expect(result.totalPages).toBe(3); // ceil(45/20)
    });

    it('applies skip based on page number', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser('0xUSER', 3, 10);

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('uses default page=1 and limit=20', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser('0xUSER');

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('orders results by createdAt DESC', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser('0xUSER');

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' } }),
      );
    });

    it('filters by recipientWallet', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser('0xUSER');

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { recipientWallet: '0xUSER' } }),
      );
    });

    it('includes recipient relation', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser('0xUSER');

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['recipient'] }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getUnreadCount  (getUnreadNotifications)
  // -------------------------------------------------------------------------
  describe('getUnreadCount (getUnreadNotifications)', () => {
    it('returns the count of unread notifications', async () => {
      repo.count.mockResolvedValue(7);

      const result = await service.getUnreadCount('0xUSER');

      expect(result).toBe(7);
      expect(repo.count).toHaveBeenCalledWith({
        where: { recipientWallet: '0xUSER', isRead: false },
      });
    });

    it('returns 0 when all notifications are read', async () => {
      repo.count.mockResolvedValue(0);

      const result = await service.getUnreadCount('0xUSER');

      expect(result).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // markAsRead
  // -------------------------------------------------------------------------
  describe('markAsRead', () => {
    it('updates isRead to true and returns the notification', async () => {
      const found = mockNotification();
      const updated = mockNotification({ isRead: true });
      repo.findOne.mockResolvedValueOnce(found); // ownership check
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValueOnce(updated); // return value

      const result = await service.markAsRead('uuid-1', '0xUSER');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
      expect(repo.update).toHaveBeenCalledWith('uuid-1', { isRead: true });
      expect(result?.isRead).toBe(true);
    });

    it('returns null when notification does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.markAsRead('nonexistent', '0xUSER');

      expect(result).toBeNull();
    });

    it('throws ForbiddenException when wallet does not match recipient', async () => {
      const found = mockNotification({ recipientWallet: '0xOTHER' });
      repo.findOne.mockResolvedValue(found);

      await expect(service.markAsRead('uuid-1', '0xUSER')).rejects.toThrow(
        'You can only modify your own notifications',
      );
    });
  });

  // -------------------------------------------------------------------------
  // markAllAsRead
  // -------------------------------------------------------------------------
  describe('markAllAsRead', () => {
    it('marks all unread notifications for a wallet as read', async () => {
      repo.update.mockResolvedValue({ affected: 3 });

      await service.markAllAsRead('0xUSER');

      expect(repo.update).toHaveBeenCalledWith(
        { recipientWallet: '0xUSER', isRead: false },
        { isRead: true },
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteNotification
  // -------------------------------------------------------------------------
  describe('deleteNotification', () => {
    it('deletes a notification owned by the requesting wallet', async () => {
      const found = mockNotification({ recipientWallet: '0xUSER' });
      repo.findOne.mockResolvedValue(found);
      repo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteNotification('uuid-1', '0xUSER');

      expect(repo.delete).toHaveBeenCalledWith('uuid-1');
    });

    it('does nothing when notification does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.deleteNotification('nonexistent', '0xUSER');

      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when wallet does not match recipient', async () => {
      const found = mockNotification({ recipientWallet: '0xOTHER' });
      repo.findOne.mockResolvedValue(found);

      await expect(
        service.deleteNotification('uuid-1', '0xUSER'),
      ).rejects.toThrow('You can only delete your own notifications');
    });
  });

  // -------------------------------------------------------------------------
  // deleteOldNotifications
  // -------------------------------------------------------------------------
  describe('deleteOldNotifications', () => {
    it('deletes notifications older than the cutoff date', async () => {
      const qb = buildDeleteQbMock();
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.deleteOldNotifications(30);

      expect(qb.delete).toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith(
        'createdAt < :cutoffDate',
        expect.objectContaining({ cutoffDate: expect.any(Date) }),
      );
      expect(qb.execute).toHaveBeenCalled();
    });

    it('uses default of 30 days when no argument is passed', async () => {
      const qb = buildDeleteQbMock();
      repo.createQueryBuilder.mockReturnValue(qb);

      const before = new Date();
      before.setDate(before.getDate() - 30);

      await service.deleteOldNotifications();

      const whereCall = qb.where.mock.calls[0];
      const cutoff: Date = whereCall[1].cutoffDate;

      // Allow a small delta (1 second) to account for test execution time
      expect(Math.abs(cutoff.getTime() - before.getTime())).toBeLessThan(1000);
    });
  });
});

// ---------------------------------------------------------------------------
// NotificationEventsService  (notifyUser family)
// ---------------------------------------------------------------------------

describe('NotificationEventsService', () => {
  let eventsService: NotificationEventsService;
  let notificationsService: { create: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationEventsService,
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    eventsService = module.get<NotificationEventsService>(
      NotificationEventsService,
    );
  });

  it('should be defined', () => {
    expect(eventsService).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // notifyMarketResolved
  // -------------------------------------------------------------------------
  describe('notifyMarketResolved', () => {
    const stakers = [
      { wallet: '0xSTAKER1', amount: '100', choice: 'yes' as const },
      { wallet: '0xSTAKER2', amount: '50', choice: 'no' as const },
    ];

    it('creates a notification for the creator', async () => {
      await eventsService.notifyMarketResolved(
        1,
        'BTC up?',
        'yes',
        '0xCREATOR',
        stakers,
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientWallet: '0xCREATOR',
          type: NotificationType.MARKET_RESOLVED,
          resourceId: '1',
          resourceType: 'call',
        }),
      );
    });

    it('creates a notification for every staker', async () => {
      await eventsService.notifyMarketResolved(
        1,
        'BTC up?',
        'yes',
        '0xCREATOR',
        stakers,
      );

      // 1 creator + 2 stakers = 3 calls total
      expect(notificationsService.create).toHaveBeenCalledTimes(3);

      for (const staker of stakers) {
        expect(notificationsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ recipientWallet: staker.wallet }),
        );
      }
    });

    it('sets userWon=true for stakers whose choice matches the outcome', async () => {
      await eventsService.notifyMarketResolved(
        1,
        'BTC up?',
        'yes',
        '0xCREATOR',
        stakers,
      );

      const staker1Call = notificationsService.create.mock.calls.find(
        ([arg]) => arg.recipientWallet === '0xSTAKER1',
      )?.[0];
      expect(staker1Call?.payload.userWon).toBe(true);

      const staker2Call = notificationsService.create.mock.calls.find(
        ([arg]) => arg.recipientWallet === '0xSTAKER2',
      )?.[0];
      expect(staker2Call?.payload.userWon).toBe(false);
    });

    it('works with an empty stakers list (creator only)', async () => {
      await eventsService.notifyMarketResolved(
        1,
        'BTC up?',
        'yes',
        '0xCREATOR',
        [],
      );

      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // notifyStakeReceived
  // -------------------------------------------------------------------------
  describe('notifyStakeReceived', () => {
    it('notifies the call creator about the stake', async () => {
      await eventsService.notifyStakeReceived(
        42,
        'ETH up?',
        '0xSTAKER',
        '200',
        'yes',
        '0xCREATOR',
      );

      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientWallet: '0xCREATOR',
          type: NotificationType.STAKE_RECEIVED,
          payload: expect.objectContaining({
            callId: 42,
            staker: '0xSTAKER',
            amount: '200',
            choice: 'yes',
          }),
          resourceId: '42',
          resourceType: 'call',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // notifyNewFollower
  // -------------------------------------------------------------------------
  describe('notifyNewFollower', () => {
    it('notifies the followed wallet about the new follower', async () => {
      await eventsService.notifyNewFollower(
        '0xFOLLOWER',
        'alice',
        'https://avatar',
        '0xFOLLOWED',
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientWallet: '0xFOLLOWED',
          type: NotificationType.NEW_FOLLOWER,
          payload: expect.objectContaining({
            follower: '0xFOLLOWER',
            followerHandle: 'alice',
            followerAvatar: 'https://avatar',
          }),
          resourceId: '0xFOLLOWER',
          resourceType: 'user',
        }),
      );
    });

    it('handles undefined handle and avatar', async () => {
      await eventsService.notifyNewFollower(
        '0xFOLLOWER',
        undefined,
        undefined,
        '0xFOLLOWED',
      );

      const [arg] = notificationsService.create.mock.calls[0];
      expect(arg.payload.followerHandle).toBeUndefined();
      expect(arg.payload.followerAvatar).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Event emitters (smoke tests)
  // -------------------------------------------------------------------------
  describe('event emitters', () => {
    it('emits market.resolved event', () => {
      eventsService.emitMarketResolved({
        callId: 1,
        callTitle: 'test',
        outcome: 'yes',
        creatorWallet: '0xC',
        stakers: [],
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'market.resolved',
        expect.any(Object),
      );
    });

    it('emits stake.received event', () => {
      eventsService.emitStakeReceived({
        callId: 1,
        callTitle: 'test',
        staker: '0xS',
        amount: '10',
        choice: 'yes',
        creatorWallet: '0xC',
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'stake.received',
        expect.any(Object),
      );
    });

    it('emits follower.new event', () => {
      eventsService.emitNewFollower({
        follower: '0xF',
        followedWallet: '0xFW',
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'follower.new',
        expect.any(Object),
      );
    });
  });
});
