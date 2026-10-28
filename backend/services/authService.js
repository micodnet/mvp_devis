// express/services/authService.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { prisma } = require('../services/prisma');
const { BadRequest, Unauthorized, Conflict } = require('../errors/AppError');

function signToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tenantId: u.tenantId,
  };
}

const authService = {
  /**
   * Inscription : crée un Tenant + un User ADMIN.
   * (Pour des utilisateurs ajoutés à un tenant existant, voir registerInto.)
   */
  async register({ email, password, name, tenantName }) {
    if (!email || !password || !name) throw BadRequest("email, password, name requis");
    if (password.length < 8) throw BadRequest("Mot de passe : 8 caractères minimum");

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw Conflict("Email déjà utilisé");

    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: tenantName || `${name}'s company` },
      });
      return tx.user.create({
        data: {
          email,
          name,
          password: hash,
          role: "ADMIN",
          tenantId: tenant.id,
        },
      });
    });

    return { token: signToken(user), user: publicUser(user) };
  },

  async login({ email, password }) {
    if (!email || !password) throw BadRequest("email et password requis");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw Unauthorized("Identifiants invalides");

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw Unauthorized("Identifiants invalides");

    return { token: signToken(user), user: publicUser(user) };
  },

  async me(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user) throw Unauthorized("Utilisateur introuvable");
    return { ...publicUser(user), tenant: { id: user.tenant.id, name: user.tenant.name } };
  },
};

module.exports = { authService };