import { Injectable } from '@nestjs/common';
import { asc, eq, ilike, inArray } from 'drizzle-orm';
import { likePattern } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { labels } from '../database/schema';

const LABEL_PAGE = 20;

/** Reusable labels (autocomplete + classification). Labels have no viewing permissions. */
@Injectable()
export class LabelsRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async names(text: string, skip: number): Promise<string[]> {
    const rows = await this.db
      .select({ name: labels.name })
      .from(labels)
      .where(text ? ilike(labels.name, likePattern(text)) : undefined)
      .orderBy(asc(labels.name))
      .offset(skip)
      .limit(LABEL_PAGE);
    return rows.map((r) => r.name);
  }

  async idByName(name: string): Promise<string | undefined> {
    const [row] = await this.db.select({ id: labels.id }).from(labels).where(eq(labels.name, name.trim()));
    return row?.id;
  }

  /** Find-or-create labels by name (idempotent under concurrency); returns name → id. */
  async ensure(names: string[]): Promise<Map<string, string>> {
    if (!names.length) return new Map();
    await this.db
      .insert(labels)
      .values(names.map((name) => ({ name })))
      .onConflictDoNothing({ target: labels.name });
    const rows = await this.db.select({ id: labels.id, name: labels.name }).from(labels).where(inArray(labels.name, names));
    return new Map(rows.map((r) => [r.name, r.id]));
  }
}
