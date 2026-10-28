// express/services/mailService.js
const nodemailer = require('nodemailer');
const { prisma } = require('../services/prisma');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const mailService = {
  async send({ tenantId, to, subject, body, attachments = [] }) {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text: body,
      attachments,
    });

    await prisma.mailLog.create({
      data: {
        tenantId,
        to,
        subject,
        body,
        status: "SENT",
      },
    });

    return { messageId: info.messageId, to, subject };
  },
};

module.exports = { mailService };