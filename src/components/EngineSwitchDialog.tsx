// Choosing a different engine for an existing chat.
//
// The two engines do not share a transcript format or a session store, so a
// chat cannot simply change hands. Rather than refusing with a toast, this
// explains what will happen and takes the user into the handoff: a new chat on
// the chosen engine, seeded with an editable transcript of this one, with the
// original left untouched.

import { store, useAppState } from "../state/store";
import { Icon } from "./Icon";

const NAME: Record<string, string> = { pi: "Pi", opencode: "OpenCode" };

export function EngineSwitchDialog() {
  const s = useAppState();
  const request = s.ui.engineSwitch;
  if (!request) return null;
  const from = NAME[request.from] ?? request.from;
  const to = NAME[request.to] ?? request.to;
  const close = () => store.setUi({ engineSwitch: null });

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Перенести чат в ${to}`}
      >
        <h2>
          <Icon name="handoff" size={17} /> Перенести чат в {to}?
        </h2>
        <p className="dialog-description">
          Готовый чат «{request.session.title}» продолжает работать на {from}: у
          движков разные форматы истории и разные хранилища, поэтому переключить
          его на месте нельзя.
        </p>
        <p>
          Будет создан новый чат {to} в той же папке. В его черновик попадёт
          расшифровка этой переписки — её можно прочитать и отредактировать
          перед отправкой. Исходный чат останется без изменений, а в новом будет
          видно, откуда пришёл контекст.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={close}>
            Оставить на {from}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              void store.continueOnEngine(request.session, request.to);
            }}
          >
            Перенести в {to}
          </button>
        </div>
      </div>
    </div>
  );
}
