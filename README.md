# PKG Link

PKG Link is a self-hosted web dashboard for serving authorized PS4 `.pkg` files from mounted storage and handing them to the PS4 Remote Package Installer (RPI). It is designed to run as one small Docker container:

- mount a host library at `/pkg`;
- scan the library recursively on a timer;
- browse and search packages in the web UI;
- queue installs one at a time;
- monitor the task progress reported by RPI;
- keep the library folder, PS4 address, and server settings in `/data`.

> Use this only with games and packages you are authorized to use. The PlayStation name and marks belong to their respective owners.

## Important transport note

The PS4 Remote Package Installer API expects a reachable **HTTP(S) package URL**. The reference desktop app linked in the request also serves files over HTTP and calls RPI's `/api/install`; it does not send an FTP URL to the PS4. PKG Link follows that compatible workflow and adds the web UI plus Docker-mounted storage:

1. PKG Link serves a selected file with HTTP range support.
2. PKG Link calls `http://PS4_IP:12801/api/install` with the package URL (the RPI port is configurable in Settings).
3. Remote Package Installer pulls the package from the container and installs it.

A PS4 FTP server is a different copy-to-console workflow and cannot be substituted for RPI's direct-install URL. If the console is using an FTP-only tool, it needs its own FTP client/installation flow; this app intentionally does not pretend an FTP URL is an RPI URL.

## Quick start with Docker Compose

1. Create the folders and put your legal `.pkg` files in `games/`:

   ```sh
   mkdir -p games data
   cp /path/to/your/game.pkg games/
   ```

2. Edit `docker-compose.yml` and change `PUBLIC_BASE_URL` to the Docker host's LAN address. For example:

   ```yaml
   PUBLIC_BASE_URL: "http://192.168.1.10:8080"
   ```

   Do not use `localhost`: the PS4 resolves the URL itself.

3. Build and start the service:

   ```sh
   docker compose up -d --build
   ```

4. Open `http://localhost:8080` on a computer or phone. The mounted packages will appear on the Library page automatically. In **Settings**:

   - confirm the library folder is `/pkg`;
   - enter the PS4's IP address;
   - leave RPI port at `12801` unless your RPI build uses another port;
   - use **Test PS4 connection**.

5. Start HEN / Remote Package Installer on the PS4, select a package, and press **Install**. The PS4 and the Docker host must be able to reach each other on the same network. The host firewall must allow TCP port `8080` from the PS4.

The default compose file uses `./games:/pkg:ro`, so PKG Link cannot modify the mounted library. Settings are stored in `./data/config.json`. The dashboard has no login layer; keep port 8080 on your trusted LAN and do not expose it directly to the internet.

## Run without Docker

Node.js 20 or newer is required. The server has no runtime npm dependencies.

```sh
PKG_DIR=/absolute/path/to/packages DATA_DIR=./data PUBLIC_BASE_URL=http://192.168.1.10:8080 npm start
```

Then open `http://localhost:8080`. `HOST=0.0.0.0` is the default so another device on the LAN can reach the package server.

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Web/package server port |
| `HOST` | `0.0.0.0` | Bind address |
| `PKG_DIR` | `/pkg` | Initial library directory |
| `DATA_DIR` | `./data` | Persistent settings directory |
| `PUBLIC_BASE_URL` | empty | Base URL placed in RPI install requests |
| `LOG_LEVEL` | `info` | `debug` logs every PS4 request, response, scan, and HTTP diagnostic |

The library path can also be changed from the Settings page. It must be a path that exists **inside the container**.

### Reading the terminal logs

The server logs every connection test and install request with a timestamp, target host/port, endpoint, HTTP status, response body, duration, and network error code. It also logs package-server requests made by the PS4. Set `LOG_LEVEL=debug` while troubleshooting:

```sh
docker compose logs -f pkg-link
```

For an RPI timeout, use these entries to identify the failing hop:

