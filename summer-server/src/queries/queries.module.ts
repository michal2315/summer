import { Module } from '@nestjs/common';
import { QueriesController } from './queries.controller';
import { QueriesRepository } from './queries.repository';
import { QueriesService } from './queries.service';

@Module({
  controllers: [QueriesController],
  providers: [QueriesRepository, QueriesService],
})
export class QueriesModule {}
