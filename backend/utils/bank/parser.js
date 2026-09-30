// backend/utils/bank/parser.js
// Parseur de releves bancaires (CSV, OFX, CAMT.053)

const fs = require('fs');
const XLSX = require('xlsx');

// ------------------------------------------------------------
// Detection du format du fichier
// ------------------------------------------------------------
function detectFormat(content, filename) {
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) return 'ofx';
    if (lower.endsWith('.xml') || content.trim().startsWith('<?xml')) return 'camt053';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
    return 'csv';
}

// ------------------------------------------------------------
// Parse un montant au format europeen ou US
// ------------------------------------------------------------
function parseAmount(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;

    let str = String(value).trim();
    if (!str) return null;

    // Retirer les symboles de monnaie
    str = str.replace(/[€$£]/g, '').replace(/EUR/gi, '').replace(/\s/g, '');

    // Detecter le format (virgule ou point comme separateur decimal)
    const hasComma = str.includes(',');
    const hasDot = str.includes('.');

    if (hasComma && hasDot) {
        // Format 1.234,56 (europeen) ou 1,234.56 (US)
        // Si la virgule est apres le point, format US
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            // Europeen
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            // US
            str = str.replace(/,/g, '');
        }
    } else if (hasComma) {
        // Que des virgules : separateur decimal europeen
        str = str.replace(',', '.');
    }

    const num = parseFloat(str);
    return isNaN(num) ? null : num;
}

// ------------------------------------------------------------
// Parse une date dans differents formats
// ------------------------------------------------------------
function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);

    const str = String(value).trim();

    // Format ISO : 2026-09-15
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.slice(0, 10);
    }

    // Format DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
    const match = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (match) {
        let day = match[1].padStart(2, '0');
        let month = match[2].padStart(2, '0');
        let year = match[3];
        if (year.length === 2) year = '20' + year;
        return year + '-' + month + '-' + day;
    }

    return null;
}

// ------------------------------------------------------------
// Detecte les colonnes d'un CSV en fonction des entetes
// ------------------------------------------------------------
function detectColumns(headers) {
    const normalized = headers.map(h => String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());

    const find = (...keys) => {
        for (const key of keys) {
            const idx = normalized.findIndex(h => h === key);
            if (idx !== -1) return idx;
        }
        for (const key of keys) {
            const idx = normalized.findIndex(h => h.includes(key));
            if (idx !== -1) return idx;
        }
        return -1;
    };

    return {
        date: find('date', 'datum', 'transaction date', 'date operation', 'date comptable', 'valuedate', 'value date'),
        valueDate: find('value date', 'date valeur', 'valuedate'),
        amount: find('montant', 'amount', 'bedrag', 'somme'),
        debit: find('debit', 'debet'),
        credit: find('credit', 'krediet'),
        description: find('description', 'libelle', 'communication', 'detail', 'narrative', 'mededeling', 'omschrijving', 'wording'),
        counterparty: find('contrepartie', 'counterparty', 'beneficiaire', 'tiers', 'naam', 'name', 'tegenpartij'),
        reference: find('reference', 'ref', 'mededeling', 'communication structuree'),
        balance: find('solde', 'balance', 'saldo'),
        currency: find('devise', 'currency', 'munt')
    };
}

// ------------------------------------------------------------
// Parse un fichier CSV
// ------------------------------------------------------------
function parseCSV(content) {
    // Detecter le separateur (virgule, point-virgule, tab)
    const firstLine = content.split('\n')[0];
    let separator = ',';
    if (firstLine.includes(';') && !firstLine.includes(',')) separator = ';';
    else if (firstLine.includes('\t')) separator = '\t';
    else if (firstLine.split(';').length > firstLine.split(',').length) separator = ';';

    // Parser le CSV manuellement (pour eviter les dependances)
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) throw new Error('Fichier CSV vide ou invalide');

    const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ''));
    const columns = detectColumns(headers);

    if (columns.date === -1 || (columns.amount === -1 && columns.credit === -1 && columns.debit === -1)) {
        throw new Error('Colonnes obligatoires introuvables (date et montant). Verifiez le format de votre CSV.');
    }

    const transactions = [];

    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(separator).map(c => c.trim().replace(/^"|"$/g, ''));

        const date = parseDate(cells[columns.date]);
        if (!date) continue;

        let amount = 0;

        // Si colonnes debit/credit separees
        if (columns.credit !== -1 || columns.debit !== -1) {
            const credit = columns.credit !== -1 ? parseAmount(cells[columns.credit]) : 0;
            const debit = columns.debit !== -1 ? parseAmount(cells[columns.debit]) : 0;
            amount = (credit || 0) - (debit || 0);
        } else {
            amount = parseAmount(cells[columns.amount]);
        }

        if (amount === null || amount === 0) continue;

        const valueDate = columns.valueDate !== -1 ? parseDate(cells[columns.valueDate]) : null;
        const description = columns.description !== -1 ? cells[columns.description] : '';
        const counterparty = columns.counterparty !== -1 ? cells[columns.counterparty] : '';
        const reference = columns.reference !== -1 ? cells[columns.reference] : '';
        const currency = columns.currency !== -1 ? cells[columns.currency] : 'EUR';

        transactions.push({
            date: date,
            valueDate: valueDate,
            amount: amount,
            currency: (currency || 'EUR').toUpperCase().slice(0, 3),
            description: description || null,
            counterparty: counterparty || null,
            reference: reference || null,
            transactionType: amount > 0 ? 'credit' : 'debit'
        });
    }

    return transactions;
}

