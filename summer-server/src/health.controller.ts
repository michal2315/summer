import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './auth/auth.guard';
import { DatabaseService } from './database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Public()
  @Get()
  async health(): Promise<{ status: 'ok'; db: 'up' }> {
    if (!(await this.database.ping())) throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    return { status: 'ok', db: 'up' };
  }
}
