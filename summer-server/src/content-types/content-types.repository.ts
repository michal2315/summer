import { Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { ApiContentType, ApiField } from '../common/api-types';
import { DatabaseService } from '../database/database.service';
import { contentTypeFields, contentTypes, fields } from '../database/schema';

export type FieldRow = typeof fields.$inferSelect;
export type ContentTypeWithFields = typeof contentTypes.$inferSelect & { fields: (typeof contentTypeFields.$inferSelect)[] };

export const toApiField = (f: FieldRow): ApiField => ({ _id: f.id, name: f.name, type: f.type });

export const toApiContentType = (t: ContentTypeWithFields): ApiContentType => ({
  _id: t.id,
  name: t.name,
  displayName: t.displayName,
  icon: t.icon ?? undefined,
  color: t.color ?? undefined,
  fields: t.fields.map((f) => ({ field: f.fieldId, required: f.required })),
});

/** Content types (lecture, video, textbook…) and the reusable custom fields they are made of. */
@Injectable()
export class ContentTypesRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  contentTypes(): Promise<ContentTypeWithFields[]> {
    return this.db.query.contentTypes.findMany({
      orderBy: [asc(contentTypes.position), asc(contentTypes.name)],
      with: { fields: { orderBy: [asc(contentTypeFields.position)] } },
    });
  }

  contentType(id: string): Promise<ContentTypeWithFields | undefined> {
    return this.db.query.contentTypes.findFirst({
      where: eq(contentTypes.id, id),
      with: { fields: { orderBy: [asc(contentTypeFields.position)] } },
    });
  }

  fields(): Promise<FieldRow[]> {
    return this.db.select().from(fields).orderBy(asc(fields.name));
  }

  fieldsByIds(ids: string[]): Promise<FieldRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.db.select().from(fields).where(inArray(fields.id, ids));
  }
}
