import { Module } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service.js';

/**
 * ANALYZER: checks and scoring
 *
 * Loaded only by the worker. The checks are listed in AnalyzerService.
 */
@Module({
  providers: [AnalyzerService],
  exports: [AnalyzerService],
})
export class AnalyzerModule {}
