# Analog Studio

Analog Studio 是 VSE-Core-1 的预发布开发线，也是一个面向模拟 IC 的浏览器原理图工作台。完整入口为：

```text
登录 / 注册 → 账户项目管理 → 原理图编辑器 → Spectre / SPICE 网表
```

每个账户只允许访问自己的项目。工具栏“保存”才更新服务端正式项目；编辑停顿 1.6 秒后写入独立 Recovery 副本，页面离开也只写 Recovery，不会暗中覆盖正式版本。重新打开项目时可选择恢复较新的副本。面板宽度、高度等纯界面偏好仍保存在当前浏览器。

## 本机开发

需要 Node.js 22.13 或更高版本。

```powershell
npm ci
npm run dev
```

访问 <http://127.0.0.1:3002>。本机开发入口会自动填入隔离的开发账号和本次进程随机生成的口令，直接点击“登录”即可；首次登录会自动创建一个可编辑的“CMOS 反相器示例”项目。需要固定本机开发口令时，可设置 8–128 个字符的 `ANALOG_LOCAL_DEV_PASSWORD`。

开发服务只监听 `127.0.0.1:3002`，不会占用旧开发版的 3001 端口。局域网部署继续使用 `0.0.0.0:3000`，不会显示或接受这个开发账号。

常用检查：

```powershell
npm run typecheck
npm test
npm run lint
```

## 页面与数据

- `/login`、`/register`：本地账户登录和注册。
- `/projects`：当前账户的项目列表，可新建、重命名、删除和打开。
- `/projects/:id`：原理图工作台；项目加载、保存和权限检查均由服务端完成。
- `users`：账户名和 PBKDF2 密码记录，不保存明文密码。
- `sessions`：只保存会话令牌的 SHA-256 摘要；浏览器使用 HttpOnly Cookie。
- `projects`：项目归属、元数据和经过 Schema 校验的 `SchematicDocument`。
- `project_recovery`：与正式项目头隔离的自动恢复副本及其 storage/design revision。

所有项目 API 都从会话中确定用户，再以 `owner_id + project id` 查询。客户端不能通过提交其他用户 id 绕过隔离。

数据库模型在 `db/schema.ts`，Drizzle 迁移在 `drizzle/`。开发服务器的本地状态位于 `.wrangler/`；独立 LAN 部署的数据位于部署根目录的 `data/wrangler/`。两者都不进入 Git。

## 原理图能力

- NMOS4、PMOS4、R/C/L、V/I 源、电源地、输入输出、网络标签和连接点。
- 点击或拖拽放置、5 DBU 电气吸附与 20 DBU 可视格点、严格/部分框选、移动、复制粘贴、删除、旋转和镜像。
- “选择 / 连线 / No Connect”工具模式；Wire 支持 Pin、Wire endpoint、Junction、segment 和 grid 吸附，多拐点正交路径以及 ROUTE/H-first/V-first。
- Enter 或双击结束 Wire，Backspace 回退拐点，Esc 分层取消，F3 打开命令选项，F4 切换严格/部分框选。
- 双击器件或按 `q` 打开属性窗口；修改先留在草稿中，点击“应用”后作为一次批操作写入。
- 删除 Instance 会保留原外部 Wire 并把端点转换为原 Pin 的精确坐标；复制会分配新对象 ID 和实例名。
- 物理/逻辑两层连通性：T 接自动连接，普通交叉不连接，Explicit Junction 使交叉连接，同名 Label 合并逻辑网。
- No Connect 可在器件 Terminal 上添加/移除，并检查与 Wire 冲突。
- Check & Save、确定性 Marker、Canvas overlay、双击 Marker 定位、Current/Stale 全网动态高亮。
- 工程 JSON 导入/导出；确定性的 Spectre `.scs` 与 SPICE `.cir` 网表预览和下载。
- 19 条默认检查规则注册表，覆盖命名、Wire 几何、悬空、No Connect、Label、重叠和损坏引用等核心问题。

