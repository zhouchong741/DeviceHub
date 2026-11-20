# DroidWall 阶段 1-2 实施方案与任务清单

> **应用名称**：**DroidWall**（仓库工作区：`/Users/zhouchong/Project/DeviceHub`）
> **分阶段交付策略**：先完成 **阶段 1-2**（基础工程 + 本机 ADB 自动接入 + 多机 `scrcpy` 实时投屏 + WebCodecs 硬解与单机控屏），并用当前已连接的 Android 16 真机跑通验收；确认稳妥后再迭代 **阶段 3-4**（一控多群控同步、文件拖拽安装分发、macOS 打包打磨）。

---

## 1. 本机实测基线与关键发现

在本次方案定稿前，已实测本机环境与已连真机状态：

| 核查项 | 实测结果 | 对实施的直接影响 |
| :--- | :--- | :--- |
| **宿主环境** | macOS `arm64`（Apple Silicon），Node `v26.13.1`，npm `11.20.0` | 未安装 `pnpm`/`yarn`，工程统一使用 `npm` 管理依赖 |
| **本机 ADB** | `/Users/zhouchong/Library/Android/sdk/platform-tools/adb`（`v37.0.0`） | 不打包 `adb`，直接复用本机 Android Studio SDK；绝不 `kill-server` |
| **已连真机** | 序列号 `8XL7JZFY8L4XAIBU` · **Xiaomi `2407FRK8EC`** · **Android 16（API 36）** · `1220×2712`（`520 dpi`） | 必须选用原生支持 Android 16 的最新 **`scrcpy-server-v5.0.1`**，避免旧版服务端崩溃 |

---

## 2. macOS Tahoe Liquid Glass 官方 UI 落地规范

