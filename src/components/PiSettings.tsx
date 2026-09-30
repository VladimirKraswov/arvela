// Pi's own settings section. Deliberately separate from the OpenCode sections:
// nothing here is shared, and no OpenCode setting applies to Pi.
//
// Everything shown is read back from the running Pi CLI (`--version`,
// `get_available_models`, `get_commands`, `get_state`), so the screen cannot
// claim a capability the installed engine does not have. Credentials are never
// displayed or stored by this app — Pi owns its own authentication.

import { useEffect, useState, type ReactNode } from "react";
import { store, useAppState } from "../state/store";
import { PI_CAPABILITIES } from "../agent/pi/backend";
import { piAvailability } from "../state/engines";

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{title}</span>
        {description && <small>{description}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="setting-group" aria-label={title}>
      <h2>{title}</h2>
      <div className="setting-card">{children}</div>
    </section>
  );
}

export function PiSettings() {
  const s = useAppState();
  const settings = s.prefs.pi ?? {};
  const [program, setProgram] = useState(settings.program ?? "");
  const [nodeProgram, setNodeProgram] = useState(settings.nodeProgram ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lsp, setLsp] = useState<{ servers: string[]; missing: string[] } | null>(null);
  const [access, setAccess] = useState<{ ok: boolean; detail: string } | null>(null);
  const [checkingModel, setCheckingModel] = useState("");
  const [custom, setCustom] = useState(settings.customModel ?? "");
  const [extension, setExtension] = useState("");
  const [serverPath, setServerPath] = useState("");
  const health = s.piHealth;
  const local = piAvailability(s.prefs);

  useEffect(() => {
    setProgram(s.prefs.pi?.program ?? "");
  }, [s.prefs.pi?.program]);
  useEffect(() => {
    setNodeProgram(s.prefs.pi?.nodeProgram ?? "");
  }, [s.prefs.pi?.nodeProgram]);

  const probe = async () => {
    setBusy(true);
    setError("");
    try {
      await store.refreshPiHealth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!health) void probe();
    // Intentionally once: probing starts a Pi process, so it is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = health?.install;
  const lspExtensions = settings.extensions ?? [];
  // The toggle must describe reality: without an installed extension there is
  // nothing to enable, whatever the stored preference says.
  const lspInstalled = lspExtensions.some((path) => path.endsWith("lsp-extension.ts"));
  const checkModel = async (id: string) => {
    setBusy(true);
    setCheckingModel(id);
    setAccess(null);
    try {
      setAccess(await store.checkPiModelAccess(id));
    } finally {
      setCheckingModel("");
      setBusy(false);
    }
  };

  return (
    <section className="pi-settings" aria-label="Pi">
      <p className="settings-intro">
        Pi — второй движок, отдельный от OpenCode. Он выполняется на этом
        компьютере через собственный режим RPC, со своей историей чатов, своим
        каталогом моделей и своими расширениями. Настройки OpenCode на Pi не
        распространяются.
      </p>

      <Group title="Установка">
        <Row title="Состояние">
          <span>
            {busy
              ? "Проверка…"
              : install?.installed
                ? `Найден · версия ${install.version}`
                : (install?.error ?? "Не проверено")}
          </span>
        </Row>
        {install && !install.installed && <Row title="Установка Pi" description="Откройте официальную инструкцию, установите CLI и нажмите «Сохранить и проверить». Установка не выполняется автоматически."><button className="btn" onClick={() => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#getting-started"))}>Установить Pi…</button></Row>}
        <Row
          title="Путь к Pi"
          description="Абсолютный путь. Пусто — искать в известных местах установки."
        >
          <input
            aria-label="Путь к исполняемому файлу Pi"
            spellCheck={false}
            placeholder="/opt/homebrew/bin/pi"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
          />
        </Row>
        <Row title="Обнаружено" description={install?.source || "—"}>
          <span>{install?.path || "—"}</span>
        </Row>
        <Row title="Путь к Node.js" description="Для Pi, установленного через npm. Пусто — искать рядом с Pi и в известных местах.">
          <input aria-label="Путь к Node.js для Pi" spellCheck={false} placeholder="/opt/homebrew/bin/node" value={nodeProgram} onChange={(e) => setNodeProgram(e.target.value)} />
        </Row>
        <div className="btn-row">
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              store.setPiSettings({ program: program.trim() || undefined, nodeProgram: nodeProgram.trim() || undefined });
              void probe();
            }}
          >
            Сохранить и проверить
          </button>
        </div>
      </Group>

      <Group title="Подключение">
        <Row
          title="Где выполняется"
          description="Pi работает только на этом компьютере: у режима RPC нет сетевого транспорта."
        >
          <span>{local.available ? "Этот компьютер" : "Недоступен"}</span>
        </Row>
        {!local.available && (
          <p role="status" className="handoff-note">
            {local.reason}
          </p>
        )}
        <Row
          title="Учётные данные"
          description="Ключи провайдеров хранит сам Pi (переменные окружения или его хранилище). Приложение их не читает, не показывает и не сохраняет."
        >
          <span>
            {install?.installed
              ? "Проверяются самим Pi при запросе"
              : "—"}
          </span>
        </Row>
        <Row
          title="Доступ к выбранной модели"
          description="Настроенная модель — это ещё не доступ. Проверяйте нужные модели ниже: каждая проверка отправляет один минимальный запрос. В чате доступны только проверенные модели."
        >
          <span>
            {access
              ? access.ok
                ? `Подтверждён · ${access.detail}`
                : `Не подтверждён · ${access.detail}`
              : settings.verifiedModel
                ? `Подтверждён ранее: ${settings.verifiedModel}`
                : "Не проверялся"}
          </span>
        </Row>
        <div className="btn-row">
          <button
            className="btn"
            disabled={busy || !install?.installed || !store.getModelChoice("pi")}
            onClick={() => {
              const choice = store.getModelChoice("pi");
              if (choice) void checkModel(`${choice.providerID}/${choice.modelID}`);
            }}
          >
            Проверить выбранную модель
          </button>
        </div>
      </Group>

      <Group title="Модели">
        <Row
          title="Свой идентификатор модели"
          description="provider/model. Используется, даже если модели нет во встроенном каталоге Pi — Pi принимает такие идентификаторы как пользовательские."
        >
          <input
            aria-label="Свой идентификатор модели Pi"
            spellCheck={false}
            placeholder="deepseek/deepseek-flash"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => store.setPiCustomModel(custom)}
          />
        </Row>
        <p className="handoff-note">
          Встроенный каталог Pi — это не список доступных вашему аккаунту
          моделей: он может и не знать вашу модель, и перечислять те, к которым
          нет доступа. В выборе чата появятся только модели, ответившие на проверку.
        </p>
        {custom.trim() && <div className="btn-row">
          <button className="btn" disabled={busy || !install?.installed || !/^[^/]+\/.+/.test(custom.trim())}
            onClick={() => { store.setPiCustomModel(custom); void checkModel(custom.trim()); }}>
            {checkingModel === custom.trim() ? "Проверка…" : "Проверить свою модель"}
          </button>
        </div>}
        {health?.models.length ? (
          <div className="pi-model-list">
            {health.models.map((m) => (
              <div className="kv" key={`${m.provider}/${m.id}`}>
                <span>
                  {m.name ?? m.id}
                  <small>{m.provider}</small>
                </span>
                <b>
                  {m.contextWindow
                    ? `${Math.round(m.contextWindow / 1000)}K контекст`
                    : ""}
                  {m.reasoning ? " · рассуждение" : ""}
                  {(m.input ?? []).includes("image") ? " · изображения" : ""}
                </b>
                <button className="btn" disabled={busy || !install?.installed}
                  onClick={() => void checkModel(`${m.provider}/${m.id}`)}>
                  {checkingModel === `${m.provider}/${m.id}` ? "Проверка…" :
                    settings.verifiedModels?.[`${m.provider}/${m.id}`] || settings.verifiedModel === `${m.provider}/${m.id}`
                      ? "Проверена · повторить" : "Проверить"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="handoff-note">
            {install?.installed
              ? "Pi не сообщил ни одной модели. Настройте провайдера в самом Pi (`pi auth` или ~/.pi/agent/models.json)."
              : "Сначала установите Pi."}
          </p>
        )}
      </Group>

      <Group title="Расширения, навыки и LSP">
        <Row
          title="Языковые серверы (LSP)"
          description={
            lspInstalled
              ? "Расширение установлено и передаётся Pi при запуске сессии."
              : "Расширение ещё не установлено — нажмите «Настроить LSP» ниже."
          }
        >
          <label className="switch-label">
            <input
              type="checkbox"
              disabled={!lspInstalled}
              checked={lspInstalled && settings.lspEnabled !== false}
              onChange={(e) => store.setPiSettings({ lspEnabled: e.target.checked })}
            />
            <span>
              {!lspInstalled
                ? "Не установлено"
                : settings.lspEnabled === false
                  ? "Выключено"
                  : "Включено"}
            </span>
          </label>
        </Row>
        <Row
          title="Доступ Pi к инструментам"
          description="Встроенные write/edit/bash самого Pi. «Спрашивать» — безопасное значение по умолчанию; при закрытом окне или без ответа действие отклоняется."
        >
          <select
            aria-label="Доступ Pi к инструментам"
            value={settings.toolPolicy === "full" ? "full" : "ask"}
            onChange={(e) =>
              store.setPiSettings({
                toolPolicy: e.target.value === "full" ? "full" : "ask",
              })
            }
          >
            <option value="ask">Спрашивать подтверждение</option>
            <option value="full">Полный доступ без запроса</option>
          </select>
        </Row>
        <Row
          title="Подключить языковые серверы"
          description="Ставит собственное расширение приложения (без сторонних зависимостей и фоновых демонов) и находит установленные серверы."
        >
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await store.setupPiLsp();
                setLsp(result);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Настроить LSP
          </button>
        </Row>
        {lsp && (
          <>
            {lsp.servers.map((line) => (
              <div className="kv" key={line}>
                <span>{line}</span>
                <b>готов</b>
              </div>
            ))}
            {lsp.missing.length > 0 && (
              <p className="handoff-note">
                Не найдены серверы: {lsp.missing.join(", ")}. Установите их сами
                (например, «rustup component add rust-analyzer» или
                «npm i -g typescript-language-server») и повторите.
              </p>
            )}
          </>
        )}
        <Row
          title="Загружаемые расширения"
          description="Абсолютные пути, передаются Pi через --extension при запуске сессии."
        >
          <span>{lspExtensions.length ? `${lspExtensions.length} шт.` : "Нет"}</span>
        </Row>
        <Row
          title="Путь к языковому серверу"
          description="Абсолютный путь, пробуется раньше встроенных. Нужен, когда приложение запущено из Finder и не наследует PATH."
        >
          <input
            aria-label="Путь к языковому серверу"
            spellCheck={false}
            placeholder="/opt/homebrew/bin/rust-analyzer"
            value={serverPath}
            onChange={(e) => setServerPath(e.target.value)}
          />
        </Row>
        <div className="btn-row">
          <button
            className="btn"
            disabled={!serverPath.trim().startsWith("/")}
            onClick={() => {
              const path = serverPath.trim();
              const current = settings.lspServerPaths ?? [];
              if (!current.includes(path))
                store.setPiSettings({ lspServerPaths: [...current, path] });
              setServerPath("");
            }}
          >
            Добавить путь
          </button>
        </div>
        {(settings.lspServerPaths ?? []).map((path) => (
          <div className="kv" key={path}>
            <span>{path}</span>
            <button
              className="btn"
              onClick={() =>
                store.setPiSettings({
                  lspServerPaths: (settings.lspServerPaths ?? []).filter((x) => x !== path),
                })
              }
            >
              Убрать
            </button>
          </div>
        ))}
        <Row
          title="Добавить расширение"
          description="Абсолютный путь к .ts файлу расширения Pi."
        >
          <input
            aria-label="Путь к расширению Pi"
            spellCheck={false}
            placeholder="/home/user/.pi/agent/extensions/my.ts"
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
          />
        </Row>
        <div className="btn-row">
          <button
            className="btn"
            disabled={!extension.trim().startsWith("/")}
            onClick={() => {
              const path = extension.trim();
              if (!lspExtensions.includes(path))
                store.setPiSettings({ extensions: [...lspExtensions, path] });
              setExtension("");
            }}
          >
            Добавить
          </button>
        </div>
        {lspExtensions.map((path) => (
          <div className="kv" key={path}>
            <span>{path}</span>
            <button
              className="btn"
              onClick={() =>
                store.setPiSettings({
                  extensions: lspExtensions.filter((x) => x !== path),
                })
              }
            >
              Убрать
            </button>
          </div>
        ))}
        {health?.commands.length ? (
          <div className="pi-model-list">
            {health.commands.map((c) => (
              <div className="kv" key={c.name}>
                <span>
                  /{c.name}
                  {c.description && <small>{c.description}</small>}
                </span>
                <b>{c.source}</b>
              </div>
            ))}
          </div>
        ) : null}
      </Group>

      <Group title="Возможности">
        <p className="handoff-note">
          Pi предоставляет: потоковый текст и рассуждения, шаги инструментов,
          остановку, сжатие контекста и вложения-изображения. Не предоставляет:
          терминал PTY, панель изменений Git, очередь разрешений OpenCode и
          ветвление сообщений — эти элементы интерфейса для чатов Pi скрыты, а не
          показаны неработающими. Подтверждения на инструменты выдаёт
          расширение-шлюз, которое приложение загружает в каждую сессию Pi.
        </p>
        <div className="kv">
          <span>Вложения</span>
          <b>{PI_CAPABILITIES.attachments ? "Только изображения" : "Нет"}</b>
        </div>
        <div className="kv">
          <span>Сжатие контекста</span>
          <b>{PI_CAPABILITIES.compaction ? "Есть" : "Нет"}</b>
        </div>
      </Group>

      {(error || health?.error) && (
        <p className="composer-error" role="alert">
          {error || health?.error}
        </p>
      )}
    </section>
  );
}
