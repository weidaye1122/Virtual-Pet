# VirtualPet

VirtualPet 是一个基于 React + Vite 的电子宠物项目。它提供小猫养成、物品互动、房间切换和成长记录等体验，并配有一个轻量后端用于保存宠物存档，方便直接以容器方式部署和长期运行。

项目的前端界面与后端存档服务已经打包为同一个可部署应用，适合放在群晖 NAS 这类常驻设备上运行。部署后，应用会通过本地挂载目录持久化保存宠物数据，重启容器后也不会丢失存档。

## 群晖 Docker Compose 部署

下面是一份适合在群晖 Container Manager 中使用的 `compose` 配置示例，已附带注释：

```yaml
services:
  virtualpet: # 服务名称，导入到群晖后会显示这个名字
    image: weidaye1122/virtualpet:latest # 使用 Docker Hub 上的最新镜像
    # image: ghcr.io/weidaye1122/virtualpet:latest # 如果你想改用 GitHub Container Registry，可改成这一行
    container_name: VirtualPet # 容器名称
    restart: unless-stopped # 开机自启，异常退出后自动重启
    ports:
      - "4173:4173" # 左边是群晖对外端口，右边是容器内部端口；如果 4173 被占用，可以改成例如 8088:4173
    environment:
      TZ: Asia/Shanghai # 时区
      PORT: 4173 # 服务监听端口
      PET_DATA_FILE: /data/pet-state.json # 宠物存档在容器内的保存位置
      STATIC_DIR: /app/dist # 前端静态文件目录
      SESSION_COOKIE_SECURE: "false" # 前面有 HTTPS 反向代理时改成 "true"，直接 HTTP 访问保持 "false"
    volumes:
      - /volume1/docker/virtualpet:/data # 左边是群晖本地目录，右边是容器内目录；存档会保存到 /volume1/docker/virtualpet/pet-state.json
```

在群晖中导入这份配置并启动后，就可以通过群晖 IP 加端口访问 VirtualPet，宠物存档也会持续保存在挂载目录中。
