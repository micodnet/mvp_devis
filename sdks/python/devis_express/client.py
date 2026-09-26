"""
Client Python pour l'API Devis Express Pro.
"""

import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Optional, Dict, Any, List

DEFAULT_BASE_URL = "https://mvp-devis.onrender.com/api/v1"
DEFAULT_TIMEOUT = 30


class DevisExpressError(Exception):
    """Erreur retournee par l'API Devis Express Pro."""

    def __init__(self, message: str, status_code: int = 0, response: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response = response


class _HttpClient:
    def __init__(self, api_key: str, base_url: str, timeout: int):
        if not api_key:
            raise ValueError("api_key requis")
        if not api_key.startswith("dsk_"):
            raise ValueError("api_key invalide (doit commencer par dsk_)")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(self, method: str, path: str, body: Optional[Dict] = None, query: Optional[Dict] = None) -> Any:
        url = self.base_url + path

        if query:
            params = {k: v for k, v in query.items() if v is not None and v != ""}
            if params:
                url += "?" + urllib.parse.urlencode(params)

        data = None
        headers = {
            "X-API-Key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "DevisExpressPro-SDK-Python/1.0.0"
        }

        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(data))

        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                response_data = response.read().decode("utf-8")
                if response_data:
                    return json.loads(response_data)
                return None
        except urllib.error.HTTPError as e:
            error_body = None
            try:
                error_body = json.loads(e.read().decode("utf-8"))
            except Exception:
                pass
            message = error_body.get("error") if isinstance(error_body, dict) else "HTTP " + str(e.code)
            raise DevisExpressError(message, e.code, error_body)
        except urllib.error.URLError as e:
            raise DevisExpressError("Erreur reseau : " + str(e.reason), 0, None)
        except Exception as e:
            raise DevisExpressError("Erreur : " + str(e), 0, None)

    def get(self, path: str, query: Optional[Dict] = None) -> Any:
        return self._request("GET", path, None, query)

    def post(self, path: str, body: Optional[Dict] = None) -> Any:
        return self._request("POST", path, body)

    def put(self, path: str, body: Optional[Dict] = None) -> Any:
        return self._request("PUT", path, body)

    def delete(self, path: str) -> Any:
        return self._request("DELETE", path)


class QuotesResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self, limit: int = 50, status: Optional[str] = None,
             from_date: Optional[str] = None, to_date: Optional[str] = None) -> List[Dict]:
        query = {"limit": limit}
        if status:
            query["status"] = status
        if from_date:
            query["from"] = from_date
        if to_date:
            query["to"] = to_date
        return self._http.get("/quotes", query)

    def get(self, quote_id: int) -> Dict:
        if not quote_id:
            raise ValueError("quote_id requis")
        return self._http.get(f"/quotes/{quote_id}")

    def create(self, items: List[Dict], client_name: Optional[str] = None,
               client_email: Optional[str] = None, client_address: Optional[str] = None,
               client_vat: Optional[str] = None, vat_regime: Optional[str] = None) -> Dict:
        if not items:
            raise ValueError("items requis (liste non vide)")
        body = {"items": items}
        if client_name:
            body["clientName"] = client_name
        if client_email:
            body["clientEmail"] = client_email
        if client_address:
            body["clientAddress"] = client_address
        if client_vat:
            body["clientVat"] = client_vat
        if vat_regime:
            body["vatRegime"] = vat_regime
        return self._http.post("/quotes", body)


class ClientsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self, limit: int = 100) -> List[Dict]:
        return self._http.get("/clients", {"limit": limit})

    def create(self, name: str, contact_name: Optional[str] = None,
               email: Optional[str] = None, phone: Optional[str] = None,
               address: Optional[str] = None, vat_number: Optional[str] = None,
               notes: Optional[str] = None) -> Dict:
        if not name:
            raise ValueError("name requis")
        body = {"name": name}
        if contact_name:
            body["contactName"] = contact_name
        if email:
            body["email"] = email
        if phone:
            body["phone"] = phone
        if address:
            body["address"] = address
        if vat_number:
            body["vatNumber"] = vat_number
        if notes:
            body["notes"] = notes
        return self._http.post("/clients", body)


class ProductsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self, limit: int = 100) -> List[Dict]:
        return self._http.get("/products", {"limit": limit})


class InvoicesResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self, limit: int = 50, status: Optional[str] = None) -> List[Dict]:
        query = {"limit": limit}
        if status:
            query["status"] = status
        return self._http.get("/invoices", query)


class ChantiersResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def list(self, limit: int = 50) -> List[Dict]:
        return self._http.get("/chantiers", {"limit": limit})


class StatsResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def get(self) -> Dict:
        return self._http.get("/stats")


class AccountResource:
    def __init__(self, http: _HttpClient):
        self._http = http

    def me(self) -> Dict:
        return self._http.get("/me")


class DevisExpress:
    """
    Client Python pour l'API Devis Express Pro.

    Exemple :
        client = DevisExpress(api_key="dsk_votre_cle")
        quotes = client.quotes.list()
    """

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, timeout: int = DEFAULT_TIMEOUT):
        self._http = _HttpClient(api_key, base_url, timeout)
        self.quotes = QuotesResource(self._http)
        self.clients = ClientsResource(self._http)
        self.products = ProductsResource(self._http)
        self.invoices = InvoicesResource(self._http)
        self.chantiers = ChantiersResource(self._http)
        self.stats = StatsResource(self._http)
        self.account = AccountResource(self._http)