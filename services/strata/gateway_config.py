"""Render private nginx config. Keys arrive through a protected JSON file, never argv."""
import ipaddress
import json
import re
import sys


def key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,256}", value):
        raise ValueError("Unsupported credential format; no config written")
    return value


def render(config):
    address = ipaddress.ip_address(config["listen"])
    if not address.is_private or address.is_unspecified:
        raise ValueError("Use the existing explicit private VM address")
    backend = key(config["backendKey"])
    if len(backend) < 32:
        raise ValueError("A strong private backend credential is required")
    clients = list(dict.fromkeys(key(k) for k in config["clientKeys"]))
    if not clients or len(clients) > 16:
        raise ValueError("Explicit client credentials required")
    # Only the HTTP scheme is case-insensitive; credentials remain exact.
    bearer = "\n".join('  "~^(?i:Bearer)[ ]+' + re.escape(k).replace('\\', '\\\\') + '$" 1;' for k in clients)
    api_key = "\n".join('  "' + k + '" 1;' for k in clients)
    # Existing SSH forwards terminate at the VM's loopback, while Pi/Hub use
    # its LAN address. Preserve both explicit binds without a wildcard listener.
    bind = '[' + str(address) + ']' if address.version == 6 else str(address)
    listen = '    listen ' + bind + ':1919;\n'
    if not address.is_loopback:
        listen += '    listen 127.0.0.1:1919;\n'
    return '''worker_processes 2;
pid /run/strata-gateway/nginx.pid;
error_log /var/log/strata-gateway/error.log warn;
events { worker_connections 128; }
http {
  map_hash_bucket_size 512;
  client_body_temp_path /var/cache/strata-gateway/body;
  proxy_temp_path /var/cache/strata-gateway/proxy;
  fastcgi_temp_path /var/cache/strata-gateway/fastcgi;
  uwsgi_temp_path /var/cache/strata-gateway/uwsgi;
  scgi_temp_path /var/cache/strata-gateway/scgi;
  map $http_authorization $strata_bearer {
    default 0;
''' + bearer + '''
  }
  map $http_x_api_key $strata_x_key {
    default 0;
''' + api_key + '''
  }
  map "$strata_bearer$strata_x_key" $strata_allowed { default 1; "00" 0; }
  log_format model_status '$time_iso8601 $request_method $uri $status $request_time';
  access_log /var/log/strata-gateway/access.log model_status;
  server {
''' + listen + '''
    server_name _;
    server_tokens off;
    client_max_body_size 64m;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Authorization "Bearer ''' + backend + '''";
    proxy_set_header X-Api-Key "";
    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    proxy_ignore_client_abort off;
    proxy_next_upstream off;
    proxy_connect_timeout 3s;
    proxy_read_timeout 1800s;
    proxy_send_timeout 1800s;
    send_timeout 1800s;
    error_page 401 = @unauthorized;
    error_page 502 503 504 = @offline;
    location = /health { proxy_pass http://127.0.0.1:1920; }
    location ~ ^/v1/(chat/completions|responses|messages|messages/count_tokens|models)$ {
      if ($strata_allowed = 0) { return 401; }
      proxy_pass http://127.0.0.1:1920;
    }
    location / { return 404; }
    location @unauthorized {
      default_type application/json;
      return 401 '{"error":{"type":"authentication_error","message":"Model credential required"}}';
    }
    location @offline {
      default_type application/json;
      return 503 '{"error":{"type":"server_not_ready","message":"Model service is not ready; no request was replayed"}}';
    }
  }
}
'''


if __name__ == "__main__":
    with open(sys.argv[1]) as source:
        sys.stdout.write(render(json.load(source)))
