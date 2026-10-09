/** History's pending tool is not proof that a process is still running. */
export type ExecutionEvidence = 'active' | 'unconfirmed' | 'inactive';
export function executionEvidence(completed: boolean, busy: boolean, connected: boolean): ExecutionEvidence {
  if (completed) return 'inactive';
  if (!connected) return 'unconfirmed';
  return busy ? 'active' : 'inactive';
}
export function executionLabel(evidence: ExecutionEvidence) {
  return evidence === 'active' ? 'выполняется' : evidence === 'unconfirmed' ? 'статус не подтверждён: нет связи' : 'выполнение не подтверждено сервером';
}
