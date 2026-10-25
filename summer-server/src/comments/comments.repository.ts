import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { Mention, comments, summaries } from '../database/schema';

@Injectable()
export class CommentsRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async insert(values: { summaryId: string; content: string; mentions: Mention[]; createdBy: string }) {
    const [row] = await this.db.insert(comments).values(values).returning();
    return row;
  }

  async find(id: string, summaryId: string) {
    const [row] = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.summaryId, summaryId)));
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(comments).where(eq(comments.id, id));
  }

  async summaryMeta(summaryId: string): Promise<{ title: string; createdBy: string } | undefined> {
    const [row] = await this.db.select({ title: summaries.title, createdBy: summaries.createdBy }).from(summaries).where(eq(summaries.id, summaryId));
    return row;
  }
}
