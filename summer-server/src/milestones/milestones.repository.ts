import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';

/** The client's summary palette (summer-client shared/models/colors.ts) — "all colors" means every one of these. */
const SUMMARY_COLORS = ['#fe9eae', '#ff0000', '#ffa500', '#008000', '#00b2b2', '#0000c9', '#800080', '#808080'];

/** Summer's first commit — 24 October. */
const BIRTHDAY = { month: 10, day: 24 };

/** Milestone id (shared with the client's milestones.ts) → whether the author has earned it. */
export type MilestoneFlags = Record<string, boolean>;

/**
 * Profile milestones, judged over ALL of an author's published summaries (drafts don't count), regardless of who is
 * looking — only yes/no flags leave the server, never the summaries behind them. Times are local (APP_TIMEZONE).
 */
@Injectable()
export class MilestonesRepository {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  async flags(authorId: string): Promise<MilestoneFlags> {
    const colors = sql.join(
      SUMMARY_COLORS.map((c) => sql`${c}`),
      sql`, `,
    );
    const [row] = await this.database.db
      .execute<MilestoneFlags>(
        sql`
      with mine as (
        select s.id, s.kind, s.link, s.color, s.content_type_id, s.content_text,
               s.created_at at time zone ${this.config.timezone} as created,
               s.updated_at at time zone ${this.config.timezone} as updated,
               s.event_date at time zone ${this.config.timezone} as event
        from summaries s
        where s.created_by = ${authorId} and not s.is_draft
      ),
      days as (select distinct created::date as d from mine),
      -- consecutive days share d - row_number()
      streaks as (select count(*) as len from (select d, d - (row_number() over (order by d))::int as grp from days) x group by grp),
      -- Sunday–Saturday weeks (date_trunc's weeks start on Monday, so shift by a day)
      weeks as (select count(*) as n from days group by date_trunc('week', d + 1))
      select
        (select count(*) from mine) >= 1 as "first",
        (select count(*) from mine) >= 10 as "ten",
        (select count(*) from mine) >= 50 as "fifty",
        (select count(*) from mine) >= 100 as "hundred",

        exists (select 1 from mine where extract(hour from created) < 5) as "night-owl",
        exists (select 1 from mine where extract(hour from created) >= 5 and extract(hour from created) < 7) as "early-bird",
        exists (select 1 from mine where extract(hour from created) = 0 and extract(minute from created) = 0) as "midnight",
        exists (select 1 from mine where extract(dow from created) = 6) as "weekend",
        exists (select 1 from mine where extract(month from created) in (7, 8)) as "summer",
        exists (select 1 from mine where extract(month from created) = ${BIRTHDAY.month} and extract(day from created) = ${BIRTHDAY.day}) as "birthday",
        coalesce((select max(len) from streaks), 0) >= 7 as "streak",
        coalesce((select max(n) from weeks), 0) >= 5 as "full-week",
        exists (select 1 from mine where event::date = created::date) as "live",
        exists (select 1 from mine where created::date - event::date > 365) as "archaeology",
        exists (select 1 from mine where updated::date - created::date > 30) as "rewrite",

        exists (select 1 from mine where kind = 'running') as "marathon",
        exists (select 1 from mine m where m.kind = 'running'
                and (select count(*) from summaries c where c.parent_id = m.id and not c.is_draft) >= 20) as "long-run",
        exists (select 1 from mine where kind = 'sumaroon' and coalesce(link, '') <> '') as "linked",
        (select count(distinct lower(color)) from mine where color <> '') >= 5 as "rainbow",
        (select count(distinct lower(color)) from mine where lower(color) in (${colors})) = ${SUMMARY_COLORS.length} as "all-colors",
        exists (select 1 from content_types)
          and not exists (select 1 from content_types ct where not exists (select 1 from mine where content_type_id = ct.id)) as "all-types",
        (select count(distinct sl.label_id) from summary_labels sl join mine on mine.id = sl.summary_id) >= 10 as "labels",
        exists (select 1 from mine m where (select count(*) from summary_files f where f.summary_id = m.id) >= 3) as "files",
        exists (select 1 from mine m where (select count(*) from summary_tagged_users t where t.summary_id = m.id) >= 5) as "team",
        exists (select 1 from mine m where (select count(*) from summary_collections sc where sc.summary_id = m.id) >= 3) as "organized",

        exists (select 1 from mine where length(trim(content_text)) > 5000) as "epic",
        exists (select 1 from mine where length(trim(content_text)) between 1 and 139) as "tldr",
        exists (select 1 from mine where length(trim(content_text)) = 100) as "exactly-100",

        exists (select 1 from mine m where (select count(*) from comments c where c.summary_id = m.id) >= 5) as "talk",
        exists (select 1 from mine m join comments c on c.summary_id = m.id where c.created_by = ${authorId}) as "self-talk",
        exists (select 1 from mine m where (select count(*) from summary_seen v where v.summary_id = m.id) >= 20) as "popular"
    `,
      )
      .then((r) => r.rows);
    return row;
  }
}