对应交互式效果图：[droidwall_liquid_glass_ui.html](file:///Users/zhouchong/.gemini/antigravity/brain/d37171de-e2d2-4f30-91d3-0b4f9215647c/droidwall_liquid_glass_ui.html)

### 2.1 Apple HIG 核心原则落地
1. **Navigation vs. Content 材质分层**：
   - **仅导航与控制层使用 Liquid Glass**：悬浮侧边栏、顶部悬浮胶囊工具栏、底部微弱状态 HUD 胶囊使用高饱和度磨砂半透（`backdrop-filter: blur(28~36px) saturate(185%)`）与 `1px` 镜面高光描边（Specular Rim Light）。
   - **Content Layer（设备墙主画布）禁用重玻璃**：采用沉静实体暗/浅灰基底（`light-dark(#f2f4f8, #121419)`），避免玻璃叠玻璃（No Glass-on-Glass）导致手机画面噪点与对比度下降。
2. **悬浮侧边栏与同心几何（Concentricity）**：
   - 侧边栏不贴死窗口边缘，而是四周 `12px` inset 悬浮（圆角 `16px`），与内部 `10px` 圆角选中项严格保持同心关系；
   - 手机投屏卡片采用极简硬件外框（外圆角 `24px`、内垫 `6px`、画面 `<canvas>` 圆角 `18px`）；
   - 顶部悬浮胶囊下方叠加渐变羽化 **Scroll Edge Effect**，滚动设备墙时卡片从胶囊下方柔和穿行。
3. **图标与色彩克制**：
   - **严格零 Emoji 图标**：全量使用 `1.5px` 均匀线宽的 SF Symbols 风格线性图标（`lucide-react`）；
   - **单主色系统**：全界面仅使用 macOS System Blue（`#007AFF` / `#0A84FF`）作为主交互色，配合语义圆点（在线 `#30D158`、未授权 `#FF9F0A`、离线 `#FF453A`）及 `tabular-nums` 等宽数字；
   - 原生支持 `light-dark()` 深浅色自动/手动切换。

### 2.2 Electron macOS 窗口融合配置
在主进程 `BrowserWindow` 初始化时采用系统级原生活力融合参数：
- `titleBarStyle: 'hiddenInset'`，`trafficLightPosition: { x: 24, y: 24 }`（精准落在 `12px` inset 悬浮侧边栏左上角内）；
- `vibrancy: 'under-window'`，`visualEffectState: 'active'`，`backgroundColor: '#00000000'`，使原生窗口底噪折射桌面壁纸，再由前端 CSS Liquid Glass 胶囊承载局部高光与折边。

---

## 3. 核心技术选型（零 C++ Native Addon）

| 层级 | 选型方案 | 关键约束与原因 |
| :--- | :--- | :--- |
| **桌面宿主与构建** | `Electron` + `electron-vite` + `React 18` + `TypeScript 5` | 内置 Chromium 原生支持 `WebCodecs` + macOS `VideoToolbox` 硬件解码 |
| **状态与样式** | `Zustand 5` + `Tailwind CSS 4` + `lucide-react` | 按 `serial` 精细订阅，避免多机高频帧率/状态更新导致全局重渲染 |
| **本地网关与存储** | `ws 8`（`perMessageDeflate: false`）+ Node 原生 `fs` | 关闭 WS 压缩降低延迟；配置直接读写 `userData/config.json`，不引入纯 ESM 的 `electron-store` |
| **ADB 通信引擎** | 自研轻量 `AdbClient`（`net.Socket` 连 `127.0.0.1:5037`） + `child_process.spawn` | 高频 `host:track-devices-l` 与 `forward` 走原生 Socket；若 `ECONNREFUSED` 自动触发一次 `adb start-server` |
| **端侧投屏代理** | **`scrcpy-server-v5.0.1`**（放置于 `resources/scrcpy-server.jar`） | 唯一随包二进制依赖，纯 Java 字节码无 Mac 芯片架构限制，原生支持 Android 16 |

### 3.1 本机 ADB 自动探测优先级
按顺序探测并缓存可用路径：
1. 用户手动配置并持久化的 `adbPath`（支持界面挑选文件兜底）；
2. `process.env.ANDROID_HOME` / `ANDROID_SDK_ROOT` 下的 `platform-tools/adb`；
3. macOS Android Studio 默认路径：`~/Library/Android/sdk/platform-tools/adb`；
4. Homebrew 常见路径：`/opt/homebrew/bin/adb`、`/usr/local/bin/adb`。

---

## 4. `scrcpy v5.0.1` 精确协议与架构设计

> [!IMPORTANT]
> 经源码核对 `Genymobile/scrcpy` `v5.0.1`（`DesktopConnection.java`、`Streamer.java`、`ControlMessageReader.java`），`v5.0.1` 的视频流头与早期版本差异显著，必须严格按下方字节定义解析与封包。

### 4.1 多机连接流程（按设备 `serial` 隔离）
1. 为设备分配随机 31 位非负整数 `scid`（8 位十六进制）与本机空闲 TCP 端口 `localPort`；
2. `adb -s <serial> push resources/scrcpy-server.jar /data/local/tmp/scrcpy-server.jar`；
3. `adb -s <serial> forward tcp:<localPort> localabstract:scrcpy_<scid>`；
4. 启动服务端（阶段 1-2 关闭音频以聚焦画面与控制稳定性）：
   ```bash
   adb -s <serial> shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
     app_process / com.genymobile.scrcpy.Server 5.0.1 \
     scid=<scid> tunnel_forward=true audio=false control=true \
     max_size=<720|1080|540> max_fps=<fps> video_bit_rate=<bps> \
     send_device_meta=true send_frame_meta=true send_dummy_byte=true send_stream_meta=true
   ```
5. 主进程依次对 `127.0.0.1:<localPort>` 建立 **Video Socket** 与 **Control Socket**。

### 4.2 视频流二进制协议解析（`v5.0.1`）
Video Socket 连接后按以下字节序依次读取：
1. **1 字节 Dummy Byte (`0x00`)**：检测隧道连接可用性；
2. **64 字节 Device Meta**：UTF-8 设备名称（零填充）；
3. **4 字节 Stream Header**：`codecId`（Big-Endian UInt32，H.264 为 `0x68323634`；注意此处无宽高）；
4. **循环读取 12 字节 Packet Header**：
   - 检查第 1 字节最高位 `bit 63`（`PACKET_FLAG_SESSION = 1n << 63n`）：
     - **Session Meta（12B，无后续 Payload）**：`flags (4B)` + `width (4B)` + `height (4B)`。用于初始化与横竖屏旋转时实时更新设备物理宽高；
     - **Frame Meta（12B + `packetSize`B）**：`ptsAndFlags (8B)` + `packetSize (4B)`，随后读取 `packetSize` 字节 H.264 Annex-B 数据：
       - `bit 62` (`PACKET_FLAG_CONFIG`) = `1`：Config 包（SPS/PPS）；
       - `bit 61` (`PACKET_FLAG_KEY_FRAME`) = `1`：IDR 关键帧；
       - 低 61 位：PTS（微秒）。

### 4.3 WebCodecs `VideoDecoder` 硬解与旋转策略
- **动态提取 Codec String**：绝不硬编码 `avc1.42E01E`。从 Config Packet 的 SPS NALU（跳过 Annex-B 起始码及 NALU Header 1 字节）读取前 3 字节 `(profile_idc, profile_compat, level_idc)`，动态拼接为 `avc1.PPCCLL` 配置 `VideoDecoder`（`hardwareAcceleration: 'prefer-hardware'`、`optimizeForLatency: true`）。
- **Annex-B 合并投递**：不传 `description` 字段，主进程或解码 Hook 缓存最近一份 Config (SPS/PPS)，在下一个 IDR 关键帧到达时将其拼接在该关键帧之前，作为 `EncodedVideoChunk({ type: 'key', ... })` 喂入 `VideoDecoder`。
- **防积压与旋转自适应**：当 `decoder.decodeQueueSize > 3` 时跳过非关键帧防止延迟累积；收到主进程转发的新 `SessionMeta` 时同步更新 `<canvas>` 宽高比与 Zustand 状态。

### 4.4 控制流二进制协议（`v5.0.1` 大端序）与扩展预留
前端指针/滚轮事件从阶段 2 起统一发送 **`[0.0 ~ 1.0]` 归一化坐标 `(xRatio, yRatio)`**，由主进程按当前设备最新 `SessionMeta (width, height)` 换算成物理坐标写入 Control Socket（阶段 3 实现群控广播时，前端零改动）：

| 消息类型 | `type` 值 | 精确包长 | 字节布局（Big-Endian） |
| :--- | :---: | :---: | :--- |
| `INJECT_KEYCODE` | `0` | **14B** | `1B type + 1B action + 4B keycode + 4B repeat + 4B metaState` |
| `INJECT_TOUCH_EVENT` | `2` | **32B** | `1B type + 1B action + 8B pointerId + 4B x + 4B y + 2B w + 2B h + 2B pressure(u16) + 4B actionBtn + 4B buttons` |
| `INJECT_SCROLL_EVENT` | `3` | **21B** | `1B type + 4B x + 4B y + 2B w + 2B h + 2B hScroll(i16, ±16) + 2B vScroll(i16, ±16) + 4B buttons` |
| `BACK_OR_SCREEN_ON` | `4` | **2B** | `1B type + 1B action` |
| `SET_CLIPBOARD` | `9` | **14+NB** | `1B type + 8B sequence + 1B paste(bool) + 4B len + N bytes UTF-8`（支持中文输入/粘贴） |
| `SET_DISPLAY_POWER` | `10` | **2B** | `1B type + 1B on(bool)` |

> 活动指针保护：主进程记录每个设备活跃的 `pointerId`；当鼠标移出画布或投屏断开前自动补发 `ACTION_UP`，防止手机端“手指粘连”。

---

## 5. 阶段 1-2 工程目录结构

```text
/Users/zhouchong/Project/DeviceHub/
├── package.json
├── tsconfig.json
├── electron.vite.config.ts
├── resources/
│   └── scrcpy-server.jar             # scrcpy-server-v5.0.1
├── electron/
│   ├── main.ts                       # BrowserWindow (hiddenInset + vibrancy)、IPC 注册
│   ├── preload.ts                    # contextBridge 安全暴露 window.droidWall
│   ├── config/
│   │   └── store.ts                  # 基于原生 fs 的 config.json 持久化
│   ├── adb/
│   │   ├── locator.ts                # macOS 本机 ADB 自动探测 + start-server 兜底
│   │   ├── client.ts                 # 原生 net.Socket 直连 5037 (ADB wire protocol)
│   │   ├── tracker.ts                # host:track-devices-l 热插拔监听与退避重连
│   │   └── executor.ts               # push / forward / removeForward / screencap
│   └── mirror/
│       ├── session-manager.ts        # 多机独立 Session 生命周期管理
│       ├── device-session.ts         # 单机 scid + forward + 双 Socket + 清理
│       ├── protocol.ts               # v5.0.1 视频帧解析 & 控制包 Big-Endian 序列化
│       └── ws-gateway.ts             # 本地 WebSocket 服务 (binary, perMessageDeflate: false)
└── src/
    ├── index.html                    # <meta name="color-scheme" content="light dark"> + 防 FOUC
    ├── main.tsx
    ├── App.tsx
    ├── styles/liquid-glass.css       # Liquid Glass 令牌、同心圆角、Scroll Edge、滚动条
    ├── store/
    │   └── useDeviceStore.ts         # Zustand：设备列表、投屏状态、分辨率、画质、列数
    ├── hooks/
    │   ├── useMirrorStream.ts        # WebSocket + SPS 解析 + WebCodecs VideoDecoder 硬解
    │   └── useNormalizedControl.ts   # Pointer/Wheel/Keyboard/Paste 归一化事件发送
    └── components/
        ├── Sidebar.tsx               # 悬浮侧边栏、设备列表、ADB 状态与手动选路径入口
        ├── Toolbar.tsx               # 悬浮液态玻璃胶囊顶栏（画质/列数/全部投屏/外观切换）
        ├── DeviceWall.tsx            # 自适应网格墙 & 单机专注模式
        └── DeviceCard.tsx            # 硬件质感投屏卡片（Canvas + 悬浮控制 + 底部导航键）
```

---

## 6. 阶段 1-2 分步任务清单（Task Breakdown）

### 阶段 1：工程骨架、Liquid Glass 外壳与本机 ADB 接入
1. **初始化工程**：搭建 `electron-vite` + `React 18` + `TypeScript` + `Tailwind CSS 4` + `Zustand` + `lucide-react` + `ws` 工程骨架，配置 `macOS` 无原生 C++ 编译依赖构建脚本。
2. **主进程配置与窗口壳**：实现 `config/store.ts` 与 `main.ts`（`hiddenInset`、`under-window` vibrancy、交通灯位置精准对齐悬浮侧栏）。
3. **本机 ADB 引擎**：
   - 实现 `adb/locator.ts`（自动命中本机 `/Users/zhouchong/Library/Android/sdk/platform-tools/adb`，同时支持 UI 手动挑选兜底）；
   - 实现 `adb/client.ts` 与 `adb/tracker.ts`（`host:track-devices-l` 实时获取序列号、在线/未授权状态、Model，5037 未启动时自动拉起）。
4. **Liquid Glass UI 骨架**：实现 `Sidebar`、`Toolbar`、`DeviceWall`、`DeviceCard` 与深/浅色切换，运行后能实时显示本机已连真机 **`Xiaomi 2407FRK8EC`**。

### 阶段 2：多机 `scrcpy v5.0.1` 投屏、WebCodecs 硬解与单机控制
5. **集成端侧代理**：下载并校验官方 `scrcpy-server-v5.0.1` 放入 `resources/scrcpy-server.jar`。
6. **视频与控制网关**：
   - 实现 `mirror/protocol.ts`（严格按 `v5.0.1` 解析 1B dummy + 64B deviceName + 4B codecId + 12B SessionMeta + 12B FrameMeta，序列化 32B Touch / 14B Keycode / 21B Scroll / Clipboard / DisplayPower）；
   - 实现 `device-session.ts`、`session-manager.ts` 与 `ws-gateway.ts`（按 `serial` 隔离本地端口、`scid` 与异常退出清理）。
7. **WebCodecs 硬件解码与输入**：
   - 实现 `useMirrorStream.ts`（SPS 动态解析 `avc1.PPCCLL`、`VideoDecoder` 硬解渲染至 `<canvas>`、收到 `SessionMeta` 时自适应横竖屏尺寸）；
   - 实现 `useNormalizedControl.ts`（指针点击/拖拽、触控板双指滚动、实体键盘、`Cmd+V` 剪贴板同步支持中文、卡片底部返回/桌面/多任务/旋转/息屏/截图、专注放大与全局画质切换）。

---

## 7. 真机验收标准（在 `Xiaomi 2407FRK8EC` 上验证）

1. **阶段 1 验收**：启动开发模式 `npm run dev` 后窗口无报错，自动识别本机 `adb`，侧边栏准确显示 `8XL7JZFY8L4XAIBU (2407FRK8EC)`；拔插 USB 数据线时界面 1 秒内同步上下线。
2. **阶段 2 验收**：
   - 点击投屏后 **1 秒内** 出首帧高清画面，无黑屏或解码器报错；
   - 鼠标点击、长按拖拽滑动跟手流畅，触控板双指滚动列表自然；
   - 测试底部 `返回 / 桌面 / 多任务 / 息屏 / 截图` 均真实生效，且 `Cmd+V` 可正常向手机输入框粘贴中文；
   - 手机横屏切换（如打开横屏应用或点击旋转）时，卡片画布比例与点击坐标映射实时同步不变形；
   - 关闭应用或断开投屏后，本机 `adb forward --list` 与手机端 `app_process` 无残留进程。
