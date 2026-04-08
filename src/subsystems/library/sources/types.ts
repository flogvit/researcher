export interface SourcePlugin {
  readonly name: string;
  /** Run the source, inserting documents with status='metadata' into the database */
  fetch(settings: Record<string, unknown>): Promise<{ added: number; total: number }>;
}
