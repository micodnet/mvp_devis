// express/services/pdf.js
const PDFDocument = require('pdfkit');

function generatePdf(devis) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(20).text(`Devis ${devis.numero}`, { align: "right" });
      doc.moveDown();
      doc.fontSize(12).text(`Client : ${devis.client.name}`);
      if (devis.client.address) doc.text(devis.client.address);
      if (devis.client.email) doc.text(devis.client.email);
      doc.moveDown();

      doc.text("Description", 50, doc.y, { width: 250, continued: true });
      doc.text("Qté", { width: 60, align: "right", continued: true });
      doc.text("PU HT", { width: 80, align: "right", continued: true });
      doc.text("Total HT", { width: 80, align: "right" });
      doc.moveDown(0.5);

      for (const l of devis.lignes) {
        doc.text(l.description, 50, doc.y, { width: 250, continued: true });
        doc.text(String(l.quantite), { width: 60, align: "right", continued: true });
        doc.text(`${l.prixUnitaire.toFixed(2)} €`, { width: 80, align: "right", continued: true });
        doc.text(`${l.total.toFixed(2)} €`, { width: 80, align: "right" });
      }

      doc.moveDown();
      doc.text(`Total HT : ${devis.totalHT.toFixed(2)} €`, { align: "right" });
      doc.text(`TVA : ${devis.totalTVA.toFixed(2)} €`, { align: "right" });
      doc.fontSize(14).text(`Total TTC : ${devis.totalTTC.toFixed(2)} €`, { align: "right" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generatePdf };