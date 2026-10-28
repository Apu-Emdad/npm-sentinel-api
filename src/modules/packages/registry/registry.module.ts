import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service.js';

@Module({
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
