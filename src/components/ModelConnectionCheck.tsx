import { useEffect, useRef, useState } from "react";
import { modelServices } from "../models/services";

/** Read-only check of the failed message's exact model; never replays agent work. */
export function ModelConnectionCheck({ providerID, modelID, agent }: { providerID: string; modelID: string; agent: string }) {
  const [result, setResult] = useState(""), [checking, setChecking] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++; setResult(""); setChecking(false);
    return () => { revision.current++; };
  }, [providerID, modelID, agent]);
  if (!modelServices.manages(providerID, modelID)) return null;
  const check = async () => {
    const current = revision.current;
    setChecking(true); setResult("");
    try {
      await modelServices.check(providerID, modelID, agent);
      if (current === revision.current) setResult("Модель доступна");
    } catch (error) {
      if (current === revision.current) setResult(error instanceof Error ? error.message : "Проверка не удалась.");
    } finally {
      if (current === revision.current) setChecking(false);
    }
  };
  return <span className="model-connection-check">{' '}
    <button className="btn small ghost" disabled={checking} onClick={() => void check()}>{checking ? "Проверка…" : "Проверить модель"}</button>
    {result && <span role="status">{' '}{result}</span>}
  </span>;
}
