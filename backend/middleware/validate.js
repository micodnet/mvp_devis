// express/middleware/validate.js
const { BadRequest } = require('../errors/AppError');

/**
 * Validation ultra-légère sans dépendance.
 * Usage : validate({ body: { name: "string!" }, params: { id: "string!" } })
 * Suffixe "!" = requis.
 */
function validate(schema) {
  return (req, _res, next) => {
    try {
      for (const [source, fields] of Object.entries(schema)) {
        const data = req[source] || {};
        for (const [field, type] of Object.entries(fields)) {
          const required = type.endsWith("!");
          const t = required ? type.slice(0, -1) : type;
          const v = data[field];

          if (required && (v === undefined || v === null || v === "")) {
            throw BadRequest(`Champ requis : ${source}.${field}`);
          }
          if (v === undefined || v === null) continue;

          if (t === "array" && !Array.isArray(v)) {
            throw BadRequest(`Champ ${source}.${field} doit être un tableau`);
          }
          if (t === "number" && typeof v !== "number" && isNaN(Number(v))) {
            throw BadRequest(`Champ ${source}.${field} doit être un nombre`);
          }
          if (t === "string" && typeof v !== "string") {
            throw BadRequest(`Champ ${source}.${field} doit être une chaîne`);
          }
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { validate }