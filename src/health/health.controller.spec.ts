import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let healthController: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    healthController = module.get<HealthController>(HealthController);
  });

  it('sends status ok', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    healthController.check(res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 200,
      message: 'API is up',
      data: { status: 'ok' },
    });
  });
});
