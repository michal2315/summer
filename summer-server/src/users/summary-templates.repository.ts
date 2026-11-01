import { Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { SummaryTemplateData, summaryTemplates } from '../database/schema';

@Injectable()
export class SummaryTemplatesRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  list(userId: string) {
    return this.db.select().from(summaryTemplates).where(eq(summaryTemplates.userId, userId)).orderBy(asc(summaryTemplates.name));
  }

  async countFor(userId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(summaryTemplates).where(eq(summaryTemplates.userId, userId));
    return row.n;
  }

  async exists(userId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: summaryTemplates.id })
      .from(summaryTemplates)
      .where(and(eq(summaryTemplates.userId, userId), eq(summaryTemplates.name, name)));
    return rows.length > 0;
  }

  /** Saving under an existing name replaces that template. */
  async upsert(userId: string, name: string, data: SummaryTemplateData): Promise<void> {
    await this.db
      .insert(summaryTemplates)
      .values({ userId, name, data })
      .onConflictDoUpdate({ target: [summaryTemplates.userId, summaryTemplates.name], set: { data, updatedAt: new Date() } });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(summaryTemplates)
      .where(and(eq(summaryTemplates.id, id), eq(summaryTemplates.userId, userId)))
      .returning({ id: summaryTemplates.id });
    return rows.length > 0;
  }
}
