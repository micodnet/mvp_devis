// agents/core/longTermMemory.js
const { prisma } = require('../../../services/prisma');
const { embed } = require('./embeddings');

/**
 * Mémoire long terme persistante avec recherche sémantique via pgvector.
 * Isolée par (tenantId, agent).
 */
const longTermMemory = {
  /**
   * Enregistre un souvenir.
   */
  async remember({ tenantId, agent, kind, text, metadata = null }) {
    if (!text) throw new Error("remember() : text requis");
    const vector = await embed(text);

    // Prisma ne sait pas insérer directement un vecteur → on passe par du SQL brut
    const literal = `[${vector.join(",")}]`;
    const id = crypto.randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "MemoryEntry" ("id","tenantId","agent","kind","text","metadata","embedding","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::vector,NOW())`,
      id,
      tenantId,
      agent,
      kind,
      text,
      metadata ? JSON.stringify(metadata) : null,
      literal
    );

    return { id };
  },

  /**
   * Recherche les k souvenirs les plus proches sémantiquement.
   */
  async recall({ tenantId, agent, query, k = 5, minSimilarity = 0.3 }) {
    if (!query) return [];
    const vector = await embed(query);
    const literal = `[${vector.join(",")}]`;

    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id","kind","text","metadata","createdAt",
              1 - (embedding <=> $1::vector) AS similarity
       FROM "MemoryEntry"
       WHERE "tenantId" = $2 AND "agent" = $3 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      literal,
      tenantId,
      agent,
      k
    );

    return rows
      .filter((r) => Number(r.similarity) >= minSimilarity)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        metadata: r.metadata,
        similarity: Number(r.similarity),
        createdAt: r.createdAt,
      }));
  },

  /**
   * Supprime les souvenirs trop vieux pour un agent (nettoyage).
   */
  async prune({ tenantId, agent, keepLast = 500 }) {
    const ids = await prisma.memoryEntry.findMany({
      where: { tenantId, agent },
      orderBy: { createdAt: "desc" },
      skip: keepLast,
      select: { id: true },
    });
    if (!ids.length) return { deleted: 0 };
    const del = await prisma.memoryEntry.deleteMany({
      where: { id: { in: ids.map((i) => i.id) } },
    });
    return { deleted: del.count };
  },
};

module.exports = { longTermMemory };