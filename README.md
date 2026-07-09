# 小猫成长记

这是一个 React + Vite 的电子宠物小猫应用。现在已经补上了一个轻量后端，用来把整份宠物存档写入本地 JSON 文件，方便后续打包成 Docker 镜像后持久化数据。

## 数据存储

- 前端会优先读写后端接口 `/api/state`
- 后端会把数据保存到 `PET_DATA_FILE` 指定的文件
- 当后端暂时不可用时，前端会继续回退到浏览器本地缓存，不会直接卡死
- 首次设置密码后，后端会用 HttpOnly 会话 Cookie 保护 `/api/state`
- 已有密码的存档必须先通过 `/api/session` 登录，才能读取、保存或删除远端存档

默认开发落盘位置：

```txt
data/pet-state.json
```

## 本地开发

先启动后端：

```bash
pnpm dev:server
```

再启动前端：

```bash
pnpm dev
```

前端开发服务器会把 `/api/*` 代理到 `http://127.0.0.1:4300`。

## 生产构建

```bash
pnpm build
pnpm start
```

`pnpm start` 会启动 Node 服务，并直接托管 `dist/` 静态文件和 `/api/state` 存档接口。

## 安全配置

后端默认会设置 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 和 `Permissions-Policy` 等安全响应头。`/api/state` 在首次设置完成后会要求：

- 有效的 HttpOnly 会话 Cookie
- 写入类请求携带服务端下发的 CSRF Token
- 请求来源是同源或显式允许的来源

常用环境变量：

```txt
PET_DATA_FILE=/data/pet-state.json
STATIC_DIR=/app/dist
SESSION_COOKIE_SECURE=false
ALLOWED_ORIGINS=
PUBLIC_ORIGIN=
SESSION_TTL_MS=43200000
MAX_BODY_BYTES=10485760
```

- `SESSION_COOKIE_SECURE=true`：如果通过 HTTPS 反向代理对外提供服务，建议开启；如果直接用 HTTP 访问，不要开启，否则浏览器不会发送会话 Cookie。
- `ALLOWED_ORIGINS`：只有确实需要跨域访问 API 时才设置，多个来源用英文逗号分隔。
- `PUBLIC_ORIGIN`：单一公开访问来源，例如 `https://example.com`。
- `MAX_BODY_BYTES`：限制单次保存的 JSON 大小，默认 10 MB，主要给头像数据留余量。

## Docker

直接构建：

```bash
docker build -t cat-pet-growth .
docker run -d -p 4173:4173 -v $(pwd)/docker-data:/data --name cat-pet-growth cat-pet-growth
```

或者使用：

```bash
docker compose up -d --build
```

当前项目根目录里的标准 Compose 文件如下：

```yaml
services:
  cat-pet-growth:
    build: .
    container_name: cat-pet-growth
    ports:
      - '4173:4173'
    environment:
      PORT: 4173
      PET_DATA_FILE: /data/pet-state.json
      STATIC_DIR: /app/dist
      # Set true when serving through an HTTPS reverse proxy.
      SESSION_COOKIE_SECURE: "false"
    volumes:
      - ./docker-data:/data
    restart: unless-stopped
```

如果你想单独指定文件启动，可以直接执行：

```bash
docker compose -f compose.yaml up -d --build
```

这个文件的含义：

- `4173:4173`：本机访问端口是 `4173`
- `./docker-data:/data`：宿主机存档目录挂载到容器内 `/data`
- `PET_DATA_FILE=/data/pet-state.json`：宠物存档会写到挂载目录里
- `restart: unless-stopped`：容器异常退出后会自动重启
- 镜像内服务进程使用非 root 用户运行；如果使用宿主机目录挂载，请确认该目录允许 UID 1000 写入

容器内默认存档位置：

```txt
/data/pet-state.json
```

## GitHub / Docker 镜像发布

项目已经准备好镜像发布流程。代码推到 `main` 后，GitHub Actions 会同步构建并推送：

- `ghcr.io/weidaye1122/electronic-pet-cat:1.0.1`
- `ghcr.io/weidaye1122/electronic-pet-cat:latest`
- `weidaye1122/electronic-pet-cat:1.0.1`
- `weidaye1122/electronic-pet-cat:latest`

首次启用前，只需要在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 里补一个仓库密钥：

```txt
DOCKERHUB_TOKEN
```

GitHub Container Registry 直接使用仓库自带的 `GITHUB_TOKEN`，不需要额外配置。

## 群晖 Docker Compose

项目里已经额外准备好了一个群晖专用文件：

```txt
compose.synology.yaml
```

默认使用 Docker Hub 镜像：

```yaml
image: weidaye1122/electronic-pet-cat:latest
```

如果你后面改用 GitHub Container Registry，只需要改成：

```yaml
image: ghcr.io/weidaye1122/electronic-pet-cat:latest
```

群晖持久化目录默认写成：

```txt
/volume1/docker/electronic-pet-cat
```

项目里自带的群晖专用 Compose 文件完整内容如下：

```yaml
services:
  # 服务名称，群晖导入后会显示这个名字
  electronic-pet-cat:
    # 默认从 Docker Hub 拉镜像
    image: weidaye1122/electronic-pet-cat:latest
    # 如果你之后改用 GitHub Container Registry，可以把上一行替换成：
    # image: ghcr.io/weidaye1122/electronic-pet-cat:latest
    # 容器名称
    container_name: ElectronicPetCat
    # 开机自启，容器异常退出后自动重启
    restart: unless-stopped
    ports:
      # 左边是群晖对外端口，右边是容器内部端口
      # 如果 4173 被占用，可以把左边改成别的，比如 8088:4173
      - "4173:4173"
    environment:
      # 时区
      TZ: Asia/Shanghai
      # 服务监听端口
      PORT: 4173
      # 宠物存档文件在容器里的保存位置
      PET_DATA_FILE: /data/pet-state.json
      # 前端静态文件目录
      STATIC_DIR: /app/dist
      # 如果前面有 HTTPS 反向代理，可以改成 "true"
      SESSION_COOKIE_SECURE: "false"
    volumes:
      # 左边是群晖本地目录，右边是容器目录
      # 存档最终会落到 /volume1/docker/electronic-pet-cat/pet-state.json
      # 镜像内服务使用非 root 用户运行，请确保这个目录允许 UID 1000 写入
      # 如果你想换目录，只改左边这一段就行
      - /volume1/docker/electronic-pet-cat:/data
```

如果你是在群晖 Container Manager 里导入文件，直接导入 `compose.synology.yaml` 就行；如果你想自己复制新建，也可以直接用上面这份。

在群晖 Container Manager 里导入这个文件后，就会把存档保存到这个目录下面的：

```txt
/volume1/docker/electronic-pet-cat/pet-state.json
```
