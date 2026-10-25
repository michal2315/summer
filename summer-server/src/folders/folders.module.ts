import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { SummariesModule } from '../summaries/summaries.module';
import { UsersModule } from '../users/users.module';
import { FoldersController } from './folders.controller';
import { FoldersRepository } from './folders.repository';
import { FoldersService } from './folders.service';

@Module({
  imports: [SummariesModule, PermissionsModule, UsersModule],
  controllers: [FoldersController],
  providers: [FoldersRepository, FoldersService],
})
export class FoldersModule {}