// ------------------------------------------------------------
// Parse un fichier OFX
// ------------------------------------------------------------
function parseOFX(content) {
    const transactions = [];

    // Extraire les blocs <STMTTRN>
    const stmtRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
    let match;

    while ((match = stmtRegex.exec(content)) !== null) {
        const block = match[1];

        const getTag = (tag) => {
            const m = block.match(new RegExp('<' + tag + '>([^<\\n]+)', 'i'));
            return m ? m[1].trim() : null;
        };

        const dateStr = getTag('DTPOSTED');
        const amountStr = getTag('TRNAMT');
        const type = getTag('TRNTYPE');
        const memo = getTag('MEMO');
        const name = getTag('NAME');

        const date = dateStr ? dateStr.slice(0, 8) : null;
        if (!date) continue;

        const formattedDate = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8);
        const amount = parseAmount(amountStr);

        if (amount === null || amount === 0) continue;

        transactions.push({
            date: formattedDate,
            valueDate: null,
            amount: amount,
            currency: 'EUR',
            description: memo || null,
            counterparty: name || null,
            reference: null,
            transactionType: amount > 0 ? 'credit' : 'debit'
        });
    }

    return transactions;
}

// ------------------------------------------------------------
// Parse un fichier XLSX
// ------------------------------------------------------------
function parseXLSX(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) throw new Error('Fichier Excel vide');

    // Reutiliser la logique CSV
    const csvContent = rows.map(row =>
        row.map(cell => {
            if (cell instanceof Date) return cell.toISOString().slice(0, 10);
            return String(cell).replace(/;/g, ',');
        }).join(';')
    ).join('\n');

    return parseCSV(csvContent);
}

// ------------------------------------------------------------
// Point d'entree : parse un fichier selon son format
// ------------------------------------------------------------
function parseBankStatement(filePath, originalName, mimeType) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const format = detectFormat(content, originalName);

    let transactions = [];

    if (format === 'ofx') {
        transactions = parseOFX(content);
    } else if (format === 'xlsx') {
        const buffer = fs.readFileSync(filePath);
        transactions = parseXLSX(buffer);
    } else if (format === 'camt053') {
        transactions = parseCAMT053(content);
    } else {
        transactions = parseCSV(content);
    }

    return {
        format: format,
        transactions: transactions.filter(t => t.date && t.amount)
    };
}

// ------------------------------------------------------------
// Parse un fichier CAMT.053 (XML)
// ------------------------------------------------------------
function parseCAMT053(content) {
    const transactions = [];

    // Regex simple pour extraire les blocs <Ntry>
    const entryRegex = /<Ntry[^>]*>([\s\S]*?)<\/Ntry>/gi;
    let match;

    while ((match = entryRegex.exec(content)) !== null) {
        const block = match[1];

        const getTag = (tag) => {
            const m = block.match(new RegExp('<' + tag + '[^>]*>([^<]+)', 'i'));
            return m ? m[1].trim() : null;
        };

        const amountStr = getTag('Amt');
        const currency = block.match(/Ccy="([A-Z]{3})"/i)?.[1] || 'EUR';
        const bookDate = getTag('BookgDt') || getTag('ValDt');
        const creditDebit = getTag('CdtDbtInd'); // CRDT ou DBIT
        const addtlInfo = getTag('AddtlNtryInf') || getTag('Ustrd');

        let amount = parseAmount(amountStr);
        if (amount !== null && creditDebit === 'DBIT') amount = -Math.abs(amount);

        if (!bookDate || amount === null) continue;

        // Extraire la date propre (YYYYMMDD ou ISO)
        let date = bookDate;
        const isoMatch = bookDate.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            date = isoMatch[0];
        } else {
            const yyyymmdd = bookDate.match(/(\d{4})(\d{2})(\d{2})/);
            if (yyyymmdd) date = yyyymmdd[1] + '-' + yyyymmdd[2] + '-' + yyyymmdd[3];
        }

        transactions.push({
            date: date,
            valueDate: null,
            amount: amount,
            currency: currency,
            description: addtlInfo || null,
            counterparty: null,
            reference: null,
            transactionType: amount > 0 ? 'credit' : 'debit'
        });
    }

    return transactions;
}

module.exports = {
    parseBankStatement,
    parseAmount,
    parseDate,
    detectFormat
};