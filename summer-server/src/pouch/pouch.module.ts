import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PouchController } from './pouch.controller';
import { PouchRepository } from './pouch.repository';
import { PouchService } from './pouch.service';

@Module({
  imports: [UsersModule],
  controllers: [PouchController],
  providers: [PouchRepository, PouchService],
})
export class PouchModule {}
