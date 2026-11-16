import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { searchNormalize } from './search-text';

export interface SearchIndexInput {
  title: string;
  // Extra searchable words (keywords, category, spec...) joined with the title.
  keywords?: string[];
  data?: Record<string, unknown>;
  status?: string;
}

export interface SearchHit {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  data: unknown;
  score: number;
}

// MySQL FULLTEXT search (P2.23) over search_documents with the ngram parser
// (added by raw SQL in the migration). Domain modules keep rows fresh via
// upsert/remove when their own tables land (P3/P4).
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(entityType: string, entityId: string, input: SearchIndexInput): Promise<void> {
    const text = searchNormalize([input.title, ...(input.keywords ?? [])].join(' ')).slice(0, 500);
    if (!text) return;
    await this.prisma.searchDocument.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      create: {
        entityType,
        entityId,
        title: input.title,
        searchText: text,
        data: input.data ? (input.data as object) : undefined,
        status: input.status ?? 'published',
      },
      update: {
        title: input.title,
        searchText: text,
        data: input.data ? (input.data as object) : undefined,
        status: input.status ?? 'published',
      },
    });
  }

  async remove(entityType: string, entityId: string): Promise<void> {
    await this.prisma.searchDocument.deleteMany({ where: { entityType, entityId } });
  }

  // Natural-language FULLTEXT match on the normalized column; returns hits
  // ranked by relevance plus the measured query time (DoD: < 200 ms).
  async search(
    query: string,
    opts: { entityType?: string; limit?: number; offset?: number } = {},
  ): Promise<{ items: SearchHit[]; total: number; tookMs: number }> {
    const startedAt = Date.now();
    const normalized = searchNormalize(query);
    if (normalized.length < 2) {
      return { items: [], total: 0, tookMs: 0 };
    }
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = Math.max(0, opts.offset ?? 0);

    // $queryRaw keeps the FULLTEXT ranking; parameters prevent injection.
    // Two branches because conditional fragments are not composable in $queryRaw.
    const rows = opts.entityType
      ? await this.prisma.$queryRaw<SearchRow[]>`
          SELECT s.\`id\`, s.\`entityType\`, s.\`entityId\`, s.\`title\`, s.\`data\`,
                 MATCH(s.\`searchText\`) AGAINST (${normalized} IN NATURAL LANGUAGE MODE) AS score,
                 COUNT(*) OVER () AS total
          FROM search_documents s
          WHERE s.\`status\` = 'published'
            AND s.\`entityType\` = ${opts.entityType}
            AND MATCH(s.\`searchText\`) AGAINST (${normalized} IN NATURAL LANGUAGE MODE)
          ORDER BY score DESC, s.\`title\` ASC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await this.prisma.$queryRaw<SearchRow[]>`
          SELECT s.\`id\`, s.\`entityType\`, s.\`entityId\`, s.\`title\`, s.\`data\`,
                 MATCH(s.\`searchText\`) AGAINST (${normalized} IN NATURAL LANGUAGE MODE) AS score,
                 COUNT(*) OVER () AS total
          FROM search_documents s
          WHERE s.\`status\` = 'published'
            AND MATCH(s.\`searchText\`) AGAINST (${normalized} IN NATURAL LANGUAGE MODE)
          ORDER BY score DESC, s.\`title\` ASC
          LIMIT ${limit} OFFSET ${offset}
        `;

    return {
      items: rows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        title: row.title,
        data: row.data,
        score: Number(row.score),
      })),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
      tookMs: Date.now() - startedAt,
    };
  }
}

interface SearchRow {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  data: unknown;
  score: number;
  total: bigint;
}
