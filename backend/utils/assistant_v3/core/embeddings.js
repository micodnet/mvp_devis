// agents/core/embeddings.js
const { openai } = require('./llm');

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

/**
 * Calcule un embedding pour un texte.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  if (!text || typeof text !== "string") {
    throw new Error("embed() : texte requis");
  }
  const res = await openai.embeddings.create({
    model: MODEL,
    input: text.slice(0, 8000), // sécurité
    dimensions: DIMENSIONS,
  });
  return res.data[0].embedding;
}

const EMBEDDING_DIMENSIONS = DIMENSIONS;

module.exports = { embed, EMBEDDING_DIMENSIONS };