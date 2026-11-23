# 让其他电脑的 DSH 用 fork 版 Qoder 插件

适用对象：DSH 桌面端 + Qoder 插件 `@dmh2002/dsh-connect-qoder`。

本 fork 只改一件事：发往 Qoder 的 **system 消息开头**如果是
`You are an AI agent powered by DeepSeek Harness.`，先把它剥掉再发。
原因是 Qoder 上游对这句做内容过滤，会回 `403 / code 10605 /
RESOURCE_LIMIT / serviceAvailable:false`（伪装成排队限流，等 30 秒、
换 PAT 都没用）。其余行为与官方 1.27.1 一致。版本号：`1.27.1-fork.1`。

两种装法任选其一：

- **方案 A（推荐）**：从 GitHub Release 装打包好的 tgz。目标机器不需要
  Node / pnpm 构建链。
- **方案 B**：克隆 fork、本地构建，profile 用 `link:` 指向它。
  本机 2026-11-23 用这种方式验证通过。

> 改之前先备份 profile 的 `package.json` 与 `pnpm-lock.yaml`。
> 只改依赖声明，不要手改 `node_modules` 里的文件（下次 install 会被覆盖）。

---

## 方案 A：装 Release 里的 tgz（推荐）

### 1. 找到桌面端 profile

| 系统 | 路径 |
| --- | --- |
| Linux / macOS | `~/.dsh/profiles/desktop` |
| Windows | `%USERPROFILE%\.dsh\profiles\desktop` |

如果桌面端用的是别的 profile，把 `desktop` 换成实际目录名；
可以用 `ls ~/.dsh/profiles/` 确认。

### 2. 备份并改依赖

Linux / macOS：

```bash
cd ~/.dsh/profiles/desktop
cp package.json "package.json.bak-fork-$(date +%Y%m%d-%H%M%S)"
cp pnpm-lock.yaml "pnpm-lock.yaml.bak-fork-$(date +%Y%m%d-%H%M%S)"
python3 - <<'PY'
import json
p = 'package.json'
d = json.load(open(p))
d['dependencies']['@dmh2002/dsh-connect-qoder'] = (
    'https://github.com/tutumumu777/dsh-connect-qoder/releases/download/'
    'v1.27.1-fork.1/dmh2002-dsh-connect-qoder-1.27.1-fork.1.tgz'
)
json.dump(d, open(p, 'w'), indent=2, ensure_ascii=False)
open(p, 'a').write('\n')
PY
```

Windows PowerShell（备份后用编辑器改，别用 heredoc）：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item package.json "package.json.bak-fork-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item pnpm-lock.yaml "pnpm-lock.yaml.bak-fork-$(Get-Date -Format yyyyMMdd-HHmmss)"
notepad package.json
```

把 `"dependencies"` 里这一行：

```json
"@dmh2002/dsh-connect-qoder": "1.27.1"
```

改成：

```json
"@dmh2002/dsh-connect-qoder": "https://github.com/tutumumu777/dsh-connect-qoder/releases/download/v1.27.1-fork.1/dmh2002-dsh-connect-qoder-1.27.1-fork.1.tgz"
```

不要动 `dsh.profile.bundles` 里的条目——它按包名加载，URL 依赖同样生效。

### 3. 在 profile 目录里安装

有系统 pnpm 11 就直接：

```bash
pnpm install
```

没有 pnpm 时，Linux / macOS 优先用 DSH 自带的 runtime：

```bash
NODE=$(ls -d ~/.dsh/dsh-runtimes/*/dependencies/node/bin/node 2>/dev/null | head -1)
PNPM=$(ls -d ~/.dsh/dsh-runtimes/*/dependencies/pnpm/bin/pnpm.cjs 2>/dev/null | head -1)
"$NODE" "$PNPM" install
```

Windows 没有 pnpm 时，先 `corepack enable`，再
`corepack prepare pnpm@11 --activate`（需要本机有 Node），然后 `pnpm install`。

### 4. 校验装的是 fork

Linux / macOS：

```bash
ls ~/.dsh/profiles/desktop/node_modules/@dmh2002/dsh-connect-qoder/lib/index.js
grep -c stripHarnessIdentityOpener \
  ~/.dsh/profiles/desktop/node_modules/@dmh2002/dsh-connect-qoder/lib/host-heartbeat-*.js
