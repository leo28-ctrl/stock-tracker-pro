from http.server import BaseHTTPRequestHandler
import json
from urllib.parse import parse_qs, urlparse
import urllib.request
import ssl

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            symbols = params.get('symbols', [''])[0]
            
            if not symbols:
                self._send_json(400, {
                    'success': False,
                    'error': 'Missing symbols. Usage: /api/price?symbols=VNM,FPT'
                })
                return
            
            symbol_list = [s.strip().upper() for s in symbols.split(',')]
            results = {}
            errors = []
            
            # Tạo SSL context để bypass certificate verification
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            for symbol in symbol_list:
                # Thử nguồn 1: VNDirect
                try:
                    url = f'https://finfo-api.vndirect.com.vn/v4/stock_prices?sort=date&q=code:{symbol}&size=1&page=1'
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    })
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                        data = json.loads(response.read().decode())
                        if data.get('data') and len(data['data']) > 0:
                            item = data['data'][0]
                            results[symbol] = {
                                'price': float(item['close']) * 1000,
                                'open': float(item['open']) * 1000,
                                'high': float(item['high']) * 1000,
                                'low': float(item['low']) * 1000,
                                'volume': int(item.get('nmVolume', 0)),
                                'change': float(item.get('pctChange', 0)),
                                'time': item.get('date', ''),
                                'source': 'VNDirect'
                            }
                            continue
                except Exception as e:
                    errors.append(f"VNDirect {symbol}: {str(e)}")
                
                # Thử nguồn 2: TCBS
                try:
                    url = f'https://apipubaws.tcbs.com.vn/stock-insight/v1/stock/bars-long-term?ticker={symbol}&type=stock&resolution=D&countBack=5'
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json',
                        'Origin': 'https://tcinvest.tcbs.com.vn',
                        'Referer': 'https://tcinvest.tcbs.com.vn/'
                    })
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                        data = json.loads(response.read().decode())
                        if data.get('data') and len(data['data']) > 0:
                            item = data['data'][-1]
                            results[symbol] = {
                                'price': float(item['close']) * 1000,
                                'open': float(item['open']) * 1000,
                                'high': float(item['high']) * 1000,
                                'low': float(item['low']) * 1000,
                                'volume': int(item.get('volume', 0)),
                                'change': round((float(item['close']) - float(item['open'])) / float(item['open']) * 100, 2),
                                'time': item.get('tradingDate', ''),
                                'source': 'TCBS'
                            }
                            continue
                except Exception as e:
                    errors.append(f"TCBS {symbol}: {str(e)}")
                
                # Thử nguồn 3: Fireant
                try:
                    url = f'https://restv2.fireant.vn/symbols/{symbol}/historical-quotes?startDate=2024-01-01&endDate=2030-12-31&offset=0&limit=1'
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    })
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                        data = json.loads(response.read().decode())
                        if data and len(data) > 0:
                            item = data[0]
                            results[symbol] = {
                                'price': float(item.get('priceClose', 0)) * 1000,
                                'open': float(item.get('priceOpen', 0)) * 1000,
                                'high': float(item.get('priceHigh', 0)) * 1000,
                                'low': float(item.get('priceLow', 0)) * 1000,
                                'volume': int(item.get('totalVolume', 0)),
                                'change': float(item.get('priceChangePercent', 0)),
                                'time': item.get('date', ''),
                                'source': 'Fireant'
                            }
                            continue
                except Exception as e:
                    errors.append(f"Fireant {symbol}: {str(e)}")
            
            self._send_json(200, {
                'success': len(results) > 0,
                'data': results,
                'fetched': list(results.keys()),
                'failed': [s for s in symbol_list if s not in results],
                'debug': errors[:5] if not results else []
            })
            
        except Exception as e:
            self._send_json(500, {
                'success': False,
                'error': str(e)
            })
    
    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        self._send_json(200, {})
