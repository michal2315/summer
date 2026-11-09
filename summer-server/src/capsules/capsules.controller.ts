import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { parse, zList } from '../common/validation';
import { Capsule, CapsuleWord } from './capsule';
import { CapsulesService } from './capsules.service';

export interface ApiCapsule {
  _id: string;
  name: string;
  description: string;
  words: CapsuleWord[];
}

const toApiCapsule = (c: Capsule): ApiCapsule => ({ _id: c.id, name: c.name, description: c.description, words: c.words });

const capsulesQuery = z.object({
  q: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  ids: zList.pipe(z.array(z.string().max(100)).max(50)),
  names: zList.pipe(z.array(z.string().max(100)).max(50)),
});

@Controller('capsules')
export class CapsulesController {
  constructor(private readonly capsules: CapsulesService) {}

  /** `?ids=` / `?names=` resolve known capsules (unknown ones are left out); otherwise autocomplete by name. */
  @Get()
  async list(@Query() query: unknown): Promise<ApiCapsule[]> {
    const { q, limit, ids, names } = parse(capsulesQuery, query);
    if (ids.length || names.length) {
      const found = await this.capsules.lookup({ ids, names });
      return [...ids.map((id) => found.byId(id)), ...names.map((n) => found.byName(n))]
        .filter((c, i, all): c is Capsule => !!c && all.indexOf(c) === i)
        .map(toApiCapsule);
    }
    return (await this.capsules.search(q.trim(), limit)).map(toApiCapsule);
  }
}
