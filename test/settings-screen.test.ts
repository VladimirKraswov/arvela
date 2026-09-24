// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_PREFS } from "../src/state/prefs";
const fake = vi.hoisted(() => ({ state: {} as any, setUi: vi.fn(), setAsr: vi.fn(), setAppearance: vi.fn(), setTheme: vi.fn(), connect: vi.fn() }));
vi.mock('../src/state/store', () => ({ useAppState: () => fake.state, store: { ...fake, hostLabel: () => "Этот компьютер" } }));
vi.mock('../src/components/OpenCodeSettings', () => ({ OpenCodeSettings: ({ section, onDirtyChange }: any) => createElement('button', { onClick: () => onDirtyChange(true) }, `Изменить ${section}`) }));
vi.mock('../src/components/ComputerSettings', () => ({ ComputerSettings: () => createElement('p', {}, 'Cua Driver') }));
import { SettingsScreen, searchSettings } from '../src/components/SettingsScreen';
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLElement.prototype.scrollTo = vi.fn();
  fake.state = { prefs: structuredClone(DEFAULT_PREFS), ui: { settingsOpen: true }, connection: { version: "1.18.18", phase: "connected", streamState: "open" }, connectedProviderIds: ["local"], agents: [] };
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node); act(() => root.render(createElement(SettingsScreen)));
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const button = (text: string) => [...document.querySelectorAll('button')].find(e => e.textContent === text)!;
const click = (text: string) => act(() => button(text).click());
function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
it("searches actual settings and opens a matching section without altering server configuration", () => {
  expect(searchSettings('размер шрифт').map(x => x.id)).toContain('appearance'); expect(searchSettings('gigaam').map(x => x.id)).toEqual(['voice']); expect(searchSettings('not-a-setting')).toEqual([]);
  input('Поиск настроек', 'шрифт');
  const result = document.querySelector<HTMLButtonElement>('.settings-results button')!; expect(result.textContent).toContain('Внешний вид'); act(() => result.click());
  expect(document.querySelector('h1')?.textContent).toBe('Внешний вид'); expect(document.querySelector('[aria-label="Размер шрифта: Код"]')).not.toBeNull(); expect(fake.connect).not.toHaveBeenCalled(); expect(fake.setAsr).not.toHaveBeenCalled();
});
it("applies appearance independently and validates custom colors", () => {
  click('Внешний вид'); input('Размер шрифта: Сообщения', '20'); expect(fake.setAppearance).toHaveBeenCalledWith({ chatFontSize: 20 });
  input('HEX цвета', '#zzzzzz'); click('Применить цвет'); expect(document.querySelector('[role="alert"]')?.textContent).toContain('шесть');
  input('HEX цвета', '#5599ee'); click('Применить цвет'); expect(fake.setAppearance).toHaveBeenCalledWith({ accent: '#5599ee' });
  click('Сбросить оформление'); expect(fake.setAppearance).toHaveBeenCalledWith(DEFAULT_PREFS.appearance); expect(fake.setTheme).toHaveBeenCalledWith('dark'); expect(fake.setAsr).not.toHaveBeenCalled();
});
it("keeps edited ASR fields across navigation and prevents accidental exit on Escape", () => {
  click('Диктовка'); input('Модель ASR', 'edited-model'); click('Внешний вид'); click('Диктовка'); expect(document.querySelector<HTMLInputElement>('[aria-label="Модель ASR"]')!.value).toBe('edited-model');
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); expect(fake.setUi).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('несохранённые');
  click('Остаться'); click('Отменить изменения'); click('Вернуться в приложение'); expect(fake.setUi).toHaveBeenCalledWith({ settingsOpen: false }); expect(fake.setAsr).not.toHaveBeenCalled();
});
it("retains staged engine changes across settings sections and guards host navigation", () => {
  click('Инструменты'); click('Изменить tools'); click('Общее'); click('Управлять…'); expect(fake.setUi).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).not.toBeNull(); click('Не сохранять и выйти'); expect(fake.setUi).toHaveBeenCalledWith({ settingsOpen: false, hostDialogOpen: true });
});
