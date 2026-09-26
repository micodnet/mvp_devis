// SDK JavaScript officiel pour l'API Devis Express Pro
// Version 1.0.0

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_BASE_URL = 'https://mvp-devis.onrender.com/api/v1';
const DEFAULT_TIMEOUT = 30000;

class DevisExpressError extends Error {
    constructor(message, statusCode, response) {
        super(message);
        this.name = 'DevisExpressError';
        this.statusCode = statusCode;
        this.response = response;
    }
}

class HttpClient {
    constructor(apiKey, baseUrl, timeout) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('apiKey requis (commence par dsk_)');
        }
        if (!apiKey.startsWith('dsk_')) {
            throw new Error('apiKey invalide (doit commencer par dsk_)');
        }
        this.apiKey = apiKey;
        this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
        this.timeout = timeout || DEFAULT_TIMEOUT;
    }

    request(method, path, body, query) {
        return new Promise((resolve, reject) => {
            let fullUrl = this.baseUrl + path;
            if (query && Object.keys(query).length > 0) {
                const params = new URLSearchParams();
                Object.entries(query).forEach(([k, v]) => {
                    if (v !== undefined && v !== null && v !== '') {
                        params.append(k, v);
                    }
                });
                const qs = params.toString();
                if (qs) fullUrl += '?' + qs;
            }

            let parsedUrl;
            try {
                parsedUrl = new URL(fullUrl);
            } catch (e) {
                return reject(new Error('URL invalide: ' + fullUrl));
            }

            const lib = parsedUrl.protocol === 'https:' ? https : http;
            const bodyString = body ? JSON.stringify(body) : null;

            const headers = {
                'X-API-Key': this.apiKey,
                'Accept': 'application/json',
                'User-Agent': 'DevisExpressPro-SDK-JS/1.0.0'
            };
            if (bodyString) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(bodyString);
            }

            const req = lib.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: method,
                headers: headers,
                timeout: this.timeout
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    let parsed = null;
                    try {
                        parsed = data ? JSON.parse(data) : null;
                    } catch (e) {
                        parsed = data;
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        const message = parsed && parsed.error
                            ? parsed.error
                            : 'HTTP ' + res.statusCode;
                        reject(new DevisExpressError(message, res.statusCode, parsed));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new DevisExpressError('Erreur reseau: ' + err.message, 0, null));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new DevisExpressError('Timeout apres ' + this.timeout + 'ms', 0, null));
            });

            if (bodyString) req.write(bodyString);
            req.end();
        });
    }

    get(path, query) { return this.request('GET', path, null, query); }
    post(path, body) { return this.request('POST', path, body); }
    put(path, body) { return this.request('PUT', path, body); }
    delete(path) { return this.request('DELETE', path); }
}

class QuotesResource {
    constructor(http) { this.http = http; }

    list(options) {
        return this.http.get('/quotes', options || {});
    }

    get(id) {
        if (!id) throw new Error('id requis');
        return this.http.get('/quotes/' + id);
    }

    create(data) {
        if (!data || !Array.isArray(data.items) || data.items.length === 0) {
            throw new Error('data.items requis (tableau non vide)');
        }
        return this.http.post('/quotes', data);
    }
}

class ClientsResource {
    constructor(http) { this.http = http; }

    list(options) {
        return this.http.get('/clients', options || {});
    }

    create(data) {
        if (!data || !data.name) {
            throw new Error('data.name requis');
        }
        return this.http.post('/clients', data);
    }
}

class ProductsResource {
    constructor(http) { this.http = http; }

    list(options) {
        return this.http.get('/products', options || {});
    }
}

class InvoicesResource {
    constructor(http) { this.http = http; }

    list(options) {
        return this.http.get('/invoices', options || {});
    }
}

class ChantiersResource {
    constructor(http) { this.http = http; }

    list(options) {
        return this.http.get('/chantiers', options || {});
    }
}

class StatsResource {
    constructor(http) { this.http = http; }

    get() {
        return this.http.get('/stats');
    }
}

class AccountResource {
    constructor(http) { this.http = http; }

    me() {
        return this.http.get('/me');
    }
}

class DevisExpress {
    constructor(options) {
        if (!options || !options.apiKey) {
            throw new Error('options.apiKey requis');
        }
        this.http = new HttpClient(
            options.apiKey,
            options.baseUrl,
            options.timeout
        );

        this.quotes = new QuotesResource(this.http);
        this.clients = new ClientsResource(this.http);
        this.products = new ProductsResource(this.http);
        this.invoices = new InvoicesResource(this.http);
        this.chantiers = new ChantiersResource(this.http);
        this.stats = new StatsResource(this.http);
        this.account = new AccountResource(this.http);
    }
}

module.exports = DevisExpress;
module.exports.DevisExpress = DevisExpress;
module.exports.DevisExpressError = DevisExpressError;