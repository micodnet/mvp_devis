// Types TypeScript pour le SDK Devis Express Pro

export interface ClientOptions {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
}

export interface ListOptions {
    limit?: number;
    status?: string;
    from?: string;
    to?: string;
}

export interface QuoteItem {
    name: string;
    qty: number;
    unitPrice: number;
    ref?: string;
}

export interface CreateQuoteData {
    items: QuoteItem[];
    clientName?: string;
    clientEmail?: string;
    clientAddress?: string;
    clientVat?: string;
    vatRegime?: 'franchise' | 'assujetti';
}

export interface Quote {
    id: number;
    number: string;
    issueDate: string;
    validDate: string;
    clientName: string;
    clientEmail?: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    currency: string;
    status: 'draft' | 'sent' | 'accepted' | 'refused';
    items?: QuoteItem[];
    createdAt?: string;
    publicToken?: string;
}

export interface CreateClientData {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    vatNumber?: string;
    notes?: string;
}

export interface Client {
    id: number;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    vatNumber?: string;
    notes?: string;
    createdAt?: string;
}

export interface Product {
    id: number;
    ref?: string;
    name: string;
    description?: string;
    category?: string;
    unit?: string;
    unitPrice: number;
    stockQuantity?: number;
    trackStock?: boolean;
}

export interface Invoice {
    id: number;
    number: string;
    type: string;
    issueDate: string;
    dueDate: string;
    clientName?: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    amountPaid: number;
    amountDue: number;
    currency: string;
    status: string;
}

export interface Chantier {
    id: number;
    name: string;
    reference?: string;
    clientName?: string;
    status: string;
    startDate?: string;
    endDate?: string;
    budgetEstimate?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface Stats {
    quotes: {
        total: number;
        accepted: number;
        revenue: number;
    };
    invoices: {
        total: number;
        dueAmount: number;
    };
    clients: number;
    products: number;
}

export interface AccountInfo {
    email: string;
    createdAt: string;
    scopes: string[];
}

export class DevisExpressError extends Error {
    statusCode: number;
    response: any;
}

export class QuotesResource {
    list(options?: ListOptions): Promise<Quote[]>;
    get(id: number): Promise<Quote>;
    create(data: CreateQuoteData): Promise<{ success: boolean; quote: { id: number; number: string; total: number; status: string } }>;
}

export class ClientsResource {
    list(options?: ListOptions): Promise<Client[]>;
    create(data: CreateClientData): Promise<{ success: boolean; client: { id: number; name: string; email: string } }>;
}

export class ProductsResource {
    list(options?: ListOptions): Promise<Product[]>;
}

export class InvoicesResource {
    list(options?: ListOptions): Promise<Invoice[]>;
}

export class ChantiersResource {
    list(options?: ListOptions): Promise<Chantier[]>;
}

export class StatsResource {
    get(): Promise<Stats>;
}

export class AccountResource {
    me(): Promise<AccountInfo>;
}

export class DevisExpress {
    constructor(options: ClientOptions);
    quotes: QuotesResource;
    clients: ClientsResource;
    products: ProductsResource;
    invoices: InvoicesResource;
    chantiers: ChantiersResource;
    stats: StatsResource;
    account: AccountResource;
}

export default DevisExpress;