# Промпт для Windows-агента: AgentMesh Desktop

Скопируйте текст ниже в новую сессию агента на Windows. Репозиторий публичный:
https://github.com/VladimirKraswov/opencode-desktop . SSH не требуется.

---

Ты работаешь на моём Windows-ноутбуке. Получи свежий `main` AgentMesh Desktop,
собери Windows x64 NSIS-установщик, обнови приложение и проверь его реальную
работу. Если обнаружишь дефекты Windows, исправь их в отдельной ветке и открой
pull request в `VladimirKraswov/opencode-desktop`, base `main`. Создание ветки,
push исправлений и PR разрешены. Координатор на Mac затем проверит изменения
и решит вопрос слияния. Сам не вливай PR и не пушь непосредственно в `main`.

Название продукта — **AgentMesh Desktop**, прежнее — OpenCode Desktop.
Репозиторий, npm package, executable `opencode-desktop.exe`, application ID
`dev.local.opencodedesktop` и исторические data paths намеренно сохраняют старые
имена. Не переименовывай их и не создавай второе хранилище чатов.

## 1. Получи исходники по HTTPS

В PowerShell сначала проверь инструменты и существующие рабочие копии.
Предпочтительный каталог — `C:\Dev\opencode-desktop`; не предполагай имя
пользователя или путь старой ZIP-копии. Если каталога нет:

```powershell
New-Item -ItemType Directory -Force C:\Dev | Out-Null
git clone https://github.com/VladimirKraswov/opencode-desktop.git C:\Dev\opencode-desktop
Set-Location C:\Dev\opencode-desktop
```

Если Git-копия уже есть, сначала `git status --short --branch`, `git remote -v`
и проверь незакоммиченные изменения. Сохрани существующую работу; не используй
`reset --hard`, `clean -fd`, принудительный checkout или слепой stash.
В старой архивной копии без `.git` клонируй в отдельный новый каталог.
Для чистой копии с правильным origin:

```powershell
git remote set-url origin https://github.com/VladimirKraswov/opencode-desktop.git
git fetch origin --prune
git switch main
git pull --ff-only origin main
git rev-parse HEAD
git rev-parse origin/main
```

При локальном расхождении main не затирай его: создай отдельную рабочую копию
или worktree от `origin/main`. Не бери старый release tag вместо свежего main.
Минимальная база передачи — `f1416c0c8462f10d663d8904571588cfaa010e62`,
уже содержащая 0.2.21; допускаются её последующие коммиты main. Запиши точный
SHA, фактическую версию `package.json` и ОС в отчёт. Если main продвинулся за
время работы, перед PR осознанно интегрируй новые изменения и повтори затронутые
проверки; не переписывай чужую историю.

Прочитай `AGENTS.md`, актуальный верхний блок `.pi/TASK.md`, релевантный
`ROADMAP.md`, `README.md`, `docs/PLATFORMS.md`, `docs/VERIFICATION.md`,
`docs/WINDOWS-MCP-INTEGRATION-20261006.md` и
`docs/WINDOWS-RESULT-0.2.18-20261006.md`. Старые checkpoint-задания не запускай.
Отсутствие Mac-only локальных памяток не блокирует работу.

## 2. Подготовь Windows x64 toolchain

Используй Node.js 24 LTS >=24.15.0 (ограничение текущего проекта), npm,
Git, Rust stable MSVC (`x86_64-pc-windows-msvc`), Microsoft Visual Studio C++
Build Tools с Desktop development with C++ и Windows SDK, WebView2 Evergreen.
GitHub CLI `gh` нужен для PR. Проверяй фактические версии и PATH, используй
`npm.cmd`, чтобы не упираться в PowerShell execution policy для npm.ps1.
Недостающие зависимости устанавливай из официальных источников; не обновляй
весь toolchain или lockfile без причины. Установщики, требующие прав или
системного подтверждения, пользователь подтверждает сам. Не обходи блокировки.

Официальные инструкции:
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/windows-installer/
- https://nodejs.org/en/download
- https://rustup.rs/
- https://git-scm.com/downloads/win
- https://cli.github.com/

Запусти `scripts/check-windows-prereqs.ps1` обычным доступным PowerShell.
Если отсутствуют команды после установки, обнови PATH текущей сессии или
открой новую оболочку, не удаляя старые записи PATH. Не отключай execution
policy глобально. Не загружай произвольные бинарники из чужих архивов.