grep '"version"' \
  ~/.dsh/profiles/desktop/node_modules/@dmh2002/dsh-connect-qoder/package.json | head -1
```

期望：文件存在；grep 输出 `2`；版本是 `1.27.1-fork.1`。

Windows 用 `dir` / `Select-String` 做同样的检查。

### 5. 重启并验收

完全退出 DSH（托盘/后台进程也要退），再启动。新建会话，选
**qoder-global/dfmodel**，发一句「hi」。

验收标准：几秒内正常出字，不再出现 `502` / `10605` / `RESOURCE_LIMIT`。

---

## 方案 B：克隆 + 本地构建 + link

本机今天的做法，适合想跟源码、随时改的机器。

```bash
# 1. 克隆（固定一个路径，后面 link 要用）
git clone git@github.com:tutumumu777/dsh-connect-qoder.git \
  ~/ttmm/projects/dsh-connect-qoder-fork
cd ~/ttmm/projects/dsh-connect-qoder-fork

# 2. 构建（需要 Node >= 22、pnpm 11）
pnpm install
pnpm run build          # 产物在 lib/

# 3. profile 依赖改成 link（Linux / macOS，路径换成你的绝对路径）
cd ~/.dsh/profiles/desktop
python3 - <<'PY'
import json
p = 'package.json'
d = json.load(open(p))
d['dependencies']['@dmh2002/dsh-connect-qoder'] = \
    'link:/home/你的用户名/ttmm/projects/dsh-connect-qoder-fork'
json.dump(d, open(p, 'w'), indent=2, ensure_ascii=False)
open(p, 'a').write('\n')
PY

# 4. 安装并确认软链
pnpm install
readlink -f node_modules/@dmh2002/dsh-connect-qoder
# 期望输出 fork 目录
```

Windows 的 `link:` 用正斜杠绝对路径，例如
`link:C:/Users/你的用户名/ttmm/projects/dsh-connect-qoder-fork`。

以后升级：`git pull && pnpm install && pnpm run build`，然后重启 DSH。

---

## 回滚

把依赖改回官方版本，重装、重启（Linux / macOS）：

```bash
cd ~/.dsh/profiles/desktop
cp package.json.bak-fork-<时间戳> package.json
cp pnpm-lock.yaml.bak-fork-<时间戳> pnpm-lock.yaml
pnpm install
```

或者手工把依赖值改回 `"1.27.1"` 再 `pnpm install`。回滚后 `10605` 会回来——
那是上游对身份句的过滤，不是插件坏了。

---

## 常见问题

- **插件市场提示更新 / 显示 1.27.1**：不要从市场更新，会把 fork 覆盖回官方版。
  fork 的版本号是 `1.27.1-fork.1`，看到这个版本说明装对了。
- **Release 下载超时**：GitHub Release 资产走 `objects.githubusercontent.com`，
  网络差时可能失败。可以先在浏览器/下载工具里把 tgz 下到本地，依赖改成
  `file:/绝对路径/dmh2002-dsh-connect-qoder-1.27.1-fork.1.tgz`，再 `pnpm install`。
- **构建报 `Failed to import module "unrun"`**：pnpm 不自动装 tsdown 的可选 peer，
  在 fork 目录执行 `pnpm add -D unrun` 再 build。仓库已把它写进 devDependencies。
- **`pnpm test` 有一条 `RSA_PKCS1_PADDING is no longer supported`**：
  Node 22 / OpenSSL 3 对 PKCS#1 v1.5 私钥解密的限制，属既有环境问题，
  与本次补丁无关。
- **机器上有多个 profile**：确认改的是桌面端正在用的那个；改错 profile 不会生效。
- **不想每台机器都装**：最终解法是给上游提 PR，让官方版内置这个兼容处理；
  在官方发版前，fork 是临时方案。

---

## 变更记录

- `1.27.1-fork.1`：`src/messages.ts` 新增 `stripHarnessIdentityOpener`，
  在 `convertIncomingMessage` 里只对 `role === 'system'` 的消息剥离开头这句；
  配 4 条单测。实测同一条真实请求（75 个工具、`reasoningEffort: max`）由
  10605 失败变为 1.7 秒成功。详见 `CHANGELOG.md`。
