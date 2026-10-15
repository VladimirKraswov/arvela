// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SETTINGS_HELP } from "../src/settings/help";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingField, SettingHelp } from "../src/components/SettingHelp";
import { settingHelp } from "../src/settings/help";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){ this.setAttribute("open",""); })});
  Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){ this.removeAttribute("open"); })});
  const host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML="";vi.restoreAllMocks();vi.unstubAllGlobals(); });
const trigger=()=>document.querySelector<HTMLButtonElement>(".setting-help-trigger")!;
const open=async()=>act(async()=>{trigger().click();await import("../src/settings/help");});

it("explains the automation-signal reduction honestly, including its limits", () => {
  const help = SETTINGS_HELP["browser.reduceAutomationSignals"];
  expect(help.summary).toContain("капч");
  expect(help.values?.[0][1]).toContain("navigator.webdriver");
  expect(help.values?.[0][1]).toContain("Headless");
  expect(help.note).toContain("IP");
  expect(help.note).toContain("Совместимость");
});

it("opens a named modal, returns focus on Close, and never submits its surrounding form", async () => {
  const submit=vi.fn();act(()=>root.render(createElement("form",{onSubmit:submit},createElement(SettingHelp,{topic:"browser.storage",title:"Данные сайтов"}))));
  trigger().focus();await open();const dialog=document.querySelector("dialog")!;
  expect(dialog.open).toBe(true);expect(dialog.getAttribute("aria-labelledby")).toBe(dialog.querySelector("h2")!.id);
  expect(dialog.textContent).toContain("потребуется заново входить");expect(submit).not.toHaveBeenCalled();
  act(()=>dialog.querySelector<HTMLButtonElement>("button")!.click());expect(document.querySelector("dialog")).toBeNull();expect(document.activeElement).toBe(trigger());
});
it("Escape closes only help without changing the control or its label association", async () => {
  const change=vi.fn();act(()=>root.render(createElement(SettingField,{label:"Канал",children:createElement("select",{defaultValue:"stable",onChange:change},createElement("option",{value:"stable"},"Стабильный"),createElement("option",{value:"preview"},"Предварительный"))})));
  const select=document.querySelector("select")!;expect(select.labels?.[0].textContent).toContain("Канал");expect(trigger().closest("label")).toBeNull();
  const outerEscape=vi.fn();window.addEventListener("keydown",outerEscape);
  await open();act(()=>document.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(outerEscape).not.toHaveBeenCalled();window.removeEventListener("keydown",outerEscape);
  act(()=>document.querySelector("dialog")!.dispatchEvent(new Event("cancel",{cancelable:true})));
  expect(document.querySelector("dialog")).toBeNull();expect(select.value).toBe("stable");expect(change).not.toHaveBeenCalled();
});
it("help works next to disabled toggles without enabling or changing them", async () => {
  const change=vi.fn();act(()=>root.render(createElement(SettingField,{label:"Передавать тексты запросов и итоговых ответов",children:createElement("input",{type:"checkbox",checked:false,disabled:true,onChange:change})})));
  expect(trigger().closest("label")).toBeNull();expect(trigger().disabled).toBe(false);await open();
  expect(document.querySelector("dialog")!.textContent).toContain("не удаляет уже переданную историю");expect(document.querySelector("input")!.checked).toBe(false);expect(change).not.toHaveBeenCalled();
});
it("does not copy a credential value into the help modal", async () => {
  act(()=>root.render(createElement(SettingField,{label:"Ключ этого устройства",children:createElement("input",{type:"password",defaultValue:"PRIVATE_FIXTURE_VALUE"})})));await open();
  expect(document.querySelector("dialog")!.textContent).not.toContain("PRIVATE_FIXTURE_VALUE");
});
it("uses explicit descriptions for uncatalogued settings and omits empty help", async () => {
  expect(settingHelp("future","Новая опция","Действительное описание")).toEqual({title:"Новая опция",summary:"Действительное описание"});
  act(()=>root.render(createElement(SettingHelp,{topic:"unknown"})));expect(document.querySelector("button")).toBeNull();
});
it("explains browser privacy tradeoffs without promising site access", async () => {
  expect(settingHelp("browser.protectWebRTC")!.note).toContain("Видеозвонки");
  expect(settingHelp("browser.reduceAutomationSignals")!.note).toContain("не гарантирует обход");
  expect(settingHelp("browser.doNotTrack")!.note).toContain("не блокировщик");
});