- `PS4 TCP connection established` means the Docker container completed TCP connection to the configured PS4 address and port. `tcpConnected: false` in a timeout means it failed before the RPI socket connected; `lookupAddress` and `lookupError` show DNS details.
- `PS4 request body sent` means the JSON body and declared `Content-Length` were flushed to the socket. If it is true while `responseHeadersReceived` is false, the request left PKG Link and is waiting on RPI.
- `PS4 response headers received` means RPI answered. If it is absent but `tcpConnected: true`, the connection reached RPI and RPI is still preparing the request or is stuck.
- `Package request received` and `Package response started` mean the PS4 reached the public package URL. If neither appears during `/api/install`, check `PUBLIC_BASE_URL`, Docker port publishing, host firewall rules, and PS4-to-host routing. If they appear with a 404/416 or an early close, the package URL or range response needs attention.
- `PS4 response received` includes the HTTP status and JSON body after RPI finishes.

Look for `PS4 request failed` with codes such as `ECONNREFUSED`, `ETIMEDOUT`, or `ENOTFOUND`. For an install, also verify that the logged `packageUrls` use the Docker host's LAN address and not `localhost` or a Docker-only address. The connection-test button calls `/api/is_exists`, so use it first to separate an RPI listener/port problem from package-host reachability.

## How scanning works

- The first API request triggers a scan, and the server scans again every 30 seconds by default.
- The interval and automatic scanning can be changed in Settings; the minimum interval is 5 seconds.
- Subdirectories are included. Symlinks are ignored.
- Only case-insensitive `.pkg` files are indexed.
- File names containing a `CUSA` identifier are shown with that title ID. Names containing `update`, `patch`, or `_A####` are labeled Update; names containing `DLC`, `addon`, `theme`, or `license` are labeled DLC.
- Files named like `GAME_0.pkg`, `GAME_1.pkg`, and so on are grouped into one RPI request when any part is selected.
- The server supports `Range` and `HEAD` requests, which is important for large packages and RPI retries.

## API overview

The browser UI uses these endpoints, which are also useful for a reverse proxy or health monitor:

- `GET /healthz` — container health check
- `GET /api/bootstrap` — settings, scan summary, packages, and recent transfers
- `GET /api/files` — current package list
- `POST /api/scan` — scan immediately
- `GET /api/settings` / `PATCH /api/settings` — persistent configuration
- `POST /api/connection/test` — call RPI's `is_exists` endpoint
- `POST /api/transfers` with `{ "fileIds": ["..."] }` — queue installs
- `GET /api/transfers` — transfer history and progress
- `POST /api/transfers/:id/cancel` — stop a queued/active install
- `GET /pkg/:id` — range-capable package stream used by the PS4

## Troubleshooting

### The package list is empty

Check that the files are in the host folder mapped to `/pkg`, not just in the image. Confirm Settings shows the correct in-container path and press **Scan library**. A read-only mount is fine; the app only needs read access.

### The PS4 accepts the install but cannot download the file

The URL in Settings must be the Docker host's LAN IP and published port. From another device on the same network, open the package URL shown in the server logs/API or use `curl -I http://HOST:8080/pkg/...`. Allow TCP `8080` through the host firewall. Do not use `localhost`, `127.0.0.1`, a Docker-only address, or an Arena/reverse-proxy URL that the PS4 cannot reach.

### The connection test fails

Start Remote Package Installer on the PS4, verify the IP and port, and check that the host can reach the console. Some builds use port `12800`; set that port in Settings if needed. RPI can be slow to wake, so the request timeout defaults to 60 seconds and is adjustable up to 300 seconds.

### Docker cannot write settings

The `/data` mount must be writable by the container's `node` user. With a bind mount, create it before starting (`mkdir -p data`) and adjust ownership/permissions for the Docker user if needed. The package mount may remain read-only.

## License

No upstream license was included in the starter repository. Add the license appropriate for your deployment before distributing this project.
