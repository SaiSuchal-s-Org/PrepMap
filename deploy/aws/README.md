# EC2 Docker Deployment (Frontend + API + Redis + Supabase DB)

## 1) Prerequisites on EC2
- Ubuntu 22.04/24.04
- Docker + Docker Compose plugin installed
- Ports open in Security Group:
  - `22` from your IP
  - `80` from internet

## 2) Prepare env file
From repo root:

```bash
cp deploy/aws/.env.ec2.example deploy/aws/.env.ec2
```

Edit `deploy/aws/.env.ec2` with real secrets.

## 3) Start stack
From repo root:

```bash
docker compose --env-file deploy/aws/.env.ec2 -f deploy/aws/docker-compose.ec2.yml up -d --build
```

## 4) Check status

```bash
docker compose -f deploy/aws/docker-compose.ec2.yml ps
docker logs prepmap-api --tail 200
```

## 5) Health checks
- Frontend: `http://<EC2_PUBLIC_IP>/`
- API metadata: `http://<EC2_PUBLIC_IP>/api/metadata`

## 6) Restart only API after env change

```bash
docker compose --env-file deploy/aws/.env.ec2 -f deploy/aws/docker-compose.ec2.yml up -d api
```

## 7) Notes
- Redis is internal-only (not exposed publicly).
- Database is external (Supabase). Set `DATABASE_URL` in `.env.ec2`.
- Add TLS later with a reverse proxy (Caddy/Nginx + Let's Encrypt) or ALB.
