const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');  // <-- Nouvelle dépendance

async function extractTextFromFile(filePath, mimeType) {
    const buffer = fs.readFileSync(filePath);

    // --- PDF ---
    if (mimeType === 'application/pdf') {
        const data = await pdfParse(buffer);
        return data.text;
    }

    // --- WORD (.doc et .docx) ---
    if (mimeType === 'application/msword' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    }

    // --- TEXTE BRUT (.txt) ---
    if (mimeType === 'text/plain') {
        return buffer.toString('utf8');
    }

    // --- CSV (.csv) ---
    if (mimeType === 'text/csv') {
        const text = buffer.toString('utf8');
        // On transforme le CSV en texte lisible
        const lignes = text.split('\n').filter(line => line.trim() !== '');
        return lignes.map(ligne => ligne.replace(/[,;]/g, ' ')).join('\n');
    }

    // --- EXCEL (.xlsx, .xls) ---
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        // Convertir la feuille en texte lisible
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        return jsonData.map(row => row.join(' ')).join('\n');
    }

    throw new Error('Type de fichier non supporté. Utilisez PDF, Word, Excel, CSV ou TXT.');
}

module.exports = { extractTextFromFile };