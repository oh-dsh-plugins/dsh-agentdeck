# Releasing / 版本发布

[English README](../README.md) · [中文说明](../README.zh-CN.md)

## English

Pull requests and pushes to `main` run [CI](../.github/workflows/ci.yml). A `vX.Y.Z` tag starts the separate [Release workflow](../.github/workflows/release.yml):

1. Check out that exact tag, require its version to match `package.json`, and verify that the commit belongs to `main`.
2. Install the pinned DSH host and isolated BrowserSkill fixtures; run TypeScript, the full test suite and package-content checks.
3. Pack the tested build and pass that archive to a separate publishing job. Test jobs have no npm publishing identity.
4. Publish the archive through npm Trusted Publishing (OIDC), verify its public registry integrity and downloaded bytes, then create the GitHub Release with the same `.tgz` and `SHA256SUMS`.

Stable versions use npm `latest`. Versions with a prerelease suffix use npm `next` and a GitHub prerelease. The workflow does not bump versions. It never overwrites an npm version or a Release asset. A rerun checks the existing archive integrity. If repacking changed archive metadata or group/other read permission bits, every regular file's content and all remaining permission bits must still match the tested package. The workflow then retains the immutable original npm archive, verifies existing Release assets and uploads only missing assets. Changed content, file types, write permissions or executable permissions require a new version.

### One-time npm setup

A package maintainer with 2FA must authorize the exact repository and workflow as an npm trusted publisher. With npm >=11.15.0, run in an interactive terminal:

```sh
npm trust github dsh-agentdeck \
  --repo oh-dsh-plugins/dsh-agentdeck \
  --file release.yml --allow-publish --yes
npm trust list dsh-agentdeck
```

Complete npm's own browser/2FA prompt. Do not put passwords, one-time codes or npm tokens in this repository. This relationship grants publishing for this package to `oh-dsh-plugins/dsh-agentdeck`'s `release.yml`; no `NPM_TOKEN` repository secret is needed. Existing unrelated trust configurations must be inspected before any replacement. The publishing job uses a GitHub-hosted runner, Node 24, npm 11.19.1 and `id-token: write`; its npm authentication comes from the short-lived GitHub OIDC identity. See [npm's documentation](https://docs.npmjs.com/trusted-publishers/).

### Publish a new version

Start from an up-to-date `main` checkout. Bump the package/lockfile version, update both README version examples and the changelog, then commit and push that source before pushing its matching tag. For example, for the next patch after 0.2.4:

```sh
npm version patch --no-git-tag-version
# Update README.md, README.zh-CN.md and CHANGELOG.md for the new version.
git add package.json package-lock.json README.md README.zh-CN.md CHANGELOG.md
git commit -m "chore(release): prepare next version"
git push origin main
release_version=$(node -p "require('./package.json').version")
git tag "v${release_version}"
git push origin "v${release_version}"
```

Watch the Release workflow. A failed test prevents publication. A trust/authentication error requires the package maintainer to correct npm's trusted publisher configuration; do not work around it with a weaker account policy. Once npm has published a version, resume the same tag rather than changing its content:

```sh
gh workflow run release.yml --repo oh-dsh-plugins/dsh-agentdeck \
  --ref main -f tag=v0.2.4
```

Use the actual failed version tag in place of `v0.2.4`. If the version is not on npm yet, use that same tag for `--ref` as well; publication requires the run's source commit/ref to match the tested tag so npm provenance identifies the correct source. Already-published versions can use `--ref main` for verification and backfilling a GitHub Release, provided the tagged source rebuilds to the same package contents and permitted mode bits; the existing original archive is retained for Release downloads. GitHub's automatic source archives omit compiled runtime files; plugin installation uses the `.tgz` Release asset or the npm package.

## 简体中文

提交到 `main` 或创建拉取请求会运行 [CI](../.github/workflows/ci.yml)。推送 `vX.Y.Z` 标签会启动独立的 [Release 工作流](../.github/workflows/release.yml)：

1. 检出该标签，要求版本与 `package.json` 一致，并确认提交属于 `main`。
2. 安装固定版本的 DSH 宿主和隔离 BrowserSkill 测试依赖，执行 TypeScript、完整测试和包内容检查。
3. 将通过测试的构建打成安装包，传给独立发布作业；测试作业没有 npm 发布身份。
4. 通过 npm 可信发布（Trusted Publishing / OIDC）发布该安装包，核对公开 registry 的完整性和下载字节，再创建包含相同 `.tgz` 与 `SHA256SUMS` 的 GitHub Release。

稳定版使用 npm `latest`；带预发布后缀的版本使用 npm `next` 和 GitHub 预发布。工作流不自动递增版本，不覆盖 npm 版本或 Release 附件。重跑时先核对归档完整性；如果重新打包仅改变归档元数据或组／其他用户的读取权限位，则逐个核对全部普通文件的内容和其余权限位，确认相同后保留 npm 上不可变的原始安装包。已有附件逐字节核验，仅补传缺失附件。文件内容、类型、写入或执行权限发生变化时，必须使用新版本。

### 一次性 npm 配置

包维护者需要开启 2FA，并在自己的交互式终端执行上面的 `npm trust github` 命令，按 npm 原生流程完成浏览器／二次验证。配置应精确指向包 `dsh-agentdeck`、仓库 `oh-dsh-plugins/dsh-agentdeck` 和工作流文件名 `release.yml`，仅授予该包的发布权限。无需设置 `NPM_TOKEN` 仓库密钥，也不要把密码、验证码或 Token 写入项目。已有其他可信发布配置时，先检查再决定是否替换。

发布作业使用 GitHub 托管 runner、Node 24、npm 11.19.1 和 `id-token: write`，通过短期 GitHub 身份凭据完成 npm 认证。该设置不要求降低 npm 账号的 2FA 策略。

### 发布新版本与恢复

从最新 `main` 开始，执行上面的版本递增示例，更新中英文 README 和更新记录，先提交并推送源码，再推送与包版本相同的 `v<版本号>` 标签。测试失败会阻止发布；认证失败应修正 npm 的可信发布配置。

npm 已接收某版本后，不要移动标签或修改同版本内容。可以在 GitHub Actions 手动运行 `Release`，填写实际标签，或使用上面的 `gh workflow run` 命令恢复。如果版本尚未发布到 npm，`--ref` 也必须填写同一个版本标签，让来源证明（provenance）指向实际测试的提交；已发布版本的核验和 Release 补全可以从 `main` 启动，但重建包的全部文件内容和受检权限位必须与 npm 原包一致，下载附件保留该原始归档。

GitHub 自动生成的源码压缩包不包含编译后的运行文件；安装插件应使用 Release 中的 `.tgz` 附件或 npm 包。