OpenCode и Pi — отдельные движки, они не входят в Desktop. Сохрани установленные
версии и provider/model/effort настройки. Если движка нет, используй штатное
предложение установки и официальную документацию. Не меняй модели на облачные,
не трогай V100/5090/Proxmox и не запускай параллельные inference-бенчмарки.

## 3. Проверки и сборка

Перед правками создай рабочую ветку от свежего main, например
`windows/agentmesh-0.2.21-validation`; для следующих задач используй уникальное
понятное имя. Все команды выполняй из корня репозитория, последовательно,
проверяя код завершения каждой команды (`$LASTEXITCODE` у native-команд).
PowerShell `$ErrorActionPreference='Stop'` сам по себе не гарантирует остановку
после неуспеха native-программы. Не скрывай ошибки за pipeline/последней командой.

```powershell
npm.cmd ci
npm.cmd test -- --maxWorkers=2
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm.cmd run build:windows
```

Не запускай `npm audit fix` или массовую смену зависимостей автоматически.
NSIS настраивается общим `tauri.conf.json` и автоматически применяемым
`src-tauri/tauri.windows.conf.json`. macOS signing config сюда не передавай.
Путь результата:
`src-tauri\target\release\bundle\nsis\AgentMesh Desktop_<version>_x64-setup.exe`.
Версию читай из исходников, не повышай её только ради пересборки той же базы.
Важные исправления/новую версию согласуй через PR; версия должна совпадать во
всех четырёх source manifests и записи собственного пакета Cargo.lock.

На Mac база 0.2.21 дала 487 frontend pass/6 opt-in skip и 80 Rust pass/1 opt-in
ignored. Это ориентир, а не требование подгонять Windows счётчики: cfg и live
проверки отличаются. Не ослабляй тесты и не выдавай skipped за пройденные.

Зафиксируй SHA256 и размер установщика:

```powershell
Get-ChildItem src-tauri\target\release\bundle\nsis\*-setup.exe
Get-FileHash -Algorithm SHA256 -LiteralPath '<фактический путь установщика>'
```

`scripts/verify-windows.ps1 -InstallerPath '<путь>' -ArtifactOnly` проверяет
артефакт. В текущей базе его installed-поиск ещё сравнивает DisplayName только
с `OpenCode Desktop`, хотя новое имя — AgentMesh Desktop. Это известное
устаревание помощника проверки: не считай его ошибку доказательством сломанной
установки. Проверь реестр HKCU и текущий installed binary отдельно; можно
исправить помощник в этой ветке с проверкой обоих имён и правильной версии.

## 4. Обнови установленное приложение, сохрани данные

Перед обновлением сохрани приватную резервную копию только необходимых
app/config/profile данных и прежнего установщика вне Git. Не публикуй её.
Закрой Desktop обычным способом, убедись, что процесс приложения завершился;
не убивай отдельно управляемый OpenCode server или его чаты. Установи новый
NSIS для текущего пользователя и открой AgentMesh Desktop. Если система
блокирует неподписанный установщик, сообщи точный блок и дай пользователю
подтвердить его самостоятельно; не обходи защиту.

Проверь фактический путь запуска, installed version и binary, отсутствие
дубликата старого приложения/shortcut. Основное ожидаемое место —
`%LOCALAPPDATA%\AgentMesh Desktop`, но реальный путь бери из установки/реестра.
Данные и application ID должны сохраняться при переименовании.
Проверь здоровье уже работающего OpenCode через `/global/health`, а если он
не работал — штатный автозапуск Desktop. Не запускай второй сервер на том же
порту. Проверь настройки Pi/Node/OpenCode paths без замены пользовательского
provider-конфига. Не отправляй прежний пользовательский черновик автоматически.

## 5. Живая Windows-проверка

Используй отдельную тестовую сессию и тестовые файлы, не переписывая владельческие
чаты. Проверяй реальные результаты, а не просто отсутствие исключений:
- открытие установленного приложения, история и сохранённые настройки;
- короткие model labels, узкий composer, несколько вложений, доступный stop;
- браузер внутри панели: вкладки, URL, назад/вперёд, expand/collapse, light/dark;
- быстрый режим: DOM snapshot/ref действия; эмуляция: клики мышью и клавиатура,
  semantic click/evaluate не выполняются;
- изменение размера окна/панели и UI масштаба во время работы: actual Chromium
  viewport меняется; старые XY не выполняются, возвращается свежий снимок;
  после нового наблюдения координатный клик попадает в responsive target;
- shared manual/agent input не использует устаревшее наблюдение; нет повтора
  потенциально уже отправленного действия;
