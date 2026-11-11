# CVC – Môi trường

Ba môi trường tách biệt: **dev**, **staging**, **production**. Cùng một image chạy staging/production, chỉ khác env (D13/P1.11).

## Bảng tổng quan

| Mục       | dev                                                                         | staging                                           | production                                        |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Chạy bằng | `infra/docker-compose.dev.yml` (build target `dev`, bind mount, hot reload) | `infra/docker-compose.prod.yml` (image build sẵn) | `infra/docker-compose.prod.yml` (image build sẵn) |
| Domain    | `localhost:5180` (web), `localhost:3000` (api)                              | `staging.cvc.example`                             | `cvc.example`                                     |
| Database  | MySQL container `mysql`, DB `cvc`, user `cvc`                               | MySQL riêng, DB `cvc_staging`                     | MySQL riêng, DB `cvc`                             |
| Redis     | container `redis`                                                           | Redis riêng                                       | Redis riêng                                       |
| Bucket S3 | SeaweedFS `cvc-public` / `cvc-private`                                      | bucket staging riêng                              | bucket production riêng                           |
| Bên thứ 3 | mailpit (SMTP giả), không gọi dịch vụ thật                                  | sandbox của bên thứ 3                             | khóa thật                                         |
| Secret    | placeholder dev trong compose (không phải secret thật)                      | GitHub Secrets / `.env` trên server               | `.env` trên server (chmod 600) / Vault            |
| TLS       | không                                                                       | có (proxy)                                        | có (proxy)                                        |
| Dữ liệu   | seed khung, không dữ liệu thật                                              | dữ liệu thử, không PII thật                       | dữ liệu thật                                      |

## Nơi đặt secret

- **Không commit secret.** `.env` đã nằm trong `.gitignore`. Mọi cấu hình qua env, có `.env.example`.
- **dev:** giá trị placeholder trong `docker-compose.dev.yml` chỉ để chạy local, không dùng cho staging/production.
- **staging/production:** đặt `.env` trên server (`chmod 600`), hoặc GitHub Secrets cho CI, hoặc Vault. CI build image dùng `secrets.GITHUB_TOKEN` để push GHCR.
- Khóa cần sinh ngẫu nhiên mạnh: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Ví dụ: `openssl rand -hex 32`.
- Khóa tích hợp (SMS/ZNS/dịch AI/hóa đơn/eKYC) để trống khi chưa dùng; staging dùng sandbox, production dùng khóa thật.

## Biến môi trường

- API: xem `apps/api/.env.example` (validate bằng Zod lúc khởi động; thiếu biến → dừng và in tên biến).
- Web: dev dùng `apps/web/.env.example` (Vite). **Production không dùng biến build** — `config.js` được sinh lúc container khởi động từ `API_URL`, `WS_URL` (xem `infra/web/docker-entrypoint.sh`). Nhờ vậy một image web chạy được mọi môi trường.

## TLS (production)

Mặc định `infra/nginx/proxy.conf` nghe HTTP 80. Để bật TLS:

1. Mount chứng thư vào volume `certs` (`fullchain.pem`, `privkey.pem`).
2. Thay `proxy.conf` bằng `infra/nginx/proxy-tls.conf` (nghe 443, redirect 80→443).
   Chỉ `proxy` publish 80/443; mysql/redis/seaweedfs không publish port.

## Deploy production

```bash
# Trên server: cần Docker + compose + .env + file image .tar.gz
bash infra/scripts/import-images.sh <tag>     # kiểm tra SHA-256 rồi docker load
bash infra/scripts/deploy.sh <tag>            # backup -> import -> migrate -> up -> health
```

`deploy.sh` **dừng, không up bản mới nếu migrate lỗi**. Backup trước migrate ghi vào `backups/` (đã gitignore). Xem thêm `runbook.md` (sẽ bổ sung ở Phase vận hành).

## CI/CD

- `ci.yml`: lint → typecheck → unit/integration test (MySQL/Redis service) → build → kiểm tra `openapi.json` không lệch. Chạy trên PR; `main` được bảo vệ, bắt buộc xanh mới merge.
- `build-image.yml`: build image api/web (cache layer), quét trivy, smoke test (compose prod env test gọi `/health`, `/ready`, web 200), push GHCR khi merge `main`/tag, tạo artifact `cvc-images-<tag>.tar.gz` + checksum cho release.
