// backend/routes/api-docs.js
// Documentation OpenAPI de l'API publique

const express = require('express');

const router = express.Router();

const spec = {
    openapi: '3.0.0',
    info: {
        title: 'Devis Express Pro API',
        version: '1.0.0',
        description: 'API REST pour acceder a vos devis, factures, clients et chantiers. Authentification par cle API dans le header Authorization: Bearer dsk_xxx ou X-API-Key: dsk_xxx.'
    },
    servers: [
        { url: '/api/v1', description: 'Production' }
    ],
    security: [
        { ApiKeyAuth: [] }
    ],
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-API-Key',
                description: 'Votre cle API commencant par dsk_'
            }
        },
        schemas: {
            Quote: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    number: { type: 'string' },
                    issueDate: { type: 'string', format: 'date' },
                    validDate: { type: 'string', format: 'date' },
                    clientName: { type: 'string' },
                    clientEmail: { type: 'string' },
                    subtotal: { type: 'number' },
                    vatAmount: { type: 'number' },
                    total: { type: 'number' },
                    currency: { type: 'string' },
                    status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'refused'] }
                }
            },
            Client: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    contactName: { type: 'string' },
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    address: { type: 'string' },
                    vatNumber: { type: 'string' }
                }
            },
            Product: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    ref: { type: 'string' },
                    name: { type: 'string' },
                    category: { type: 'string' },
                    unit: { type: 'string' },
                    unitPrice: { type: 'number' },
                    trackStock: { type: 'boolean' }
                }
            },
            Invoice: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    number: { type: 'string' },
                    type: { type: 'string' },
                    issueDate: { type: 'string', format: 'date' },
                    dueDate: { type: 'string', format: 'date' },
                    clientName: { type: 'string' },
                    subtotal: { type: 'number' },
                    vatAmount: { type: 'number' },
                    total: { type: 'number' },
                    amountPaid: { type: 'number' },
                    amountDue: { type: 'number' },
                    status: { type: 'string' }
                }
            },
            Chantier: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    reference: { type: 'string' },
                    clientName: { type: 'string' },
                    status: { type: 'string' },
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' }
                }
            },
            Error: {
                type: 'object',
                properties: {
                    error: { type: 'string' }
                }
            }
        }
    },
    paths: {
        '/me': {
            get: {
                summary: 'Informations sur le compte',
                tags: ['Compte'],
                responses: {
                    200: { description: 'Succes' },
                    401: { description: 'Cle API invalide', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
                }
            }
        },
        '/quotes': {
            get: {
                summary: 'Liste des devis',
                tags: ['Devis'],
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filtrer par statut' },
                    { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Date de debut' },
                    { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Date de fin' },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Nombre maximum de resultats' }
                ],
                responses: {
                    200: {
                        description: 'Liste des devis',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Quote' } }
                            }
                        }
                    }
                }
            },
            post: {
                summary: 'Creer un devis',
                tags: ['Devis'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['items'],
                                properties: {
                                    items: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                name: { type: 'string' },
                                                qty: { type: 'number' },
                                                unitPrice: { type: 'number' }
                                            }
                                        }
                                    },
                                    clientName: { type: 'string' },
                                    clientEmail: { type: 'string' },
                                    clientAddress: { type: 'string' },
                                    clientVat: { type: 'string' },
                                    vatRegime: { type: 'string', enum: ['franchise', 'assujetti'] }
                                }
                            }
                        }
                    }
                },
                responses: {
                    201: { description: 'Devis cree' },
                    400: { description: 'Donnees invalides' }
                }
            }
        },
        '/quotes/{id}': {
            get: {
                summary: 'Detail d\'un devis',
                tags: ['Devis'],
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: {
                    200: {
                        description: 'Detail du devis',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Quote' } } }
                    },
                    404: { description: 'Devis introuvable' }
                }
            }
        },
        '/clients': {
            get: {
                summary: 'Liste des clients',
                tags: ['Clients'],
                parameters: [
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }
                ],
                responses: {
                    200: {
                        description: 'Liste des clients',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Client' } }
                            }
                        }
                    }
                }
            },
            post: {
                summary: 'Creer un client',
                tags: ['Clients'],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name'],
                                properties: {
                                    name: { type: 'string' },
                                    contactName: { type: 'string' },
                                    email: { type: 'string' },
                                    phone: { type: 'string' },
                                    address: { type: 'string' },
                                    vatNumber: { type: 'string' },
                                    notes: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    201: { description: 'Client cree' }
                }
            }
        },
        '/products': {
            get: {
                summary: 'Liste des produits',
                tags: ['Produits'],
                parameters: [
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }
                ],
                responses: {
                    200: {
                        description: 'Liste des produits',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Product' } }
                            }
                        }
                    }
                }
            }
        },
        '/invoices': {
            get: {
                summary: 'Liste des factures',
                tags: ['Factures'],
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
                ],
                responses: {
                    200: {
                        description: 'Liste des factures',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } }
                            }
                        }
                    }
                }
            }
        },
        '/chantiers': {
            get: {
                summary: 'Liste des chantiers',
                tags: ['Chantiers'],
                parameters: [
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
                ],
                responses: {
                    200: {
                        description: 'Liste des chantiers',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Chantier' } }
                            }
                        }
                    }
                }
            }
        },
        '/stats': {
            get: {
                summary: 'Statistiques rapides',
                tags: ['Statistiques'],
                responses: {
                    200: { description: 'Statistiques' }
                }
            }
        }
    }
};

// ============================================================
// GET /api/docs/openapi.json — Specification OpenAPI
// ============================================================
router.get('/openapi.json', (req, res) => {
    res.json(spec);
});

// ============================================================
// GET /api/docs — Page HTML de documentation
// ============================================================
router.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation - Devis Express Pro</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
        body { margin: 0; padding: 0; background: #0b1120; }
        .topbar { display: none; }
        .swagger-ui .info .title { color: #fff; }
        .swagger-ui { background: #0b1120; color: #e2e8f0; }
        .swagger-ui .info { margin: 30px 0; }
        .swagger-ui .scheme-container { background: #161f32; box-shadow: none; padding: 20px; }
        .swagger-ui .opblock { background: #161f32; border-color: #2a3a55; }
        .swagger-ui .opblock .opblock-summary { border-color: #2a3a55; }
        .swagger-ui .opblock-description-wrapper p,
        .swagger-ui .response-col_status,
        .swagger-ui .parameter__name,
        .swagger-ui .parameter__type { color: #cbd5e1; }
        .swagger-ui .btn { background: #f97316; color: #0b1120; border: none; }
        .swagger-ui .btn:hover { background: #ea580c; }
        .swagger-ui select,
        .swagger-ui input[type=text],
        .swagger-ui textarea { background: #0b1120; color: #e2e8f0; border: 1px solid #2a3a55; }
        .swagger-ui .model-box { background: #0b1120; }
        .swagger-ui section.models { background: #161f32; border-color: #2a3a55; }
        .swagger-ui .model { color: #cbd5e1; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
        window.onload = function() {
            SwaggerUIBundle({
                url: '/api/docs/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: 'BaseLayout'
            });
        };
    </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

module.exports = router;