- OpenCode и Pi получают один браузер/MCP, 33 tools на этой базе; Pi передаёт
  recovery image/guidance агенту, а обычные ошибки не раскрывают private logs;
- Windows `%USERPROFILE%\.opencode-desktop\browser-runtime` общ для Desktop и
  MSIX/обычно запущенных движков; отсутствие stale bridge после обновления;
- cancel/setup/reconnect/browser off-on/quit-relaunch без удаления профиля;
- файловые вложения, clipboard, drag-and-drop, диктовка и stop при картинках;
- настройки модели/агента, task/source panel и persistence paused schedule.

Реальные browser regression scripts:
`src-tauri/resources/browser/test/smoke.mjs` и `windows-shared.mjs`.
Прочитай их contract: только disposable `%TEMP%\oc-browser-*`, pinned runtime
и read-only cache reuse; нельзя передавать пользовательский профиль/ready.json.
`setup.mjs` запускается из copied runtime/current и требует два абсолютных
аргумента (root и npm CLI script). Не придумывай MCP readiness/token вручную.
`windows-shared.mjs` принимает абсолютные пути compiled Desktop CLI и prepared
временного runtime. Проверяй как debug, так и final/installed CLI, если уместно.
Не раскрывай auth tokens/пароли/содержимое профиля в отчётах и screenshots.

Не заявляй поддержку неработающих функций: Agent Control/Factory и некоторые
remote/Pi возможности имеют отдельные ограничения. Если живой микрофон,
SSH/модель или OS подтверждение недоступны, запиши «не проверено» с причиной.
Один короткий model smoke допустим в собственной тестовой сессии с текущими
локальными настройками; не запускай нагрузочные тесты и не меняй reasoning.

## 6. Исправления и pull request

Подтверждённые дефекты исправляй минимально через существующую архитектуру.
Предпочитай общий код, выделяя Windows-only часть явно; не ломай Mac/Linux,
CSP, sandbox, auth, workspace roots, cancel/no-replay и data migration.
Добавляй нужную regression-проверку; после изменения повтори затронутые tests,
обязательные build/check и пересобери финальный installer. Обнови релевантные
документы/checkpoint фактическими Windows результатами. Если исходники не
менялись, PR только ради пересборки не нужен; полезный verification report
может идти отдельным документационным PR.

HTTPS clone/pull публичного репозитория не требует входа. Push/PR требуют GitHub
учётной записи. Проверь `gh auth status`. Если входа нет:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```

Пользователь завершает вход в браузере сам. Не проси пароль/PAT в чате,
не записывай их в код или Git remote, SSH не настраивай. Отсутствие GitHub auth
не мешает клонированию, сборке и локальной установке. При невозможности входа
сохрани локальную ветку и дай patch/bundle без секретов, честно укажи, что PR
не создан.

Если учётная запись имеет write access, push только своей рабочей ветки:

```powershell
git push -u origin '<имя своей ветки>'
gh pr create --repo VladimirKraswov/opencode-desktop --base main --head '<имя своей ветки>' --title '<конкретное исправление>' --body-file '<путь к UTF-8 описанию PR>'
```

Если write access нет, используй fork той же публичной базы, оставив основной
репозиторий отдельным upstream; не заменяй source на сторонний проект:

```powershell
gh repo fork VladimirKraswov/opencode-desktop --remote --remote-name windows-fork
```

Проверь URL созданного remote; push свою ветку в `windows-fork`, затем создай
PR с `--repo VladimirKraswov/opencode-desktop --base main --head '<GitHub-login>:<ветка>'`.
Не force-push, не merge и не публикуй GitHub release самостоятельно.
Для следующих обновлений fetch upstream/main, pull --ff-only чистого local main
и новая ветка. Исправления остаются в PR до принятия координатором на Mac.
Если в этом агенте есть штатный attach_artifact, прикрепи созданный PR к чату.

В PR укажи проблему, изменение поведения, SHA базы, точные команды/результаты,
реальные Windows проверки, ограничения и риски для Mac/Linux. Логи/скриншоты
добавляй только после удаления приватных данных. Installer, target, node_modules,
profiles, chat history, tokens и backup не коммить. Финальный installer оставь
в доступном пользователю локальном outputs/Downloads каталоге с SHA256.

В конце дай: source SHA/branch, installed version/path, installer link/SHA256,
таблицу pass/fail/not-tested, список исправлений, PR URL (если создан),
что нужно отдельно проверить координатору на Mac. Не заявляй успешную установку
по одной успешной сборке.
