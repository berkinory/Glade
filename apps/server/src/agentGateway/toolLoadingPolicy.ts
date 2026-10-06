const AUTO_LOAD_TOOLS = new Set([
  "glade_context",
  "glade_capabilities",
  "glade_interrupt_thread",
  "glade_set_thread_title",
  "glade_diagnose_thread",
  "glade_open_in_app",
  "glade_read_turn_diff",
  "glade_read_thread_diff",
  "glade_read_thread_runtime_events",
]);

export function shouldAutoLoadTool(name: string): boolean {
  return AUTO_LOAD_TOOLS.has(name);
}
