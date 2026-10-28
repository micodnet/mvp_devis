// agents/core/permissions.js
/**
 * Matrice de permissions par rôle.
 * Chaque rôle a un ensemble de scopes en lecture et en écriture.
 */

const ROLE_PERMISSIONS = {
  ADMIN: {
    read:  ["devis","facture","mail","stats","chantier","client","memory"],
    write: ["devis","facture","mail","stats","chantier","client","memory"],
  },
  USER: {
    read:  ["devis","facture","mail","stats","chantier","client","memory"],
    write: ["devis","facture","chantier","client","memory"],
  },
  VIEWER: {
    read:  ["devis","facture","stats","chantier","client","memory"],
    write: [],
  },
};

function resolvePermissions(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.VIEWER;
}

// Vérifie qu'une action est autorisée pour un rôle.
function can(role, scope, write = false) {
  const perms = resolvePermissions(role);
  return write ? perms.write.includes(scope) : perms.read.includes(scope);
}

module.exports = { ROLE_PERMISSIONS, resolvePermissions, can };