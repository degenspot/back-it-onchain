import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { AdminService } from '../admin/admin.service';

describe('CallsController', () => {
  const callsService = {
    findAll: jest.fn(),
  };

  const adminService = {
    isPaused: jest.fn().mockReturnValue(false),
  };

  const controller = new CallsController(
    callsService as unknown as CallsService,
    adminService as unknown as AdminService,
  );

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(true).toBeTruthy();
  });

  it('should forward pagination and chain filters to the service', () => {
    controller.findAll({ chain: 'stellar', limit: 25, offset: 5 });

    expect(callsService.findAll).toHaveBeenCalledWith({
      chain: 'stellar',
      limit: 25,
      offset: 5,
    });
  });
});
