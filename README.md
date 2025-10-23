# Proxy AI Fusion

高性能 AI 代理服务，支持多配置管理、负载均衡、请求过滤和实时监控。

## ⚡ 快速开始

```bash
# 1. 首次安装
./setup.sh

# 2. 启动服务（后台运行）
paf start

# 3. 查看服务状态
paf status

# 4. 访问 Web UI
open http://localhost:8800

# 5. 停止服务
paf stop
```

## 🎯 核心功能

- **多配置管理** - 支持多个上游服务配置，动态切换
- **负载均衡** - 权重选择和轮询模式，自动故障转移
- **请求过滤** - 正则表达式过滤敏感数据
- **实时监控** - WebSocket 实时请求跟踪
- **日志查询** - 详细的请求日志和 Token 使用统计
- **二选一认证** - 支持 Auth Token 或 API Key 认证
- **静态文件嵌入** - 前端资源打包进二进制，无需依赖外部文件
- **守护进程模式** - 后台运行，自动管理 PID，支持 start/stop/restart

## 🛠️ 技术栈

**后端** - Rust + Tokio + Axum + SQLite + rust-embed
**前端** - TypeScript + React + Vite + shadcn/ui + Tailwind CSS

## 📚 文档

- [QUICKSTART.md](./QUICKSTART.md) - 详细使用指南
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构说明
- [AGENTS.md](./AGENTS.md) - 开发规范

## 🔧 命令行使用

### 服务管理
```bash
paf start              # 启动服务（后台运行）
paf stop               # 停止服务
paf restart            # 重启服务
paf status             # 查看服务状态
paf dev                # 前台运行（开发模式，显示日志）
paf ui                 # 在浏览器中打开 Web UI
```

### 配置管理
```bash
paf list claude        # 列出 Claude 的所有配置
paf list codex         # 列出 Codex 的所有配置
paf active claude prod # 激活 Claude 的 prod 配置
paf active codex dev   # 激活 Codex 的 dev 配置
```

### 开发模式

如果需要调试或查看日志，可以使用前台运行模式：
```bash
paf dev                # 前台运行，显示所有日志，Ctrl+C 停止
# 或
cargo run -- dev       # 通过 cargo 运行
```

## 📦 构建与部署

### 开发构建（不嵌入前端）
```bash
cargo build
# 需要确保 frontend/dist 目录存在
```

### 生产构建（嵌入前端）
```bash
# 方式一：自动构建前端（推荐）
cargo build --release

# 方式二：手动构建
cd frontend && npm run build && cd ..
cargo build --release

# 生成的二进制文件可以独立运行
./target/release/paf start
```

**注意**：
- **开发模式** (`cargo build`)：从 `frontend/dist` 目录读取静态文件
- **生产模式** (`cargo build --release`)：前端资源被 `rust-embed` 打包进二进制文件
- Release 构建会自动触发 `build.rs` 执行前端构建（需要安装 Node.js 和 npm）
- 生产构建后的二进制文件可以在任意目录运行，无需依赖 frontend 目录

## 🧹 清理

```bash
./clean.sh  # 删除所有构建产物和依赖
```

## 📝 License

MIT
