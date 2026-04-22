import type { ModuleConfig } from '../../../core/module-config';

export interface SourceFilters {
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
  type?: string;
  language?: string;
}

export interface SourcePlugin {
  readonly name: string;
  /** Run the source, inserting documents with status='metadata' into the database */
  fetch(settings: Record<string, unknown>, moduleConfig?: ModuleConfig): Promise<{ added: number; total: number }>;
}
