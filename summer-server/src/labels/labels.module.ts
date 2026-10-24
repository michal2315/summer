import { Module } from '@nestjs/common';
import { LabelsController } from './labels.controller';
import { LabelsRepository } from './labels.repository';

@Module({
  controllers: [LabelsController],
  providers: [LabelsRepository],
  exports: [LabelsRepository],
})
export class LabelsModule {}
