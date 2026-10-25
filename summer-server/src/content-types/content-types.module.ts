import { Module } from '@nestjs/common';
import { ContentTypesController } from './content-types.controller';
import { ContentTypesRepository } from './content-types.repository';

@Module({
  controllers: [ContentTypesController],
  providers: [ContentTypesRepository],
  exports: [ContentTypesRepository],
})
export class ContentTypesModule {}