正式文件使用 `SchematicDocument v3`，以整数 DBU 保存器件、Wire 完整点列、Explicit Junction、Net Label、No Connect、Note、Marker 和四类 revision。连通性引擎直接依据持久化 Wire 几何建立 PhysicalNetComponent，再解析为 LogicalNet；MOS 网表端口顺序固定为 `D/G/S/B`。

公开需求原文见 [`Virtuoso 原理图编辑器最小核心版本需求规格说明书 V1.0`](docs/requirements/Virtuoso原理图编辑器_最小核心版本需求规格说明书_V1.0.docx)，1–40 章实施矩阵和未关闭发布门禁见 [`VSE-Core-1 V1.0 需求冻结与实施追踪`](docs/requirements/VSE-Core-1-V1.0-implementation.md)。当前类型检查、生产构建和 37 项领域测试均通过，但完整 AT/Golden/性能与统一 DesignStore 事务尚未完成，不能把本开发线标记为 V1.0 正式发布版。

## 局域网部署

本项目带账户数据库，因此部署版必须由 Wrangler 本地运行时注入 D1；不能使用普通的 `vinext start`。

一键准备独立部署目录：

```powershell
npm run deploy:lan
```

默认结果：

```text
../analog-studio-lan/
├─ app/                 Git 管理的独立部署克隆
├─ data/wrangler/       账户和项目数据库，升级时不会覆盖
├─ logs/
└─ backups/
```

进入部署版并启动：

```powershell
cd ..\analog-studio-lan\app
npm run start:lan
```

脚本会先应用未执行的数据库迁移，再监听 `0.0.0.0:3000`。同一局域网中的设备访问：

```text
http://部署电脑的局域网IPv4地址:3000
```

也可以显式指定端口和持久化位置：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-lan.ps1 `
  -Port 3000 `
  -DataPath "C:\AnalogStudioData\wrangler"
```

Windows 防火墙需单独允许 TCP 3000，只建议为“专用网络 / 本地子网”放行；这属于系统安全设置，部署脚本不会自动修改。

当前 `Wrangler Local + D1` 适合局域网内测和 MVP。若作为长期正式服务，应迁移到本机 SQLite/PostgreSQL 并配置进程守护、定时备份和 HTTPS；局域网 HTTP 不应承载高价值真实密码。

## 局域网版本更新流程

公开仓库是开发源，部署目录是它的 Git 克隆。后续更新建议：

```powershell
git add -A
git commit -m "描述本次变更"
# 先在正在运行 start:lan 的终端按 Ctrl+C 停止旧版本
npm run deploy:lan
npm run start:lan --prefix ..\analog-studio-lan\app
```

`deploy:lan` 会拒绝没有提交或仍有未提交修改的源仓库，避免部署版悄悄漏掉代码。它对已有部署执行 `git pull --ff-only`、`npm ci` 和生产构建；数据库、日志和环境文件不进入 Git。Windows 下更新前需要先停止旧服务，避免运行中的 Node/Workerd 锁住依赖文件。

## 参与协作

- 开始开发前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)，并优先通过 [Issues](https://github.com/ehaiedu/agent-anlog-studio/issues) 对齐问题和方案。
- Pull Request 会自动执行类型检查、生产构建、领域测试和代码检查；合并前应全部通过。
- 安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要在公开 Issue 中披露利用细节。
- 所有参与者都应遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方符号资源的许可声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 核心文件

- `components/AnalogWorkbench.tsx`：编辑器整体布局、项目保存和 AI 面板占位。
- `components/SchematicCanvas.tsx`：X6 画布、交互、历史、正交连线和文档同步。
- `components/x6Symbols.ts`：模拟器件 SVG 符号和端口布局。
- `components/ProjectDashboard.tsx`：账户项目管理。
- `app/api/auth/**`、`app/api/projects/**`：会话和按账户隔离的项目 API。
- `lib/schematic.ts`：与画布无关的领域模型和器件定义。
- `lib/netlist.ts`：连通性、ERC、Spectre/SPICE 编译。
- `scripts/start-lan.ps1`：迁移数据库并启动局域网部署。

AI 助手暂未调用外部 API；接入 OpenAI API 时应输出经过 Schema 校验的连接方案或 `SchematicDocument`，而不是直接输出 SVG 或网表文本。
